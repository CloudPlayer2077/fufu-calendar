'use strict';
/* 提醒轮询 + 右下角提醒卡片 */

(function () {
  const POLL_MS = 30000;
  let timer = null;

  // 本次会话内已弹过的提醒（key = eventId:minutes），不再重复弹
  const shown = new Set();
  // 当前屏幕上正显示的卡片（eventId -> element），同一活动只保留一张
  const live = new Map();

  function root() { return U.qs('#reminder-root'); }

  async function check() {
    try {
      const r = await API.dueReminders();
      const due = r.due || [];
      for (const d of due) {
        const key = d.event.id + ':' + d.minutes;
        if (shown.has(key)) continue;
        if (live.has(d.event.id)) continue;
        shown.add(key);
        showCard(d, key);
      }
      updateBadge(due.length);
    } catch (e) {
      // 服务没起来时静默失败，不打扰用户
    }
  }

  function updateBadge(n) {
    const b = U.qs('#badge-due');
    if (!b) return;
    if (n > 0) {
      b.style.display = '';
      b.textContent = String(n);
    } else {
      b.style.display = 'none';
    }
  }

  function showCard(d, key) {
    const e = d.event;
    const R = root();
    if (!R) return;

    const g = Store.gameById(e.game);
    const color = g ? g.color : '#ff6b6b';
    const end = U.parseLocal(e.endAt);

    const label = d.minutes === 0 ? '活动已截止' :
      (d.minutes >= 1440 ? '距截止 ' + Math.round(d.minutes / 1440) + ' 天' :
        (d.minutes >= 60 ? '距截止 ' + Math.round(d.minutes / 60) + ' 小时' : '距截止 ' + d.minutes + ' 分钟'));

    const card = U.el('div', {
      class: 'reminder-card',
      style: { borderColor: U.hexToRgba(color, 0.5) }
    }, [
      U.el('div', { class: 'reminder-head' }, [
        U.el('svg', {
          viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6',
          style: { width: '13px', height: '13px' },
          html: '<path d="M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 2.6-1 3.4-1.6 4h10.4c-.6-.6-1.6-1.4-1.6-4A3.6 3.6 0 0 0 8 2.2Z"/><path d="M6.4 12a1.7 1.7 0 0 0 3.2 0" stroke-linecap="round"/>'
        }),
        U.el('span', { text: label, style: { color: color } })
      ]),
      U.el('div', { class: 'reminder-title', text: e.title }),
      U.el('div', { class: 'reminder-time', text: (g ? g.name + ' · ' : '') + (end ? '截止 ' + U.fmtDateTime(end) : '') }),
      U.el('div', { class: 'reminder-actions' }, [
        U.el('button', {
          class: 'btn btn-sm btn-primary', text: '知道了',
          onclick: async ev => {
            ev.stopPropagation();
            dismiss(card);
            try { await API.ackReminder(e.id, d.minutes); } catch (_) {}
            Store.refresh().catch(() => {});
          }
        }),
        U.el('button', {
          class: 'btn btn-sm', text: '10 分钟后',
          onclick: async ev => {
            ev.stopPropagation();
            dismiss(card);
            // 延后提醒：把这个 key 移出「已展示」，到点后还能再弹一次
            shown.delete(key);
            try {
              await API.snoozeReminder(e.id, d.minutes, 10);
              U.toast('10 分钟后再提醒你', 'info');
            } catch (_) {}
          }
        }),
        U.el('button', {
          class: 'btn btn-sm btn-ghost', text: '查看',
          onclick: ev => {
            ev.stopPropagation();
            dismiss(card);
            Drawer.open(e.id);
          }
        })
      ])
    ]);

    live.set(e.id, card);
    R.appendChild(card);
  }

  function dismiss(card) {
    for (const [id, c] of live) {
      if (c === card) live.delete(id);
    }
    card.classList.add('out');
    setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 240);
  }

  function start() {
    stop();
    check();
    timer = setInterval(check, POLL_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.Reminder = { start, stop, check };
})();
