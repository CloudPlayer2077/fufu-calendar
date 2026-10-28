'use strict';
/**
 * 时间轴视图（纵向叠放的大卡片甘特图）。
 *
 * 视觉参照游戏官方的「版本日历」：
 *   - 每个活动独占一行，卡片高约 96px，标题大、信息少
 *   - 卡片横向宽度 = 活动时长，位置 = 起止日期
 *   - 顶部日期刻度每 2 天一个，月份交界处有分隔线
 *   - 「今天」用红色竖线贯穿全表
 *   - 一行放不下时（活动太多）纵向叠放并滚动
 */

(function () {
  const DAY_W = 30;          // 每天占的像素宽度
  const RANGE_DAYS = 42;     // 一屏显示的天数（6 周）
  const ROW_H = 100;         // 每个活动行的高度
  const CARD_H = 88;         // 卡片高度
  const MIN_CARD_W = 46;     // 卡片最小宽度（太短的活动也给个可见的小块）
  const TICK_EVERY = 3;      // 每几天画一个刻度

  const root = () => U.qs('#view-timeline');

  /** 当前视图的起始日（存在视图状态里，翻页时修改） */
  function getCursor() {
    if (!S.tlStart) {
      const t = U.startOfDay(new Date());
      S.tlStart = U.addDays(t, -3);
    }
    return S.tlStart;
  }

  function fmtDot(d) {
    return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * 卡片上的时间范围。
   * 跨年时补上年份，否则「12.03 — 12.03」会被误读成同一天。
   */
  function fmtRangeShort(start, end) {
    if (!start || !end) return '?';
    if (start.getFullYear() !== end.getFullYear()) {
      return start.getFullYear() + '.' + fmtDot(start) + ' — ' +
        end.getFullYear() + '.' + fmtDot(end);
    }
    return fmtDot(start) + ' — ' + fmtDot(end);
  }

  function rebuild() { render(); }

  function render() {
    const R = root();
    if (!R) return;

    const start = getCursor();
    const today = U.startOfDay(new Date());

    const days = [];
    for (let i = 0; i < RANGE_DAYS; i++) days.push(U.addDays(start, i));
    const startMs = start.getTime();
    const endMs = U.endOfDay(days[days.length - 1]).getTime();
    const end = days[days.length - 1];

    // 只取与窗口有交集的活动
    const events = Store.filtered().filter(e => {
      const s = U.parseLocal(e.startAt);
      const en = U.parseLocal(e.endAt);
      if (!s || !en) return false;
      return en.getTime() >= startMs && s.getTime() <= endMs;
    });

    // 按游戏分组，组内按开始时间排
    const groups = [];
    for (const g of S.games) {
      if (S.activeGames.size && !S.activeGames.has(g.id)) continue;
      const list = events.filter(e => e.game === g.id)
        .sort((a, b) => (U.parseLocal(a.startAt) - U.parseLocal(b.startAt)));
      if (list.length) groups.push({ game: g, list: list });
    }
    const orphans = events.filter(e => !e.game || !Store.gameById(e.game));
    if (orphans.length) {
      groups.push({
        game: { id: null, name: '未指定', color: '#7e96b0', mark: '?' },
        list: orphans
      });
    }

    U.clear(R);

    /* ================= 顶部工具栏 ================= */
    const bar = U.el('div', { class: 'tl-bar-top' });

    const nav = U.el('div', { class: 'tl-nav' }, [
      U.el('button', {
        class: 'tl-nav-btn', title: '往前一周',
        html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        onclick: () => { S.tlStart = U.addDays(getCursor(), -7); render(); }
      }),
      U.el('div', { class: 'tl-range-text', text: fmtDot(days[0]) + ' – ' + fmtDot(end) }),
      U.el('button', {
        class: 'tl-nav-btn', title: '往后一周',
        html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        onclick: () => { S.tlStart = U.addDays(getCursor(), 7); render(); }
      }),
      U.el('button', {
        class: 'tl-today-btn', text: '回到今天',
        onclick: () => { S.tlStart = U.addDays(U.startOfDay(new Date()), -3); render(); }
      })
    ]);
    bar.appendChild(nav);

    bar.appendChild(U.el('div', { class: 'grow' }));

    // 游戏切换：点一下只看这个游戏，再点恢复全部
    const picker = U.el('div', { class: 'tl-picker' });
    for (const g of S.games) {
      const only = S.activeGames.size === 1 && S.activeGames.has(g.id);
      const on = S.activeGames.size === 0 || S.activeGames.has(g.id);
      picker.appendChild(U.el('button', {
        class: 'tl-pick' + (on ? ' on' : '') + (only ? ' only' : ''),
        style: on ? {
          color: g.color,
          borderColor: U.hexToRgba(g.color, 0.55),
          background: U.hexToRgba(g.color, only ? 0.22 : 0.10)
        } : {},
        title: only ? '再点一次显示全部游戏' : '只看' + g.name,
        onclick: () => {
          if (only) Store.setGames([]);
          else Store.setGames([g.id]);
        }
      }, [
        U.el('span', { class: 'dot', style: { background: g.color } }),
        U.el('span', { text: g.name })
      ]));
    }
    if (S.activeGames.size) {
      picker.appendChild(U.el('button', {
        class: 'tl-pick-reset', text: '全部', title: '显示全部游戏',
        onclick: () => Store.setGames([])
      }));
    }
    bar.appendChild(picker);
    R.appendChild(bar);

    /* ================= 主体 ================= */
    if (!groups.length) {
      R.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty-title', text: '这段时间没有活动' }),
        U.el('div', { class: 'empty-desc', text: '试试点「回到今天」，或换个游戏看看。' })
      ]));
      return;
    }

    const scroller = U.el('div', { class: 'tl2-scroll' });
    const inner = U.el('div', {
      class: 'tl2-inner',
      style: { width: (RANGE_DAYS * DAY_W) + 'px' }
    });

    /* ---- 日期刻度 ---- */
    const head = U.el('div', { class: 'tl2-head', style: { height: '46px' } });
    days.forEach((d, i) => {
      const isToday = U.sameDay(d, today);
      const isWe = d.getDay() === 0 || d.getDay() === 6;
      const isMon1 = d.getDate() === 1;
      // 每 TICK_EVERY 天标一次，今天必定标
      const show = i % TICK_EVERY === 0 || isToday;

      const cell = U.el('div', {
        class: 'tl2-day' + (isWe ? ' we' : '') + (isToday ? ' today' : '') + (isMon1 ? ' mon1' : ''),
        style: { left: (i * DAY_W) + 'px', width: DAY_W + 'px' }
      });

      if (isMon1) {
        cell.appendChild(U.el('div', {
          class: 'tl2-month',
          text: d.getFullYear() + ' / ' + (d.getMonth() + 1),
          style: { left: '0px' }
        }));
      }
      if (show) {
        cell.appendChild(U.el('div', { class: 'tl2-day-label', text: fmtDot(d) }));
      }
      if (isToday) {
        cell.appendChild(U.el('div', { class: 'tl2-today-tag', text: '今天' }));
      }
      head.appendChild(cell);
    });
    inner.appendChild(head);

    // 今天竖线
    const todayIdx = days.findIndex(d => U.sameDay(d, today));
    if (todayIdx >= 0) {
      inner.appendChild(U.el('div', {
        class: 'tl2-today-line',
        style: { left: (todayIdx * DAY_W + DAY_W / 2) + 'px', top: '46px' }
      }));
    }

    /* ---- 分组与卡片 ---- */
    const body = U.el('div', { class: 'tl2-body' });

    for (const grp of groups) {
      const g = grp.game;

      const gh = U.el('div', { class: 'tl2-group' }, [
        U.el('span', {
          class: 'tl2-group-dot',
          style: { background: g.color, boxShadow: '0 0 10px ' + g.color }
        }),
        U.el('span', { class: 'tl2-group-name', text: g.name }),
        U.el('span', { class: 'tl2-group-count', text: grp.list.length + ' 项' })
      ]);
      body.appendChild(gh);

      for (const e of grp.list) {
        const s = U.parseLocal(e.startAt);
        const en = U.parseLocal(e.endAt);
        if (!s || !en) continue;

        const row = U.el('div', { class: 'tl2-row', style: { height: ROW_H + 'px' } });

        // 裁剪到窗口
        const cs = Math.max(s.getTime(), startMs);
        const ce = Math.min(en.getTime(), endMs);
        const leftPx = ((cs - startMs) / 86400000) * DAY_W;
        const widthPx = Math.max(MIN_CARD_W, ((ce - cs) / 86400000) * DAY_W);

        const card = buildCard(e, g, widthPx, leftPx);
        row.appendChild(card);
        body.appendChild(row);
      }
    }

    inner.appendChild(body);
    scroller.appendChild(inner);
    R.appendChild(scroller);

    // 自动把今天滚到视野里
    requestAnimationFrame(() => {
      if (todayIdx < 0) return;
      const target = todayIdx * DAY_W - scroller.clientWidth * 0.35;
      if (target > 0) scroller.scrollLeft = target;
    });
  }

  function buildCard(e, g, widthPx, leftPx) {
    const color = g.color || '#7e96b0';
    const now = Date.now();
    const end = U.parseLocal(e.endAt);
    const start = U.parseLocal(e.startAt);
    const left = end ? end.getTime() - now : 0;
    const past = left <= 0;
    const done = e.done || past;

    // 徽章：进行中 / 还有 N 天结束 / 已结束
    let badgeText = '', badgeCls = '', badgeColor = '';
    if (past) {
      badgeText = '已结束'; badgeCls = 'over'; badgeColor = 'var(--text-3)';
    } else if (start && start.getTime() > now) {
      const b = U.breakdown(start.getTime() - now);
      badgeText = b.d > 0 ? (b.d + ' 天后开始') : (b.h + ' 小时后开始');
      badgeCls = 'soon-start'; badgeColor = '#8fd3ff';
    } else {
      const b = U.breakdown(left);
      if (b.d <= 3) { badgeText = '还有 ' + (b.d > 0 ? b.d + ' 天' : b.h + ' 小时') + '结束'; badgeCls = 'urgent'; badgeColor = '#ff6b6b'; }
      else if (b.d <= 7) { badgeText = '还有 ' + b.d + ' 天结束'; badgeCls = 'soon'; badgeColor = '#ffb347'; }
      else { badgeText = '进行中'; badgeCls = 'going'; badgeColor = '#4ade80'; }
    }

    // 宽度太窄时逐级减少信息，避免文字挤成一团或被裁掉
    const compact = widthPx < 170;
    const tiny = widthPx < 96;
    const veryTiny = widthPx < 60;

    const card = U.el('div', {
      class: 'tl2-card' + (done ? ' done' : '') +
        (veryTiny ? ' tiny' : (tiny ? ' tiny' : (compact ? ' compact' : ''))),
      style: {
        left: leftPx + 'px',
        width: widthPx + 'px',
        height: CARD_H + 'px',
        background: 'linear-gradient(115deg, ' +
          U.hexToRgba(color, done ? 0.10 : 0.26) + ' 0%, ' +
          U.hexToRgba(color, done ? 0.04 : 0.10) + ' 46%, ' +
          'rgba(8,18,32,0.82) 100%)',
        borderColor: U.hexToRgba(color, done ? 0.18 : 0.42)
      },
      title: e.title + '\n' +
        U.fmtRange(start, end, e.allDay) + '\n' +
        '分类：' + Store.categoryName(e.category) +
        (e.note ? '\n' + e.note : ''),
      onclick: () => Drawer.open(e.id)
    });

    // 左侧色条
    card.appendChild(U.el('div', {
      class: 'tl2-accent',
      style: { background: color, boxShadow: done ? 'none' : '0 0 12px ' + color }
    }));

    // 徽章：太窄时不显示
    if (!tiny) {
      card.appendChild(U.el('div', {
        class: 'tl2-badge ' + badgeCls,
        text: badgeText,
        style: { color: badgeColor, borderColor: U.hexToRgba(badgeColor, 0.5), background: U.hexToRgba(badgeColor, 0.16) }
      }));
    }

    // 标题
    card.appendChild(U.el('div', {
      class: 'tl2-title',
      text: e.title
    }));

    // 时间范围：只有够宽时才显示，否则会被裁得很难看
    if (!compact) {
      card.appendChild(U.el('div', {
        class: 'tl2-range',
        text: fmtRangeShort(start, end)
      }));
    }

    // 进度条（进行中的活动才有）
    if (!past && start && end && end.getTime() > start.getTime()) {
      const p = Math.min(100, Math.max(0, ((now - start.getTime()) / (end.getTime() - start.getTime())) * 100));
      card.appendChild(U.el('div', { class: 'tl2-progress' }, [
        U.el('i', { style: { width: p + '%', background: color } })
      ]));
    }

    return card;
  }

  window.TimelineView = { render };
})();
