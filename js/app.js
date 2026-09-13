window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · app.js
   全局壳：路由 / 页面注册 / Toast / 模态框 / 确认框 /
   事件总线 / 工具函数 / 主题切换 / Service Worker 注册
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 工具函数 ---------- */

  /** 本地日期 'YYYY-MM-DD'（不用 toISOString，避免 UTC 时区偏移） */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** 秒 → 'm:ss'（如 95 → '1:35'） */
  function fmtSec(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /** 生成唯一 id（时间戳 + 随机段） */
  function uuid() {
    return 'bmf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- 事件总线 ---------- */
  const _listeners = {};

  /** 订阅事件（如 'bmf:plan-updated'、'bmf:log-added'） */
  function on(evt, fn) {
    (_listeners[evt] = _listeners[evt] || []).push(fn);
  }

  /** 触发事件，逐个调用订阅者，单个出错不影响其他 */
  function emit(evt, detail) {
    (_listeners[evt] || []).slice().forEach(function (fn) {
      try { fn(detail); } catch (e) { console.error('[bmf] 事件处理器出错:', evt, e); }
    });
  }

  /* ---------- Toast ---------- */
  let _toastTimer = null;

  /** 底部胶囊提示，2 秒后自动淡出 */
  function toast(msg) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    root.textContent = '';
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = String(msg);
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 2000);
  }

  /* ---------- 模态框 ---------- */
  /**
   * openModal({title, body, actions:[{label, primary, danger, onClick}], onClose})
   * - body 支持 HTML 字符串或 DOM 节点
   * - onClick 返回 false 时不自动关闭（可用于表单校验失败场景）
   * - 可选 onClose：弹窗因任意原因（按钮/遮罩）关闭后回调
   * 返回 close 函数
   */
  function openModal(opts) {
    opts = opts || {};
    const mount = document.getElementById('modal-root');
    if (!mount) return function () {};

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const card = document.createElement('div');
    card.className = 'modal-card';

    // 标题
    if (opts.title) {
      const t = document.createElement('div');
      t.className = 'modal-title';
      t.textContent = opts.title;
      card.appendChild(t);
    }

    // 内容
    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    card.appendChild(body);

    // 操作按钮行
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    (opts.actions || []).forEach(function (a) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : 'btn-ghost'));
      btn.textContent = a.label || '确定';
      btn.addEventListener('click', function () {
        const r = a.onClick ? a.onClick() : undefined;
        if (r !== false) close();
      });
      actions.appendChild(btn);
    });
    card.appendChild(actions);
    backdrop.appendChild(card);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('show'); // 出场动画
      setTimeout(function () { backdrop.remove(); }, 200);
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    // 点遮罩关闭
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });

    mount.appendChild(backdrop);
    requestAnimationFrame(function () { backdrop.classList.add('show'); }); // 入场动画
    return close;
  }

  /** confirm(msg) → Promise<boolean>：基于 openModal，点遮罩视为取消 */
  function confirm(msg) {
    return new Promise(function (resolve) {
      let done = false;
      function settle(val) {
        if (!done) { done = true; resolve(val); }
      }
      openModal({
        title: '确认操作',
        body: '<p>' + String(msg) + '</p>',
        onClose: function () { settle(false); },
        actions: [
          { label: '取消', onClick: function () { settle(false); } },
          { label: '确定', primary: true, onClick: function () { settle(true); } }
        ]
      });
    });
  }

  /* ---------- 路由 ---------- */
  // 页面 id → 对应根容器 id（plan 页容器名为 planner-root）
  const ROOT_IDS = {
    today: 'today-root',
    plan: 'planner-root',
    library: 'library-root',
    progress: 'progress-root'
  };
  const _renderers = {};

  /** 注册页面渲染函数：每次切入该页都会调用 renderFn(root) */
  function registerPage(id, renderFn) {
    _renderers[id] = renderFn;
  }

  /** 切换页面：显隐 section、高亮底部导航、调用该页渲染函数 */
  function showPage(id) {
    if (!ROOT_IDS[id]) id = 'today';

    // 页面显隐
    document.querySelectorAll('.page').forEach(function (sec) {
      sec.classList.toggle('active', sec.id === 'page-' + id);
    });
    // 导航高亮
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page') === id);
    });
    window.scrollTo(0, 0);

    // 调用渲染函数（未注册则显示空提示）
    const root = document.getElementById(ROOT_IDS[id]);
    if (!root) return;
    const fn = _renderers[id];
    if (typeof fn === 'function') {
      try { fn(root); }
      catch (e) {
        console.error('[bmf] 页面渲染出错:', id, e);
        root.innerHTML = '<div class="card empty-tip"><p>页面渲染出错，请重试</p></div>';
      }
    } else {
      root.innerHTML = '<div class="card empty-tip"><p>该模块尚未加载</p></div>';
    }
  }

  /* ---------- 主题 ---------- */

  /** 应用主题到 html[data-theme]，并同步状态栏 theme-color */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F6F6F8' : '#0B0B0F');
  }

  /** 初始化：读取持久化主题；绑定切换按钮并持久化 */
  function initTheme() {
    let theme = 'dark';
    try { theme = BMF.store.getSettings().theme || 'dark'; } catch (e) { /* store 未就绪时用默认 */ }
    applyTheme(theme);

    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try { BMF.store.setSettings({ theme: next }); } catch (e) { /* 忽略持久化失败 */ }
      BMF.toast(next === 'light' ? '已切换到浅色模式' : '已切换到深色模式');
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    initTheme();

    // 底部导航点击 → 切页
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        BMF.showPage(btn.getAttribute('data-page'));
      });
    });

    // 默认进入「今日」页
    BMF.showPage('today');

    // Service Worker：仅在 http(s) 环境注册（file:// 下无意义且会报错）
    if (location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 静默 */ });
      } catch (e) { /* 静默 */ }
    }
  }

  /* ---------- 暴露全局 API（必须在 init() 调用之前，否则 defer 场景下 init 抛错连锁崩溃） ---------- */
  BMF.showPage = showPage;
  BMF.registerPage = registerPage;
  BMF.toast = toast;
  BMF.openModal = openModal;
  BMF.confirm = confirm;
  BMF.on = on;
  BMF.emit = emit;
  BMF.today = today;
  BMF.fmt = { sec: fmtSec };
  BMF.uuid = uuid;
  // 注：BMF.player 由 js/player.js 定义（全屏跟练播放器），此处仅占位说明，不实现

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // defer 脚本执行时 DOM 已就绪
  }
})();
