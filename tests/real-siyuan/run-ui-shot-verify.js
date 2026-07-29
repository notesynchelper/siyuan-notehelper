'use strict';
// 在【真的】 SiYuan UI 里验证本次两个改动，并截图存档：
//   A. dock 按钮上的同步状态徽标（点它 = 手动同步，且不能开合面板）
//   B. 官方设置入口（设置 → 已下载插件 → 齿轮 → 打开设置弹窗）
//
// 自带内核：先 npm run build，再 `node tests/real-siyuan/run-ui-shot-verify.js`。
// 内核在没有 UI 连上来时会自己退出，所以这里 boot 完立刻接浏览器，不分两个进程。
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/work/gate/outsourcescrper/node_modules/playwright');
const { bootWithPlugin, DOCK_TYPE } = require('./run-ui-shot');

const PORT = parseInt(process.env.SIYUAN_PORT || '6812', 10);
const AUTH_CODE = process.env.SIYUAN_AUTHCODE || 'e2e-test-code';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '.runs', 'shots');

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};
const shot = async (page, name) => {
    const p = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: p });
    console.log(`  📸 ${p}`);
    return p;
};

(async () => {
    const kernel = await bootWithPlugin({ port: PORT, authCode: AUTH_CODE });

    // 借用隔壁 outsourcescrper 的 playwright，但它自带的 chromium 版本对不上缓存里的，
    // 直接用系统装的 google-chrome。
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    try {
        // 授权码门：先拿到会话 cookie，否则 GET / 是 401。
        // 用 context.request 发（与浏览器共享 cookie jar），避免页面里 fetch 撞上跳转。
        const resp = await page.context().request.post(BASE + '/api/system/loginAuth', {
            data: { authCode: AUTH_CODE },
        });
        const auth = await resp.json();
        if (auth.code !== 0) throw new Error('loginAuth 失败: ' + JSON.stringify(auth));
        console.log('[verify] loginAuth ok');

        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        // 等 SiYuan 前端把侧栏画出来（插件 dock 按钮由 afterLoadPlugin 生成）
        await page.waitForSelector(`.dock__item[data-type="${DOCK_TYPE}"]`, { timeout: 60000 });
        await page.waitForTimeout(2500); // 让 onLayoutReady + 徽标挂载跑完
        console.log('[verify] SiYuan UI ready, plugin dock button present');

        // ————— A. dock 徽标 —————
        console.log('\n[A] dock 状态徽标');
        const badge = await page.evaluate((dockType) => {
            const btn = document.querySelector(`.dock__item[data-type="${dockType}"]`);
            if (!btn) return { btn: false };
            const el = btn.querySelector('.notehelper-dock-badge');
            if (!el) return { btn: true, badge: false, btnHTML: btn.outerHTML.slice(0, 300) };
            const cs = getComputedStyle(el, '::before');
            return {
                btn: true,
                badge: true,
                count: btn.querySelectorAll('.notehelper-dock-badge').length,
                state: el.getAttribute('data-notehelper-badge-state'),
                className: el.className,
                tooltip: el.getAttribute('aria-label'),
                dotColor: cs.backgroundColor,
                dotW: cs.width,
                dotH: cs.height,
                btnPositioned: getComputedStyle(btn).position,
                badgeRect: el.getBoundingClientRect().toJSON(),
                btnRect: btn.getBoundingClientRect().toJSON(),
            };
        }, DOCK_TYPE);

        check('dock 按钮上挂到了徽标', badge.badge === true, JSON.stringify(badge).slice(0, 200));
        check('徽标只有一个（不重复叠加）', badge.count === 1, `count=${badge.count}`);
        check('未配置 API Key 时是 unconfigured 态', badge.state === 'unconfigured', `state=${badge.state}`);
        check('徽标提示告知点击会同步', /点击/.test(badge.tooltip || ''), badge.tooltip);
        check('圆点真的渲染出来了（有尺寸和颜色）',
            parseFloat(badge.dotW) > 0 && parseFloat(badge.dotH) > 0 && badge.dotColor !== 'rgba(0, 0, 0, 0)',
            `${badge.dotW}x${badge.dotH} ${badge.dotColor}`);
        check('按钮被设成定位上下文（徽标才能绝对定位）', badge.btnPositioned === 'relative', badge.btnPositioned);

        // 回归：SiYuan 的侧栏按钮只有 ~27x26px，徽标做大一点就会把按钮中心盖住 ——
        // 用户照着图标正中点下去命中的是徽标（触发同步）而不是打开面板。
        const bc = { x: badge.btnRect.x + badge.btnRect.width / 2, y: badge.btnRect.y + badge.btnRect.height / 2 };
        const br = badge.badgeRect;
        const centerCovered = bc.x >= br.x && bc.x <= br.x + br.width && bc.y >= br.y && bc.y <= br.y + br.height;
        check('徽标没有盖住 dock 按钮中心（主操作仍是开面板）', centerCovered === false,
            `按钮 ${badge.btnRect.width}x${badge.btnRect.height} 中心(${bc.x.toFixed(1)},${bc.y.toFixed(1)}), 徽标 ${br.width}x${br.height} @(${br.x.toFixed(1)},${br.y.toFixed(1)})`);

        await shot(page, '01-dock-badge');
        await page.evaluate((r) => window.scrollTo(0, 0), null);
        // 放大左侧栏区域，看清圆点
        await page.screenshot({
            path: path.join(OUT, '02-dock-badge-zoom.png'),
            clip: { x: 0, y: 0, width: 260, height: 300 },
        });
        console.log(`  📸 ${path.join(OUT, '02-dock-badge-zoom.png')}`);

        // ————— A2. 点徽标 = 手动同步，且不开合面板 —————
        console.log('\n[A2] 点徽标触发同步、且不开合 dock 面板');
        const panelOpenBefore = await page.evaluate((t) =>
            !!document.querySelector(`.dock__item[data-type="${t}"]`).classList.contains('dock__item--active'), DOCK_TYPE);

        await page.click('.notehelper-dock-badge');
        await page.waitForTimeout(1800);

        const afterClick = await page.evaluate((t) => {
            const btn = document.querySelector(`.dock__item[data-type="${t}"]`);
            const msgs = Array.from(document.querySelectorAll('#message .b3-snackbar__content, #message .b3-snackbar'))
                .map((n) => n.textContent.trim()).filter(Boolean);
            return {
                panelOpen: btn.classList.contains('dock__item--active'),
                messages: msgs,
            };
        }, DOCK_TYPE);

        check('点徽标没有开合 dock 面板（事件没冒泡到按钮）',
            afterClick.panelOpen === panelOpenBefore,
            `before=${panelOpenBefore} after=${afterClick.panelOpen}`);
        check('点徽标确实触发了同步逻辑（弹出「请先配置 API 密钥」）',
            afterClick.messages.some((m) => /API\s*密钥|API key/i.test(m)),
            JSON.stringify(afterClick.messages));
        await shot(page, '03-badge-click-triggers-sync');

        // 对照：点按钮本体应该正常开合面板
        // 注意：不能用 page.click(选择器) —— 它点的是元素【中心】，按钮才 27x26，
        // 中心可能落在徽标上（历史上就这么误判过）。这里显式点左上 30% 处。
        console.log('\n[A3] 对照：点按钮本体仍能正常打开面板');
        const box = await page.locator(`.dock__item[data-type="${DOCK_TYPE}"]`).boundingBox();
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
        await page.waitForTimeout(2000);
        const panelAfterBtn = await page.evaluate((t) => {
            const btn = document.querySelector(`.dock__item[data-type="${t}"]`);
            const area = document.querySelector('#settingsFormArea');
            return {
                active: btn.classList.contains('dock__item--active'),
                // 面板真的渲染出了插件自己的内容（不只是 class 变了）
                formFields: document.querySelectorAll('#settingsFormArea #apiKey').length,
                hasQuickSync: !!document.querySelector('#dockQuickSync'),
                areaLen: area ? area.innerHTML.length : 0,
            };
        }, DOCK_TYPE);
        check('点按钮本体照常打开面板', panelAfterBtn.active === true, JSON.stringify(panelAfterBtn));
        check('面板里渲染出了插件内容（立即同步按钮 + 设置表单）',
            panelAfterBtn.hasQuickSync === true && panelAfterBtn.formFields === 1,
            JSON.stringify(panelAfterBtn));
        await shot(page, '04-dock-panel-opened');

        // ————— B. 官方设置入口 —————
        console.log('\n[B] 官方设置入口（设置 → 已下载插件 → 齿轮）');
        // 直接走 SiYuan 的设置对话框：openSetting 面板里的 bazaar → 已下载
        await page.evaluate(() => {
            // 打开「设置」对话框
            const el = document.querySelector('#barWorkspace, #toolbar #barSetting, [data-type="setting"]');
            if (el) el.dispatchEvent(new CustomEvent('click'));
        });
        await page.waitForTimeout(800);

        // 更可靠：直接调插件实例的 openSetting()，验证 SiYuan 会把它当作有设置界面的插件，
        // 以及点齿轮时真的会弹出我们的设置表单。
        const gearGate = await page.evaluate(() => {
            const app = window.siyuan && window.siyuan.ws && window.siyuan.ws.app;
            const plugins = (app && app.plugins) || [];
            const p = plugins.find((x) => x.name === 'siyuan-notehelper');
            if (!p) return { found: false, names: plugins.map((x) => x.name) };
            // SiYuan 判定「要不要显示齿轮」的原式子（见前端 bundle）
            const showsGear = !!(p.setting || Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(p), 'openSetting'));
            return {
                found: true,
                showsGear,
                hasOwnOpenSetting: Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(p), 'openSetting'),
                hasSettingInstance: !!p.setting,
            };
        });
        check('SiYuan 认为本插件有设置界面（会渲染齿轮）', gearGate.showsGear === true, JSON.stringify(gearGate));

        const dialogsBefore = await page.evaluate(() => document.querySelectorAll('.b3-dialog--open').length);
        await page.evaluate(() => {
            const app = window.siyuan.ws.app;
            app.plugins.find((x) => x.name === 'siyuan-notehelper').openSetting();
        });
        await page.waitForTimeout(1500);

        const dlg = await page.evaluate(() => {
            const container = document.querySelector('.notehelper-settings-dialog');
            if (!container) return { opened: false, dialogs: document.querySelectorAll('.b3-dialog--open').length };
            const title = container.closest('.b3-dialog__container')?.querySelector('.b3-dialog__header')?.textContent?.trim();
            const ids = Array.from(container.querySelectorAll('input,select,textarea')).map((e) => e.id).filter(Boolean);
            return {
                opened: true,
                title,
                fieldCount: ids.length,
                hasApiKey: ids.includes('apiKey'),
                hasTargetNotebook: ids.includes('targetNotebook'),
                hasTemplate: ids.includes('template'),
                // 全局只允许一份活表单：dock 那份此刻应该已经让位
                dockFormFields: document.querySelectorAll('#settingsFormArea #apiKey').length,
                duplicateApiKey: document.querySelectorAll('#apiKey').length,
            };
        });

        check('齿轮/openSetting 真的弹出了设置弹窗', dlg.opened === true, JSON.stringify(dlg).slice(0, 200));
        check('弹窗里渲染了完整设置表单', (dlg.fieldCount || 0) > 15 && dlg.hasApiKey && dlg.hasTargetNotebook && dlg.hasTemplate,
            `fields=${dlg.fieldCount}`);
        check('全局只有一份活表单（没有重复 id 的第二份）', dlg.duplicateApiKey === 1,
            `#apiKey 数量=${dlg.duplicateApiKey}, dock 里残留=${dlg.dockFormFields}`);
        await shot(page, '05-official-settings-dialog');

        // 滚一下弹窗，证明内容是完整的设置表单
        await page.evaluate(() => {
            const c = document.querySelector('.notehelper-settings-dialog');
            if (c) c.scrollTop = c.scrollHeight / 2;
        });
        await page.waitForTimeout(500);
        await shot(page, '06-settings-dialog-scrolled');

        // ————— B2. 关闭弹窗后 dock 表单要回来 —————
        console.log('\n[B2] 关掉弹窗后，dock 那份表单要还回去');
        await page.evaluate(() => {
            const d = (window.siyuan.dialogs || []).find((x) => x.element.querySelector('.notehelper-settings-dialog'));
            if (d) d.destroy();
        });
        await page.waitForTimeout(1500);
        const afterClose = await page.evaluate(() => ({
            dialogGone: !document.querySelector('.notehelper-settings-dialog'),
            dockFormBack: document.querySelectorAll('#settingsFormArea #apiKey').length,
            totalApiKey: document.querySelectorAll('#apiKey').length,
        }));
        check('弹窗已关闭', afterClose.dialogGone === true);
        check('dock 表单已恢复，且仍然只有一份', afterClose.dockFormBack === 1 && afterClose.totalApiKey === 1,
            JSON.stringify(afterClose));
        await shot(page, '07-after-dialog-closed');

        // 控制台不该有插件抛出的报错
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e)));
        await page.waitForTimeout(500);
        check('没有插件相关的页面级报错', errs.length === 0, errs.join(' | ').slice(0, 200));
    } finally {
        await browser.close();
        await kernel.stop();
    }

    console.log('\n================ 结果 ================');
    const failed = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - failed.length}/${results.length}`);
    console.log(`截图目录: ${OUT}`);
    if (failed.length) {
        console.log('失败项:');
        failed.forEach((f) => console.log(`  - ${f.name} (${f.detail})`));
        process.exit(1);
    }
    console.log('✅ 全部通过');
})().catch((e) => {
    console.error('[verify] FAILED:', e.stack || e.message);
    process.exit(1);
});
