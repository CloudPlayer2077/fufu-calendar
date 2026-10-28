'use strict';
/* 应用主控：初始化、导航、顶栏、渲染调度 */

(function () {
  const VIEW_META = {
    calendar: { title: '月历', sub: '按月份查看所有活动区间' },
    timeline: { title: '时间轴', sub: '横向对比各游戏的活动排期' },
    deadline: { title: '死线看板', sub: '按剩余时间排序，别错过任何截止' },
    import: { title: '截图导入', sub: '上传官方日历截图，自动识别活动时间' }
  };

  let searchInput = null;
  let tickTimer = null;

  function currentRender() {
    switch (S.view) {
      case 'calendar': return CalendarView.render();
      case 'timeline': return TimelineView.render();
      case 'deadline': return DeadlineView.render();
      case 'import': return ImportView.render();
    }
  }

  /** 同步导航高亮与视图容器显隐 */
  function syncViewSections() {
    U.qsa('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === S.view));
    U.qsa('.view').forEach(sec => sec.classList.toggle('active', sec.id === 'view-' + S.view));
  }

  function renderAll() {
    if (!S.ready) return;
    syncViewSections();
    currentRender();
    renderSidebar();
    renderTopbar();
  }

  /* ---------------- 侧边栏 ---------------- */
  function renderSidebar() {
    // 游戏列表
    const list = U.qs('#game-list');
    if (list) {
      U.clear(list);
      const counts = {};
      for (const e of S.events) {
        if (Store.isPast(e)) continue;
        counts[e.game] = (counts[e.game] || 0) + 1;
      }
      for (const g of S.games) {
        const on = S.activeGames.size === 0 || S.activeGames.has(g.id);
        const row = U.el('div', {
          class: 'game-row' + (on ? '' : ' off'),
          onclick: () => Store.toggleGame(g.id),
          title: g.fullName
        }, [
          U.el('span', { class: 'game-dot', style: { color: g.color } }),
          U.el('span', { class: 'game-name', text: g.name }),
          U.el('span', { class: 'game-count', text: String(counts[g.id] || 0) })
        ]);
        list.appendChild(row);
      }
    }

    // 统计
    const st = Store.stats();
    const setTxt = (id, v) => {
      const n = U.qs('#' + id);
      if (n) n.textContent = String(v);
    };
    setTxt('stat-active', st.active);
    setTxt('stat-week', st.week);
    setTxt('stat-past', st.past);

    // 筛选状态提示
    const hint = U.qs('#game-filter-hint');
    if (hint) {
      const n = Store.visibleGameIds().length;
      const filtered = Store.isFiltered();
      hint.textContent = filtered
        ? '仅显示 ' + n + ' 款游戏 · 点此修改'
        : '游戏显示设置（全部）';
      hint.style.color = filtered ? 'var(--gold)' : '';
    }
  }

  /* ---------------- 顶栏 ---------------- */
  function renderTopbar() {
    const meta = VIEW_META[S.view] || VIEW_META.calendar;
    const t = U.qs('#page-title');
    const s = U.qs('#page-sub');
    if (t) t.textContent = meta.title;
    if (s) s.textContent = meta.sub;

    const box = U.qs('#topbar-actions');
    if (!box) return;
    U.clear(box);

    // 搜索框
    searchInput = U.el('input', {
      class: 'input',
      placeholder: '搜索活动…',
      value: S.search,
      style: { width: '180px' },
      oninput: U.debounce(ev => {
        S.search = ev.target.value;
        currentRender();
      }, 220)
    });
    box.appendChild(searchInput);

    // 新建
    box.appendChild(U.el('button', {
      class: 'btn btn-primary',
      onclick: () => openCreateModal()
    }, [
      U.el('svg', {
        viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
        html: '<path d="M8 3.5v9M3.5 8h9" stroke-linecap="round"/>'
      }),
      '新建活动'
    ]));

    // 更多菜单
    box.appendChild(U.el('button', {
      class: 'icon-btn',
      title: '更多',
      onclick: () => openMoreMenu(),
      html: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.4" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.6" r="1.3"/></svg>'
    }));
  }

  /* ---------------- 新建活动 ---------------- */
  function openCreateModal() {
    const draft = {
      game: S.games.length ? S.games[0].id : null,
      title: '',
      category: 'activity',
      startAt: U.toLocalIso(new Date()),
      endAt: U.toLocalIso(U.addDays(new Date(), 7)),
      reminders: (S.settings.defaultReminders || [1440, 180]).slice(),
      note: ''
    };

    const rootEl = U.qs('#modal-root');
    const close = () => { rootEl.innerHTML = ''; };

    const titleInput = U.el('input', {
      class: 'input', placeholder: '例如：月之一版本主题活动',
      oninput: ev => { draft.title = ev.target.value; }
    });

    const gameSel = U.el('select', {
      class: 'select', onchange: ev => { draft.game = ev.target.value || null; }
    });
    for (const g of S.games) {
      const opt = U.el('option', { value: g.id, text: g.name });
      if (draft.game === g.id) opt.selected = true;
      gameSel.appendChild(opt);
    }

    const catSel = U.el('select', {
      class: 'select', onchange: ev => { draft.category = ev.target.value; }
    });
    for (const c of S.categories) {
      const opt = U.el('option', { value: c.id, text: c.name });
      if (draft.category === c.id) opt.selected = true;
      catSel.appendChild(opt);
    }

    const startInput = U.el('input', {
      class: 'input', type: 'datetime-local', value: draft.startAt,
      onchange: ev => { draft.startAt = ev.target.value; }
    });
    const endInput = U.el('input', {
      class: 'input', type: 'datetime-local', value: draft.endAt,
      onchange: ev => { draft.endAt = ev.target.value; }
    });

    const remChips = U.el('div', { class: 'remind-chips' });
    const REM = [
      { m: 0, label: '截止时' }, { m: 60, label: '1 小时前' }, { m: 180, label: '3 小时前' },
      { m: 1440, label: '1 天前' }, { m: 2880, label: '2 天前' }, { m: 4320, label: '3 天前' }
    ];
    for (const o of REM) {
      const on = draft.reminders.includes(o.m);
      remChips.appendChild(U.el('button', {
        class: 'remind-chip' + (on ? ' on' : ''),
        text: o.label,
        onclick: ev => {
          const btn = ev.currentTarget;
          if (draft.reminders.includes(o.m)) {
            draft.reminders = draft.reminders.filter(x => x !== o.m);
            btn.classList.remove('on');
          } else {
            draft.reminders.push(o.m);
            draft.reminders.sort((a, b) => a - b);
            btn.classList.add('on');
          }
        }
      }));
    }

    const mask = U.el('div', { class: 'modal-mask', onclick: ev => { if (ev.target === mask) close(); } }, [
      U.el('div', { class: 'modal' }, [
        U.el('div', { class: 'modal-head', text: '新建活动' }),
        U.el('div', { class: 'modal-body' }, [
          U.el('div', { class: 'field' }, [U.el('div', { class: 'field-label', text: '活动标题' }), titleInput]),
          U.el('div', { class: 'row', style: { gap: '10px' } }, [
            U.el('div', { class: 'field grow' }, [U.el('div', { class: 'field-label', text: '游戏' }), gameSel]),
            U.el('div', { class: 'field grow' }, [U.el('div', { class: 'field-label', text: '分类' }), catSel])
          ]),
          U.el('div', { class: 'field' }, [U.el('div', { class: 'field-label', text: '开始时间' }), startInput]),
          U.el('div', { class: 'field' }, [U.el('div', { class: 'field-label', text: '结束时间（死线）' }), endInput]),
          U.el('div', { class: 'field' }, [
            U.el('div', { class: 'field-label', text: '提醒（距截止前）' }),
            remChips
          ])
        ]),
        U.el('div', { class: 'modal-foot' }, [
          U.el('button', { class: 'btn', text: '取消', onclick: close }),
          U.el('button', {
            class: 'btn btn-primary', text: '创建',
            onclick: async ev => {
              if (!draft.title.trim()) { U.toast('请填写活动标题', 'err'); return; }
              if (!draft.startAt || !draft.endAt) { U.toast('请填写开始与结束时间', 'err'); return; }
              if (U.parseLocal(draft.endAt) < U.parseLocal(draft.startAt)) {
                U.toast('结束时间不能早于开始时间', 'err');
                return;
              }
              const btn = ev.currentTarget;
              btn.disabled = true;
              try {
                await API.createEvent(Object.assign({}, draft, { source: 'manual', confidence: 1 }));
                await Store.refresh();
                close();
                U.toast('已创建', 'ok');
                renderAll();
              } catch (err) {
                U.toast(err.message, 'err');
                btn.disabled = false;
              }
            }
          })
        ])
      ])
    ]);

    rootEl.innerHTML = '';
    rootEl.appendChild(mask);
    setTimeout(() => titleInput.focus(), 60);
  }

  /* ---------------- 更多菜单 ---------------- */
  function openMoreMenu() {
    const rootEl = U.qs('#modal-root');
    const close = () => { rootEl.innerHTML = ''; };

    const items = [
      {
        icon: '🎮', label: '显示哪些游戏',
        desc: '只保留你关心的游戏，设置会记住',
        run: () => openGameSettingsModal()
      },
      {
        icon: '🔔', label: '测试系统通知',
        desc: '发一条 Windows 通知，验证提醒能正常弹出',
        run: async () => {
          try {
            const r = await API.testNotify();
            U.toast(r.delivered ? '通知已发送，看看右下角' : '通知发送失败，请检查系统设置', r.delivered ? 'ok' : 'err');
          } catch (e) { U.toast(e.message, 'err'); }
        }
      },
      {
        icon: '📅', label: '导出为 .ics 日历',
        desc: '可导入到 Outlook / 手机系统日历',
        run: () => { API.exportIcs(); U.toast('已开始下载', 'ok'); }
      },
      {
        icon: '🔄', label: '重新加载数据',
        desc: '从本地数据库重新读取全部活动',
        run: async () => {
          try {
            await Store.load();
            renderAll();
            U.toast('已刷新', 'ok');
          } catch (e) { U.toast(e.message, 'err'); }
        }
      },
      {
        icon: '🧹', label: '清除所有筛选',
        desc: '恢复显示全部游戏与分类',
        run: () => {
          Store.setGames([]);
          S.activeCategories.clear();
          S.search = '';
          renderAll();
          U.toast('筛选已清除', 'ok');
        }
      },
      {
        icon: '🗂️', label: '版本备份与恢复',
        desc: '查看历次导入前的快照，可一键回滚',
        run: () => openBackupModal()
      }
    ];

    const mask = U.el('div', { class: 'modal-mask', onclick: ev => { if (ev.target === mask) close(); } }, [
      U.el('div', { class: 'modal', style: { width: '400px' } }, [
        U.el('div', { class: 'modal-head', text: '更多操作' }),
        U.el('div', { class: 'modal-body', style: { padding: '10px' } },
          items.map(it => U.el('div', {
            class: 'cand',
            style: { cursor: 'pointer', marginBottom: '6px' },
            onclick: () => { close(); it.run(); }
          }, [
            U.el('div', { style: { fontSize: '17px', lineHeight: '1.2' }, text: it.icon }),
            U.el('div', { class: 'cand-main' }, [
              U.el('div', { class: 'cand-title', text: it.label, style: { marginBottom: '2px' } }),
              U.el('div', { class: 'tiny muted', text: it.desc })
            ])
          ]))
        ),
        U.el('div', { class: 'modal-foot' }, [
          U.el('button', { class: 'btn', text: '关闭', onclick: close })
        ])
      ])
    ]);

    rootEl.innerHTML = '';
    rootEl.appendChild(mask);
  }

  /* ---------------- 游戏显示设置 ---------------- */
  function openGameSettingsModal() {
    const rootEl = U.qs('#modal-root');
    const close = () => { rootEl.innerHTML = ''; };

    // 当前勾选状态（空集合 = 全部显示，这里展开成全选）
    const picked = new Set(Store.visibleGameIds());
    const listBox = U.el('div', { class: 'col', style: { gap: '7px' } });

    function countFor(gameId) {
      return S.events.filter(e => e.game === gameId && !Store.isPast(e)).length;
    }

    function paint() {
      U.clear(listBox);
      for (const g of S.games) {
        const on = picked.has(g.id);
        const row = U.el('div', {
          class: 'cand',
          style: {
            cursor: 'pointer',
            alignItems: 'center',
            borderColor: on ? U.hexToRgba(g.color, 0.5) : 'var(--line)',
            background: on ? U.hexToRgba(g.color, 0.10) : 'rgba(255,255,255,0.02)'
          },
          onclick: () => {
            if (picked.has(g.id)) picked.delete(g.id);
            else picked.add(g.id);
            paint();
          }
        }, [
          U.el('div', {
            class: 'cand-check' + (on ? ' on' : ''),
            style: on ? { background: g.color, borderColor: g.color } : {}
          }),
          U.el('span', {
            style: {
              width: '9px', height: '9px', borderRadius: '50%',
              background: g.color, boxShadow: '0 0 8px ' + g.color,
              flexShrink: '0'
            }
          }),
          U.el('div', { class: 'cand-main' }, [
            U.el('div', {
              class: 'cand-title',
              text: g.name,
              style: { marginBottom: '1px', color: on ? '#ffffff' : 'var(--text-2)' }
            }),
            U.el('div', { class: 'tiny muted', text: (countFor(g.id)) + ' 个进行中' })
          ])
        ]);
        listBox.appendChild(row);
      }

      const allOn = picked.size === S.games.length;
      summary.textContent = allOn
        ? '全部显示（4 款游戏）'
        : (picked.size === 0 ? '一个都没选，至少选一款' : '只显示 ' + picked.size + ' 款游戏');
      summary.style.color = picked.size === 0 ? 'var(--danger)' : 'var(--text-3)';
      saveBtn.disabled = picked.size === 0;
      saveBtn.style.opacity = picked.size === 0 ? '0.45' : '1';
    }

    const summary = U.el('div', {
      class: 'tiny',
      style: { color: 'var(--text-3)', marginBottom: '10px' }
    });

    const saveBtn = U.el('button', {
      class: 'btn btn-primary',
      text: '保存',
      onclick: async () => {
        if (!picked.size) { U.toast('至少要选一款游戏', 'err'); return; }
        const allOn = picked.size === S.games.length;
        Store.setEnabledGames(allOn ? [] : [...picked]);
        // 等防抖写完再关，确保已落盘
        setTimeout(() => { close(); renderAll(); }, 420);
        U.toast(allOn ? '已设为显示全部游戏' : '只显示 ' + picked.size + ' 款游戏', 'ok');
      }
    });

    const mask = U.el('div', {
      class: 'modal-mask',
      onclick: ev => { if (ev.target === mask) close(); }
    }, [
      U.el('div', { class: 'modal', style: { width: '420px' } }, [
        U.el('div', { class: 'modal-head', text: '显示哪些游戏' }),
        U.el('div', { class: 'modal-body' }, [
          U.el('div', {
            class: 'tiny',
            style: { color: 'var(--text-3)', lineHeight: '1.8', marginBottom: '12px' }
          }, '勾选后，月历、时间轴、死线看板、统计都只会显示这些游戏。设置会保存，下次打开仍然生效。'),
          listBox,
          U.el('div', { style: { marginTop: '12px' } }, [summary])
        ]),
        U.el('div', { class: 'modal-foot' }, [
          U.el('button', {
            class: 'btn', text: '全选',
            onclick: () => { S.games.forEach(g => picked.add(g.id)); paint(); }
          }),
          U.el('button', {
            class: 'btn', text: '反选',
            onclick: () => {
              const next = new Set();
              S.games.forEach(g => { if (!picked.has(g.id)) next.add(g.id); });
              picked.clear();
              next.forEach(id => picked.add(id));
              paint();
            }
          }),
          U.el('div', { class: 'grow' }),
          U.el('button', { class: 'btn', text: '取消', onclick: close }),
          saveBtn
        ])
      ])
    ]);

    rootEl.innerHTML = '';
    rootEl.appendChild(mask);
    paint();
  }

  /* ---------------- 版本备份 ---------------- */
  async function openBackupModal() {
    const rootEl = U.qs('#modal-root');
    const close = () => { rootEl.innerHTML = ''; };

    const listBox = U.el('div', { class: 'cand-list', style: { maxHeight: '46vh' } });
    const statusLine = U.el('div', {
      class: 'tiny', style: { color: 'var(--text-3)', marginBottom: '10px' }
    }, '加载中…');

    async function refresh() {
      U.clear(listBox);
      try {
        const r = await API.listBackups();
        const arr = r.backups || [];
        statusLine.textContent = arr.length
          ? '共 ' + arr.length + ' 个备份（最多保留 ' + (r.max || 30) + ' 个）'
          : '还没有备份。每次批量导入前会自动备份一次。';

        if (!arr.length) {
          listBox.appendChild(U.el('div', { class: 'empty', style: { padding: '24px 10px' } }, [
            U.el('div', { class: 'empty-title', text: '没有备份' }),
            U.el('div', { class: 'empty-desc', text: '导入活动时会自动创建；也可以点下面的「立即备份」手动存一份。' })
          ]));
          return;
        }

        for (const b of arr) {
          const row = U.el('div', { class: 'cand', style: { alignItems: 'center' } }, [
            U.el('div', { class: 'cand-main' }, [
              U.el('div', { class: 'cand-title', text: b.label || '（未命名备份）' }),
              U.el('div', { class: 'cand-meta' }, [
                U.el('span', { text: (b.createdAt || '').replace('T', ' ') }),
                U.el('span', { text: b.count + ' 条活动' }),
                U.el('span', { text: Math.round(b.size / 1024) + ' KB' })
              ])
            ]),
            U.el('button', {
              class: 'btn btn-sm', text: '恢复',
              onclick: async () => {
                const okRestore = await U.confirmDialog(
                  '恢复备份',
                  '将把活动库恢复到「' + (b.label || b.id) + '」的状态（' + b.count + ' 条活动）。\n\n当前状态会先自动备份一份，恢复错了还能退回来。',
                  '恢复', false
                );
                if (!okRestore) return;
                try {
                  const rr = await API.restoreBackup(b.id);
                  await Store.refresh();
                  renderAll();
                  U.toast('已恢复到 ' + rr.count + ' 条活动', 'ok');
                  close();
                } catch (e) {
                  U.toast(e.message, 'err');
                }
              }
            }),
            U.el('button', {
              class: 'icon-btn', title: '删除这个备份',
              html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke-linecap="round"/></svg>',
              onclick: async () => {
                const okDel = await U.confirmDialog('删除备份', '删除后无法恢复，确定吗？', '删除', true);
                if (!okDel) return;
                try {
                  await API.deleteBackup(b.id);
                  await refresh();
                } catch (e) { U.toast(e.message, 'err'); }
              }
            })
          ]);
          listBox.appendChild(row);
        }
      } catch (e) {
        statusLine.textContent = '加载失败：' + e.message;
      }
    }

    const mask = U.el('div', {
      class: 'modal-mask',
      onclick: ev => { if (ev.target === mask) close(); }
    }, [
      U.el('div', { class: 'modal', style: { width: '520px' } }, [
        U.el('div', { class: 'modal-head', text: '版本备份与恢复' }),
        U.el('div', { class: 'modal-body' }, [statusLine, listBox]),
        U.el('div', { class: 'modal-foot' }, [
          U.el('button', {
            class: 'btn', text: '立即备份',
            onclick: async () => {
              try {
                await API.createBackup('手动备份 ' + S.events.length + ' 条');
                await refresh();
                U.toast('已创建备份', 'ok');
              } catch (e) { U.toast(e.message, 'err'); }
            }
          }),
          U.el('div', { class: 'grow' }),
          U.el('button', { class: 'btn btn-primary', text: '关闭', onclick: close })
        ])
      ])
    ]);

    rootEl.innerHTML = '';
    rootEl.appendChild(mask);
    await refresh();
  }

  /* ---------------- 导航 ---------------- */
  function bindNav() {
    const nav = U.qs('#nav');
    if (nav) {
      nav.addEventListener('click', ev => {
        const item = ev.target.closest('.nav-item');
        if (!item) return;
        Store.setView(item.dataset.view);
      });
    }

    const toggle = U.qs('#row-all-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => openGameSettingsModal());
    }

    // 抽屉遮罩关闭
    const m = U.qs('#drawer-mask');
    if (m) m.addEventListener('click', () => Drawer.close());

    // 快捷键
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        Drawer.close();
        const mr = U.qs('#modal-root');
        if (mr) mr.innerHTML = '';
      }
      // Ctrl+N 新建
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        openCreateModal();
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    bindNav();

    try {
      await Store.load();
    } catch (e) {
      U.toast('加载失败：' + e.message, 'err', 6000);
      return;
    }

    // 支持 ?view=deadline&game=genshin 直接进入某个视图（便于截图与分享）
    try {
      const params = new URLSearchParams(location.search);
      const v = params.get('view');
      if (v && VIEW_META[v]) {
        S.view = v;
        U.qsa('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === v));
      }
      const g = params.get('game');
      if (g) {
        const valid = g.split(',').filter(x => S.games.some(g2 => g2.id === x));
        if (valid.length) S.activeGames = new Set(valid);
      }
    } catch (_) {}

    renderAll();

    // 事件订阅
    Store.on('view', v => {
      syncViewSections();
      currentRender();
      renderTopbar();
      const c = U.qs('#content');
      if (c) c.scrollTop = 0;
    });
    Store.on('filter', () => renderAll());
    Store.on('changed', () => renderAll());
    Store.on('tick', () => {
      // 每秒只刷新倒计时相关视图，避免整页重绘
      if (S.view === 'deadline') DeadlineView.render();
      else if (S.view === 'calendar') renderSidebar();
    });

    // 每分钟推进时间
    tickTimer = setInterval(() => Store.tick(), 60000);

    // 提醒轮询
    Reminder.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
