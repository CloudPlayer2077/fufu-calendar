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

// 3. 首页注入在线版标识
const indexPath = path.join(PUBLIC, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // 标题加「在线版」
  html = html.replace(/<title>([^<]*)<\/title>/,
    '<title>$1 · 在线版</title>');

  // 在 body 末尾插入只读脚本（放在所有业务脚本之后）
  const patch = `
<script src="/js/online-mode.js"></script>
`;
  html = html.replace('</body>', patch + '</body>');
  fs.writeFileSync(indexPath, html, 'utf8');
  log('已注入在线版标识');
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

