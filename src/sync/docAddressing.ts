/**
 * 思源结构化文档寻址（3.8.9+）：resolveDocPath + createDocByParent
 *
 * 背景：3.8.9 起旧字符串路径接口 createDocWithMd 写入前校验每一层父路径前缀，只要某层
 *   - 有 ≥2 个同名同级文档（多设备云同步合并、手动建过同名文档……3.8.8 下都合法），或
 *   - 祖先链里有空标题文档 / 标题含 "/" 的文档（hpath 会和真正的父级撞车）
 * 就返回 "document path is ambiguous; use a document ID or resolveDocPath"（上游 #20892，
 * 有意为之，不会回退）。3.8.9 同时提供了按标题段逐级解析、按父文档 ID 创建的新接口。
 *
 * 本模块：
 *   - 探测内核是否提供新接口（3.8.8 及以前没有，调用方回退旧接口）；
 *   - 按标题段逐级解析目录，遇到同名多个时选"能往下匹配得最深"的那个（并列取 ID 最小 =
 *     最早建的），从而落到用户已有内容的那条链上，不另起炉灶；
 *   - 缺的目录层用 createDocByParent 逐层补建（带名称条件，防并发重复补建）；
 *   - 最终文档用 createDocByParent 按父 ID 创建。
 *
 * 环境无关：只经 getRuntime().kernel 访问内核，前端与 kernel bundle 共用。
 */

import { getRuntime } from './runtimeAdapter';
import { logger } from '../utils/logger';

// 用 RegExp 构造：tsconfig target=es6 不允许 \p{} 字面量，运行时（Electron/Node）均支持
const KERNEL_TITLE_INVALID = new RegExp('[^\\p{L}\\p{M}\\p{N}\\p{P}\\p{S} \\u3000\\u200d]', 'gu');

/** 歧义层最多展开的候选数（真实场景通常 2 个，防病态笔记本指数级请求） */
const MAX_AMBIGUOUS_CANDIDATES = 8;

interface DocMeta {
    id: string;
    displayPath?: string;
}

interface ResolveResult {
    status: 'resolved' | 'missing' | 'ambiguous';
    resolved: DocMeta | null;
    nextIndex: number;
    candidates: DocMeta[];
}

/** 结构化接口返回 code≠0 时抛出，携带内核给的 reason / commitState */
export class DocAddressingError extends Error {
    constructor(message: string, readonly reason?: string, readonly commitState?: string) {
        super(message);
        this.name = 'DocAddressingError';
    }
}

/**
 * 把一段路径/文件名转换成 createDocByParent 能接受的标题。
 *
 * 旧接口会默默替换换行、制表符、"/" 并截断到 512 字；新接口改为严格校验（首尾空白、
 * 不可见字符、"."/".." 一律 invalidTitle），所以这里先做与旧接口等价的清洗。
 */
export function toDocTitle(raw: string): string {
    let title = String(raw ?? '')
        // 旧接口 documentBaseNameReplacer 的等价处理
        .replace(/\r\n|[\r\n\u2028\u2029\t]/g, '')
        .replace(/\//g, '')
        // 内核 normalizeTitleText 的等价处理（gulu RemoveInvisible + RemovePUA，保留 ZWJ）：
        // NBSP→空格；只保留 Go unicode.IsPrint 认可的字符（L/M/N/P/S + ASCII 空格）及全角空格。
        // 软连字符、零宽空格、PUA 等不可见字符会让 createDocByParent/resolveDocPath 判 invalidTitle。
        .replace(/\u00a0/g, ' ')
        .replace(KERNEL_TITLE_INVALID, '')
        .trim();
    const chars = Array.from(title);
    if (chars.length > 512) {
        title = chars.slice(0, 512).join('').trim();
    }
    if (title === '' || title === '.' || title === '..') {
        return '未命名';
    }
    return title;
}

/** 兜底清洗：内核仍判 invalidTitle 时连 ZWJ 等全部 Unicode 控制/格式类字符一起去掉再试一次 */
function toStrictDocTitle(raw: string): string {
    return toDocTitle(String(raw ?? '').replace(new RegExp('\\p{C}', 'gu'), ''));
}

/** 生成思源块 ID：yyyyMMddHHmmss-7 位小写字母数字 */
export function newNodeId(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
        + `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 7; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${ts}-${suffix}`;
}

/** 把 "a/b/c" 形式的路径拆成清洗后的标题段（忽略空段） */
export function splitDocPath(docPath: string): string[] {
    return String(docPath ?? '')
        .replace(/\\/g, '/')
        .split('/')
        .map(s => s.trim())
        .filter(Boolean)
        .map(toDocTitle);
}

export class DocAddressing {
    // 只缓存确定的结论；网络异常等不确定情况下次再探
    private supported: boolean | null = null;
    // 同一歧义路径每个实例只 WARN 一次：诊断日志只留 100 条 WARN/ERROR，逐篇刷屏会挤掉真正的错误
    private warnedAmbiguous = new Set<string>();

    /** 每轮同步开始时调用：让每轮同步对同一歧义路径各提示一次 */
    resetPerSync(): void {
        this.warnedAmbiguous.clear();
    }

    /**
     * 内核是否提供 resolveDocPath / createDocByParent（思源 3.8.9+）。
     * 旧内核对未知路由返回非 JSON（SPA 回落页 / 404），解析失败即判定为不支持。
     */
    async isSupported(notebookId: string): Promise<boolean> {
        if (this.supported !== null) return this.supported;
        let response;
        try {
            response = await getRuntime().kernel('/api/filetree/resolveDocPath', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notebook: notebookId, start: { kind: 'root' }, segments: [] }),
            });
        } catch (error) {
            logger.warn('[DocAddressing] 探测结构化接口失败（本次按旧接口处理）:', error);
            return false;
        }
        if (response.status === 404) {
            this.supported = false;
            return false;
        }
        try {
            const data = await response.json();
            // 路由存在时无论成功与否都会返回 {code,...}（例如元数据未就绪也是 JSON 错误）
            this.supported = !!data && typeof data === 'object' && typeof data.code === 'number';
        } catch {
            this.supported = false;
        }
        logger.info(`[DocAddressing] 结构化文档接口${this.supported ? '可用（思源 3.8.9+）' : '不可用，使用旧路径接口'}`);
        return this.supported;
    }

    /**
     * 在 docPath（"目录/.../标题"）处创建文档：逐级解析/补建目录，再按父 ID 创建。
     * @returns 新文档 ID
     */
    async createDocAtPath(notebookId: string, docPath: string, markdown: string): Promise<string> {
        const rawParts = String(docPath ?? '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(Boolean);
        if (rawParts.length === 0) {
            throw new Error(`Failed to create document: empty path`);
        }
        const folder = rawParts.slice(0, -1).map(toDocTitle);
        const rawTitle = rawParts[rawParts.length - 1];
        const parentId = await this.ensureFolder(notebookId, folder);
        try {
            return await this.createByParent(notebookId, parentId, toDocTitle(rawTitle), markdown);
        } catch (error) {
            if (error instanceof DocAddressingError && error.reason === 'invalidTitle') {
                const strict = toStrictDocTitle(rawTitle);
                logger.warn(`[DocAddressing] 标题被内核判为无效，清洗后重试: "${rawTitle}" -> "${strict}"`);
                return await this.createByParent(notebookId, parentId, strict, markdown);
            }
            throw error;
        }
    }

    /**
     * 确保目录链存在，返回最深一层目录文档 ID（null = 笔记本根）。
     * 名称条件冲突（并发补建了同名目录）时重新解析一次。
     */
    async ensureFolder(notebookId: string, segments: string[]): Promise<string | null> {
        for (let attempt = 0; ; attempt++) {
            const best = await this.resolveBest(notebookId, null, segments, '');
            let parentId = best.id;
            try {
                for (let i = best.depth; i < segments.length; i++) {
                    parentId = await this.createByParent(notebookId, parentId, segments[i], '', true);
                    logger.info(`[DocAddressing] 补建目录文档 /${segments.slice(0, i + 1).join('/')} -> ${parentId}`);
                }
                return parentId;
            } catch (error) {
                if (attempt === 0 && error instanceof DocAddressingError && error.reason === 'planChanged') {
                    logger.warn('[DocAddressing] 目录在解析后被并发创建，重新解析:', error.message);
                    continue;
                }
                throw error;
            }
        }
    }

    /**
     * 从 startId（null=根）按标题段解析，返回能匹配到的最深文档及深度。
     * 某层同名多个时逐个往下试，选匹配最深的；并列取候选顺序中的第一个（内核按 ID 排序 = 最早建的）。
     */
    private async resolveBest(
        notebookId: string,
        startId: string | null,
        segments: string[],
        prefix: string,
    ): Promise<{ id: string | null; depth: number }> {
        const r = await this.resolve(notebookId, startId, segments);
        if (r.status === 'resolved') {
            return { id: r.resolved?.id ?? startId, depth: segments.length };
        }
        if (r.status === 'missing') {
            return { id: r.resolved?.id ?? startId, depth: r.nextIndex };
        }

        const where = `${prefix}/${segments.slice(0, r.nextIndex + 1).join('/')}`;
        const rest = segments.slice(r.nextIndex + 1);
        const candidates = (r.candidates || []).slice(0, MAX_AMBIGUOUS_CANDIDATES);
        if (candidates.length === 0) {
            throw new DocAddressingError(`resolveDocPath returned ambiguous without candidates`, 'pathAmbiguous');
        }
        let best: { id: string | null; depth: number } | null = null;
        for (const c of candidates) {
            const sub = rest.length > 0
                ? await this.resolveBest(notebookId, c.id, rest, where)
                : { id: c.id, depth: 0 };
            const depth = r.nextIndex + 1 + sub.depth;
            if (!best || depth > best.depth) {
                best = { id: sub.id ?? c.id, depth };
            }
            if (best.depth === segments.length) break;
        }
        const msg = `[DocAddressing] 路径 "${where}" 有 ${r.candidates.length} 个同名文档，选用匹配最深的一条（${best!.depth}/${segments.length} 层）`;
        if (this.warnedAmbiguous.has(where)) {
            logger.debug(msg);
        } else {
            this.warnedAmbiguous.add(where);
            logger.warn(msg);
        }
        return best!;
    }

    private async resolve(notebookId: string, startId: string | null, segments: string[]): Promise<ResolveResult> {
        const response = await getRuntime().kernel('/api/filetree/resolveDocPath', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                notebook: notebookId,
                start: startId ? { kind: 'document', id: startId } : { kind: 'root' },
                segments,
            }),
        });
        const data = await response.json();
        if (data.code !== 0) {
            throw new DocAddressingError(`Failed to resolve document path: ${data.msg}`, data.data?.reason);
        }
        return data.data as ResolveResult;
    }

    private async createByParent(
        notebookId: string,
        parentId: string | null,
        title: string,
        markdown: string,
        requireAbsent = false,
    ): Promise<string> {
        const id = newNodeId();
        const body: Record<string, unknown> = {
            notebook: notebookId,
            parentID: parentId,
            id,
            title: { format: 'plain', text: title },
            markdown,
        };
        if (requireAbsent) {
            // 目录层：要求此刻不存在同名子文档，防止并发同步补建出重复目录
            body.nameConditions = [{ parentID: parentId, title, expectedID: null }];
        }
        const response = await getRuntime().kernel('/api/filetree/createDocByParent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (data.code !== 0) {
            const reason = data.data?.reason;
            const commitState = data.data?.commitState;
            // 文档已保存但后续步骤（排序/模板）失败：文档本身可用，返回 ID，避免重试造重复
            if (commitState === 'committed' && typeof data.data?.id === 'string') {
                logger.warn(`[DocAddressing] 文档已创建但后续步骤失败（${reason}）: ${data.msg}`);
                return data.data.id;
            }
            throw new DocAddressingError(
                `Failed to create document: ${data.msg}${reason ? ` (reason=${reason}, commitState=${commitState})` : ''}`,
                reason,
                commitState,
            );
        }
        return data.data?.id || id;
    }
}
