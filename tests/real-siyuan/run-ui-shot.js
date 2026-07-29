'use strict';
// 起一个【真的】无头 SiYuan 内核，把本仓库 dist/ 里的插件真安装真启用。
//
// 与 run-sync-smoke.js 的区别：那个是 Node 重驱动 src/sync/*、内核只当 /api 后端用，
// 不加载插件；这里要验证的是【UI】（dock 按钮徽标、官方设置入口），所以必须让插件
// 真正在内核的前端里跑起来。
//
// 直接运行：把内核留在前台供人工浏览（Ctrl-C 结束）
//   SIYUAN_PORT=6812 node tests/real-siyuan/run-ui-shot.js
// 作为模块：run-ui-shot-verify.js 用 bootWithPlugin() 起内核后立刻接浏览器。
const fs = require('fs');
const path = require('path');
const { startKernel } = require('./lib/kernel');

const PORT = parseInt(process.env.SIYUAN_PORT || '6812', 10);
const AUTH_CODE = process.env.SIYUAN_AUTHCODE || 'e2e-test-code';
const REPO = path.resolve(__dirname, '../..');
const DIST = path.join(REPO, 'dist');
const WS = path.join(__dirname, '.runs', process.env.WS_NAME || 'ws-ui-shot');
const PLUGIN_ID = 'siyuan-notehelper';
// plugin.name + addDock 传的 type —— SiYuan 的 addDock 内部是 `this.name + e.type`，
// 侧栏按钮上的 data-type 是前缀后的值。
const DOCK_TYPE = `${PLUGIN_ID}notehelper_sync_dock`;

const log = (...a) => console.log('[ui-shot]', ...a);

function installPluginInto(ws) {
    const target = path.join(ws, 'data', 'plugins', PLUGIN_ID);
    fs.mkdirSync(target, { recursive: true });
    for (const f of ['index.js', 'index.css', 'plugin.json', 'icon.png', 'preview.png', 'README.md']) {
        fs.copyFileSync(path.join(DIST, f), path.join(target, f));
    }
    log('copied dist ->', target);

    // petals.json 是「已启用插件」清单
    const petalDir = path.join(ws, 'data', 'storage', 'petal');
    fs.mkdirSync(petalDir, { recursive: true });
    fs.writeFileSync(
        path.join(petalDir, 'petals.json'),
        JSON.stringify([{ name: PLUGIN_ID, enabled: true }], null, '\t')
    );
    log('wrote petals.json (enabled=true)');

    // 关键：非 Docker(ContainerStd) 模式下 loadPetals() 会因 conf.bazaar.trust!==true
    // 静默 early-return，插件根本不加载。conf.json 只有首次启动后才存在，
    // 所以流程必须是：先启一次 → 停 → 装 → 再启。
    const confPath = path.join(ws, 'conf', 'conf.json');
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    conf.bazaar = conf.bazaar || {};
    conf.bazaar.trust = true;
    conf.bazaar.petalDisabled = false;
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
    log('set bazaar.trust=true, petalDisabled=false');
}

/**
 * 起一个装好本插件的内核，返回 kernel 句柄。
 * ⚠️ 内核在【没有 UI 连上来】时会自己退出（kernel.log 里 "no active UI proc" → "exited kernel"），
 * 所以调用方拿到句柄后要尽快把浏览器接上，中间别隔太久。
 */
async function bootWithPlugin({ port = PORT, ws = WS, authCode = AUTH_CODE } = {}) {
    if (!fs.existsSync(path.join(DIST, 'index.js'))) {
        throw new Error(`dist/index.js 不存在，先跑 npm run build（REPO=${REPO}）`);
    }
    fs.rmSync(ws, { recursive: true, force: true });

    log('boot #1 (generate conf.json) ...');
    let kernel = await startKernel({ port, workspace: ws, authCode, lang: 'zh_CN' });
    await kernel.stop();
    log('boot #1 done, kernel stopped');

    installPluginInto(ws);

    log('boot #2 (with plugin) ...');
    kernel = await startKernel({ port, workspace: ws, authCode, lang: 'zh_CN' });

    // 校验插件真的被内核认到了（jsBytes>0 说明代码读进去了）
    const petals = await kernel.rest('/api/petal/loadPetals', { frontend: 'desktop' });
    const mine = (petals || []).find((p) => p.name === PLUGIN_ID);
    if (!mine) throw new Error('内核没有加载到插件（loadPetals 里找不到 ' + PLUGIN_ID + '）');
    log(`plugin loaded: enabled=${mine.enabled} jsBytes=${(mine.js || '').length} cssBytes=${(mine.css || '').length}`);
    if (!mine.enabled || !(mine.js || '').length) throw new Error('插件未启用或 js 为空');
    if (!(mine.css || '').includes('notehelper-dock-badge')) {
        throw new Error('内核下发的 css 里没有 notehelper-dock-badge —— 徽标样式没打进 dist/index.css');
    }
    log('css contains notehelper-dock-badge ✓');
    return kernel;
}

module.exports = { bootWithPlugin, installPluginInto, PORT, AUTH_CODE, WS, PLUGIN_ID, DOCK_TYPE };

if (require.main === module) {
    (async () => {
        const kernel = await bootWithPlugin();
        console.log('');
        console.log('================ 内核已就绪 ================');
        console.log(`  URL      : http://127.0.0.1:${PORT}/`);
        console.log(`  授权码   : ${AUTH_CODE}`);
        console.log(`  workspace: ${WS}`);
        console.log(`  api token: ${kernel.token}`);
        console.log('  ⚠️ 没有 UI 连上来的话内核会自行退出，请尽快打开上面的 URL');
        console.log('  Ctrl-C 结束（优雅关闭内核）');
        console.log('===========================================');

        const shutdown = async () => {
            log('stopping kernel ...');
            await kernel.stop();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        setInterval(() => {}, 1 << 30); // 挂住进程
    })().catch((e) => {
        console.error('[ui-shot] FAILED:', e.message);
        process.exit(1);
    });
}
