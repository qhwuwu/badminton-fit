window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · library.js
   动作库：板块 / 器材双筛选 + 计数 + 列表 + 详情弹窗
   纯浏览模块，不与 planner 交叉
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 模块内样式（注入一次，不改动 style.css） ---------- */
  const CSS = [
    '.lb-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}',
    '.lb-count{font-size:13px;color:var(--text-dim);margin-top:2px;}',
    '.lb-row{cursor:pointer;align-items:flex-start;min-height:48px;}',
    '.lb-row:active{background:var(--surface2);border-radius:10px;}',
    '.lb-line{display:flex;align-items:center;gap:8px;min-width:0;}',
    '.lb-line .li-title{min-width:0;}',
    '.lb-line .badge{flex-shrink:0;}',
    '.lb-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '.lb-value{font-size:12px;color:var(--text-dim);line-height:1.5;margin-top:4px;}',
    '.ld-meta{font-size:13px;color:var(--text-dim);margin-top:4px;}',
    '.ld-sec{font-size:13px;font-weight:700;margin-top:14px;}',
    '.ld-text{font-size:14px;line-height:1.6;margin-top:6px;}',
    '.ld-danger-sec .ld-sec,.ld-danger-sec .ld-text{color:var(--danger);}',
    '.ld-note-sec .ld-text{color:var(--text-dim);background:var(--surface2);border-radius:10px;padding:8px 10px;}'
  ].join('');

  function injectCss() {
    if (document.getElementById('bmf-library-style')) return;
    const s = document.createElement('style');
    s.id = 'bmf-library-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 常量 ---------- */
  const TRACK_ORDER = ['wrist', 'legs', 'cardio', 'backhand', 'warmup', 'cooldown'];
  const EQUIP_ORDER = ['none', 'dumbbell', 'weight', 'rope', 'racket', 'towel', 'bed', 'court'];
  const EQUIP_NAMES = {
    none: '徒手', dumbbell: '哑铃', weight: '重物', rope: '跳绳',
    racket: '球拍', towel: '毛巾', bed: '床上', court: '场地'
  };
  // 难度徽章配色：L1 绿 / L2 橙 / L3 红（浅色底 + 深色字，深浅主题均可用）
  const LEVEL_COLORS = { 1: '#81C784', 2: '#FFB74D', 3: '#FF8A80' };

  /* ---------- 状态 ---------- */
  let _root = null;      // library-root
  let _track = 'all';    // 当前 track 筛选
  let _equip = 'all';    // 当前器材筛选

  /* ---------- 小工具 ---------- */
  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function exercises() { return BMF.data.exercises || []; }
  function tracks() { return BMF.data.tracks || {}; }

  /** 组次摘要：reps → '3组 × 20次'；timed → '3组 × 30秒 · 休30秒' */
  function summaryText(ex) {
    if (ex.type === 'reps') return ex.sets + '组 × ' + ex.reps + '次';
    return ex.sets + '组 × ' + ex.workSec + '秒 · 休' + ex.restSec + '秒';
  }

  /** track 色徽章（中文名 + tracks 配色） */
  function trackBadge(track) {
    const t = tracks()[track];
    const b = el('span', 'badge');
    b.textContent = t ? t.name : track;
    if (t) {
      b.style.setProperty('--badge', t.color);
      b.style.setProperty('--badge-ink', '#0B0B0F');
    }
    return b;
  }

  /** 难度徽章（L1/L2/L3） */
  function levelBadge(level) {
    const b = el('span', 'badge');
    b.textContent = 'L' + (level || 1);
    const c = LEVEL_COLORS[level];
    if (c) {
      b.style.setProperty('--badge', c);
      b.style.setProperty('--badge-ink', '#0B0B0F');
    }
    return b;
  }

  /** 器材中文 badges 行 */
  function equipBadges(ex) {
    const wrap = el('div', 'lb-badges');
    (ex.equip || []).forEach(function (k) {
      const b = el('span', 'badge');
      b.textContent = EQUIP_NAMES[k] || k;
      wrap.appendChild(b);
    });
    return wrap;
  }

  /** 当前筛选结果 */
  function filterList() {
    return exercises().filter(function (ex) {
      if (_track !== 'all' && ex.track !== _track) return false;
      if (_equip !== 'all' && (ex.equip || []).indexOf(_equip) < 0) return false;
      return true;
    });
  }

  /* ---------- 页面渲染 ---------- */
  function renderLibrary(root) {
    _root = root;
    injectCss();
    root.innerHTML = '';
    root.appendChild(buildFilterCard());
    root.appendChild(buildListCard());
  }

  /* ---------- 筛选卡片 ---------- */
  function buildFilterCard() {
    const card = el('div', 'card');

    // 筛选行1：track chips（用 tracks 配色做选中态）
    const row1 = el('div', 'lb-chips');
    ['all'].concat(TRACK_ORDER).forEach(function (k) {
      const c = el('button', 'chip' + (_track === k ? ' active' : ''));
      c.type = 'button';
      const t = k === 'all' ? null : tracks()[k];
      c.textContent = k === 'all' ? '全部' : (t ? t.name : k);
      if (_track === k && t) {
        // 选中态用 track 配色覆盖默认青柠色
        c.style.background = t.color;
        c.style.borderColor = t.color;
        c.style.color = '#0B0B0F';
        c.style.fontWeight = '600';
      }
      c.addEventListener('click', function () {
        _track = k;
        if (_root) renderLibrary(_root);
      });
      row1.appendChild(c);
    });
    card.appendChild(row1);

    // 筛选行2：equip chips
    const row2 = el('div', 'lb-chips');
    const allBtn = el('button', 'chip' + (_equip === 'all' ? ' active' : ''));
    allBtn.type = 'button';
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', function () {
      _equip = 'all';
      if (_root) renderLibrary(_root);
    });
    row2.appendChild(allBtn);
    EQUIP_ORDER.forEach(function (k) {
      const c = el('button', 'chip' + (_equip === k ? ' active' : ''));
      c.type = 'button';
      c.textContent = EQUIP_NAMES[k];
      c.addEventListener('click', function () {
        _equip = k;
        if (_root) renderLibrary(_root);
      });
      row2.appendChild(c);
    });
    card.appendChild(row2);

    // 计数行
    const count = el('div', 'lb-count');
    count.textContent = '共 ' + filterList().length + ' 个动作';
    card.appendChild(count);
    return card;
  }

  /* ---------- 列表卡片 ---------- */
  function buildListCard() {
    const card = el('div', 'card');
    const list = filterList();
    if (!list.length) {
      const tip = el('div', 'empty-tip');
      tip.textContent = '没有符合条件的动作';
      card.appendChild(tip);
      return card;
    }
    list.forEach(function (ex) { card.appendChild(buildRow(ex)); });
    return card;
  }

  /** 单个动作行：名称 + 难度徽章 + 器材徽章 + 摘要 + 迁移价值 */
  function buildRow(ex) {
    const row = el('div', 'list-item lb-row');
    const main = el('div', 'li-main');

    const line = el('div', 'lb-line');
    const name = el('span', 'li-title');
    name.textContent = ex.name;
    line.append(name, levelBadge(ex.level));
    main.appendChild(line);

    // track 徽章 + 器材中文徽章
    const badges = el('div', 'lb-badges');
    badges.appendChild(trackBadge(ex.track));
    (ex.equip || []).forEach(function (k) {
      const b = el('span', 'badge');
      b.textContent = EQUIP_NAMES[k] || k;
      badges.appendChild(b);
    });
    main.appendChild(badges);

    // 组次摘要
    const sum = el('div', 'li-sub');
    sum.style.marginTop = '4px';
    sum.textContent = summaryText(ex);
    main.appendChild(sum);

    // 迁移价值一句（小字）
    if (ex.value) {
      const val = el('div', 'lb-value');
      val.textContent = ex.value;
      main.appendChild(val);
    }

    row.appendChild(main);
    row.addEventListener('click', function () { showDetail(ex); });
    return row;
  }

  /* ---------- 详情弹窗 ---------- */
  function showDetail(ex) {
    const body = el('div');

    // track / 难度 / 器材徽章
    const badges = el('div', 'lb-badges');
    badges.appendChild(trackBadge(ex.track));
    badges.appendChild(levelBadge(ex.level));
    (ex.equip || []).forEach(function (k) {
      const b = el('span', 'badge');
      b.textContent = EQUIP_NAMES[k] || k;
      badges.appendChild(b);
    });
    body.appendChild(badges);

    // meta：组次 + 难度
    const meta = el('div', 'ld-meta');
    meta.textContent = summaryText(ex) + ' · 难度 L' + (ex.level || 1);
    body.appendChild(meta);

    /** 小节：标题 + 正文（wrapCls 用于危险/提示配色） */
    function section(label, text, wrapCls) {
      const wrap = el('div', wrapCls || '');
      const h = el('div', 'ld-sec');
      h.textContent = label;
      const p = el('div', 'ld-text');
      p.textContent = text;
      wrap.append(h, p);
      body.appendChild(wrap);
    }

    // 动作要点（cue-list 青柠小圆点）
    const cuesHead = el('div', 'ld-sec');
    cuesHead.textContent = '动作要点';
    const ul = el('ul', 'cue-list');
    (ex.cues || []).forEach(function (c) {
      const li = el('li');
      li.textContent = c;
      ul.appendChild(li);
    });
    body.append(cuesHead, ul);

    if (ex.mistakes) section('常见错误', ex.mistakes, 'ld-danger-sec'); // --danger 色
    if (ex.value) section('迁移价值', ex.value);
    if (ex.note) section('提示', ex.note, 'ld-note-sec');

    BMF.openModal({
      title: ex.name,
      body: body,
      actions: [{ label: '关闭', primary: true }]
    });
  }

  /* ---------- 注册 ---------- */
  BMF.registerPage('library', renderLibrary);
  /* 暴露详情弹窗：制定页/今日页点击动作名查看详解（无需切到动作库） */
  BMF.showExerciseDetail = showDetail;
})();
