'use strict';
/**
 * 本地测试 Pages Functions 的路由逻辑。
 * 不需要 wrangler，直接调纯函数 handler。
 *
 * 用法：node scripts/test-handler.cjs
 */

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

(async () => {
  let handleApi;
  try {
    ({ handleApi } = await import('../lib/handler.mjs'));
  } catch (e) {
    console.error('无法加载 handler.mjs：' + e.message);
    console.error('请先运行：node scripts/build.cjs');
    process.exit(1);
  }

  const call = (path, method, qs) =>
    handleApi(path, method || 'GET', new URLSearchParams(qs || ''));

  const parse = r => JSON.parse(r.body);

  console.log('\n=== 1. 基础接口 ===');
  {
    const r = call('/api/health');
    const d = parse(r);
    ok('health 返回 200', r.status === 200);
    ok('health 标记 readonly', d.mode === 'readonly');
  }

  console.log('\n=== 2. bootstrap ===');
  let boot;
  {
    const r = call('/api/bootstrap');
    boot = parse(r);
    ok('bootstrap 返回 200', r.status === 200);
    ok('ok 为 true', boot.ok === true);
    ok('标记 readonly', boot.readonly === true);
    ok('games 有 4 款', Array.isArray(boot.games) && boot.games.length === 4);
    ok('categories 有 6 个', Array.isArray(boot.categories) && boot.categories.length === 6);
    ok('events 有数据', Array.isArray(boot.events) && boot.events.length > 0,
      '实际 ' + (boot.events ? boot.events.length : 0) + ' 条');
    ok('now 格式正确', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(boot.now));
    ok('settings 不含 ai 字段', !boot.settings.ai);
    ok('事件时间格式合法', boot.events.every(e =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.startAt) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.endAt)));
    ok('事件不带个人痕迹字段',
      boot.events.every(e => e.ackReminders === undefined && e.snoozeUntil === undefined));
  }

  console.log('\n=== 3. 事件查询 ===');
  {
    const r = call('/api/events');
    const d = parse(r);
    ok('events 返回 200', r.status === 200);
    ok('返回全部事件', d.events.length === boot.events.length);

    const g = parse(call('/api/events', 'GET', 'games=genshin'));
    ok('按游戏筛选', g.events.length > 0 && g.events.every(e => e.game === 'genshin'),
      '筛出 ' + g.events.length + ' 条');

    const c = parse(call('/api/events', 'GET', 'categories=activity'));
    ok('按分类筛选', c.events.every(e => e.category === 'activity'));

    const d2 = parse(call('/api/events', 'GET', 'from=2026-10-01&to=2026-10-31'));
    ok('按日期区间筛选', Array.isArray(d2.events));

    const one = boot.events[0];
    const byId = call('/api/events/' + one.id);
    ok('按 id 查询', byId.status === 200 && parse(byId).event.id === one.id);

    const missing = call('/api/events/ev_not_exist');
    ok('查不存在的 id 返回 404', missing.status === 404);
  }

  console.log('\n=== 4. 只读约束 ===');
  {
    const r = call('/api/events', 'POST');
    ok('POST 新建被拒绝', r.status === 403);
    ok('拒绝时带中文说明', /只读|预览版/.test(parse(r).error || ''));

    const r2 = call('/api/events/abc', 'PUT');
    ok('PUT 编辑被拒绝', r2.status === 403);

    const r3 = call('/api/events/abc', 'DELETE');
    ok('DELETE 被拒绝', r3.status === 403);

    const r4 = call('/api/events/bulk', 'POST');
    ok('批量导入被拒绝', r4.status === 403);

    const r5 = call('/api/ocr', 'POST');
    ok('OCR 上传被拒绝', r5.status === 403);
  }

  console.log('\n=== 5. 兼容接口 ===');
  {
    const r = call('/api/reminders/due');
    const d = parse(r);
    ok('reminders 返回空数组（不报错）', r.status === 200 && Array.isArray(d.due) && d.due.length === 0);

    const s = parse(call('/api/settings'));
    ok('settings 可读', s.ok === true && s.settings !== undefined);

    const src = parse(call('/api/sources'));
    ok('sources 返回空列表', src.ok === true && Array.isArray(src.sources));

    const nf = call('/api/not-exist');
    ok('未知 GET 返回 404', nf.status === 404);
  }

  console.log('\n=== 6. CORS 头 ===');
  {
    const r = call('/api/bootstrap');
    ok('带 Access-Control-Allow-Origin', r.headers['Access-Control-Allow-Origin'] === '*');
    ok('Content-Type 是 JSON', /application\/json/.test(r.headers['Content-Type']));
  }

  console.log('\n' + '='.repeat(46));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('\n失败项：');
    failures.forEach(f => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
