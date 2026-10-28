/**
 * Cloudflare Pages Functions 入口。
 * 路径约定：functions/api/[[path]].js 匹配 /api/* 全部子路径。
 */
import { handleApi } from '../../lib/handler.mjs';

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  try {
    const r = handleApi(url.pathname, context.request.method, url.searchParams);
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: '服务端错误：' + (e.message || e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
