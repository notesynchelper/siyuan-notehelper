/**
 * 左侧栏 dock 按钮上的同步状态徽标。
 *
 * 借鉴 flomo 同步插件「顶栏图标当状态灯」的做法，但落点改在 dock 按钮上：
 * addTopBar 每次调用都会向 #barPlugins 追加新 DOM 且不去重，重复触发会叠出一排
 * 图标（本插件已因此彻底移除顶栏）；dock 侧栏按钮按 type 唯一，重复注册是覆盖
 * 而非叠加，安全得多。
 *
 * 徽标同时是一个同步入口：点它直接跑一次手动同步，且必须阻止事件冒泡到 dock
 * 按钮本身——否则会顺带开合面板。
 *
 * 状态一律由【本地已知信息】推导，不发任何额外网络请求。
 */

export type SyncBadgeState =
    | 'unconfigured' // 没填 API Key
    | 'never'        // 已配置但从未同步过
    | 'syncing'      // 正在同步
    | 'error'        // 上次同步失败
    | 'synced';      // 已同步且上次成功

export interface SyncBadgeInput {
    apiKey?: string;
    syncAt?: string;
    syncing?: boolean;
    lastSyncFailed?: boolean;
}

export const BADGE_CLASS = 'notehelper-dock-badge';
export const DOCK_ITEM_CLASS = 'notehelper-dock-item';

/**
 * 纯函数：由本地状态推导徽标状态。
 * 优先级：同步中 > 未配置 > 上次失败 > 从未同步 > 已同步。
 * 「同步中」压过「未配置」是有意的——没 API Key 时 performSync 会直接报错返回，
 * 不会进入 syncing 态，所以这个顺序不会把两种状态混淆。
 */
export function computeSyncBadgeState(input: SyncBadgeInput): SyncBadgeState {
    if (input.syncing) return 'syncing';
    if (!input.apiKey) return 'unconfigured';
    if (input.lastSyncFailed) return 'error';
    if (!input.syncAt) return 'never';
    return 'synced';
}

/** 纯函数：徽标状态 → CSS 类名 + 悬浮提示文案。 */
export function describeSyncBadge(
    state: SyncBadgeState,
    lastSyncLabel?: string
): { className: string; tooltip: string } {
    const className = `${BADGE_CLASS} ${BADGE_CLASS}--${state} b3-tooltips b3-tooltips__e`;
    switch (state) {
        case 'syncing':
            return { className, tooltip: '正在同步…' };
        case 'unconfigured':
            return { className, tooltip: '未配置 API Key · 点击同步' };
        case 'error':
            return { className, tooltip: '上次同步失败 · 点击重试' };
        case 'never':
            return { className, tooltip: '尚未同步 · 点击立即同步' };
        case 'synced':
        default:
            return {
                className,
                tooltip: lastSyncLabel
                    ? `上次同步 ${lastSyncLabel} · 点击立即同步`
                    : '点击立即同步',
            };
    }
}

export interface DockSyncBadgeOptions {
    /**
     * 侧栏按钮 data-type 的候选值，按优先级排列，命中第一个就用它。
     *
     * ⚠️ 不能直接用 addDock 时传的 type：SiYuan 的 `Plugin.addDock` 内部是
     * `const n = this.name + e.type`，登记进 `plugin.docks` 的键、以及 `genButton()`
     * 渲染到按钮上的 `data-type`，都是【加了插件名前缀】的那个值。所以调用方要把
     * `${plugin.name}${type}` 和裸 type 一起传进来。
     */
    dockTypes: string[];
    /** 点击徽标时执行（手动同步）。 */
    onSync: () => void;
    /** 便于测试注入；默认取全局 document。 */
    doc?: Document;
    /** dock 按钮由 afterLoadPlugin 生成，可能晚于 onLayoutReady，故留有界重试。 */
    retries?: number;
    retryDelayMs?: number;
}

/**
 * 徽标的 DOM 控制器。所有 DOM 触碰都收在这里，状态推导在上面的纯函数里。
 */
export class DockSyncBadge {
    private readonly dockTypes: string[];
    private readonly onSync: () => void;
    private readonly doc: Document;
    private readonly retries: number;
    private readonly retryDelayMs: number;

    private el: HTMLElement | null = null;
    private state: SyncBadgeState = 'never';
    private tooltip = '';
    private timer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    constructor(options: DockSyncBadgeOptions) {
        this.dockTypes = options.dockTypes.filter(Boolean);
        this.onSync = options.onSync;
        this.doc = options.doc || document;
        this.retries = options.retries ?? 20;
        this.retryDelayMs = options.retryDelayMs ?? 500;
    }

    /** 开始挂载（带有界重试）。幂等，重复调用不会挂出两个徽标。 */
    start(): void {
        this.tryAttach(this.retries);
    }

    /** 用最新状态刷新徽标；按钮若被 SiYuan 重建过会自动重新挂载。 */
    update(input: SyncBadgeInput, lastSyncLabel?: string): void {
        if (this.destroyed) return;
        this.state = computeSyncBadgeState(input);
        this.tooltip = describeSyncBadge(this.state, lastSyncLabel).tooltip;
        if (this.el && this.doc.contains(this.el)) {
            this.render();
            return;
        }
        // 旧节点已脱离文档（dock 按钮被重建）：丢掉它重新挂一个。
        this.el = null;
        this.attach();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.el) {
            this.el.removeEventListener('click', this.onClick);
            this.el.remove();
            this.el = null;
        }
    }

    /** 仅供测试/排查：当前徽标状态。 */
    getState(): SyncBadgeState {
        return this.state;
    }

    private findButton(): HTMLElement | null {
        for (const type of this.dockTypes) {
            const el = this.doc.querySelector(
                `.dock__item[data-type="${type}"]`
            ) as HTMLElement | null;
            if (el) return el;
        }
        return null;
    }

    private tryAttach(remaining: number): void {
        if (this.destroyed) return;
        if (this.attach()) return;
        if (remaining <= 0) return;
        this.timer = setTimeout(() => this.tryAttach(remaining - 1), this.retryDelayMs);
    }

    /** 返回是否已挂载成功。 */
    private attach(): boolean {
        if (this.destroyed) return false;
        if (this.el && this.doc.contains(this.el)) return true;

        const button = this.findButton();
        if (!button) return false;

        // 按钮可能已经带着上一轮的徽标（比如 start() 与 update() 撞车）：先清干净，
        // 避免同一个按钮上叠出多个圆点。
        button.querySelectorAll(`.${BADGE_CLASS}`).forEach((stale) => stale.remove());

        const el = this.doc.createElement('span');
        el.addEventListener('click', this.onClick);
        button.classList.add(DOCK_ITEM_CLASS);
        button.appendChild(el);
        this.el = el;
        this.render();
        return true;
    }

    private render(): void {
        if (!this.el) return;
        const { className } = describeSyncBadge(this.state);
        this.el.className = className;
        this.el.setAttribute('aria-label', this.tooltip);
        this.el.setAttribute('data-notehelper-badge-state', this.state);
    }

    private onClick = (event: MouseEvent): void => {
        // 徽标是独立入口：绝不能冒泡到 dock 按钮，否则会顺带开合面板。
        event.preventDefault();
        event.stopPropagation();
        this.onSync();
    };
}
