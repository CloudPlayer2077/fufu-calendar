'use strict';
/**
 * 从桌面版同步源文件到本项目的 _source/。
 *
 * 桌面版里更新了活动数据或前端代码后，跑一次这个脚本，
 * 项目就变成自包含的（部署时不再依赖桌面版目录）。
 *
 * 用法：node scripts/sync-source.cjs [桌面版路径]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = process.argv[2] ||
  path.resolve(ROOT, '..', 'game-calendar');
const SRC = path.join(ROOT, '_source');

function log(m) { console.log('[sync] ' + m); }

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(s)) {
    if (name.startsWith('.')) continue;
    const sp = path.join(s, name);
    const dp = path.join(d, name);
    const st = fs.statSync(sp);
    if (st.isDirectory()) n += copyDir(sp, dp);
    else { fs.copyFileSync(sp, dp); n++; }
  }
  return n;
}

if (!fs.existsSync(DESKTOP)) {
  console.error('[sync] 桌面版目录不存在: ' + DESKTOP);
  console.error('  用法: node scripts/sync-source.cjs "路径到 game-calendar"');
  process.exit(1);
}

const webSrc = path.join(DESKTOP, 'web');
const dbSrc = path.join(DESKTOP, 'data', 'db.json');
const gamesSrc = path.join(DESKTOP, 'server', 'games.js');

for (const [p, label] of [[webSrc, 'web 目录'], [dbSrc, 'db.json'], [gamesSrc, 'games.js']]) {
  if (!fs.existsSync(p)) {
    console.error('[sync] 缺少 ' + label + ': ' + p);
    process.exit(1);
  }
}

rmrf(SRC);
fs.mkdirSync(SRC, { recursive: true });

const n = copyDir(webSrc, path.join(SRC, 'web'));
log('复制 web/ → _source/web (' + n + ' 个文件)');

fs.copyFileSync(dbSrc, path.join(SRC, 'db.json'));
log('复制 db.json (' + (fs.statSync(dbSrc).size / 1024).toFixed(1) + ' KB)');

fs.copyFileSync(gamesSrc, path.join(SRC, 'games.cjs'));
log('复制 games.cjs');

// 打印数据概况，便于确认同步到的是最新数据
const db = JSON.parse(fs.readFileSync(path.join(SRC, 'db.json'), 'utf8'));
const g = {};
(db.events || []).forEach(e => { g[e.game] = (g[e.game] || 0) + 1; });
log('活动总数: ' + (db.events || []).length + '  ' + JSON.stringify(g));
log('完成。接着运行: node scripts/build.cjs');

