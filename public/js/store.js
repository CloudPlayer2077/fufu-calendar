'use strict';
/* 前端状态中心：事件数据、筛选、视图切换 */

(function () {
  const listeners = {};

  const S = {
    ready: false,
    games: [],
    categories: [],
    events: [],
    settings: {},
    now: new Date(),

    // 视图状态
    view: 'calendar',
    cursor: new Date(),          // 月历当前月 / 时间轴起始
    activeGames: new Set(),      // 空集合表示全部
    activeCategories: new Set(),
    search: '',

    ocrJob: null,
    candidates: []
  };

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => {
      const a = listeners[evt];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  }

  function emit(evt, payload) {
    (listeners[evt] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[store]', evt, e); }
    });
  }

  function gameById(id) {
    return S.games.find(g => g.id === id) || null;
  }

  function gameColor(id) {
    const g = gameById(id);
    return g ? g.color : '#7e96b0';
  }

  function gameName(id) {
    const g = gameById(id);
    return g ? g.name : '未指定';
  }

  function gameMark(id) {
    const g = gameById(id);
    return g ? g.mark : '?';
  }

  function categoryById(id) {
    return S.categories.find(c => c.id === id) || null;
  }

  function categoryColor(id) {
    const c = categoryById(id);
    return c ? c.color : '#A0AEC0';
  }

  function categoryName(id) {
    const c = categoryById(id);
    return c ? c.name : '其他';
  }

  /** 应用游戏/分类/搜索筛选 */
  function filtered() {
    const now = S.now;
    const q = S.search.trim().toLowerCase();
    return S.events.filter(e => {
      if (S.activeGames.size && !S.activeGames.has(e.game)) return false;
      if (S.activeCategories.size && !S.activeCategories.has(e.category)) return false;
      if (q) {
        const hay = (e.title + ' ' + gameName(e.game) + ' ' + (e.note || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /** 事件是否已结束 */
  function isPast(e) {
    const end = U.parseLocal(e.endAt);
    return end ? end.getTime() < S.now.getTime() : false;
  }

  function isActive(e) {
    const s = U.parseLocal(e.startAt), en = U.parseLocal(e.endAt);
    if (!s || !en) return false;
    return s.getTime() <= S.now.getTime() && en.getTime() >= S.now.getTime();
  }

  /** 距结束的毫秒数 */
  function msLeft(e) {
    const en = U.parseLocal(e.endAt);
    return en ? en.getTime() - S.now.getTime() : 0;
  }

  async function load() {
    const data = await API.bootstrap();
    S.games = data.games || [];
    S.categories = data.categories || [];
    S.events = data.events || [];
    S.settings = data.settings || {};
    S.now = U.parseLocal(data.now) || new Date();

    // 恢复上次保存的游戏显示设置
    const enabled = Array.isArray(S.settings.enabledGames) ? S.settings.enabledGames : [];
    S.activeGames = new Set(enabled.filter(id => S.games.some(g => g.id === id)));

    S.ready = true;
    emit('loaded', S);
    emit('changed');
    return S;
  }

  async function refresh() {
    const data = await API.listEvents({});
    S.events = data.events || [];
    emit('changed');
  }

  function setEvents(events) {
    S.events = events;
    emit('changed');
  }

  function setView(v) {
    if (S.view === v) return;
    S.view = v;
    emit('view', v);
  }

  /**
   * 把当前游戏筛选写回设置（持久化）。
   * 全选等价于「不筛选」，存空数组更简洁。
   * 用防抖避免连点时频繁请求。
   */
  let saveTimer = null;
  function persistGames() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const picked = [...S.activeGames];
      const allIds = S.games.map(g => g.id);
      // 全选 / 空集 都存成 []（表示不筛选）
      const value = picked.length === allIds.length ? [] : picked;
      S.settings.enabledGames = value;
      try {
        await API.updateSettings({ enabledGames: value });
      } catch (e) {
        // 保存失败不影响当前会话的筛选效果
        console.warn('[store] 保存游戏筛选失败', e);
      }
    }, 350);
  }

  function toggleGame(id) {
    if (S.activeGames.has(id)) S.activeGames.delete(id);
    else S.activeGames.add(id);
    persistGames();
    emit('filter');
  }

  function setGames(list) {
    S.activeGames = new Set(list);
    persistGames();
    emit('filter');
  }

  /** 直接设置「只显示这些游戏」，用于设置面板 */
  function setEnabledGames(list) {
    const valid = (list || []).filter(id => S.games.some(g => g.id === id));
    S.activeGames = new Set(valid);
    persistGames();
    emit('filter');
  }

  /** 当前是否处于「筛选了部分游戏」的状态 */
  function isFiltered() {
    return S.activeGames.size > 0 && S.activeGames.size < S.games.length;
  }

  /** 当前实际显示的游戏 id 列表 */
  function visibleGameIds() {
    const all = S.games.map(g => g.id);
    if (S.activeGames.size === 0) return all;
    // 只保留仍然存在的游戏
    return all.filter(id => S.activeGames.has(id));
  }

  function toggleCategory(id) {
    if (S.activeCategories.has(id)) S.activeCategories.delete(id);
    else S.activeCategories.add(id);
    emit('filter');
  }

  function stats() {
    const evs = filtered();
    let active = 0, week = 0, past = 0, due = 0;
    for (const e of evs) {
      const left = msLeft(e);
      if (e.done) { past++; continue; }
      if (left < 0) { past++; continue; }
      active++;
      if (left <= 7 * 86400000) week++;
      if (left <= 3 * 86400000) due++;
    }
    return { active, week, past, due, total: evs.length };
  }

  /** 每分钟推进一次 now，触发倒计时刷新 */
  function tick() {
    S.now = new Date();
    emit('tick');
  }

  window.S = S;
  window.Store = {
    on, emit, load, refresh, setEvents, setView,
    filtered, isPast, isActive, msLeft,
    gameById, gameColor, gameName, gameMark,
    categoryById, categoryColor, categoryName,
    toggleGame, setGames, toggleCategory, stats, tick,
    setEnabledGames, isFiltered, visibleGameIds
  };
})();
