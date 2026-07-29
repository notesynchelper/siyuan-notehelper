/**
 * dock 同步状态徽标：状态推导（纯函数）+ DOM 控制器的关键不变式。
 *
 * jest 环境是 node、没有 jsdom，所以下面用一个刚好够用的极简 fake DOM 跑
 * DockSyncBadge。要守的不变式有三条，都是坏了会静默的那种：
 *   1. 点徽标不能冒泡到 dock 按钮（否则顺带把面板开合了）
 *   2. 同一个按钮上不能叠出多个圆点
 *   3. 按钮晚到（afterLoadPlugin 晚于 onLayoutReady）时要能重试挂上
 */

import {
    computeSyncBadgeState,
    describeSyncBadge,
    DockSyncBadge,
    BADGE_CLASS,
    DOCK_ITEM_CLASS,
} from '../src/ui/syncBadge';

// ————————————————————— 纯函数 —————————————————————

describe('computeSyncBadgeState', () => {
    const base = { apiKey: 'k', syncAt: '2026-07-28T00:00:00Z', syncing: false, lastSyncFailed: false };

    it('已配置且上次成功 → synced', () => {
        expect(computeSyncBadgeState(base)).toBe('synced');
    });

    it('没有 apiKey → unconfigured', () => {
        expect(computeSyncBadgeState({ ...base, apiKey: '' })).toBe('unconfigured');
    });

    it('已配置但从未同步 → never', () => {
        expect(computeSyncBadgeState({ ...base, syncAt: '' })).toBe('never');
    });

    it('上次同步失败 → error（压过 never/synced）', () => {
        expect(computeSyncBadgeState({ ...base, lastSyncFailed: true })).toBe('error');
        expect(computeSyncBadgeState({ ...base, syncAt: '', lastSyncFailed: true })).toBe('error');
    });

    it('同步中压过其它一切状态', () => {
        expect(
            computeSyncBadgeState({ apiKey: '', syncAt: '', syncing: true, lastSyncFailed: true })
        ).toBe('syncing');
    });

    it('空输入不炸，落到 unconfigured', () => {
        expect(computeSyncBadgeState({})).toBe('unconfigured');
    });
});

describe('describeSyncBadge', () => {
    it('类名带上状态修饰符，方便 CSS 和 E2E 断言', () => {
        const { className } = describeSyncBadge('error');
        expect(className).toContain(BADGE_CLASS);
        expect(className).toContain(`${BADGE_CLASS}--error`);
    });

    it('已同步时提示里带上次同步时间', () => {
        expect(describeSyncBadge('synced', '2026-07-28 09:30').tooltip).toContain('2026-07-28 09:30');
    });

    it('除同步中外，提示都说明「点一下会同步」', () => {
        (['synced', 'never', 'error', 'unconfigured'] as const).forEach((state) => {
            expect(describeSyncBadge(state).tooltip).toMatch(/点击/);
        });
        expect(describeSyncBadge('syncing').tooltip).not.toMatch(/点击/);
    });
});

// ————————————————————— 极简 fake DOM —————————————————————

const DOCK_TYPE = 'notehelper_sync_dock';
const PLUGIN_NAME = 'siyuan-notehelper';
// SiYuan `Plugin.addDock` 内部：`const n = this.name + e.type`，按钮上的 data-type 是这个。
const PREFIXED_DOCK_TYPE = `${PLUGIN_NAME}${DOCK_TYPE}`;

class FakeElement {
    className = '';
    children: FakeElement[] = [];
    parent: FakeElement | null = null;
    attrs: Record<string, string> = {};
    classes = new Set<string>();
    listeners: Record<string, Array<(e: any) => void>> = {};

    constructor(public tag: string) {}

    get classList() {
        return {
            add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
            contains: (n: string) => this.classes.has(n),
        };
    }

    appendChild(child: FakeElement) {
        child.parent = this;
        this.children.push(child);
    }

    remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
    }

    setAttribute(name: string, value: string) {
        this.attrs[name] = value;
    }

    getAttribute(name: string) {
        return this.attrs[name];
    }

    addEventListener(type: string, fn: (e: any) => void) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
    }

    removeEventListener(type: string, fn: (e: any) => void) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }

    /** 只支持 `.some-class` 形式，够本测试用。 */
    querySelectorAll(selector: string): FakeElement[] {
        const want = selector.replace(/^\./, '');
        const out: FakeElement[] = [];
        const walk = (node: FakeElement) => {
            node.children.forEach((c) => {
                if (c.className.split(/\s+/).includes(want)) out.push(c);
                walk(c);
            });
        };
        walk(this);
        return out;
    }

    /** 触发一次点击，返回这次事件对象（便于断言 stopPropagation 被调用）。 */
    click() {
        const event = {
            stopPropagationCalled: false,
            preventDefaultCalled: false,
            stopPropagation() { this.stopPropagationCalled = true; },
            preventDefault() { this.preventDefaultCalled = true; },
        };
        (this.listeners['click'] || []).forEach((fn) => fn(event));
        return event;
    }
}

class FakeDoc {
    root = new FakeElement('body');
    button: FakeElement | null = null;

    /**
     * 模拟 SiYuan afterLoadPlugin 画出侧栏按钮。
     * dataType 默认用【加了插件名前缀】的真实值 —— SiYuan 的 addDock 是
     * `const n = this.name + e.type`，按钮上的 data-type 是前缀后的那个。
     */
    addDockButton(dataType: string = PREFIXED_DOCK_TYPE) {
        const btn = new FakeElement('span');
        btn.setAttribute('data-type', dataType);
        this.button = btn;
        this.root.appendChild(btn);
        return btn;
    }

    /** 模拟 SiYuan 重建侧栏（旧按钮连同徽标一起脱离文档）。 */
    rebuildDockButton() {
        const dataType = this.button?.getAttribute('data-type') ?? PREFIXED_DOCK_TYPE;
        if (this.button) this.button.remove();
        return this.addDockButton(dataType);
    }

    querySelector(selector: string): FakeElement | null {
        const m = /^\.dock__item\[data-type="(.+)"\]$/.exec(selector);
        if (!m) return null;
        return this.button && this.button.getAttribute('data-type') === m[1] ? this.button : null;
    }

    createElement(tag: string) {
        return new FakeElement(tag);
    }

    contains(el: FakeElement | null) {
        let node = el;
        while (node) {
            if (node === this.root) return true;
            node = node.parent;
        }
        return false;
    }
}

const makeBadge = (doc: FakeDoc, onSync = jest.fn(), extra: Record<string, unknown> = {}) =>
    new DockSyncBadge({
        dockTypes: [PREFIXED_DOCK_TYPE, DOCK_TYPE],
        onSync,
        doc: doc as unknown as Document,
        retries: 3,
        retryDelayMs: 10,
        ...extra,
    });

const badgesOn = (btn: FakeElement) => btn.querySelectorAll(`.${BADGE_CLASS}`);

// ————————————————————— DOM 控制器 —————————————————————

describe('DockSyncBadge', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    // 回归：最初的实现只查裸 type，而 SiYuan 的 addDock 会把 type 前缀成
    // `${plugin.name}${type}` 再渲染到按钮的 data-type 上 —— 选择器永远落空，
    // 徽标在真机上根本不出现，且单测（自造裸 type 按钮）还是绿的。
    it('命中 SiYuan 加了插件名前缀的 data-type', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton(PREFIXED_DOCK_TYPE);
        makeBadge(doc).start();

        expect(badgesOn(btn)).toHaveLength(1);
    });

    it('裸 type 作为兜底候选也能命中', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton(DOCK_TYPE);
        makeBadge(doc).start();

        expect(badgesOn(btn)).toHaveLength(1);
    });

    it('data-type 完全对不上时不乱挂到别的按钮上', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton('someOtherPluginDock');
        makeBadge(doc).start();
        jest.advanceTimersByTime(10 * 10);

        expect(badgesOn(btn)).toHaveLength(0);
    });

    it('按钮已在 DOM 里时立刻挂上，并给按钮加定位类', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton();
        makeBadge(doc).start();

        expect(badgesOn(btn)).toHaveLength(1);
        expect(btn.classList.contains(DOCK_ITEM_CLASS)).toBe(true);
    });

    it('按钮晚到时靠重试挂上（afterLoadPlugin 晚于 onLayoutReady）', () => {
        const doc = new FakeDoc();
        makeBadge(doc).start();

        // 第一轮没找到按钮
        expect(doc.button).toBeNull();

        const btn = doc.addDockButton();
        jest.advanceTimersByTime(10);

        expect(badgesOn(btn)).toHaveLength(1);
    });

    it('重试次数用尽后就不再无限轮询', () => {
        const doc = new FakeDoc();
        makeBadge(doc).start();

        jest.advanceTimersByTime(10 * 10); // 远超 retries=3
        const btn = doc.addDockButton();
        jest.advanceTimersByTime(10 * 10);

        expect(badgesOn(btn)).toHaveLength(0);
    });

    it('点徽标触发同步，且阻止事件冒泡到 dock 按钮（否则会开合面板）', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton();
        const onSync = jest.fn();
        makeBadge(doc, onSync).start();

        const event = badgesOn(btn)[0].click();

        expect(onSync).toHaveBeenCalledTimes(1);
        expect(event.stopPropagationCalled).toBe(true);
        expect(event.preventDefaultCalled).toBe(true);
    });

    it('反复 start/update 也只有一个圆点', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton();
        const badge = makeBadge(doc);

        badge.start();
        badge.start();
        badge.update({ apiKey: 'k', syncAt: '2026-07-28T00:00:00Z' });
        badge.update({ apiKey: 'k', syncing: true });

        expect(badgesOn(btn)).toHaveLength(1);
    });

    it('update 把状态写进 class 和 aria-label', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton();
        const badge = makeBadge(doc);
        badge.start();

        badge.update({ apiKey: '', syncAt: '' });
        expect(badge.getState()).toBe('unconfigured');
        expect(badgesOn(btn)[0].className).toContain(`${BADGE_CLASS}--unconfigured`);

        badge.update({ apiKey: 'k', syncing: true });
        expect(badgesOn(btn)[0].className).toContain(`${BADGE_CLASS}--syncing`);
        expect(badgesOn(btn)[0].getAttribute('aria-label')).toBe('正在同步…');
    });

    it('SiYuan 重建 dock 按钮后，update 会把徽标重新挂到新按钮上', () => {
        const doc = new FakeDoc();
        const oldBtn = doc.addDockButton();
        const badge = makeBadge(doc);
        badge.start();
        expect(badgesOn(oldBtn)).toHaveLength(1);

        const newBtn = doc.rebuildDockButton();
        badge.update({ apiKey: 'k', syncAt: '2026-07-28T00:00:00Z' });

        expect(badgesOn(newBtn)).toHaveLength(1);
        expect(newBtn.classList.contains(DOCK_ITEM_CLASS)).toBe(true);
    });

    it('destroy 摘掉圆点，之后 update 不再复活它', () => {
        const doc = new FakeDoc();
        const btn = doc.addDockButton();
        const badge = makeBadge(doc);
        badge.start();

        badge.destroy();
        expect(badgesOn(btn)).toHaveLength(0);

        badge.update({ apiKey: 'k', syncing: true });
        expect(badgesOn(btn)).toHaveLength(0);
    });

    it('destroy 后不再有待触发的重试定时器', () => {
        const doc = new FakeDoc();
        const badge = makeBadge(doc);
        badge.start();

        badge.destroy();
        const btn = doc.addDockButton();
        jest.advanceTimersByTime(10 * 10);

        expect(badgesOn(btn)).toHaveLength(0);
    });
});
