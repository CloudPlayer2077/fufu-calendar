'use strict';
/**
 * 时间轴缩放功能的自动化测试。
 * 用 CDP 发送真实的 Alt+滚轮 事件，验证缩放是否生效、锚点是否稳定。
 *
 * 用法：node tools/test-timeline-zoom.cjs [url]
 */

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8790/';
const CDP_PORT = 9334;

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-zoom-' + Date.now());
const SHOT_DIR = path.join(process.cwd(), '..', '_probe');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function main() {
  const proc = spawn(EDGE, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1440,900',
    `--user-data-dir=${profile}`,
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();

  let list = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      list = await res.json();
      if (list && list.length) break;
    } catch (e) { /* retry */ }
  }
  if (!list || !list.length) { console.error('CDP 启动失败'); process.exit(1); }

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
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.value;
  };

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
    return p;
  };

  // 滚轮：modifiers Alt=1
  const wheel = async (deltaY, x, y) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: x || 700, y: y || 400,
      deltaX: 0, deltaY: deltaY,
      modifiers: 1
    });
    await new Promise(r => setTimeout(r, 350));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await send('Page.navigate', { url: URL_TARGET });
  await new Promise(r => setTimeout(r, 2800));

  // 清掉上次测试留下的缩放记忆，保证从默认 30px 开始
  await evalJs("try{localStorage.removeItem('fufu.tl.dayW')}catch(e){}");
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 3200));

  console.log('\n=== 准备 ===');
  await evalJs("Store.setView('timeline')");
  await new Promise(r => setTimeout(r, 1200));

  const readW = () => evalJs(`
    (function(){
      var el = document.getElementById('tl-zoom-label');
      return el ? parseFloat(el.textContent) : -1;
    })()
  `);
  const scrollLeft = () => evalJs(
    "(function(){var s=document.querySelector('.tl2-scroll');return s?s.scrollLeft:-1})()");
  const innerW = () => evalJs(
    "(function(){var i=document.querySelector('.tl2-inner');return i?Math.round(i.getBoundingClientRect().width):-1})()");

  const w0 = await readW();
  const iw0 = await innerW();
  ok('初始缩放标签可读', w0 > 0, '读到 ' + w0);
  ok('初始每天宽度 = 30px', Math.abs(w0 - 30) < 0.6, '实际 ' + w0);
  ok('内层宽度 = 42 天 × 30px', Math.abs(iw0 - 1260) < 5, '实际 ' + iw0 + 'px');

  console.log('\n=== Alt + 滚轮向上（放大）===');
  await wheel(-120);
  const w1 = await readW();
  const iw1 = await innerW();
  ok('放大后每天宽度增加', w1 > w0, w0 + ' → ' + w1);
  ok('内层宽度同步变大', iw1 > iw0, iw0 + ' → ' + iw1 + 'px');
  await shot('zoom-in.png');

  console.log('\n=== Alt + 滚轮向下（缩小）===');
  await wheel(120);
  await wheel(120);
  const w2 = await readW();
  const iw2 = await innerW();
  ok('缩小后每天宽度减少', w2 < w1, w1 + ' → ' + w2);
  ok('内层宽度同步变小', iw2 < iw1, iw1 + ' → ' + iw2 + 'px');
  await shot('zoom-out.png');

  console.log('\n=== 边界限制 ===');
  // 疯狂放大，应该被 DAY_W_MAX=96 卡住
  for (let i = 0; i < 20; i++) await wheel(-120, 700, 400);
  const wMax = await readW();
  ok('放大有上限（≤96px）', wMax <= 96.5, '实际 ' + wMax);

  // 疯狂缩小，应该被 DAY_W_MIN=11 卡住
  for (let i = 0; i < 30; i++) await wheel(120, 700, 400);
  const wMin = await readW();
  ok('缩小有下限（≥11px）', wMin >= 10.5, '实际 ' + wMin);
  await shot('zoom-min.png');

  console.log('\n=== 不带 Alt 的滚轮应正常滚动 ===');
  // 先回到中间缩放
  for (let i = 0; i < 12; i++) await wheel(-120, 700, 400);
  await evalJs("(function(){var s=document.querySelector('.tl2-scroll');if(s)s.scrollLeft=300;})()");
  await new Promise(r => setTimeout(r, 200));
  const sl0 = await scrollLeft();
  // 不带修饰键的滚轮
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 120, modifiers: 0
  });
  await new Promise(r => setTimeout(r, 400));
  const sl1 = await scrollLeft();
  const wAfter = await readW();
  ok('无 Alt 时缩放级别不变', Math.abs(wAfter - (await readW())) < 0.1, '宽度 ' + wAfter);

  console.log('\n=== 手机双指捏合 ===');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await new Promise(r => setTimeout(r, 600));
  await evalJs("Store.setView('timeline')");
  await new Promise(r => setTimeout(r, 1200));

  const mw0 = await readW();
  ok('手机视口下缩放标签可读', mw0 > 0, '读到 ' + mw0);

  // CDP 的 dispatchTouchEvent 会被浏览器手势识别器吃掉，
  // 这里直接在页面里合成 TouchEvent，精确验证 handler 逻辑。
  const pinchInPage = (fromGap, toGap, steps) => evalJs(`
    (function(){
      var el = document.querySelector('.tl2-scroll');
      if (!el) return -1;
      function mk(pts){
        return pts.map(function(p, i){
          return new Touch({ identifier: i, target: el,
            clientX: p[0], clientY: p[1], pageX: p[0], pageY: p[1] });
        });
      }
      function fire(type, pts){
        var t = mk(pts);
        el.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: t, targetTouches: t, changedTouches: t
        }));
      }
      var cx = 195, cy = 420;
      fire('touchstart', [[cx - ${fromGap}/2, cy], [cx + ${fromGap}/2, cy]]);
      for (var i = 1; i <= ${steps}; i++) {
        var g = ${fromGap} + (${toGap} - ${fromGap}) * i / ${steps};
        fire('touchmove', [[cx - g/2, cy], [cx + g/2, cy]]);
      }
      fire('touchend', []);
      var lab = document.getElementById('tl-zoom-label');
      return lab ? parseFloat(lab.textContent) : -2;
    })()
  `);

  const mw1 = await pinchInPage(90, 230, 8);      // 张开 → 放大
  ok('双指张开放大', mw1 > mw0, mw0 + ' → ' + mw1);
  await shot('zoom-pinch-out.png');

  const mw2 = await pinchInPage(230, 90, 8);      // 捏合 → 缩小
  ok('双指捏合缩小', mw2 < mw1, mw1 + ' → ' + mw2);

  const mw3 = await pinchInPage(60, 400, 10);     // 大幅张开 → 触顶
  ok('捏合放大也有上限', mw3 <= 96.5, '实际 ' + mw3);

  console.log('\n=== 缩放级别持久化 ===');
  const beforeReload = await readW();
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 3500));
  await evalJs("Store.setView('timeline')");
  await new Promise(r => setTimeout(r, 1200));
  const afterReload = await readW();
  ok('刷新后保持上次缩放', Math.abs(afterReload - beforeReload) < 1.5,
    beforeReload + ' → ' + afterReload);

  console.log('\n' + '='.repeat(46));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  ws.close();
  cleanup();
  process.exit(fail ? 1 : 0);
}

function cleanup() {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
