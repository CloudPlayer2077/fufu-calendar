'use strict';
/**
 * 用 CDP 测量页面各层元素的实际宽度，定位横向溢出的元凶。
 * 用法：node tools/measure.js [url] [width]
 */

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8794/';
const VIEW_W = parseInt(process.argv[3] || '390', 10);
const CDP_PORT = 9333;

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-measure-' + Date.now());

async function main() {
  const proc = spawn(EDGE, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${VIEW_W},844`,
    `--user-data-dir=${profile}`,
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();

  // 等 CDP 端口起来
  let list = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      list = await res.json();
      if (list && list.length) break;
    } catch (e) { /* retry */ }
  }
  if (!list || !list.length) {
    console.error('CDP 没起来');
    cleanup(proc);
    process.exit(1);
  }

  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  ws.addEventListener('message', ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW_W, height: 844, deviceScaleFactor: 1, mobile: true
  });

  await send('Page.navigate', { url: URL_TARGET });
  await new Promise(r => setTimeout(r, 3500));

  // 可选：截图前先执行一段 JS（用来切视图、展开抽屉等）
  const evalJs = process.argv[5];
  if (evalJs) {
    await send('Runtime.evaluate', { expression: evalJs, awaitPromise: false });
    await new Promise(r => setTimeout(r, 900));
  }

  // 用 CDP 截一张精确视口的图，避免外部截图工具视口不准
  const shotPath = process.argv[4];
  if (shotPath) {
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false
    });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log('截图已保存:', shotPath);
    console.log('');
  }

  const expr = `
(function () {
  var out = [];
  var vw = document.documentElement.clientWidth;
  function m(sel) {
    var el = document.querySelector(sel);
    if (!el) return { sel: sel, missing: true };
    var r = el.getBoundingClientRect();
    return {
      sel: sel,
      w: Math.round(r.width),
      right: Math.round(r.right),
      scrollW: el.scrollWidth,
      overflow: el.scrollWidth > el.clientWidth + 1
    };
  }
  var sels = [
    'html', 'body', '#app', '.sidebar', '.main', '.topbar',
    '#content', '#view-calendar', '.cal-head', '.month-label',
    '.cal-grid-wrap', '.cal-grid', '.cal-week', '.cal-week-cells', '.cal-bar'
  ];
  sels.forEach(function (s) { out.push(m(s)); });
  return JSON.stringify({ viewport: vw, bodyScrollW: document.body.scrollWidth, items: out }, null, 1);
})()
`;

  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  });

  console.log('视口宽度:', VIEW_W);
  try {
    const data = JSON.parse(r.result.value);
    console.log('body.scrollWidth =', data.bodyScrollW,
      data.bodyScrollW > data.viewport ? '  ⚠ 横向溢出' : '  ✓ 未溢出');
    console.log('');
    console.log('选择器                      宽度   右边缘  滚动宽  溢出');
    console.log('-'.repeat(64));
    for (const it of data.items) {
      if (it.missing) { console.log(pad(it.sel) + '  (不存在)'); continue; }
      console.log(
        pad(it.sel) +
        String(it.w).padStart(6) +
        String(it.right).padStart(8) +
        String(it.scrollW).padStart(8) +
        (it.overflow ? '   ⚠' : '')
      );
    }
  } catch (e) {
    console.log('原始返回:', r.result && r.result.value);
  }

  ws.close();
  cleanup(proc);
}

function pad(s) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, 26 - s.length));
}

function cleanup(proc) {
  try { proc.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }, 500);
}

main().catch(e => { console.error(e); process.exit(1); });
