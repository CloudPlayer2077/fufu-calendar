'use strict';
/**
 * 本地预览服务器。
 * 模拟 Cloudflare Pages 的行为：静态文件从 public/ 读，/api/* 走 handler。
 *
 * 用法：node scripts/dev-server.cjs [端口]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = parseInt(process.argv[2] || '8788', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

(async () => {
  const { handleApi } = await import('../lib/handler.mjs');

  const server = http.createServer((req, res) => {
    const u = url.parse(req.url, true);
    let p = decodeURIComponent(u.pathname);

    // API
    if (p.startsWith('/api/')) {
      try {
        const r = handleApi(p, req.method, new URLSearchParams(u.query));
        res.writeHead(r.status, r.headers);
        res.end(r.body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
      return;
    }

    // 静态
    if (p === '/') p = '/index.html';
    const file = path.join(PUBLIC, p);
    // 防目录穿越
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        // SPA 回退
        fs.readFile(path.join(PUBLIC, 'index.html'), (e2, b2) => {
          if (e2) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(b2);
        });
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      // 静态资源加缓存头，模拟 CDN 行为
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(buf);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('[dev] http://127.0.0.1:' + PORT);
    console.log('[dev] 静态目录: ' + PUBLIC);
    console.log('[dev] API 走 lib/handler.mjs');
  });
})();
