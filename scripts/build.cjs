'use strict';
/**
 * 构建脚本：把前端源和活动数据转换成 Cloudflare Pages 可部署的静态站点。
 *
 * 做四件事：
 *   1. 复制 _source/web 到 public/
 *   2. 从 _source/db.json 生成精简的数据（去掉 AI 密钥等敏感字段）
 *   3. 给 index.html 注入「在线版」标识和只读补丁
 *   4. 生成 Functions 用的数据模块
 *
 * 源文件放在项目内的 _source/，所以这个项目是自包含的：
 * 换任何机器、Cloudflare 构建机都能直接跑，不依赖桌面版目录。
 *
 * 用法：node scripts/build.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '_source');       // 项目内的源快照
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');

const WEB_SRC = path.join(SRC, 'web');
const DB_SRC = path.join(SRC, 'db.json');

// 兜底：如果 _source 不存在，尝试用桌面版目录（开发机上的便利）
const FALLBACK_SRC = path.resolve(__dirname, '..', '..', 'game-calendar');

function log(msg) { console.log('[build] ' + msg); }

function resolveSrc() {
  if (fs.existsSync(path.join(SRC, 'web')) && fs.existsSync(DB_SRC)) {
    return { web: WEB_SRC, db: DB_SRC, from: '_source' };
  }
  const altWeb = path.join(FALLBACK_SRC, 'web');
  const altDb = path.join(FALLBACK_SRC, 'data', 'db.json');
  if (fs.existsSync(altWeb) && fs.existsSync(altDb)) {
    log('⚠ _source 不存在，回退到桌面版目录');
    return { web: altWeb, db: altDb, from: 'game-calendar' };
  }
  return null;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst, filter) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      n += copyDir(s, d, filter);
    } else {
      if (filter && !filter(s, name)) continue;
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

/**
 * 生成静态兜底脚本。
 * 内联一份数据，并包装 window.fetch：
 *   - 非 /api/ 请求原样放行
 *   - 写操作直接本地拒绝（纯静态托管没有后端，不能让请求挂死）
 *   - 读请求先试真实 API，失败才降级到内联数据
 */
function fallbackJs(data) {
  return `/* 由 scripts/build.cjs 自动生成，请勿手改 */
/* 作用：纯静态托管（Cloudflare 网页上传不包含 Functions）时，
   让页面依然能显示数据，不会白屏。 */
(function () {
  'use strict';

  var DATA = ${JSON.stringify(data)};

  function pad(n) { return String(n).padStart(2, '0'); }

  function nowIso() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' +
      pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  function makeResp(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  var READONLY = { ok: false, readonly: true,
    error: '这是在线预览版，只支持查看。添加/编辑/导入请使用桌面版。' };

  function localApi(url, method) {
    if (String(method || 'GET').toUpperCase() !== 'GET') {
      return makeResp(READONLY, 403);
    }
    var path = String(url).split('?')[0];
    if (path === '/api/health') {
      return makeResp({ ok: true, version: DATA.version, mode: 'static' });
    }
    if (path === '/api/bootstrap') {
      var d = JSON.parse(JSON.stringify(DATA));
      d.now = nowIso();
      return makeResp(d);
    }
    if (path === '/api/events') return makeResp({ ok: true, events: DATA.events });
    if (path === '/api/reminders/due') return makeResp({ ok: true, due: [] });
    if (path === '/api/settings') return makeResp({ ok: true, settings: DATA.settings });
    if (path === '/api/sources') return makeResp({ ok: true, sources: [] });
    return null;
  }

  var orig = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    var method = (init && init.method) || (input && input.method) || 'GET';

    if (url.indexOf('/api/') === -1) {
      return orig ? orig(input, init) : Promise.reject(new Error('no fetch'));
    }

    var local = localApi(url, method);

    // 写操作直接本地拒绝，不必等网络超时
    if (String(method).toUpperCase() !== 'GET' && local) {
      return Promise.resolve(local);
    }
    if (!orig) {
      return local ? Promise.resolve(local) : Promise.reject(new Error('offline'));
    }
    return orig(input, init).then(function (resp) {
      if (resp && resp.ok) return resp;
      return local || resp;
    }).catch(function () {
      if (local) return local;
      throw new Error('api unavailable');
    });
  };
})();
`;
}

// ---------------------------------------------------------------- 主流程

const src = resolveSrc();
if (!src) {
  console.error('[build] 找不到源文件。');
  console.error('  期望位置: _source/web 和 _source/db.json');
  console.error('  由桌面版导出：node scripts/sync-source.cjs');
  process.exit(1);
}
log('数据源: ' + src.from);

rmrf(PUBLIC);
fs.mkdirSync(PUBLIC, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

// 1. 前端资源
const count = copyDir(src.web, PUBLIC, (full, name) => !name.startsWith('.'));
log('复制前端资源 ' + count + ' 个文件');

// 2. 数据
const db = JSON.parse(fs.readFileSync(src.db, 'utf8'));

// 只保留展示需要的字段，并清掉任何私密配置
const settings = {
  defaultReminders: db.settings.defaultReminders || [],
  enabledGames: db.settings.enabledGames || [],
  theme: db.settings.theme || 'ocean'
  // 注意：ai / notifyEnabled / lastSyncAt 等运行时配置不带到线上
};

const events = (db.events || []).map(e => {
  // 去掉个人操作痕迹字段
  const c = Object.assign({}, e);
  delete c.snoozeUntil;
  delete c.ackReminders;
  delete c.createdAt;
  delete c.updatedAt;
  return c;
});

const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  events: events,
  settings: settings
};

const dataPath = path.join(DATA, 'calendar.json');
fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2), 'utf8');
log('生成数据 ' + events.length + ' 条活动，' +
  (fs.statSync(dataPath).size / 1024).toFixed(1) + ' KB');

// 2.5 生成给 Functions 用的 JS 模块（比 JSON import 更稳，不依赖打包器配置）
const gamesPath = path.join(SRC, 'games.cjs');
let gamesMod;
if (fs.existsSync(gamesPath)) {
  gamesMod = require(gamesPath);
} else {
  // 兜底：从桌面版读
  gamesMod = require(path.join(FALLBACK_SRC, 'server', 'games.js'));
  log('⚠ _source/games.cjs 不存在，回退到桌面版');
}
const libData = {
  generatedAt: new Date().toISOString(),
  games: gamesMod.GAMES,
  categories: gamesMod.CATEGORIES,
  events: events,
  settings: settings
};
const libPath = path.join(ROOT, 'lib', 'data.generated.mjs');
fs.writeFileSync(libPath,
  '// 由 scripts/build.cjs 自动生成，请勿手改\n' +
  'export const DATA = ' + JSON.stringify(libData, null, 2) + ';\n',
  'utf8');
log('生成 Functions 数据模块 ' +
  (fs.statSync(libPath).size / 1024).toFixed(1) + ' KB');

// 3. 生成静态兜底脚本
// 目的：Cloudflare Pages 的「网页上传」方式不包含 Functions，
// 此时 /api/* 会 404，页面就白了。这个脚本里内联了一份数据，
// 优先走真实 API，失败时自动降级到本地数据，保证纯静态托管也能正常显示。
const fallbackData = {
  ok: true,
  games: libData.games,
  categories: libData.categories,
  events: libData.events,
  settings: libData.settings,
  now: null,           // 运行时按北京时间算
  version: '1.0.0-static',
  readonly: true,
  exportedAt: libData.generatedAt
};

fs.mkdirSync(path.join(PUBLIC, 'js'), { recursive: true });
const fallbackPath = path.join(PUBLIC, 'js', 'fallback-data.js');
fs.writeFileSync(fallbackPath, fallbackJs(fallbackData), 'utf8');
log('生成静态兜底数据 ' +
  (fs.statSync(fallbackPath).size / 1024).toFixed(1) + ' KB');

// 4. 首页注入在线版标识 + 兜底脚本（兜底必须在业务脚本之前）
const indexPath = path.join(PUBLIC, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // 标题加「在线版」
  html = html.replace(/<title>([^<]*)<\/title>/,
    '<title>$1 · 在线版</title>');

  // 兜底脚本插在 api.js 之前
  const fbTag = '<script src="/js/fallback-data.js"></script>\n';
  if (/<script src="js\/api\.js"><\/script>/.test(html)) {
    html = html.replace(/<script src="js\/api\.js"><\/script>/,
      fbTag + '<script src="js/api.js"></script>');
  } else if (/<script[^>]*src="[^"]*api\.js"/.test(html)) {
    html = html.replace(/(<script[^>]*src="[^"]*api\.js")/,
      fbTag + '$1');
  } else {
    // 兜底：直接塞在 head 末尾
    html = html.replace('</head>', fbTag + '</head>');
  }

  // 只读补丁插在 body 末尾
  html = html.replace('</body>',
    '\n<script src="/js/online-mode.js"></script>\n</body>');
  fs.writeFileSync(indexPath, html, 'utf8');
  log('已注入在线版标识和兜底脚本');
}

// 4. 补丁脚本放进 public/js/
const onlineSrc = path.join(ROOT, 'lib', 'online-mode.js');
const onlineDst = path.join(PUBLIC, 'js', 'online-mode.js');
if (fs.existsSync(onlineSrc)) {
  fs.mkdirSync(path.dirname(onlineDst), { recursive: true });
  fs.copyFileSync(onlineSrc, onlineDst);
  log('已复制 online-mode.js');
}

// 5. 路由规则：只有 /api/* 走 Functions，其余走静态资源
fs.writeFileSync(path.join(PUBLIC, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2), 'utf8');
log('已生成 _routes.json');

log('构建完成 → ' + PUBLIC);

