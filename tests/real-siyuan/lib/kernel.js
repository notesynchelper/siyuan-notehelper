'use strict';
// Launch a REAL headless SiYuan kernel for E2E. The kernel is a standalone,
// statically-linked ELF that serves both the web UI and the /api/* REST surface
// the plugin calls — no Docker, no Go, no Electron, no Xvfb. Proven on this box.
//
// Note: for the Node-driven harness the kernel only needs to serve /api/*. We do
// NOT install/enable the plugin inside the kernel (no petals.json / bazaar.trust
// dance) — the Node process re-drives the plugin's own code against the kernel.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = process.env.SIYUAN_RUNTIME || '/home/work/siyuan-runtime';
const RESOURCES = path.join(RUNTIME, 'siyuan-3.6.5-linux', 'resources');
const KERNEL_BIN = path.join(RESOURCES, 'kernel', 'SiYuan-Kernel');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startKernel({
  port = 6808,
  workspace,
  authCode = 'e2e-test-code',
  lang = 'en_US',
  bootTimeoutMs = 40000,
} = {}) {
  if (!fs.existsSync(KERNEL_BIN)) {
    throw new Error(
      `SiYuan kernel binary missing: ${KERNEL_BIN}\n` +
        `Download + extract siyuan-3.6.5-linux.tar.gz under ${RUNTIME} (see README).`
    );
  }
  if (!workspace) throw new Error('startKernel: workspace is required');
  fs.mkdirSync(workspace, { recursive: true });

  const logPath = path.join(workspace, 'kernel.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    KERNEL_BIN,
    [
      '--wd', RESOURCES,
      '--workspace', workspace,
      '--port', String(port),
      '--accessAuthCode', authCode,
      '--mode', 'prod',
      '--lang', lang,
    ],
    { stdio: ['ignore', logFd, logFd] }
  );

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + bootTimeoutMs;
  let booted = false;
  while (Date.now() < deadline) {
    await sleep(800);
    try {
      const r = await fetch(`${base}/api/system/bootProgress`, { method: 'POST' });
      const j = await r.json();
      if (j && j.data && j.data.progress === 100) { booted = true; break; }
    } catch (_) { /* not up yet */ }
  }
  if (!booted) {
    try { child.kill('SIGTERM'); } catch (_) {}
    throw new Error(`kernel did not reach bootProgress=100 within ${bootTimeoutMs}ms (log: ${logPath})`);
  }

  const conf = JSON.parse(fs.readFileSync(path.join(workspace, 'conf', 'conf.json'), 'utf8'));
  const token = conf.api && conf.api.token;
  if (!token) throw new Error('could not read api.token from conf.json');

  // REST helper: POST /api/* with admin token; throws on non-zero kernel code.
  async function rest(apiPath, body = {}) {
    const r = await fetch(`${base}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`kernel ${apiPath} -> code=${j.code} msg=${j.msg}`);
    return j.data;
  }

  function stop() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; try { fs.closeSync(logFd); } catch (_) {} resolve(); } };
      child.on('exit', finish);
      try { child.kill('SIGTERM'); } catch (_) { finish(); }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} finish(); }, 8000);
    });
  }

  return { base, port, token, rest, stop, pid: child.pid, logPath };
}

module.exports = { startKernel, KERNEL_BIN, RESOURCES, RUNTIME };
