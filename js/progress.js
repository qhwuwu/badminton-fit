window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · progress.js
   进度页：统计三卡 / 打卡日历 / 板块分布 / 最近训练
   渲染进 #progress-root，通过 BMF.registerPage 注册
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 模块内样式（注入一次，不改动 style.css） ---------- */
  const PROGRESS_CSS = [
    '.pg-card{margin-bottom:12px;}',
    '.pg-sec-title{font-size:14px;font-weight:700;margin-bottom:10px;}',
    '.pg-stats{display:grid;grid-template-columns:repeat(3,1fr);}',
    '.pg-stat{text-align:center;padding:4px 2px;min-width:0;}',
    '.pg-stat+.pg-stat{border-left:1px solid var(--border);}',
    '.pg-stat-num{font-size:22px;font-weight:800;color:var(--accent);white-space:nowrap;}',
    '.pg-stat-num small{font-size:12px;font-weight:600;margin-left:1px;}',
    '.pg-stat-label{font-size:11px;color:var(--text-dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.pg-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
    '.pg-cal-title{font-size:15px;font-weight:700;}',
    '.pg-cal-nav{width:48px;height:48px;border:none;background:transparent;color:var(--text);font-size:20px;border-radius:12px;cursor:pointer;}',
    '.pg-cal-nav:active{background:var(--surface2);}',
    '.pg-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}',
    '.pg-wd{text-align:center;font-size:11px;color:var(--text-dim);padding:4px 0;}',
    '.pg-cell{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:13px;color:var(--text-dim);min-width:0;}',
    '.pg-day{color:var(--text);}',
    '.pg-day-log{background:var(--accent);color:var(--accent-ink);font-weight:700;}',
    '.pg-day-today{box-shadow:0 0 0 2px var(--accent);}',
    '.pg-day-log.pg-day-today{box-shadow:0 0 0 2px var(--text);}',
    '.pg-cal-foot{margin-top:10px;font-size:12px;color:var(--text-dim);text-align:center;}',
    '.pg-track-row{display:flex;align-items:center;gap:10px;margin:10px 0;}',
    '.pg-track-name{width:64px;font-size:13px;flex-shrink:0;}',
    '.pg-track-bar{flex:1;height:10px;background:var(--surface2);border-radius:5px;overflow:hidden;}',
    '.pg-track-val{height:100%;border-radius:5px;transition:width .3s;}',
    '.pg-track-pct{width:44px;text-align:right;font-size:12px;color:var(--text-dim);flex-shrink:0;}'
  ].join('');
  function injectCss() {
    if (document.getElementById('bmf-progress-style')) return;
    const s = document.createElement('style');
    s.id = 'bmf-progress-style';
    s.textContent = PROGRESS_CSS;
    document.head.appendChild(s);
  }

  /* ---------- 小工具 ---------- */
  const TRACK_KEYS = ['wrist', 'legs', 'cardio', 'backhand'];
  let calY = 0, calM = 0; // 日历当前查看的年 / 月（0-11），页面级状态

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function emptyTip(msg) {
    const d = el('div', 'empty-tip');
    d.textContent = msg;
    return d;
  }

  /** 连续训练天数：截止今天或昨天的连续日期数 */
  function calcStreak(dateSet) {
    const d = new Date();
    if (!dateSet.has(fmtDate(d))) {
      d.setDate(d.getDate() - 1);
      if (!dateSet.has(fmtDate(d))) return 0;
    }
    let n = 0;
    while (dateSet.has(fmtDate(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- 统计三卡 ---------- */
  function buildStatsCard(logs) {
    const card = el('div', 'card pg-card');
    const stats = el('div', 'pg-stats');

    const dateSet = new Set(logs.map(function (l) { return l && l.date; }).filter(Boolean));

    // 本周（周一为一周开始）
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const mondayStr = fmtDate(monday);
    let weekCount = 0, weekSec = 0, totalSec = 0;
    logs.forEach(function (l) {
      const s = Number(l && l.durationSec) || 0;
      totalSec += s;
      if (l && l.date && l.date >= mondayStr) { weekCount++; weekSec += s; }
    });

    function stat(numStr, unit, label) {
      const box = el('div', 'pg-stat');
      const n = el('div', 'pg-stat-num');
      n.appendChild(document.createTextNode(numStr));
      const u = el('small'); u.textContent = unit;
      n.appendChild(u);
      const l = el('div', 'pg-stat-label');
      l.textContent = label;
      box.append(n, l);
      return box;
    }
    stats.appendChild(stat(String(calcStreak(dateSet)), '天', '连续训练'));
    stats.appendChild(stat(String(weekCount), '次', '本周 · ' + Math.round(weekSec / 60) + ' 分钟'));
    stats.appendChild(stat((totalSec / 3600).toFixed(1), '小时', '累计 · ' + logs.length + ' 次'));
    card.appendChild(stats);
    return card;
  }

  /* ---------- 打卡日历卡片 ---------- */
  function buildCalendarCard(logs, root) {
    const card = el('div', 'card pg-card');
    const title = el('div', 'pg-sec-title');
    title.textContent = '打卡日历';
    card.appendChild(title);

    // 月份切换头
    const head = el('div', 'pg-cal-head');
    const prev = el('button', 'pg-cal-nav');
    prev.type = 'button'; prev.textContent = '‹';
    prev.setAttribute('aria-label', '上个月');
    const label = el('div', 'pg-cal-title');
    label.textContent = calY + ' 年 ' + (calM + 1) + ' 月';
    const next = el('button', 'pg-cal-nav');
    next.type = 'button'; next.textContent = '›';
    next.setAttribute('aria-label', '下个月');
    prev.addEventListener('click', function () {
      calM--; if (calM < 0) { calM = 11; calY--; }
      draw(root); // 整页重绘（保留查看的月份）
    });
    next.addEventListener('click', function () {
      calM++; if (calM > 11) { calM = 0; calY++; }
      draw(root);
    });
    head.append(prev, label, next);
    card.appendChild(head);

    // 网格：周一起始 7 列
    const grid = el('div', 'pg-grid');
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (w) {
      const d = el('div', 'pg-wd'); d.textContent = w; grid.appendChild(d);
    });
    const offset = (new Date(calY, calM, 1).getDay() + 6) % 7;   // 周一前的空位
    const days = new Date(calY, calM + 1, 0).getDate();          // 当月天数
    for (let i = 0; i < offset; i++) grid.appendChild(el('div', 'pg-cell'));

    const dateSet = new Set(logs.map(function (l) { return l && l.date; }).filter(Boolean));
    const todayStr = BMF.today();
    for (let d = 1; d <= days; d++) {
      const key = calY + '-' + pad(calM + 1) + '-' + pad(d);
      const cell = el('div', 'pg-cell pg-day');
      cell.textContent = d;
      if (dateSet.has(key)) cell.classList.add('pg-day-log'); // 训练日主色填充
      if (key === todayStr) cell.classList.add('pg-day-today'); // 今天描边
      grid.appendChild(cell);
    }
    card.appendChild(grid);

    // 本月统计
    const prefix = calY + '-' + pad(calM + 1);
    let mc = 0, msec = 0;
    logs.forEach(function (l) {
      if (l && l.date && l.date.indexOf(prefix) === 0) {
        mc++;
        msec += Number(l.durationSec) || 0;
      }
    });
    const foot = el('div', 'pg-cal-foot');
    foot.textContent = '本月 ' + mc + ' 次训练 · 共 ' + Math.round(msec / 60) + ' 分钟';
    card.appendChild(foot);
    return card;
  }

  /* ---------- 板块分布卡片（横向条形图） ---------- */
  function buildTrackCard(logs) {
    const card = el('div', 'card pg-card');
    const t = el('div', 'pg-sec-title');
    t.textContent = '板块分布';
    card.appendChild(t);

    const sums = {}; let total = 0;
    TRACK_KEYS.forEach(function (k) { sums[k] = 0; });
    logs.forEach(function (l) {
      const ts = (l && l.trackSec) || {};
      TRACK_KEYS.forEach(function (k) {
        const v = Number(ts[k]) || 0;
        sums[k] += v; total += v;
      });
    });
    if (total <= 0) {
      card.appendChild(emptyTip('暂无训练数据，完成一次跟练后展示板块占比'));
      return card;
    }
    TRACK_KEYS.forEach(function (k) {
      const meta = BMF.data.tracks[k] || {};
      const pct = (sums[k] / total) * 100;
      const row = el('div', 'pg-track-row');
      const name = el('div', 'pg-track-name');
      name.textContent = meta.name || k;
      const bar = el('div', 'pg-track-bar');
      const val = el('div', 'pg-track-val');
      val.style.width = (sums[k] > 0 ? Math.max(3, pct) : 0) + '%'; // 极小占比保底可见
      val.style.background = meta.color || 'var(--accent)';
      bar.appendChild(val);
      const p = el('div', 'pg-track-pct');
      p.textContent = Math.round(pct) + '%';
      row.append(name, bar, p);
      card.appendChild(row);
    });
    return card;
  }

  /* ---------- 最近训练列表 ---------- */
  function buildRecentCard(logs) {
    const card = el('div', 'card pg-card');
    const t = el('div', 'pg-sec-title');
    t.textContent = '最近训练';
    card.appendChild(t);

    if (!logs.length) {
      card.appendChild(emptyTip('还没有训练记录，去「今日」或「制定」开始第一次跟练吧'));
      return card;
    }
    logs.slice(0, 8).forEach(function (l) {
      const row = el('div', 'list-item');
      const main = el('div', 'li-main');
      const title = el('div', 'li-title');
      title.textContent = (l && l.planTitle) || '自定义训练';
      const sub = el('div', 'li-sub');
      sub.textContent = (l && l.date || '') + ' · 完成 ' +
        (Number(l && l.doneItems) || 0) + '/' + (Number(l && l.totalItems) || 0) + ' 个动作';
      main.append(title, sub);
      const act = el('div', 'li-action');
      const dur = el('span', 'text-dim');
      dur.style.fontSize = '13px';
      dur.textContent = BMF.fmt.sec(Number(l && l.durationSec) || 0);
      act.appendChild(dur);
      row.append(main, act);
      card.appendChild(row);
    });
    return card;
  }

  /* ---------- 整页渲染 ---------- */
  function draw(root) {
    if (!root) return;
    injectCss();
    const logs = BMF.store.getLogs(); // date 倒序
    root.innerHTML = '';
    root.appendChild(buildStatsCard(logs));
    root.appendChild(buildCalendarCard(logs, root));
    root.appendChild(buildTrackCard(logs));
    root.appendChild(buildRecentCard(logs));
  }

  /** 注册渲染函数：每次进入进度页重置日历到当月 */
  BMF.registerPage('progress', function (root) {
    const now = new Date();
    calY = now.getFullYear();
    calM = now.getMonth();
    draw(root);
  });

  // 有新打卡且进度页处于激活状态 → 立即重绘（保留当前查看的月份）
  BMF.on('bmf:log-added', function () {
    const page = document.getElementById('page-progress');
    if (page && page.classList.contains('active')) {
      draw(document.getElementById('progress-root'));
    }
  });
})();
