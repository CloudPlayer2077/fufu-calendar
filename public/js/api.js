'use strict';
/* 极简 HTTP 客户端 + 统一错误处理 */

(function () {
  const BASE = '';

  async function request(method, path, body, opts) {
    const o = opts || {};
    const init = { method: method, headers: {} };

    if (body !== undefined && body !== null) {
      if (o.raw) {
        init.body = body;
        if (o.contentType) init.headers['Content-Type'] = o.contentType;
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }

    let res;
    try {
      res = await fetch(BASE + path, init);
    } catch (e) {
      throw new Error('无法连接本地服务，请确认程序仍在运行');
    }

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!res.ok) throw new Error('请求失败（HTTP ' + res.status + '）');
      return res;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('服务端返回了无效数据');
    }

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
    }
    return data;
  }

  window.API = {
    bootstrap: () => request('GET', '/api/bootstrap'),

    listEvents: (filter) => {
      const q = new URLSearchParams();
      if (filter) {
        if (filter.from) q.set('from', filter.from);
        if (filter.to) q.set('to', filter.to);
        if (filter.games && filter.games.length) q.set('games', filter.games.join(','));
        if (filter.categories && filter.categories.length) q.set('categories', filter.categories.join(','));
      }
      const qs = q.toString();
      return request('GET', '/api/events' + (qs ? '?' + qs : ''));
    },

    createEvent: (ev) => request('POST', '/api/events', ev),
    updateEvent: (id, patch) => request('PUT', '/api/events/' + encodeURIComponent(id), patch),
    deleteEvent: (id) => request('DELETE', '/api/events/' + encodeURIComponent(id)),
    bulkEvents: (events, mode) => request('POST', '/api/events/bulk', { events: events, mode: mode || 'merge' }),

    uploadOcr: (file) => request('POST', '/api/ocr', file, {
      raw: true,
      contentType: file.type || 'image/png'
    }),
    getOcr: (jobId) => request('GET', '/api/ocr/' + encodeURIComponent(jobId)),
    discardOcr: (jobId) => request('POST', '/api/ocr/' + encodeURIComponent(jobId) + '/discard'),

    dueReminders: () => request('GET', '/api/reminders/due'),
    ackReminder: (id, minutes) => request('POST', '/api/reminders/' + encodeURIComponent(id) + '/ack', { minutes: minutes }),
    snoozeReminder: (id, minutes, snoozeFor) =>
      request('POST', '/api/reminders/' + encodeURIComponent(id) + '/snooze', { minutes: minutes, snoozeFor: snoozeFor }),

    getSettings: () => request('GET', '/api/settings'),
    updateSettings: (patch) => request('PUT', '/api/settings', patch),

    syncSources: (games) => request('POST', '/api/sources/sync', { games: games }),
    listSources: () => request('GET', '/api/sources'),
    fetchSources: (games) => request('POST', '/api/sources/fetch', { games: games }),
    clearSourceCache: (game) => request('DELETE', '/api/sources/cache', { game: game || null }),
    importUrl: (url, game, timeout) =>
      request('POST', '/api/import/url', { url: url, game: game || null, timeout: timeout || 60000 }),
    testNotify: () => request('POST', '/api/notify/test', { title: '游戏活动日历', body: '通知已开启 ~ 死线会准时提醒你' }),

    exportIcs: () => { window.location.href = '/api/export?format=ics'; },

    // 版本备份
    listBackups: () => request('GET', '/api/backups'),
    createBackup: (label) => request('POST', '/api/backups', { label: label }),
    restoreBackup: (id) => request('POST', '/api/backups/' + encodeURIComponent(id) + '/restore'),
    deleteBackup: (id) => request('DELETE', '/api/backups/' + encodeURIComponent(id)),

    // AI 识别
    aiPresets: () => request('GET', '/api/ai/presets'),
    aiConfig: () => request('GET', '/api/ai/config'),
    saveAiConfig: (cfg) => request('PUT', '/api/ai/config', cfg),
    aiParse: (text, game) => request('POST', '/api/ai/parse', { text: text, game: game || null }),
    aiTest: () => request('POST', '/api/ai/test', {})
  };
})();
