/**
 * splitContentByTables 拆分逻辑测试
 *
 * 覆盖：
 *  - 基本拆分（markdown / html-table / markdown）
 *  - 无表格直接返回整体 markdown
 *  - P2#1：代码块（``` / ~~~）里的字面 <table> 不能被误判成真表格
 *  - P2#2：<div class="table-wrap"><table>…</table></div> 这类带包裹的表格，
 *          必须把包裹的 div 一起放进同一个 html-table 片段（不能留孤儿标签）
 */
import { splitContentByTables, ContentSegment } from '../src/settings/template';

const TABLE = '<table><thead><tr><th>City</th></tr></thead><tbody><tr><td>Tokyo</td></tr></tbody></table>';

function types(segs: ContentSegment[]): string[] {
    return segs.map((s) => s.type);
}

describe('splitContentByTables — 基本行为', () => {
    test('无表格 → 单个 markdown 片段', () => {
        const segs = splitContentByTables('# 标题\n\n正文一段，没有任何表格。');
        expect(segs).toHaveLength(1);
        expect(segs[0].type).toBe('markdown');
    });

    test('表格被前后 markdown 夹着 → md / html-table / md', () => {
        const segs = splitContentByTables(`前言段落。\n\n${TABLE}\n\n收尾段落。`);
        expect(types(segs)).toEqual(['markdown', 'html-table', 'markdown']);
        expect(segs[1].content).toContain('<table');
        expect(segs[1].content).toContain('Tokyo');
    });
});

describe('splitContentByTables — P2#1 代码块里的 <table> 不算表格', () => {
    test('``` 围栏代码块里的 <table> 不拆分，整体仍是 markdown', () => {
        const md = '讲解 HTML 表格语法：\n\n```html\n' + TABLE + '\n```\n\n以上是示例。';
        const segs = splitContentByTables(md);
        expect(types(segs)).toEqual(['markdown']);
        expect(segs[0].content).toBe(md);
    });

    test('~~~ 围栏同样有效', () => {
        const md = '~~~\n' + TABLE + '\n~~~';
        const segs = splitContentByTables(md);
        expect(types(segs)).toEqual(['markdown']);
    });

    test('真表格 + 代码块里的假表格 → 只有真表格被抽出', () => {
        const md = `真实表格：\n\n${TABLE}\n\n代码示例：\n\n\`\`\`html\n${TABLE}\n\`\`\``;
        const segs = splitContentByTables(md);
        const tableSegs = segs.filter((s) => s.type === 'html-table');
        expect(tableSegs).toHaveLength(1);
        // 代码块整体应保留在某个 markdown 片段里（围栏没被破坏）
        expect(segs.some((s) => s.type === 'markdown' && s.content.includes('```html'))).toBe(true);
    });
});

describe('splitContentByTables — P2#2 带包裹的表格连同 div 一起抽取', () => {
    test('<div class="table-wrap"> 包裹 → html-table 片段含包裹 div，无孤儿标签', () => {
        const wrapped = `<div class="table-wrap">${TABLE}</div>`;
        const segs = splitContentByTables(`前言。\n\n${wrapped}\n\n收尾。`);
        const tableSegs = segs.filter((s) => s.type === 'html-table');
        expect(tableSegs).toHaveLength(1);
        const t = tableSegs[0].content;
        expect(t).toContain('<div class="table-wrap"');
        expect(t.trimEnd().endsWith('</div>')).toBe(true);
        expect(t).toContain('<table');
        // markdown 片段里不能留下孤儿的 <div>/</div>
        for (const s of segs) {
            if (s.type === 'markdown') {
                expect(s.content).not.toMatch(/^\s*<\/div>/);
                expect(s.content).not.toMatch(/<div class="table-wrap">\s*$/);
            }
        }
    });

    test('多层包裹 <figure><div><table>…</div></figure> 全部一起抽取', () => {
        const wrapped = `<figure><div>${TABLE}</div></figure>`;
        const segs = splitContentByTables(wrapped);
        const tableSegs = segs.filter((s) => s.type === 'html-table');
        expect(tableSegs).toHaveLength(1);
        expect(tableSegs[0].content).toContain('<figure>');
        expect(tableSegs[0].content.trimEnd().endsWith('</figure>')).toBe(true);
    });
});
