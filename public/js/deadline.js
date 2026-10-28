'use strict';
/* 死线看板：按剩余时间排序的倒计时卡片 */

(function () {
  const root = () => U.qs('#view-deadline');

  function render() {
    const R = root();
    if (!R) return;

    const now = S.now.getTime();
    const all = Store.filtered();

    const upcoming = all.filter(e => {
      const en = U.parseLocal(e.endAt);
      return en && en.getTime() >= now;
    }).sort((a, b) => U.parseLocal(a.endAt) - U.parseLocal(b.endAt));

    const past = all.filter(e => {
      const en = U.parseLocal(e.endAt);
      return en && en.getTime() < now;
    }).sort((a, b) => U.parseLocal(b.endAt) - U.parseLocal(a.endAt));

    U.clear(R);

    // 顶部统计条
    const buckets = { d3: 0, d7: 0, d30: 0, far: 0 };
    for (const e of upcoming) {
      const left = U.parseLocal(e.endAt).getTime() - now;
      if (left <= 3 * 86400000) buckets.d3++;
      else if (left <= 7 * 86400000) buckets.d7++;
      else if (left <= 30 * 86400000) buckets.d30++;
      else buckets.far++;
    }

    R.appendChild(U.el('div', { class: 'cal-head' }, [
      U.el('div', { class: 'month-label' }, [
        '死线看板',
        U.el('small', { text: upcoming.length + ' 个待处理' })
      ]),
      U.el('div', { class: 'topbar-spacer' }),
      U.el('div', { class: 'row', style: { gap: '6px' } }, [
        statChip('3 天内', buckets.d3, '#ff6b6b'),
        statChip('一周内', buckets.d7, '#ffb347'),
        statChip('一月内', buckets.d30, '#46d3ff'),
        statChip('更远', buckets.far, '#7e96b0')
      ])
    ]));

    if (!upcoming.length && !past.length) {
      R.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty-title', text: '没有待截止的活动' }),
        U.el('div', { class: 'empty-desc', text: '导入活动后，这里会按剩余时间排好所有死线。' })
      ]));
      return;
    }

    if (upcoming.length) {
      const grid = U.el('div', { class: 'deadline-grid' });
      upcoming.forEach((e, i) => grid.appendChild(buildCard(e, i)));
      R.appendChild(grid);
    }

    if (past.length) {
      R.appendChild(U.el('div', {
        class: 'card-title',
        text: '已结束 / 已处理（' + past.length + '）',
        style: { marginTop: '26px', opacity: '0.7' }
      }));
      const grid2 = U.el('div', { class: 'deadline-grid', style: { opacity: '0.62' } });
      past.slice(0, 24).forEach((e, i) => grid2.appendChild(buildCard(e, i, true)));
      R.appendChild(grid2);
    }
  }

  function statChip(label, n, color) {
    return U.el('div', {
      class: 'pill',
      style: { color: n ? color : 'var(--text-3)', cursor: 'default' }
    }, [
      U.el('span', { class: 'dot', style: { background: n ? color : 'var(--text-3)' } }),
      label + ' ' + n
    ]);
  }

  function buildCard(e, idx, isPast) {
    const g = Store.gameById(e.game);
    const color = g ? g.color : '#7e96b0';
    const end = U.parseLocal(e.endAt);
    const start = U.parseLocal(e.startAt);
    const left = end ? end.getTime() - S.now.getTime() : 0;

    let cls = 'dl-card';
    let countCls = 'dl-count far';
    let countText, unitText;

    if (left <= 0) {
      cls += ' done';
      countCls = 'dl-count over';
      countText = '已结束';
      unitText = '';
    } else if (left <= 3 * 86400000) {
      cls += ' urgent';
      countCls = 'dl-count urgent';
      const b = U.breakdown(left);
      countText = String(b.d > 0 ? b.d : b.h);
      unitText = b.d > 0 ? '天' : '小时';
      if (b.d === 0 && b.h === 0) { countText = String(b.m); unitText = '分钟'; }
    } else if (left <= 7 * 86400000) {
      cls += ' soon';
      countCls = 'dl-count soon';
      const b = U.breakdown(left);
      countText = String(b.d);
      unitText = '天';
    } else {
      const b = U.breakdown(left);
      countText = b.d >= 30 ? String(Math.floor(b.d / 30)) : String(b.d);
      unitText = b.d >= 30 ? '个月' : '天';
    }

    if (e.done) cls += ' done';

    // 进度：已经过去多少
    let progress = 0;
    if (start && end && end.getTime() > start.getTime()) {
      progress = Math.min(100, Math.max(0, ((S.now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
    } else if (left <= 0) {
      progress = 100;
    }

    const bellCount = (e.reminders || []).length;

    const card = U.el('div', {
      class: cls,
      style: { '--gc': color },
      onclick: () => Drawer.open(e.id)
    }, [
      U.el('div', { class: 'dl-top' }, [
        U.el('span', { class: 'dl-game', text: g ? g.name : '未指定' }),
        U.el('span', { class: 'tiny muted', text: Store.categoryName(e.category) })
      ]),
      U.el('div', { class: 'dl-title', text: e.title }),
      U.el('div', { class: countCls }, [
        U.el('span', { text: countText }),
        unitText ? U.el('span', { class: 'u', text: unitText }) : null
      ]),
      U.el('div', { class: 'dl-bar' }, [
        U.el('i', { style: { width: progress + '%' } })
      ]),
      U.el('div', { class: 'dl-meta' }, [
        U.el('span', { text: end ? '截止 ' + U.fmtDateTime(end) : '无截止时间' }),
        U.el('span', { text: left > 0 ? U.humanCountdown(left) : '' })
      ]),
      bellCount ? U.el('div', { class: 'dl-bell', text: String(bellCount), title: bellCount + ' 个提醒' }) : null
    ]);

    return card;
  }

  window.DeadlineView = { render };
})();
