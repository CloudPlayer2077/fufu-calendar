'use strict';
/* 通用工具：时间处理、DOM、格式化 */

(function () {
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 时间 ---------- */
  function parseLocal(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s));
    if (!m) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0, 0);
  }

  function toLocalIso(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toDateStr(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function endOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  function addDays(d, n) {
    const r = new Date(d.getTime());
    r.setDate(r.getDate() + n);
    return r;
  }

  function addMonths(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const maxDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), maxDay));
    return r;
  }

  function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /** 毫秒 -> { d, h, m, s, total } */
  function breakdown(ms) {
    const neg = ms < 0;
    let t = Math.abs(ms);
    const d = Math.floor(t / 86400000); t -= d * 86400000;
    const h = Math.floor(t / 3600000); t -= h * 3600000;
    const m = Math.floor(t / 60000); t -= m * 60000;
    const s = Math.floor(t / 1000);
    return { neg: neg, d: d, h: h, m: m, s: s, total: Math.abs(ms) };
  }

  /** 人类可读倒计时，例如 "3 天 12 小时" */
  function humanCountdown(ms) {
    const b = breakdown(ms);
    if (b.neg) return '已结束';
    if (b.d > 0) return b.d + ' 天 ' + b.h + ' 小时';
    if (b.h > 0) return b.h + ' 小时 ' + b.m + ' 分';
    if (b.m > 0) return b.m + ' 分钟';
    return '不到 1 分钟';
  }

  /** 短倒计时：3天12时 / 12:34:56 */
  function shortCountdown(ms) {
    const b = breakdown(ms);
    if (b.neg) return '已结束';
    if (b.d > 0) return b.d + '天' + b.h + '时';
    if (b.h > 0) return b.h + '时' + pad(b.m) + '分';
    return pad(b.m) + ':' + pad(b.s);
  }

  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  function fmtTime(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtDate(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtDateFull(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }

  function fmtDateTime(d) {
    return fmtDateFull(d) + ' ' + fmtTime(d);
  }

  function fmtWeekday(d) {
    return '周' + WEEK_CN[d.getDay()];
  }

  /** 智能区间描述：同一天只显示一次日期 */
  function fmtRange(s, e, allDay) {
    if (!s || !e) return '';
    const sameY = s.getFullYear() === e.getFullYear();
    const sameD = sameDay(s, e);
    if (sameD) {
      if (allDay) return fmtDateFull(s);
      return fmtDateFull(s) + ' ' + fmtTime(s) + ' – ' + fmtTime(e);
    }
    const left = fmtDateFull(s) + (allDay ? '' : ' ' + fmtTime(s));
    const right = (sameY ? '' : e.getFullYear() + '/') + pad(e.getMonth() + 1) + '/' + pad(e.getDate()) +
      (allDay ? '' : ' ' + fmtTime(e));
    return left + ' – ' + right;
  }

  /* ---------- DOM ---------- */
  // SVG 元素必须用 createElementNS 创建，否则拿到的是 HTMLUnknownElement，
  // 浏览器不会渲染，表现为「按钮是空的、只能看到 hover 背景」。
  const SVG_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'ellipse', 'use', 'defs', 'text', 'tspan', 'clipPath', 'mask'
  ]);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    const node = SVG_TAGS.has(tag)
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.setAttribute('class', v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  /* ---------- 颜色 ---------- */
  function hexToRgba(hex, a) {
    const h = String(hex || '#46d3ff').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- Toast ---------- */
  let toastSeq = 0;
  function toast(msg, type, ms) {
    const root = qs('#toast-root');
    if (!root) return;
    const t = type || 'info';
    const icons = {
      ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.4l3.2 3.2L13 4.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      err: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke-linecap="round"/></svg>',
      info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.2" stroke-linecap="round"/></svg>'
    };
    const node = el('div', { class: 'toast ' + t }, [
      el('span', { class: 'toast-icon', html: icons[t] || icons.info }),
      el('span', { text: msg })
    ]);
    root.appendChild(node);
    const id = ++toastSeq;
    node.dataset.id = id;
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }, ms || 2800);
  }

  /* ---------- 确认框 ---------- */
  function confirmDialog(title, message, okText, danger) {
    return new Promise(resolve => {
      const root = qs('#modal-root');
      const close = v => { root.innerHTML = ''; resolve(v); };
      const mask = el('div', { class: 'modal-mask', onclick: e => { if (e.target === mask) close(false); } }, [
        el('div', { class: 'modal' }, [
          el('div', { class: 'modal-head', text: title }),
          el('div', { class: 'modal-body' }, [
            el('div', { style: { fontSize: '12.5px', lineHeight: '1.75', color: 'var(--text-1)' }, text: message })
          ]),
          el('div', { class: 'modal-foot' }, [
            el('button', { class: 'btn', text: '取消', onclick: () => close(false) }),
            el('button', {
              class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
              text: okText || '确定',
              onclick: () => close(true)
            })
          ])
        ])
      ]);
      root.innerHTML = '';
      root.appendChild(mask);
    });
  }

  window.U = {
    pad, parseLocal, toLocalIso, toDateStr, startOfDay, endOfDay, addDays, addMonths, sameDay,
    breakdown, humanCountdown, shortCountdown, fmtTime, fmtDate, fmtDateFull, fmtDateTime,
    fmtWeekday, fmtRange, WEEK_CN,
    el, esc, clear, qs, qsa, debounce, hexToRgba, toast, confirmDialog
  };
})();
