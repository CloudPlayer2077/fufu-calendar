'use strict';
/* 截图导入视图：上传 -> OCR -> 候选确认 -> 入库 */

(function () {
  const root = () => U.qs('#view-import');

  let pollTimer = null;
  let currentFile = null;
  let candidates = [];
  let selected = new Set();
  let lastOcrText = '';      // 最近一次 OCR 的原始文本，用来喂给 AI 纠错

  // 在线同步状态：{ busy, summary:[], fetchedAt, error, picked:Set<gameId> }
  let syncState = { busy: false, summary: [], fetchedAt: '', error: '', picked: null };

  // 从链接导入状态
  let urlState = { busy: false, url: '', game: null, error: '', info: '' };

  // AI 配置缓存（懒加载）
  let aiCfg = null;

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /** 数据源卡片 */
  function buildSourceCard() {
    const card = U.el('div', { class: 'card card-pad' });
    card.appendChild(U.el('div', { class: 'card-title', text: '在线同步（从 Wiki 拉取）' }));

    card.appendChild(U.el('div', {
      class: 'tiny',
      style: { lineHeight: '1.8', color: 'var(--text-3)', marginBottom: '11px' }
    }, [
      U.el('div', { text: '从 BWIKI / 官网的活动一览直接拉取，比截图更准更全。' }),
      U.el('div', { text: '需要联网；抓取结果会缓存在本地，断网时自动使用上次的数据。' })
    ]));

    // 游戏选择
    const pickRow = U.el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '12px' } });
    if (!syncState.picked) syncState.picked = new Set(S.games.map(g => g.id));

    for (const g of S.games) {
      const on = syncState.picked.has(g.id);
      pickRow.appendChild(U.el('button', {
        class: 'pill' + (on ? ' on' : ''),
        style: on ? {
          color: g.color,
          borderColor: U.hexToRgba(g.color, 0.5),
          background: U.hexToRgba(g.color, 0.12)
        } : {},
        onclick: () => {
          if (syncState.picked.has(g.id)) syncState.picked.delete(g.id);
          else syncState.picked.add(g.id);
          render();
        }
      }, [
        U.el('span', { class: 'dot', style: { background: g.color } }),
        g.name
      ]));
    }
    card.appendChild(pickRow);

    // 按钮
    const btnChildren = syncState.busy
      ? [U.el('span', { class: 'spinner' }), U.el('span', { text: '同步中…' })]
      : [U.el('span', { text: '开始同步' })];
    const btn = U.el('button', {
      class: 'btn btn-primary btn-sm',
      disabled: syncState.busy || syncState.picked.size === 0,
      onclick: () => fetchFromSources()
    }, btnChildren);
    card.appendChild(btn);

    // 结果摘要
    if (syncState.summary.length) {
      const box = U.el('div', { style: { marginTop: '12px' } });
      for (const s of syncState.summary) {
        const g = Store.gameById(s.game);
        const color = g ? g.color : '#7e96b0';
        const okk = s.status === 'ok';
        const cached = s.status === 'cached';
        const label = okk ? '在线' : (cached ? '缓存' : '失败');
        const labelColor = okk ? 'var(--ok)' : (cached ? 'var(--warn)' : 'var(--danger)');
        const stale = s.staleness && s.staleness.warning;

        const row = U.el('div', {
          class: 'row',
          style: {
            gap: '7px', padding: '5px 0',
            borderBottom: '1px solid rgba(120,190,255,0.07)',
            fontSize: '11.5px'
          },
          title: s.message
        }, [
          U.el('span', {
            style: {
              width: '6px', height: '6px', borderRadius: '50%',
              background: color, flexShrink: '0'
            }
          }),
          U.el('span', { text: g ? g.name : s.game, style: { color: 'var(--text-1)' } }),
          U.el('span', {
            text: label,
            style: {
              fontSize: '10px', padding: '1px 6px', borderRadius: '99px',
              color: labelColor, background: U.hexToRgba(okk ? '#4ade80' : (cached ? '#ffb347' : '#ff6b6b'), 0.14)
            }
          }),
          stale ? U.el('span', {
            text: '数据旧',
            title: s.staleness.warning,
            style: {
              fontSize: '10px', padding: '1px 6px', borderRadius: '99px',
              color: '#ffb347', background: 'rgba(255,179,71,0.14)'
            }
          }) : null,
          U.el('div', { class: 'grow' }),
          U.el('span', {
            class: 'mono tiny',
            text: s.count ? s.count + ' 条' : '—',
            style: { color: 'var(--text-2)' }
          })
        ]);
        box.appendChild(row);

        // 旧数据的详细提示
        if (stale) {
          box.appendChild(U.el('div', {
            class: 'tiny',
            style: { color: 'var(--warn)', padding: '3px 0 5px 13px', lineHeight: '1.6', opacity: '0.9' },
            text: s.staleness.warning
          }));
        }
      }

      if (syncState.fetchedAt) {
        box.appendChild(U.el('div', {
          class: 'tiny',
          style: { color: 'var(--text-3)', marginTop: '8px' }
        }, '抓取于 ' + syncState.fetchedAt.replace('T', ' ')));
      }
      card.appendChild(box);
    }

    if (syncState.error) {
      card.appendChild(U.el('div', {
        class: 'tiny',
        style: { color: 'var(--danger)', marginTop: '9px', lineHeight: '1.7' },
        text: syncState.error
      }));
    }

    return card;
  }

  /** 从链接导入卡片 */
  function buildUrlCard() {
    const card = U.el('div', { class: 'card card-pad' });
    card.appendChild(U.el('div', { class: 'card-title', text: '从链接导入' }));

    card.appendChild(U.el('div', {
      class: 'tiny',
      style: { lineHeight: '1.8', color: 'var(--text-3)', marginBottom: '10px' },
      text: '粘贴任意活动页链接，程序会用无头浏览器渲染出正文，再抽取活动时间。适合官网公告页、wiki 活动页。'
    }));

    const urlInput = U.el('input', {
      class: 'input',
      placeholder: 'https://...',
      value: urlState.url || '',
      style: { width: '100%', marginBottom: '8px' },
      oninput: e => { urlState.url = e.target.value; }
    });
    card.appendChild(urlInput);

    // 可选：归属游戏
    const gameSel = U.el('select', {
      class: 'select',
      style: { width: '100%', marginBottom: '10px' },
      onchange: e => { urlState.game = e.target.value || null; }
    });
    gameSel.appendChild(U.el('option', { value: '', text: '自动判断游戏' }));
    for (const g of S.games) {
      const opt = U.el('option', { value: g.id, text: '强制归到：' + g.name });
      if (urlState.game === g.id) opt.selected = true;
      gameSel.appendChild(opt);
    }
    card.appendChild(gameSel);

    const btnRow = U.el('div', { class: 'row', style: { gap: '7px' } });
    const btn = U.el('button', {
      class: 'btn btn-primary btn-sm',
      disabled: urlState.busy,
      onclick: () => importFromUrl()
    }, urlState.busy
      ? [U.el('span', { class: 'spinner' }), U.el('span', { text: '渲染中…' })]
      : [U.el('span', { text: '渲染并解析' })]);
    btnRow.appendChild(btn);

    if (urlState.url) {
      btnRow.appendChild(U.el('button', {
        class: 'btn btn-sm btn-ghost', text: '清空',
        onclick: () => { urlState.url = ''; urlState.error = ''; render(); }
      }));
    }
    card.appendChild(btnRow);

    if (urlState.error) {
      card.appendChild(U.el('div', {
        class: 'tiny',
        style: { color: 'var(--danger)', marginTop: '9px', lineHeight: '1.7' },
        text: urlState.error
      }));
    }

    if (urlState.info) {
      card.appendChild(U.el('div', {
        class: 'tiny',
        style: { color: 'var(--text-2)', marginTop: '9px', lineHeight: '1.7' },
        text: urlState.info
      }));
    }

    return card;
  }

  /** 从链接导入 */
  async function importFromUrl() {
    const url = String(urlState.url || '').trim();
    if (!url) { U.toast('请先填一个链接', 'info'); return; }
    if (!/^https?:\/\//i.test(url)) { U.toast('链接要以 http:// 或 https:// 开头', 'err'); return; }

    urlState.busy = true;
    urlState.error = '';
    urlState.info = '';
    render();

    try {
      const r = await API.importUrl(url, urlState.game, 70000);

      if (!r.ok) {
        urlState.error = r.error + (r.hint ? '\n' + r.hint : '');
        U.toast(r.error, 'err', 5200);
        return;
      }

      const cands = (r.candidates || []).map(c => ({
        game: c.game || urlState.game || null,
        title: c.title,
        category: c.category,
        startAt: c.startAt,
        endAt: c.endAt,
        allDay: !!c.allDay,
        confidence: c.confidence,
        evidence: c.evidence || [],
        rawLine: c.rawLine || '',
        _origin: 'url'
      }));

      // 同来源的旧结果替换掉，OCR/wiki 的保留
      candidates = candidates.filter(c => c._origin !== 'url').concat(cands);

      const now = Date.now();
      selected = new Set();
      candidates.forEach((c, i) => {
        const end = U.parseLocal(c.endAt);
        if (end && end.getTime() >= now) selected.add(i);
      });

      urlState.info = '渲染成功：' + (r.title || '无标题') + '，正文 ' + r.textLength +
        ' 字，解析出 ' + cands.length + ' 条候选';

      if (cands.length) {
        U.toast('解析出 ' + cands.length + ' 条候选', 'ok', 4000);
      } else {
        U.toast('页面渲染成功，但没从中解析出「活动名 + 日期区间」', 'info', 5200);
      }

      const right = U.qs('#ocr-result');
      if (right) renderCandidates(right);
    } catch (e) {
      urlState.error = e.message;
      U.toast(e.message, 'err', 5200);
    } finally {
      urlState.busy = false;
      render();
    }
  }

  /* ---------------- AI 纠错 ---------------- */

  /** 读一次 AI 配置（带缓存） */
  async function getAiConfig(force) {
    if (aiCfg && !force) return aiCfg;
    try {
      const r = await API.aiConfig();
      aiCfg = r.config || {};
    } catch (e) {
      aiCfg = { configured: false };
    }
    return aiCfg;
  }

  /** 用 AI 重新解析当前 OCR 文本 */
  async function runAiFix() {
    const text = lastOcrText || candidates.map(c => c.rawLine).filter(Boolean).join('\n');
    if (!text) {
      U.toast('还没有 OCR 文本。先上传一张截图。', 'info');
      return;
    }

    const cfg = await getAiConfig();
    if (!cfg.configured) {
      const ok = await openAiConfigDialog();
      if (!ok) return;
      await getAiConfig(true);
    }

    // 猜一个游戏：候选里出现最多的那个
    const counts = {};
    for (const c of candidates) {
      if (c.game) counts[c.game] = (counts[c.game] || 0) + 1;
    }
    let guessGame = null;
    let best = 0;
    for (const k in counts) { if (counts[k] > best) { best = counts[k]; guessGame = k; } }

    const right = U.qs('#ocr-result');
    if (right) {
      const tip = U.el('div', {
        class: 'row', style: { gap: '8px', marginBottom: '10px', color: '#c9b6ff', fontSize: '12px' }
      }, [U.el('span', { class: 'spinner' }), U.el('span', { text: 'AI 正在纠错…' })]);
      right.insertBefore(tip, right.firstChild);
    }

    try {
      const r = await API.aiParse(text, guessGame);
      if (!r.ok) {
        U.toast(r.error || 'AI 解析失败', 'err', 5200);
        return;
      }
      if (!r.candidates.length) {
        U.toast('AI 没有解析出活动，可能这段文本里确实没有活动时间', 'info', 4600);
        return;
      }

      // 用 AI 结果替换全部候选（它已经覆盖了整段文本）
      candidates = r.candidates.map(c => Object.assign({}, c, { _origin: 'ai' }));
      const now = Date.now();
      selected = new Set();
      candidates.forEach((c, i) => {
        const end = U.parseLocal(c.endAt);
        if (end && end.getTime() >= now) selected.add(i);
      });

      const usage = r.usage ? (' · 消耗 ' + ((r.usage.total_tokens || 0)) + ' tokens') : '';
      U.toast('AI 解析出 ' + r.candidates.length + ' 条' + usage, 'ok', 4200);
    } catch (e) {
      U.toast(e.message, 'err', 5200);
    } finally {
      const right = U.qs('#ocr-result');
      if (right) renderCandidates(right);
    }
  }

  /** AI 配置弹窗 */
  function openAiConfigDialog() {
    return new Promise(async resolve => {
      const rootEl = U.qs('#modal-root');
      const close = v => { rootEl.innerHTML = ''; resolve(v); };

      let presets = [];
      try {
        const r = await API.aiPresets();
        presets = r.presets || [];
      } catch (_) {}

      const cfg = await getAiConfig(true);

      const state = {
        preset: cfg.preset || 'deepseek',
        baseUrl: cfg.baseUrl || '',
        model: cfg.model || '',
        apiKey: ''
      };

      const baseInput = U.el('input', {
        class: 'input', placeholder: 'https://api.deepseek.com/v1', value: state.baseUrl,
        oninput: e => { state.baseUrl = e.target.value; }
      });
      const modelInput = U.el('input', {
        class: 'input', placeholder: 'deepseek-chat', value: state.model,
        oninput: e => { state.model = e.target.value; }
      });
      const keyInput = U.el('input', {
        class: 'input', type: 'password',
        placeholder: cfg.apiKeyMasked ? ('已保存 ' + cfg.apiKeyMasked + '，留空则不修改') : 'sk-...',
        oninput: e => { state.apiKey = e.target.value; }
      });

      const presetRow = U.el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '12px' } });
      function paintPresets() {
        U.clear(presetRow);
        for (const p of presets) {
          const on = state.preset === p.id;
          presetRow.appendChild(U.el('button', {
            class: 'pill' + (on ? ' on' : ''),
            text: p.name,
            onclick: () => {
              state.preset = p.id;
              if (p.baseUrl) { state.baseUrl = p.baseUrl; baseInput.value = p.baseUrl; }
              if (p.model) { state.model = p.model; modelInput.value = p.model; }
              paintPresets();
            }
          }));
        }
      }
      paintPresets();

      const mask = U.el('div', { class: 'modal-mask', onclick: e => { if (e.target === mask) close(false); } }, [
        U.el('div', { class: 'modal', style: { width: '500px' } }, [
          U.el('div', { class: 'modal-head', text: 'AI 识别配置' }),
          U.el('div', { class: 'modal-body' }, [
            U.el('div', {
              class: 'tiny', style: { color: 'var(--text-3)', lineHeight: '1.8', marginBottom: '12px' }
            }, [
              U.el('div', { text: '填入任意 OpenAI 兼容接口即可。OCR 认错的字交给大模型按游戏语境还原，准确率比规则引擎高很多。' }),
              U.el('div', { text: 'Key 只保存在本机的 data/db.json 里，不会上传到别处。' })
            ]),
            U.el('div', { class: 'field' }, [
              U.el('div', { class: 'field-label', text: '服务商预设' }),
              presetRow
            ]),
            U.el('div', { class: 'field' }, [
              U.el('div', { class: 'field-label', text: 'API 地址（需以 /v1 结尾）' }),
              baseInput
            ]),
            U.el('div', { class: 'field' }, [
              U.el('div', { class: 'field-label', text: '模型名' }),
              modelInput
            ]),
            U.el('div', { class: 'field' }, [
              U.el('div', { class: 'field-label', text: 'API Key' }),
              keyInput
            ]),
            U.el('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, [
              U.el('button', {
                class: 'btn btn-sm', text: '保存并测试',
                onclick: async ev => {
                  const btn = ev.currentTarget;
                  btn.disabled = true;
                  btn.textContent = '测试中…';
                  try {
                    await API.saveAiConfig({
                      preset: state.preset,
                      baseUrl: state.baseUrl,
                      model: state.model,
                      apiKey: state.apiKey || undefined
                    });
                    const t = await API.aiTest();
                    if (t.ok) {
                      U.toast('AI 连接正常，测试解析出 ' + (t.sample || []).length + ' 条', 'ok', 4200);
                      close(true);
                    } else {
                      U.toast(t.error || '测试失败', 'err', 5200);
                    }
                  } catch (e) {
                    U.toast(e.message, 'err');
                  } finally {
                    btn.disabled = false;
                    btn.textContent = '保存并测试';
                  }
                }
              })
            ])
          ]),
          U.el('div', { class: 'modal-foot' }, [
            U.el('button', { class: 'btn', text: '取消', onclick: () => close(false) }),
            U.el('button', {
              class: 'btn btn-primary', text: '保存',
              onclick: async ev => {
                const btn = ev.currentTarget;
                btn.disabled = true;
                try {
                  await API.saveAiConfig({
                    preset: state.preset,
                    baseUrl: state.baseUrl,
                    model: state.model,
                    apiKey: state.apiKey || undefined
                  });
                  await getAiConfig(true);
                  U.toast('已保存', 'ok');
                  close(true);
                } catch (e) {
                  U.toast(e.message, 'err');
                  btn.disabled = false;
                }
              }
            })
          ])
        ])
      ]);

      rootEl.innerHTML = '';
      rootEl.appendChild(mask);
    });
  }

  /** 执行在线同步 */
  async function fetchFromSources() {    const games = [...syncState.picked];
    if (!games.length) { U.toast('请先选择要同步的游戏', 'info'); return; }

    syncState.busy = true;
    syncState.error = '';
    render();

    try {
      const r = await API.fetchSources(games);
      syncState.summary = r.summary || [];
      syncState.fetchedAt = r.fetchedAt || '';

      const wikiCands = (r.events || []).map(e => ({
        game: e.game,
        title: e.title,
        category: e.category,
        startAt: e.startAt,
        endAt: e.endAt,
        allDay: !!e.allDay,
        confidence: e.confidence,
        evidence: (e._meta && e._meta.evidence) || [],
        rawLine: e.note || '',
        _origin: 'wiki'
      }));

      // 合并进候选列表：OCR 的保留，wiki 的替换掉同来源的旧条目
      candidates = candidates.filter(c => c._origin !== 'wiki').concat(wikiCands);

      // 默认勾选：未结束的活动
      selected = new Set();
      const now = Date.now();
      candidates.forEach((c, i) => {
        const end = U.parseLocal(c.endAt);
        if (end && end.getTime() >= now) selected.add(i);
      });

      const okCount = syncState.summary.filter(s => s.status === 'ok').length;
      const failed = syncState.summary.filter(s => s.status === 'failed').length;
      if (wikiCands.length) {
        U.toast('拉取到 ' + wikiCands.length + ' 条活动，已默认勾选未结束的 ' + selected.size + ' 条', 'ok', 4200);
      } else {
        U.toast('没有拉到活动' + (failed ? '（' + failed + ' 个数据源失败）' : ''), 'info', 4200);
      }

      const right = U.qs('#ocr-result');
      if (right) renderCandidates(right);
    } catch (e) {
      syncState.error = e.message;
      U.toast(e.message, 'err', 5000);
    } finally {
      syncState.busy = false;
      render();
    }
  }

  function render() {
    const R = root();
    if (!R) return;
    U.clear(R);

    const layout = U.el('div', { class: 'import-layout' });

    /* ---------------- 左：上传 ---------------- */
    const left = U.el('div', { class: 'col', style: { gap: '14px' } });

    const uploadCard = U.el('div', { class: 'card card-pad' }, [
      U.el('div', { class: 'card-title', text: '上传官方活动日历截图' })
    ]);

    const zone = U.el('div', { class: 'dropzone', id: 'dropzone' }, [
      U.el('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4',
        html: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3.5 17l5-5 3.5 3.5L15 12l5.5 5" stroke-linecap="round" stroke-linejoin="round"/>'
      }),
      U.el('div', { class: 'dropzone-title', text: '点击选择，或把截图拖进来' }),
      U.el('div', { class: 'dropzone-desc', text: '支持 PNG / JPG / WEBP。长截图也没问题，程序会自动切片识别。' })
    ]);

    const fileInput = U.el('input', {
      type: 'file', accept: 'image/png,image/jpeg,image/webp,image/*',
      style: { display: 'none' },
      onchange: e => {
        const f = e.target.files && e.target.files[0];
        if (f) handleFile(f);
        e.target.value = '';
      }
    });

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('hover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('hover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('hover');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    uploadCard.appendChild(zone);
    uploadCard.appendChild(fileInput);

    // 进度区
    const progressBox = U.el('div', { id: 'ocr-progress', style: { display: 'none', marginTop: '14px' } });
    uploadCard.appendChild(progressBox);

    left.appendChild(uploadCard);

    // 说明卡
    left.appendChild(U.el('div', { class: 'card card-pad' }, [
      U.el('div', { class: 'card-title', text: '两种导入方式' }),
      U.el('div', { class: 'tiny', style: { lineHeight: '1.9', color: 'var(--text-2)' } }, [
        U.el('div', { text: '① 截图 OCR —— 系统自带中文引擎，完全离线，适合官方的图文日历' }),
        U.el('div', { text: '② 在线同步 —— 从 BWIKI 语义查询直接拉结构化数据，最准最全' }),
        U.el('div', { text: '③ 两者都会先列成候选，你勾选确认后才写入日历' }),
        U.el('div', {
          text: '④ 同游戏同标题同起始日的重复项会自动合并',
          style: { color: 'var(--text-3)' }
        })
      ])
    ]));

    // 在线数据源同步卡
    left.appendChild(buildSourceCard());

    // 从链接导入卡
    left.appendChild(buildUrlCard());

    /* ---------------- 右：结果 ---------------- */
    const right = U.el('div', { class: 'card card-pad', id: 'ocr-result' }, [
      U.el('div', { class: 'card-title', text: '待确认活动' }),
      U.el('div', { class: 'empty', id: 'ocr-empty' }, [
        U.el('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2',
          html: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6" stroke-linecap="round"/>'
        }),
        U.el('div', { class: 'empty-title', text: '还没有待确认的活动' }),
        U.el('div', {
          class: 'empty-desc',
          text: '可以上传活动日历截图做 OCR 识别，也可以点左侧「在线同步」从 wiki 直接拉活动。结果都会先列在这里，勾选后才写入日历。'
        })
      ])
    ]);

    layout.appendChild(left);
    layout.appendChild(right);
    R.appendChild(layout);

    // 恢复上一次的识别结果（切视图不丢）
    if (candidates.length) {
      renderCandidates(right);
    }
  }

  async function handleFile(file) {
    if (!/^image\//.test(file.type)) {
      U.toast('请选择图片文件', 'err');
      return;
    }
    if (file.size > 38 * 1024 * 1024) {
      U.toast('图片太大（上限 38 MB）', 'err');
      return;
    }

    currentFile = file;
    candidates = [];
    selected = new Set();

    const box = U.qs('#ocr-progress');
    if (box) {
      box.style.display = 'block';
      U.clear(box);
      box.appendChild(U.el('div', { class: 'preview-wrap' }, [
        U.el('img', { src: URL.createObjectURL(file), alt: '预览' })
      ]));
      box.appendChild(U.el('div', { class: 'progress-track' }, [
        U.el('div', { class: 'progress-bar', id: 'ocr-bar', style: { width: '8%' } })
      ]));
      box.appendChild(U.el('div', { class: 'stage-text', id: 'ocr-stage' }, [
        U.el('div', { class: 'spinner' }),
        U.el('span', { text: '正在上传…' })
      ]));
    }

    try {
      const up = await API.uploadOcr(file);
      startPoll(up.jobId);
    } catch (e) {
      setStage('上传失败：' + e.message, true);
      U.toast(e.message, 'err');
    }
  }

  function setProgress(p) {
    const bar = U.qs('#ocr-bar');
    if (bar) bar.style.width = Math.max(6, Math.min(100, p * 100)) + '%';
  }

  function setStage(text, isErr) {
    const st = U.qs('#ocr-stage');
    if (!st) return;
    U.clear(st);
    if (isErr) {
      st.appendChild(U.el('span', { text: text, style: { color: 'var(--danger)' } }));
    } else {
      st.appendChild(U.el('div', { class: 'spinner' }));
      st.appendChild(U.el('span', { text: text }));
    }
  }

  function startPoll(jobId) {
    stopPoll();
    setStage('排队中…');
    setProgress(0.1);

    let ticks = 0;
    pollTimer = setInterval(async () => {
      ticks++;
      if (ticks > 200) { // 100 秒
        stopPoll();
        setStage('识别超时，请重试或换一张图', true);
        return;
      }
      try {
        const r = await API.getOcr(jobId);
        const job = r.job;
        setProgress(job.progress || 0.1);
        setStage(job.stage + '…');

        if (job.status === 'done') {
          stopPoll();
          setProgress(1);
          setStage('识别完成：共 ' + (job.candidates || []).length + ' 条候选，' + (job.lineCount || 0) + ' 行文本 · 用时 ' + ((job.elapsedMs || 0) / 1000).toFixed(1) + ' 秒');

          candidates = job.candidates || [];
          selected = new Set(candidates.map((c, i) => i));
          lastOcrText = job.rawText || '';

          const right = U.qs('#ocr-result');
          if (right) renderCandidates(right, job.rawText);

          if (!candidates.length) {
            U.toast('没识别出活动，可能是截图太模糊或格式不常见', 'info', 4200);
          } else {
            U.toast('识别出 ' + candidates.length + ' 条候选，确认后导入', 'ok');
          }
        } else if (job.status === 'error') {
          stopPoll();
          setStage('识别失败：' + (job.error || '未知错误'), true);
          U.toast(job.error || '识别失败', 'err', 4200);
        }
      } catch (e) {
        stopPoll();
        setStage('轮询失败：' + e.message, true);
      }
    }, 500);
  }

  function renderCandidates(container, rawText) {
    U.clear(container);

    const wikiCount = candidates.filter(c => c._origin === 'wiki').length;
    const ocrCount = candidates.length - wikiCount;

    const head = U.el('div', { class: 'row', style: { marginBottom: '12px', gap: '8px' } }, [
      U.el('div', { class: 'card-title', text: '待确认活动', style: { margin: '0' } }),
      U.el('span', { class: 'tiny muted', text: '已选 ' + selected.size + ' / ' + candidates.length }),
      wikiCount ? U.el('span', {
        class: 'chip',
        text: 'Wiki ' + wikiCount,
        style: {
          color: '#8fe4ff', background: 'rgba(70,211,255,0.14)',
          borderColor: 'rgba(70,211,255,0.36)', fontSize: '9.5px', height: '18px'
        }
      }) : null,
      ocrCount ? U.el('span', {
        class: 'chip',
        text: 'OCR ' + ocrCount,
        style: {
          color: '#ffd166', background: 'rgba(255,209,102,0.14)',
          borderColor: 'rgba(255,209,102,0.36)', fontSize: '9.5px', height: '18px'
        }
      }) : null,
      U.el('div', { class: 'topbar-spacer' }),
      U.el('button', {
        class: 'btn btn-sm',
        title: '把 OCR 文本交给 AI 纠错重排（更准确，需要配置 API）',
        style: { color: '#c9b6ff', borderColor: 'rgba(155,123,255,0.45)', background: 'rgba(155,123,255,0.10)' },
        onclick: () => runAiFix()
      }, [
        U.el('svg', {
          viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6',
          style: { width: '12px', height: '12px' },
          html: '<path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4L8 2Z" stroke-linejoin="round"/>'
        }),
        U.el('span', { text: 'AI 纠错' })
      ]),
      U.el('button', {
        class: 'btn btn-sm btn-ghost', text: '只选未完的',
        title: '勾选所有尚未结束的活动',
        onclick: () => {
          const now = Date.now();
          selected = new Set();
          candidates.forEach((c, i) => {
            const end = U.parseLocal(c.endAt);
            if (end && end.getTime() >= now) selected.add(i);
          });
          renderCandidates(container, rawText);
        }
      }),
      U.el('button', {
        class: 'btn btn-sm btn-ghost', text: '全选',
        onclick: () => {
          candidates.forEach((c, i) => selected.add(i));
          renderCandidates(container, rawText);
        }
      }),
      U.el('button', {
        class: 'btn btn-sm btn-ghost', text: '全不选',
        onclick: () => { selected.clear(); renderCandidates(container, rawText); }
      })
    ]);
    container.appendChild(head);

    if (!candidates.length) {
      container.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty-title', text: '没有待确认的活动' }),
        U.el('div', {
          class: 'empty-desc',
          text: '上传活动日历截图做 OCR 识别，或点左侧「开始同步」从 wiki 拉取。'
        })
      ]));
    } else {
      const list = U.el('div', { class: 'cand-list' });
      candidates.forEach((c, i) => list.appendChild(buildCandidate(c, i, container, rawText)));
      container.appendChild(list);
    }

    // 操作条
    const actions = U.el('div', { class: 'row', style: { marginTop: '13px', gap: '8px' } }, [
      U.el('button', {
        class: 'btn btn-primary',
        text: '导入选中的 ' + selected.size + ' 条',
        onclick: async ev => {
          if (!selected.size) { U.toast('请先勾选要导入的活动', 'info'); return; }
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            const list2 = [...selected].sort((a, b) => a - b).map(i => toEvent(candidates[i]));
            const r = await API.bulkEvents(list2, 'merge');
            await Store.refresh();
            U.toast('已导入 ' + r.added + ' 条' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : ''), 'ok');
            candidates = [];
            selected = new Set();
            const right = U.qs('#ocr-result');
            if (right) renderCandidates(right);
            Store.setView('deadline');
          } catch (e) {
            U.toast(e.message, 'err');
          } finally {
            btn.disabled = false;
          }
        }
      }),
      U.el('button', {
        class: 'btn', text: '全部清空',
        onclick: async () => {
          candidates = [];
          selected = new Set();
          const box = U.qs('#ocr-progress');
          if (box) { box.style.display = 'none'; U.clear(box); }
          const right = U.qs('#ocr-result');
          if (right) renderCandidates(right);
          U.toast('已清空', 'info');
        }
      })
    ]);
    container.appendChild(actions);

    // 原始文本
    if (rawText) {
      const details = U.el('div', { style: { marginTop: '14px' } }, [
        U.el('div', {
          class: 'tiny muted',
          text: 'OCR 原始文本（点击展开）',
          style: { cursor: 'pointer', marginBottom: '6px' },
          onclick: ev => {
            const p = ev.currentTarget.nextElementSibling;
            p.classList.toggle('hidden');
          }
        }),
        U.el('div', { class: 'raw-panel hidden', text: rawText })
      ]);
      container.appendChild(details);
    }
  }

  function buildCandidate(c, i, container, rawText) {
    const g = Store.gameById(c.game);
    const on = selected.has(i);
    const color = g ? g.color : '#7e96b0';

    const node = U.el('div', { class: 'cand' + (on ? '' : ' off') });

    const check = U.el('div', {
      class: 'cand-check' + (on ? ' on' : ''),
      onclick: ev => {
        ev.stopPropagation();
        if (selected.has(i)) selected.delete(i); else selected.add(i);
        renderCandidates(container, rawText);
      }
    });
    node.appendChild(check);

    const main = U.el('div', { class: 'cand-main' });

    // 标题行（可编辑）
    const titleInput = U.el('input', {
      class: 'input',
      value: c.title,
      style: { height: '26px', fontSize: '12px', marginBottom: '6px', width: '100%' },
      oninput: e => { candidates[i].title = e.target.value; }
    });
    main.appendChild(titleInput);

    // 元信息行
    const meta = U.el('div', { class: 'cand-meta' });

    // 游戏选择
    const gameSel = U.el('select', {
      class: 'select',
      style: { height: '24px', fontSize: '11px', padding: '0 20px 0 7px' },
      onchange: e => {
        candidates[i].game = e.target.value || null;
        renderCandidates(container, rawText);
      }
    });
    gameSel.appendChild(U.el('option', { value: '', text: '未指定游戏' }));
    for (const g2 of S.games) {
      const opt = U.el('option', { value: g2.id, text: g2.name });
      if (c.game === g2.id) opt.selected = true;
      gameSel.appendChild(opt);
    }
    meta.appendChild(gameSel);

    // 分类
    const catSel = U.el('select', {
      class: 'select',
      style: { height: '24px', fontSize: '11px', padding: '0 20px 0 7px' },
      onchange: e => { candidates[i].category = e.target.value; }
    });
    for (const cat of S.categories) {
      const opt = U.el('option', { value: cat.id, text: cat.name });
      if (c.category === cat.id) opt.selected = true;
      catSel.appendChild(opt);
    }
    meta.appendChild(catSel);

    main.appendChild(meta);

    // 时间区间（可编辑）
    const timeRow = U.el('div', { class: 'row', style: { gap: '5px', marginTop: '6px' } }, [
      U.el('input', {
        class: 'input', type: 'datetime-local',
        value: c.startAt,
        style: { height: '26px', fontSize: '11px', flex: '1', minWidth: '0' },
        onchange: e => { candidates[i].startAt = e.target.value; }
      }),
      U.el('span', { class: 'tiny muted', text: '→' }),
      U.el('input', {
        class: 'input', type: 'datetime-local',
        value: c.endAt,
        style: { height: '26px', fontSize: '11px', flex: '1', minWidth: '0' },
        onchange: e => { candidates[i].endAt = e.target.value; }
      })
    ]);
    main.appendChild(timeRow);

    // 置信度 + 依据
    const confRow = U.el('div', { class: 'cand-meta', style: { marginTop: '6px' } }, [
      U.el('span', {
        class: 'chip',
        text: c._origin === 'wiki' ? 'Wiki' : 'OCR',
        style: c._origin === 'wiki' ? {
          color: '#8fe4ff', background: 'rgba(70,211,255,0.14)',
          borderColor: 'rgba(70,211,255,0.36)', fontSize: '9.5px', height: '17px'
        } : {
          color: '#ffd166', background: 'rgba(255,209,102,0.14)',
          borderColor: 'rgba(255,209,102,0.36)', fontSize: '9.5px', height: '17px'
        }
      }),
      U.el('span', { class: 'cand-conf' }, [
        U.el('span', { text: '置信 ' + Math.round((c.confidence || 0) * 100) + '%' }),
        U.el('i', {}, [U.el('b', { style: { width: Math.round((c.confidence || 0) * 100) + '%' } })])
      ])
    ]);

    if (c.evidence && c.evidence.length) {
      confRow.appendChild(U.el('span', {
        class: 'tiny',
        text: c.evidence.join(' · '),
        style: { color: 'var(--text-3)', opacity: '0.8' }
      }));
    }
    main.appendChild(confRow);

    if (c.rawLine) {
      main.appendChild(U.el('div', { class: 'cand-raw', text: c.rawLine, title: c.rawLine }));
    }

    node.appendChild(main);
    return node;
  }

  function toEvent(c) {
    const isWiki = c._origin === 'wiki';
    return {
      game: c.game || null,
      title: c.title,
      category: c.category || 'other',
      startAt: c.startAt,
      endAt: c.endAt,
      allDay: !!c.allDay,
      source: isWiki ? 'wiki' : 'ocr',
      confidence: c.confidence || 0.5,
      reminders: (S.settings && S.settings.defaultReminders) || [1440, 180],
      note: isWiki
        ? (c.rawLine || '来源 BWIKI')
        : (c.rawLine ? 'OCR 原文：' + c.rawLine : '')
    };
  }

  window.ImportView = { render };
})();
