'use strict';
/* 月历视图：绝对定位精确对齐的跨天事件条带 */

(function () {
  const MAX_LANES = 5;
  const BAR_TOP = 24;      // 事件条起始 y（日号行之后）
  const LANE_H = 16;       // 每条 lane 的高度（含间距）
  const BAR_H = 14;
  const MIN_WEEK_H = 96;   // 周最小高度

  const root = () => U.qs('#view-calendar');

  /**
   * 计算周高：保证本周能放下自己的事件条，同时尽量让 6 周都在可视区内。
   */
  function computeWeekHeight(laneCounts) {
    const needed = Math.max.apply(null, laneCounts.concat([1])) * LANE_H + BAR_TOP + 16;

    const content = U.qs('#content');
    const viewportH = (content && content.clientHeight) || window.innerHeight || 900;

    // 头部（月标题 + 星期行）约 130px
    const avail = viewportH - 130;
    const perWeek = Math.floor(avail / 6);

    const target = Math.max(needed, perWeek);
    return Math.max(MIN_WEEK_H, Math.min(target, 210));
  }

  /** 事件覆盖的自然日范围（含首尾，按天归零） */
  function eventDayRange(e) {
    const s = U.parseLocal(e.startAt);
    const en = U.parseLocal(e.endAt);
    if (!s || !en) return null;
    return { start: U.startOfDay(s), end: U.startOfDay(en) };
  }

  /** 为某一周（7 个 Date）分配条带 lane */
  function layoutWeek(weekDays, events) {
    const wStart = U.startOfDay(weekDays[0]).getTime();
    const wEnd = U.endOfDay(weekDays[6]).getTime();

    const segs = [];
    for (const e of events) {
      const r = eventDayRange(e);
      if (!r) continue;
      const s = r.start.getTime();
      const en = r.end.getTime();
      if (en < wStart || s > wEnd) continue;

      const clippedStart = Math.max(s, wStart);
      const clippedEnd = Math.min(en, wEnd);

      let colStart = 0, colEnd = 6;
      for (let i = 0; i < 7; i++) {
        const t = U.startOfDay(weekDays[i]).getTime();
        if (t === clippedStart) colStart = i;
        if (t === clippedEnd) colEnd = i;
      }

      segs.push({
        event: e,
        colStart: colStart,
        colEnd: colEnd,
        isStart: s >= wStart,
        isEnd: en <= wEnd,
        span: colEnd - colStart + 1
      });
    }

    // 排序策略：本周内有「开始/结束」的优先占上面的 lane，
    // 跨越整周的长期活动（版本活动、永久活动）垫底作为背景。
    segs.sort((a, b) => {
      const aEdge = (a.isStart || a.isEnd) ? 0 : 1;
      const bEdge = (b.isStart || b.isEnd) ? 0 : 1;
      if (aEdge !== bEdge) return aEdge - bEdge;

      // 都在本周有边界时，跨度短的优先（更具体、更需要看到）
      if (a.span !== b.span) return a.span - b.span;

      if (a.colStart !== b.colStart) return a.colStart - b.colStart;

      // 最后按开始时间
      const at = U.parseLocal(a.event.startAt);
      const bt = U.parseLocal(b.event.startAt);
      return (at ? at.getTime() : 0) - (bt ? bt.getTime() : 0);
    });

    const laneEnds = [];
    for (const seg of segs) {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] < seg.colStart) { lane = i; break; }
      }
      if (lane < 0) {
        laneEnds.push(seg.colEnd);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = seg.colEnd;
      }
      seg.lane = lane;
    }

    return { segs: segs, laneCount: laneEnds.length };
  }

  function buildBar(seg) {
    const e = seg.event;
    const g = Store.gameById(e.game);
    const color = g ? g.color : '#7e96b0';
    const done = e.done || Store.isPast(e);
    const endD = U.parseLocal(e.endAt);

    let cls = 'cal-ev';
    if (done) cls += ' done';
    if (seg.isStart && seg.isEnd) cls += ' span-only';
    else if (seg.isStart) cls += ' span-start';
    else if (seg.isEnd) cls += ' span-end';
    else cls += ' span-mid';
    if (seg.isEnd && endD) cls += ' is-end';

    const node = U.el('div', {
      class: cls,
      style: {
        left: 'calc(' + (seg.colStart / 7 * 100) + '% + 3px)',
        width: 'calc(' + (seg.span / 7 * 100) + '% - 6px)',
        top: (BAR_TOP + seg.lane * LANE_H) + 'px',
        height: BAR_H + 'px',
        color: color,
        background: U.hexToRgba(color, done ? 0.06 : 0.16),
        borderLeftColor: color
      },
      title: (g ? g.name + ' · ' : '') + e.title + '\n' +
        U.fmtRange(U.parseLocal(e.startAt), U.parseLocal(e.endAt), e.allDay),
      onclick: ev => {
        ev.stopPropagation();
        Drawer.open(e.id);
      }
    });

    if (seg.isStart) {
      node.appendChild(U.el('span', { class: 'ev-g', text: g ? g.mark : '?', style: { color: color } }));
      node.appendChild(U.el('span', { class: 'ev-t', text: e.title }));
    } else if (seg.span >= 2) {
      // 跨周延续的段落：左侧加个箭头提示，让人知道它是接着上一周的
      node.appendChild(U.el('span', { class: 'ev-t', text: '← ' + e.title }));
    }
    return node;
  }

  /**
   * 某天的活动统计。
   *   total  当天正在进行中的活动总数（覆盖到这一天，含首尾）
   *   starts 当天开始的活动数
   *   ends   当天结束的活动数
   */
  function dayStats(day, events) {
    const t = U.startOfDay(day).getTime();
    let total = 0, starts = 0, ends = 0;
    for (const e of events) {
      const r = eventDayRange(e);
      if (!r) continue;
      const s = r.start.getTime();
      const en = r.end.getTime();
      if (s <= t && en >= t) {
        total++;
        if (s === t) starts++;
        if (en === t) ends++;
      }
    }
    return { total: total, starts: starts, ends: ends };
  }

  function buildCell(day, month, today, stats) {
    const isOut = day.getMonth() !== month;
    const isToday = U.sameDay(day, today);

    let cls = 'cal-cell';
    if (isOut) cls += ' out';
    if (isToday) cls += ' today';

    const cell = U.el('div', { class: cls, dataset: { date: U.toDateStr(day) } });
    const head = U.el('div', { class: 'cal-dayhead' });
    head.appendChild(U.el('span', { class: 'cal-daynum', text: String(day.getDate()) }));

    if (stats.total > 0) {
      // 这天有活动开始或结束 —— 是「有变化」的日子，用金色突出
      const hasChange = stats.starts > 0 || stats.ends > 0;

      const tip = [];
      tip.push('当天共 ' + stats.total + ' 个活动进行中');
      if (stats.starts) tip.push(stats.starts + ' 个在这天开始');
      if (stats.ends) tip.push(stats.ends + ' 个在这天结束');

      head.appendChild(U.el('span', {
        class: 'cal-daynum-badge' + (hasChange ? ' hi' : ''),
        text: String(stats.total),
        title: tip.join('\n')
      }));
    }

    cell.appendChild(head);
    return cell;
  }

  function renderWeek(weekDays, month, today, events, weekH) {
    const { segs, laneCount } = layoutWeek(weekDays, events);
    const shown = Math.min(laneCount, MAX_LANES);
    const overflow = laneCount > MAX_LANES;

    const week = U.el('div', { class: 'cal-week', style: { height: weekH + 'px' } });
    // 背景单元格
    const cells = U.el('div', { class: 'cal-week-cells' });
    for (let d = 0; d < 7; d++) {
      cells.appendChild(buildCell(weekDays[d], month, today, dayStats(weekDays[d], events)));
    }
    week.appendChild(cells);

    // 事件条层
    const bars = U.el('div', { class: 'cal-week-bars' });
    for (const seg of segs) {
      if (seg.lane >= MAX_LANES) continue;
      bars.appendChild(buildBar(seg));
    }
    week.appendChild(bars);

    // 溢出提示：显示当天还有多少条被折叠
    if (overflow) {
      const extra = laneCount - MAX_LANES;
      for (let d = 0; d < 7; d++) {
        // 统计这一列真正被折叠掉的数量
        let hidden = 0;
        let total = 0;
        for (const s of segs) {
          if (s.colStart <= d && s.colEnd >= d) {
            total++;
            if (s.lane >= MAX_LANES) hidden++;
          }
        }
        if (!hidden) continue;
        const day = weekDays[d];
        bars.appendChild(U.el('div', {
          class: 'cal-more',
          text: '+' + hidden + ' 更多（共 ' + total + '）',
          style: {
            left: 'calc(' + (d / 7 * 100) + '% + 4px)',
            top: (BAR_TOP + MAX_LANES * LANE_H) + 'px'
          },
          onclick: ev => {
            ev.stopPropagation();
            openDayList(day, events);
          }
        }));
      }
    }

    return week;
  }

  function icon(name) {
    const paths = {
      left: '<path d="M10 3.5L5.5 8l4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/>',
      right: '<path d="M6 3.5L10.5 8 6 12.5" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    return U.el('svg', {
      viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
      html: paths[name] || ''
    });
  }

  function buildLegend() {
    return S.games.map(g => {
      const on = S.activeGames.size === 0 || S.activeGames.has(g.id);
      return U.el('button', {
        class: 'pill' + (on ? ' on' : ''),
        style: on ? {
          color: g.color,
          borderColor: U.hexToRgba(g.color, 0.5),
          background: U.hexToRgba(g.color, 0.12)
        } : {},
        onclick: () => Store.toggleGame(g.id),
        title: g.fullName
      }, [
        U.el('span', { class: 'dot', style: { background: g.color } }),
        g.name
      ]);
    });
  }

  function render() {
    const R = root();
    if (!R) return;

    const cursor = S.cursor;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const today = new Date();

    const first = new Date(year, month, 1);
    const gridStart = U.addDays(first, -first.getDay());
    const events = Store.filtered();

    U.clear(R);

    R.appendChild(U.el('div', { class: 'cal-head' }, [
      U.el('div', { class: 'month-label' }, [
        year + ' 年 ' + (month + 1) + ' 月',
        U.el('small', { text: events.length + ' 个活动' })
      ]),
      U.el('div', { class: 'row', style: { gap: '5px' } }, [
        U.el('button', {
          class: 'icon-btn', title: '上一月',
          onclick: () => { S.cursor = U.addMonths(S.cursor, -1); render(); }
        }, [icon('left')]),
        U.el('button', {
          class: 'btn btn-sm', text: '今天',
          onclick: () => { S.cursor = new Date(); render(); }
        }),
        U.el('button', {
          class: 'icon-btn', title: '下一月',
          onclick: () => { S.cursor = U.addMonths(S.cursor, 1); render(); }
        }, [icon('right')])
      ]),
      U.el('div', { class: 'topbar-spacer' }),
      U.el('div', { class: 'row wrap', style: { gap: '5px' } }, buildLegend())
    ]));

    const wrap = U.el('div', { class: 'cal-grid-wrap' });

    const weekHead = U.el('div', { class: 'cal-weekdays' });
    ['日', '一', '二', '三', '四', '五', '六'].forEach((w, i) => {
      weekHead.appendChild(U.el('div', {
        class: 'cal-weekday' + (i === 0 || i === 6 ? ' we' : ''),
        text: w
      }));
    });
    wrap.appendChild(weekHead);

    const grid = U.el('div', { class: 'cal-grid' });

    // 先算出每周需要的 lane 数，再统一决定周高，保证 6 周都在可视区内
    const weeks = [];
    const laneCounts = [];
    for (let w = 0; w < 6; w++) {
      const weekDays = [];
      for (let d = 0; d < 7; d++) weekDays.push(U.addDays(gridStart, w * 7 + d));
      const lay = layoutWeek(weekDays, events);
      weeks.push(weekDays);
      laneCounts.push(Math.min(lay.laneCount, MAX_LANES));
    }
    const weekH = computeWeekHeight(laneCounts);

    for (let w = 0; w < 6; w++) {
      grid.appendChild(renderWeek(weeks[w], month, today, events, weekH));
    }
    wrap.appendChild(grid);
    R.appendChild(wrap);

    if (!events.length) {
      R.appendChild(U.el('div', { class: 'empty', style: { paddingTop: '20px' } }, [
        U.el('div', { class: 'empty-title', text: '还没有任何活动' }),
        U.el('div', { class: 'empty-desc', text: '去「截图导入」上传游戏官方活动日历截图，或者点右上角「新建活动」。' }),
        U.el('button', {
          class: 'btn btn-primary btn-sm', text: '去导入截图',
          onclick: () => Store.setView('import')
        })
      ]));
    }
  }

  /** 某天全部活动弹窗 */
  function openDayList(day, events) {
    const t = U.startOfDay(day).getTime();
    const list = events.filter(e => {
      const r = eventDayRange(e);
      return r && r.start.getTime() <= t && r.end.getTime() >= t;
    }).sort((a, b) => (U.parseLocal(a.startAt) - U.parseLocal(b.startAt)));

    const rootEl = U.qs('#modal-root');
    const close = () => { rootEl.innerHTML = ''; };
    const mask = U.el('div', { class: 'modal-mask', onclick: e => { if (e.target === mask) close(); } }, [
      U.el('div', { class: 'modal', style: { width: '460px' } }, [
        U.el('div', {
          class: 'modal-head',
          text: U.fmtDateFull(day) + ' ' + U.fmtWeekday(day) + ' · ' + list.length + ' 个活动'
        }),
        U.el('div', { class: 'modal-body' }, [
          U.el('div', { class: 'cand-list', style: { maxHeight: '52vh' } },
            list.map(e => {
              const g = Store.gameById(e.game);
              return U.el('div', {
                class: 'cand',
                style: { cursor: 'pointer' },
                onclick: () => { close(); Drawer.open(e.id); }
              }, [
                U.el('div', { class: 'cand-main' }, [
                  U.el('div', { class: 'cand-title', text: e.title }),
                  U.el('div', { class: 'cand-meta' }, [
                    U.el('span', {
                      text: g ? g.name : '未指定',
                      style: { color: g ? g.color : 'var(--text-3)' }
                    }),
                    U.el('span', { text: U.fmtRange(U.parseLocal(e.startAt), U.parseLocal(e.endAt), e.allDay) })
                  ])
                ])
              ]);
            })
          )
        ]),
        U.el('div', { class: 'modal-foot' }, [
          U.el('button', { class: 'btn', text: '关闭', onclick: close })
        ])
      ])
    ]);
    rootEl.innerHTML = '';
    rootEl.appendChild(mask);
  }

  window.CalendarView = { render, layoutWeek, eventDayRange };
})();
