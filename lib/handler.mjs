/**
 * API 路由逻辑（纯函数，不依赖 Cloudflare 运行时，方便本地测试）。
 *
 * 网页版是只读的：查询类接口正常工作，写操作统一返回只读提示，
 * 前端会把提示展示给用户，引导去下载桌面版。
 */

import { DATA } from './data.generated.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const READONLY_MSG = '这是在线预览版，只支持查看。添加/编辑/导入请使用桌面版。';

function json(body, status = 200) {
  return {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
    body: JSON.stringify(body)
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalIso(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function nowIso() {
  // Cloudflare 运行时是 UTC，这里换算成北京时间（目标用户都在 UTC+8）
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}

function parseLocal(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

/**
 * @param {string} pathname  形如 /api/bootstrap
 * @param {string} method
 * @param {URLSearchParams} query
 * @returns {{status:number, headers:object, body:string}}
 */
export function handleApi(pathname, method, query) {
  method = (method || 'GET').toUpperCase();
  const q = query || new URLSearchParams();

  // ---- 只读拦截：网页版没有任何写接口 ----
  // 放在最前面统一处理，避免某个查询分支漏判 method 而误放行 POST。
  if (method !== 'GET' && method !== 'HEAD') {
    return json({ ok: false, error: READONLY_MSG, readonly: true }, 403);
  }

  // ---- 查询类 ----
  if (pathname === '/api/health') {
    return json({ ok: true, version: '1.0.0-web', mode: 'readonly' });
  }

  if (pathname === '/api/bootstrap') {
    return json({
      ok: true,
      games: DATA.games,
      categories: DATA.categories,
      events: DATA.events,
      settings: DATA.settings,
      now: nowIso(),
      version: '1.0.0-web',
      readonly: true,
      exportedAt: DATA.generatedAt
    });
  }

  if (pathname === '/api/events') {
    let list = DATA.events.slice();
    const games = q.get('games');
    const cats = q.get('categories');
    if (games) {
      const set = new Set(games.split(',').filter(Boolean));
      list = list.filter(e => set.has(e.game));
    }
    if (cats) {
      const set = new Set(cats.split(',').filter(Boolean));
      list = list.filter(e => set.has(e.category));
    }
    const from = q.get('from');
    const to = q.get('to');
    if (from) {
      const t = parseLocal(from + 'T00:00');
      list = list.filter(e => {
        const end = parseLocal(e.endAt);
        return end && t && end >= t;
      });
    }
    if (to) {
      const t = parseLocal(to + 'T23:59');
      list = list.filter(e => {
        const s = parseLocal(e.startAt);
        return s && t && s <= t;
      });
    }
    list.sort((a, b) => {
      const A = parseLocal(a.startAt), B = parseLocal(b.startAt);
      return (A ? A.getTime() : 0) - (B ? B.getTime() : 0);
    });
    return json({ ok: true, events: list });
  }

  const evMatch = /^\/api\/events\/([A-Za-z0-9_\-]+)$/.exec(pathname);
  if (evMatch) {
    const ev = DATA.events.find(e => e.id === evMatch[1]);
    return ev ? json({ ok: true, event: ev }) : json({ ok: false, error: '活动不存在' }, 404);
  }

  // 网页版没有本地通知能力，返回空列表让前端安静下来
  if (pathname === '/api/reminders/due') {
    return json({ ok: true, due: [] });
  }

  if (pathname === '/api/settings') {
    return json({ ok: true, settings: DATA.settings });
  }

  if (pathname === '/api/sources') {
    return json({ ok: true, sources: [] });
  }

  return json({ ok: false, error: '未知接口：' + pathname }, 404);
}
