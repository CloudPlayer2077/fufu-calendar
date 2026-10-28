/**
 * 在线版前端补丁。
 *
 * 加载顺序：在所有业务脚本之后，负责两件事：
 *   1. 顶栏显示「在线预览版」标识
 *   2. 拦截写操作按钮，弹友好提示（而不是让它发请求后报错）
 *
 * 只在页面确实是只读模式时生效，桌面版不受影响。
 */
(function () {
  'use strict';

  function boot() {
    // 用 bootstrap 判断是否只读（桌面版返回 readonly 为 undefined）
    fetch('/api/bootstrap', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!d || d.readonly !== true) return;
        markUI(d);
        interceptWrites();
      })
      .catch(() => { /* 离线或接口异常时安静跳过 */ });
  }

  function markUI(data) {
    // 顶栏加徽标
    const box = document.querySelector('#topbar-actions');
    if (box && !document.querySelector('#online-badge')) {
      const badge = document.createElement('span');
      badge.id = 'online-badge';
      badge.textContent = '在线预览';
      badge.title = '这是只读的在线版本，数据每期同步一次';
      badge.style.cssText = [
        'display:inline-flex', 'align-items:center', 'height:26px',
        'padding:0 10px', 'border-radius:99px', 'font-size:11px',
        'font-weight:600', 'letter-spacing:.4px',
        'color:#e8cf94', 'background:rgba(232,207,148,.14)',
        'border:1px solid rgba(232,207,148,.42)',
        'margin-right:4px', 'white-space:nowrap'
      ].join(';');
      box.insertBefore(badge, box.firstChild);
    }

    // 页面底部加一行说明
    const content = document.querySelector('#content');
    if (content && !document.querySelector('#online-footer')) {
      const foot = document.createElement('div');
      foot.id = 'online-footer';
      foot.style.cssText = [
        'margin-top:18px', 'padding-top:14px',
        'border-top:1px solid rgba(126,176,240,.16)',
        'font-size:11.5px', 'line-height:1.9',
        'color:#5f7da1', 'text-align:center'
      ].join(';');
      const n = data.events ? data.events.length : 0;
      const at = data.exportedAt ? data.exportedAt.slice(0, 10) : '';
      foot.innerHTML =
        '<div style="color:#8ba9c9">共 ' + n + ' 个活动 · 数据更新于 ' + at + '</div>' +
        '<div>在线版只读。需要添加/导入/提醒功能请下载桌面版 <b style="color:#8ba9c9">FURINA CALENDAR</b></div>';
      content.appendChild(foot);
    }
  }

  function interceptWrites() {
    const WARN = '在线预览版只读，添加或编辑请用桌面版';
    const WRITE_SELECTORS = [
      '#topbar-actions .btn-primary',      // 新建活动
      '#row-all-toggle'                    // 游戏显示设置
    ];

    document.addEventListener('click', function (ev) {
      const hit = ev.target.closest && ev.target.closest(WRITE_SELECTORS.join(','));
      if (!hit) return;
      // 游戏设置只是本机偏好，不算写数据，放行
      if (hit.id === 'row-all-toggle') return;
      ev.preventDefault();
      ev.stopPropagation();
      if (window.U && window.U.toast) window.U.toast(WARN, 'info', 3200);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // 等业务脚本先跑完（它们会加载数据）
      setTimeout(boot, 300);
    });
  } else {
    setTimeout(boot, 300);
  }
})();
