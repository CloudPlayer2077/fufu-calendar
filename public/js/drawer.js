'use strict';
/* 事件详情抽屉：查看 / 编辑 / 删除 / 设置提醒 */

(function () {
  const REMIND_OPTIONS = [
    { m: 0, label: '截止时' },
    { m: 30, label: '30 分钟前' },
    { m: 60, label: '1 小时前' },
    { m: 180, label: '3 小时前' },
    { m: 720, label: '12 小时前' },
    { m: 1440, label: '1 天前' },
    { m: 2880, label: '2 天前' },
    { m: 4320, label: '3 天前' },
    { m: 10080, label: '7 天前' }
  ];

  let currentId = null;
  let editing = false;
  let draft = null;

  const drawer = () => U.qs('#drawer');
  const mask = () => U.qs('#drawer-mask');

  function open(id) {
    currentId = id;
    editing = false;
    draft = null;
    render();
    mask().classList.add('on');
    drawer().classList.add('on');
  }

  function close() {
    currentId = null;
    editing = false;
    draft = null;
    mask().classList.remove('on');
    drawer().classList.remove('on');
  }

  function getEvent() {
    return S.events.find(e => e.id === currentId) || null;
  }

  function render() {
    const D = drawer();
    if (!D) return;
    U.clear(D);

    const e = getEvent();
    if (!e) {
      D.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty-title', text: '活动已不存在' })
      ]));
      return;
    }

    const g = Store.gameById(e.game);
    const color = g ? g.color : '#7e96b0';
    const start = U.parseLocal(e.startAt);
    const end = U.parseLocal(e.endAt);
    const left = end ? end.getTime() - S.now.getTime() : 0;

    /* ---- 头部 ---- */
    const head = U.el('div', { class: 'drawer-head' });

    const topRow = U.el('div', { class: 'row', style: { marginBottom: '9px', gap: '7px' } }, [
      U.el('span', {
        class: 'chip',
        text: g ? g.name : '未指定',
        style: {
          color: color,
          background: U.hexToRgba(color, 0.14),
          borderColor: U.hexToRgba(color, 0.4)
        }
      }),
      U.el('span', {
        class: 'chip',
        text: Store.categoryName(e.category),
        style: {
          color: Store.categoryColor(e.category),
          background: U.hexToRgba(Store.categoryColor(e.category), 0.12),
          borderColor: U.hexToRgba(Store.categoryColor(e.category), 0.34)
        }
      }),
      e.source === 'ocr' ? U.el('span', {
        class: 'chip',
        text: 'OCR ' + Math.round((e.confidence || 0) * 100) + '%',
        style: { color: 'var(--text-3)', background: 'rgba(255,255,255,0.05)', borderColor: 'var(--line)' }
      }) : null,
      U.el('div', { class: 'topbar-spacer' }),
      U.el('button', {
        class: 'icon-btn',
        title: '关闭',
        onclick: close,
        html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke-linecap="round"/></svg>'
      })
    ]);
    head.appendChild(topRow);

    if (!editing) {
      head.appendChild(U.el('div', {
        style: { fontSize: '16px', fontWeight: '650', lineHeight: '1.45', color: 'var(--text-0)' },
        text: e.title
      }));
    }
    D.appendChild(head);

    /* ---- 主体 ---- */
    const body = U.el('div', { class: 'drawer-body' });

    if (editing) {
      body.appendChild(buildEditor(e));
    } else {
      body.appendChild(buildViewer(e, start, end, left, color));
    }

    D.appendChild(body);

    /* ---- 底部 ---- */
    const foot = U.el('div', { class: 'drawer-foot' });

    if (editing) {
      foot.appendChild(U.el('button', {
        class: 'btn grow', text: '取消',
        onclick: () => { editing = false; draft = null; render(); }
      }));
      foot.appendChild(U.el('button', {
        class: 'btn btn-primary grow', text: '保存',
        onclick: async ev => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            await API.updateEvent(e.id, draft);
            await Store.refresh();
            editing = false;
            draft = null;
            render();
            U.toast('已保存', 'ok');
          } catch (err) {
            U.toast(err.message, 'err');
          } finally {
            btn.disabled = false;
          }
        }
      }));
    } else {
      foot.appendChild(U.el('button', {
        class: 'btn btn-danger', text: '删除',
        onclick: async () => {
          const okDel = await U.confirmDialog('删除活动', '确定要删除「' + e.title + '」吗？此操作不可撤销。', '删除', true);
          if (!okDel) return;
          try {
            await API.deleteEvent(e.id);
            await Store.refresh();
            close();
            U.toast('已删除', 'ok');
          } catch (err) {
            U.toast(err.message, 'err');
          }
        }
      }));
      foot.appendChild(U.el('div', { class: 'grow' }));
      foot.appendChild(U.el('button', {
        class: 'btn' + (e.done ? '' : ' btn-primary'),
        text: e.done ? '标记为未完成' : '标记为已处理',
        onclick: async () => {
          try {
            await API.updateEvent(e.id, { done: !e.done });
            await Store.refresh();
            render();
          } catch (err) { U.toast(err.message, 'err'); }
        }
      }));
      foot.appendChild(U.el('button', {
        class: 'btn', text: '编辑',
        onclick: () => {
          editing = true;
          draft = {
            game: e.game, title: e.title, category: e.category,
            startAt: e.startAt, endAt: e.endAt,
            reminders: (e.reminders || []).slice(),
            note: e.note || ''
          };
          render();
        }
      }));
    }

    D.appendChild(foot);
  }

  function buildViewer(e, start, end, left, color) {
    const frag = document.createDocumentFragment();

    // 倒计时卡
    if (end) {
      const isOver = left <= 0;
      const urgent = left > 0 && left <= 3 * 86400000;
      const soon = left > 0 && left <= 7 * 86400000;
      frag.appendChild(U.el('div', {
        style: {
          padding: '13px 15px',
          borderRadius: 'var(--r-md)',
          marginBottom: '15px',
          background: isOver ? 'rgba(255,255,255,0.03)' : U.hexToRgba(urgent ? '#ff6b6b' : (soon ? '#ffb347' : color), 0.1),
          border: '1px solid ' + (isOver ? 'var(--line)' : U.hexToRgba(urgent ? '#ff6b6b' : (soon ? '#ffb347' : color), 0.34))
        }
      }, [
        U.el('div', {
          class: 'tiny',
          text: isOver ? '已结束' : '距离截止还有',
          style: { color: 'var(--text-2)', marginBottom: '5px' }
        }),
        U.el('div', {
          style: {
            fontSize: isOver ? '15px' : '24px',
            fontWeight: '800',
            fontVariantNumeric: 'tabular-nums',
            color: isOver ? 'var(--text-2)' : (urgent ? 'var(--danger)' : (soon ? 'var(--warn)' : 'var(--text-0)')),
            letterSpacing: '-0.3px'
          },
          text: isOver ? U.fmtDateTime(end) : U.humanCountdown(left)
        })
      ]));
    }

    // 时间
    const fields = [];
    fields.push(field('开始', start ? U.fmtDateTime(start) + ' ' + U.fmtWeekday(start) : '未设置'));
    fields.push(field('结束', end ? U.fmtDateTime(end) + ' ' + U.fmtWeekday(end) : '未设置'));
    if (e.allDay) fields.push(field('类型', '全天'));
    fields.push(field('来源', e.source === 'ocr' ? '截图识别' : (e.source === 'api' ? '官方接口' : '手动添加')));

    const fieldBox = U.el('div', {});
    for (const f of fields) fieldBox.appendChild(f);
    frag.appendChild(fieldBox);

    // 提醒
    const remindBox = U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '提醒（距截止前）' })
    ]);
    if (e.reminders && e.reminders.length) {
      const chips = U.el('div', { class: 'remind-chips' });
      for (const m of e.reminders) {
        const opt = REMIND_OPTIONS.find(o => o.m === m);
        chips.appendChild(U.el('span', {
          class: 'remind-chip on',
          text: opt ? opt.label : (m >= 1440 ? Math.round(m / 1440) + ' 天前' : m + ' 分钟前'),
          style: { cursor: 'default' }
        }));
      }
      remindBox.appendChild(chips);
    } else {
      remindBox.appendChild(U.el('div', { class: 'tiny muted', text: '未设置提醒' }));
    }
    frag.appendChild(remindBox);

    // 备注
    if (e.note) {
      frag.appendChild(field('备注', e.note, true));
    }

    // 元信息
    frag.appendChild(U.el('div', {
      class: 'tiny',
      style: { color: 'var(--text-3)', marginTop: '18px', paddingTop: '12px', borderTop: '1px solid var(--line)', lineHeight: '1.8' }
    }, [
      U.el('div', { text: '创建于 ' + (e.createdAt || '').replace('T', ' ') }),
      U.el('div', { text: 'ID: ' + e.id })
    ]));

    return frag;
  }

  function field(label, value, multiline) {
    return U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: label }),
      U.el('div', {
        style: {
          fontSize: '12.5px',
          color: 'var(--text-1)',
          lineHeight: '1.7',
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          userSelect: 'text'
        },
        text: value
      })
    ]);
  }

  function buildEditor(e) {
    const frag = document.createDocumentFragment();

    frag.appendChild(U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '标题' }),
      U.el('input', {
        class: 'input', value: draft.title,
        oninput: ev => { draft.title = ev.target.value; }
      })
    ]));

    // 游戏
    const gameField = U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '游戏' })
    ]);
    const gameSel = U.el('select', {
      class: 'select',
      onchange: ev => { draft.game = ev.target.value || null; }
    });
    gameSel.appendChild(U.el('option', { value: '', text: '未指定' }));
    for (const g of S.games) {
      const opt = U.el('option', { value: g.id, text: g.name });
      if (draft.game === g.id) opt.selected = true;
      gameSel.appendChild(opt);
    }
    gameField.appendChild(gameSel);
    frag.appendChild(gameField);

    // 分类
    const catField = U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '分类' })
    ]);
    const catSel = U.el('select', {
      class: 'select',
      onchange: ev => { draft.category = ev.target.value; }
    });
    for (const c of S.categories) {
      const opt = U.el('option', { value: c.id, text: c.name });
      if (draft.category === c.id) opt.selected = true;
      catSel.appendChild(opt);
    }
    catField.appendChild(catSel);
    frag.appendChild(catField);

    frag.appendChild(U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '开始时间' }),
      U.el('input', {
        class: 'input', type: 'datetime-local', value: draft.startAt,
        onchange: ev => { draft.startAt = ev.target.value; }
      })
    ]));

    frag.appendChild(U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '结束时间（死线）' }),
      U.el('input', {
        class: 'input', type: 'datetime-local', value: draft.endAt,
        onchange: ev => { draft.endAt = ev.target.value; }
      })
    ]));

    // 提醒
    const remField = U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '提醒（可多选，距截止前）' })
    ]);
    const remChips = U.el('div', { class: 'remind-chips' });
    for (const opt of REMIND_OPTIONS) {
      const on = draft.reminders.includes(opt.m);
      remChips.appendChild(U.el('button', {
        class: 'remind-chip' + (on ? ' on' : ''),
        text: opt.label,
        onclick: ev => {
          const btn = ev.currentTarget;
          if (draft.reminders.includes(opt.m)) {
            draft.reminders = draft.reminders.filter(x => x !== opt.m);
            btn.classList.remove('on');
          } else {
            draft.reminders.push(opt.m);
            draft.reminders.sort((a, b) => a - b);
            btn.classList.add('on');
          }
        }
      }));
    }
    remField.appendChild(remChips);
    frag.appendChild(remField);

    frag.appendChild(U.el('div', { class: 'field' }, [
      U.el('div', { class: 'field-label', text: '备注' }),
      U.el('textarea', {
        class: 'textarea', rows: '3',
        oninput: ev => { draft.note = ev.target.value; }
      }, [draft.note || ''])
    ]));

    return frag;
  }

  window.Drawer = { open, close, render };
})();
