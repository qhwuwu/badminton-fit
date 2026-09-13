window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · planner.js
   今日页：问候 / 今日计划概览 / 连续打卡激励 / 安全提示
   制定页：① 选择参数 → ② 调整动作 → ③ 保存 + 我的计划列表
   跨模块契约：BMF.planner.getDraft()；跟练只调用 BMF.player（不实现）
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 模块内样式（注入一次，不改动 style.css） ---------- */
  const CSS = [
    /* 制定页 · 参数卡片 */
    '.pl-sec-title{font-size:15px;font-weight:700;margin-bottom:12px;}',
    '.pl-label{display:block;font-size:13px;color:var(--text-dim);margin:14px 0 8px;}',
    '.pl-chips{display:flex;flex-wrap:wrap;gap:8px;}',
    '.pl-week-row{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;-webkit-overflow-scrolling:touch;}',
    '.pl-week-row .chip{flex-shrink:0;}',
    '.pl-week-hint{font-size:11px;color:var(--text-dim);margin-top:4px;}',
    '.pl-gen-btn{margin-top:18px;}',
    /* 制定页 · 编辑卡片 */
    '.pl-est{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 4px;}',
    '.pl-est .chip{pointer-events:none;min-height:32px;}',
    '.pl-phase-title{font-size:13px;font-weight:700;color:var(--text-dim);margin:16px 0 2px;}',
    '.pl-item-line{display:flex;align-items:center;gap:8px;min-width:0;}',
    '.pl-item-line .li-title{min-width:0;}',
    '.pl-ctrl{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
    '.pl-step{display:inline-flex;align-items:stretch;background:var(--surface2);border-radius:10px;overflow:hidden;}',
    '.pl-step-btn{width:44px;height:48px;border:none;background:transparent;color:var(--text);font-size:18px;font-weight:700;cursor:pointer;}',
    '.pl-step-btn:active{background:var(--border);}',
    '.pl-step-val{min-width:72px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}',
    '.pl-del{width:48px;height:48px;flex-shrink:0;border:none;border-radius:12px;background:transparent;color:var(--danger);font-size:16px;cursor:pointer;}',
    '.pl-del:active{background:var(--surface2);}',
    '.pl-add-chip{margin-top:10px;}',
    '.pl-clear-btn{margin-top:18px;}',
    /* 添加动作弹窗 */
    '.pl-modal-label{font-size:12px;color:var(--text-dim);margin:10px 0 6px;}',
    '.pl-modal-list{margin-top:4px;max-height:44vh;overflow-y:auto;}',
    '.pl-pick-row{cursor:pointer;min-height:48px;}',
    '.pl-pick-row:active{background:var(--surface2);border-radius:10px;}',
    /* 动作名可点击查看详解（点虚线 = 可点） */
    '.pl-name-link{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;-webkit-tap-highlight-color:transparent;}',
    '.pl-info-ico{flex-shrink:0;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-style:italic;color:var(--text-dim);border:1px solid var(--border);border-radius:50%;cursor:pointer;}',
    '.pl-info-btn{flex-shrink:0;align-self:center;border:1px solid var(--border);background:transparent;color:var(--text-dim);font-size:12px;border-radius:999px;padding:6px 12px;cursor:pointer;}',
    /* 今日页 */
    '.td-date{font-size:22px;font-weight:800;}',
    '.td-week{font-size:13px;color:var(--text-dim);margin-top:2px;}',
    '.td-plan-title{font-size:17px;font-weight:700;}',
    '.td-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px;}',
    '.td-meta{font-size:13px;color:var(--text-dim);}',
    '.td-phase-name{font-size:12px;font-weight:700;color:var(--text-dim);margin:12px 0 0;}',
    '.td-item-row{display:flex;align-items:center;gap:10px;padding:6px 0;}',
    '.td-item-name{flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.td-item-sum{font-size:12px;color:var(--text-dim);flex-shrink:0;}',
    '.td-btns{display:flex;gap:10px;margin-top:16px;}',
    '.td-btns .btn{flex:1;padding:0 8px;}',
    '.td-streak-num{font-size:20px;font-weight:800;color:var(--accent);}',
    '.td-streak-txt{font-size:13px;color:var(--text-dim);margin-top:4px;}',
    '.td-tips{padding:6px 4px 0;}',
    '.td-tip{font-size:12px;color:var(--text-dim);line-height:1.6;margin:3px 0;}'
  ].join('');

  function injectCss() {
    if (document.getElementById('bmf-planner-style')) return;
    const s = document.createElement('style');
    s.id = 'bmf-planner-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 常量 ---------- */
  const EQUIP_NAMES = {
    none: '徒手', dumbbell: '哑铃', barbell: '杠铃', weight: '重物', rope: '跳绳',
    racket: '球拍', towel: '毛巾', bed: '床上', court: '场地'
  };
  const EQUIP_KEYS = ['dumbbell', 'barbell', 'weight', 'rope', 'racket', 'towel', 'bed', 'court']; // 参数卡可开关（none 恒可用）
  const FOCUS_KEYS = ['wrist', 'legs', 'cardio', 'backhand'];
  const TRACK_ALL = ['wrist', 'legs', 'cardio', 'backhand', 'warmup', 'cooldown'];
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const SESSION_DAYS = ['周一', '周二', '周四', '周六']; // eightWeek.sessions 对应的训练日
  const PHASES = [
    { key: 'warmup', name: '热身' },
    { key: 'main', name: '主训' },
    { key: 'cooldown', name: '放松' }
  ];
  const DUR_OPTS = [15, 30, 45];
  const DEFAULT_LEVEL = 2; // 未选周模板时的生成难度

  /* ---------- 小工具 ---------- */
  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  /** 大于 0 的有效数字，否则 0 */
  function num(v) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  /** 本地日期 'YYYY-MM-DD'（与 BMF.today 同规则） */
  function localDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function exercises() { return BMF.data.exercises || []; }

  /** 动作名（可点击查看详解；ex 为空时降级为暗色纯文本） */
  function nameLink(ex, cls, fallbackText) {
    if (!ex) {
      const s = el('span', cls + ' text-dim');
      s.textContent = fallbackText;
      return s;
    }
    const s = el('span', cls + ' pl-name-link');
    s.textContent = ex.name;
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', '查看「' + ex.name + '」动作详解');
    s.addEventListener('click', function () { BMF.showExerciseDetail(ex); });
    return s;
  }

  /** 「ⓘ」小圆标（与动作名同效，点击弹详解） */
  function infoIcon(ex) {
    const ico = el('span', 'pl-info-ico');
    ico.textContent = 'i';
    ico.setAttribute('role', 'button');
    ico.setAttribute('aria-label', '查看「' + ex.name + '」动作详解');
    ico.addEventListener('click', function () { BMF.showExerciseDetail(ex); });
    return ico;
  }

  function tracks() { return BMF.data.tracks || {}; }
  function findEx(id) {
    return exercises().find(function (e) { return e.id === id; }) || null;
  }

  /** 按契约估算单个动作耗时：timed=sets*(work+rest)；reps=sets*(reps*3+rest) */
  function itemSec(ex, item) {
    const sets = num(item.sets);
    const rest = num(item.restSec);
    return ex.type === 'reps'
      ? sets * (num(item.reps) * 3 + rest)
      : sets * (num(item.workSec) + rest);
  }
  /** 计划总秒数（逐项按动作库详情估算） */
  function planSec(items) {
    let sum = 0;
    (items || []).forEach(function (it) {
      const ex = findEx(it.exId);
      if (ex) sum += itemSec(ex, it);
    });
    return sum;
  }
  function estMin(items) { return Math.round(planSec(items) / 60); }

  /** 组次摘要：reps → '3组 × 20次'；timed → '3组 × 30秒 · 休30秒' */
  function summaryText(ex, item) {
    const sets = num(item.sets);
    if (ex.type === 'reps') return sets + '组 × ' + num(item.reps) + '次';
    return sets + '组 × ' + num(item.workSec) + '秒 · 休' + num(item.restSec) + '秒';
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

  /** 器材是否全部可用（equip 每一项都在 userEquip 中启用） */
  function equipOk(ex, userEquip) {
    return (ex.equip || []).every(function (k) { return !!(userEquip && userEquip[k]); });
  }

  /** 深拷贝动作项（仅保留计划契约字段） */
  function copyItem(it) {
    return {
      exId: it.exId, phase: it.phase,
      sets: it.sets, workSec: it.workSec, restSec: it.restSec, reps: it.reps
    };
  }

  /** item 归属阶段：优先 item.phase，缺省时按动作 track 推断 */
  function phaseOf(it) {
    if (it.phase === 'warmup' || it.phase === 'main' || it.phase === 'cooldown') return it.phase;
    const ex = findEx(it.exId);
    if (ex && ex.track === 'warmup') return 'warmup';
    if (ex && ex.track === 'cooldown') return 'cooldown';
    return 'main';
  }

  /** Fisher-Yates 洗牌（热身/放松随机挑 2 个） */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function isPageActive(id) {
    const s = document.getElementById('page-' + id);
    return !!(s && s.classList.contains('active'));
  }

  /* 跟练播放器调用（带 typeof 防御，player.js 由其他模块提供） */
  function playerOpen(plan) {
    if (BMF.player && typeof BMF.player.open === 'function') BMF.player.open(plan);
  }
  function playerBusy() {
    return !!(BMF.player && typeof BMF.player.isActive === 'function' && BMF.player.isActive());
  }

  /* ---------- 模块状态 ---------- */
  let _draft = null; // 当前编辑器草稿（BMF.planner.getDraft 暴露给跨模块）
  let _param = { dur: 30, focus: ['legs'], week: 0 }; // week: 0=未选周模板，1-8=选中周
  let _proot = null; // 制定页根容器（#planner-root）

  /* =====================================================
     制定页
     ===================================================== */

  function renderPlanner(root) {
    if (!root) return;
    _proot = root;
    injectCss();
    root.innerHTML = '';
    root.appendChild(buildParamCard());
    if (_draft) {
      root.appendChild(buildEditCard());
      root.appendChild(buildSaveCard());
    }
    root.appendChild(buildPlansCard());
  }

  /* ---------- ① 参数卡片 ---------- */
  function buildParamCard() {
    const card = el('div', 'card');

    const title = el('div', 'pl-sec-title');
    title.textContent = '① 选择参数';
    card.appendChild(title);

    // 时长：15 / 30 / 45 分钟
    const durLabel = el('span', 'pl-label');
    durLabel.textContent = '训练时长';
    card.appendChild(durLabel);
    const seg = el('div', 'segmented');
    DUR_OPTS.forEach(function (min) {
      const b = el('button', 'seg-btn' + (_param.dur === min ? ' active' : ''));
      b.type = 'button';
      b.textContent = min + ' 分钟';
      b.addEventListener('click', function () {
        _param.dur = min;
        renderPlanner(_proot);
      });
      seg.appendChild(b);
    });
    card.appendChild(seg);

    // 弱项侧重（多选，至少 1 项）
    const focusLabel = el('span', 'pl-label');
    focusLabel.textContent = '弱项侧重（可多选，至少 1 项）';
    card.appendChild(focusLabel);
    const focusRow = el('div', 'pl-chips');
    FOCUS_KEYS.forEach(function (k) {
      const on = _param.focus.indexOf(k) >= 0;
      const t = tracks()[k];
      const c = el('button', 'chip' + (on ? ' active' : ''));
      c.type = 'button';
      c.textContent = t ? t.name : k;
      c.addEventListener('click', function () {
        if (on) {
          if (_param.focus.length <= 1) { BMF.toast('至少保留一个侧重点'); return; }
          _param.focus = _param.focus.filter(function (x) { return x !== k; });
        } else {
          _param.focus.push(k); // 追加到末尾，标题取第一个 track
        }
        renderPlanner(_proot);
      });
      focusRow.appendChild(c);
    });
    card.appendChild(focusRow);

    // 器材可用（读写 settings.userEquip）
    const eqLabel = el('span', 'pl-label');
    eqLabel.textContent = '器材可用';
    card.appendChild(eqLabel);
    const eqRow = el('div', 'pl-chips');
    const userEquip = BMF.store.getSettings().userEquip || {};
    EQUIP_KEYS.forEach(function (k) {
      const on = !!userEquip[k];
      const c = el('button', 'chip' + (on ? ' active' : ''));
      c.type = 'button';
      c.textContent = EQUIP_NAMES[k];
      c.addEventListener('click', function () {
        const cur = BMF.store.getSettings().userEquip || {};
        cur[k] = cur[k] ? 0 : 1;
        BMF.store.setSettings({ userEquip: cur });
        renderPlanner(_proot);
      });
      eqRow.appendChild(c);
    });
    card.appendChild(eqRow);

    // 8 周渐进模板：选周 → 记录该周 level；再点取消 → 回默认 L2
    const weekLabel = el('span', 'pl-label');
    weekLabel.textContent = '8 周渐进模板（可选：按所选周难度生成）';
    card.appendChild(weekLabel);
    const weekRow = el('div', 'pl-week-row');
    (BMF.data.eightWeek || []).forEach(function (w) {
      const on = _param.week === w.week;
      const c = el('button', 'chip' + (on ? ' active' : ''));
      c.type = 'button';
      c.textContent = '第' + w.week + '周·' + w.phase;
      c.addEventListener('click', function () {
        if (_param.week === w.week) {
          _param.week = 0;
          BMF.toast('已取消周模板，按默认 L' + DEFAULT_LEVEL + ' 难度生成');
        } else {
          _param.week = w.week;
          BMF.toast(weekHint(w));
        }
        renderPlanner(_proot);
      });
      weekRow.appendChild(c);
    });
    card.appendChild(weekRow);
    const weekHintTxt = el('div', 'pl-week-hint');
    weekHintTxt.textContent = '未选周时按 L' + DEFAULT_LEVEL + ' 难度生成';
    card.appendChild(weekHintTxt);

    // 自动生成
    const gen = el('button', 'btn btn-primary btn-block pl-gen-btn');
    gen.type = 'button';
    gen.textContent = '自动生成计划';
    gen.addEventListener('click', generatePlan);
    card.appendChild(gen);
    return card;
  }

  /** 周模板 toast：该周各训练日的建议侧重 */
  function weekHint(w) {
    const parts = (w.sessions || []).map(function (s, i) {
      const names = (s.focus || []).map(function (f) {
        const t = tracks()[f];
        return t ? t.name : f;
      }).join('+');
      return (SESSION_DAYS[i] || '训练日') + ' ' + names;
    });
    return '第' + w.week + '周·' + w.phase + '（L' + w.level + '）：' + parts.join(' / ') + '。可在上方手动调整侧重';
  }

  /* ---------- 自动生成 ---------- */

  /** 当前选周对应难度（未选周 → 默认 2） */
  function currentLevel() {
    if (_param.week) {
      const w = (BMF.data.eightWeek || []).find(function (x) { return x.week === _param.week; });
      if (w) return w.level || DEFAULT_LEVEL;
    }
    return DEFAULT_LEVEL;
  }

  /** 生成入口：热身 15% / 主训 70% / 放松 15% 预算，主训贪心装填 */
  function generatePlan() {
    const userEquip = BMF.store.getSettings().userEquip || {};
    const dur = _param.dur;
    const mainBudget = Math.round(dur * 60 * 0.7);

    // 热身/放松：各随机挑 2 个（器材过滤；跳绳热身仅 rope 启用时可入选）
    const warmups = pickByTrack('warmup', userEquip);
    const cooldowns = pickByTrack('cooldown', userEquip);

    // 主训：track ∈ 侧重、器材可用、level ≤ 所选周难度，多侧重轮流交错
    const main = buildMain(userEquip, currentLevel(), mainBudget);

    const items = []
      .concat(warmups.map(function (ex) { return itemFrom(ex, 'warmup'); }))
      .concat(main.map(function (ex) { return itemFrom(ex, 'main'); }))
      .concat(cooldowns.map(function (ex) { return itemFrom(ex, 'cooldown'); }));

    _draft = {
      id: null,
      createdAt: null,
      title: autoTitle(dur),
      totalMin: dur,
      focus: _param.focus.slice(),
      items: items
    };

    renderPlanner(_proot);
    if (!items.length) BMF.toast('当前条件下没有可选动作，请调整器材或侧重');
    else if (!main.length) BMF.toast('主训池为空：请调整侧重 / 器材 / 周难度');
    else BMF.toast('已生成 ' + items.length + ' 个动作 · 约 ' + estMin(items) + ' 分钟');
  }

  /** 以动作默认参数构造计划项 */
  function itemFrom(ex, phase) {
    return {
      exId: ex.id, phase: phase,
      sets: ex.sets, workSec: ex.workSec, restSec: ex.restSec, reps: ex.reps
    };
  }

  /** 从指定 track 随机挑 2 个器材可用的动作 */
  function pickByTrack(track, userEquip) {
    return shuffle(exercises().filter(function (ex) {
      return ex.track === track && equipOk(ex, userEquip);
    })).slice(0, 2);
  }

  /** 主训贪心装填：多侧重轮流交错取候选，装到剩余预算放不下为止 */
  function buildMain(userEquip, level, budget) {
    const pools = _param.focus.map(function (t) {
      return exercises().filter(function (ex) {
        return ex.track === t && equipOk(ex, userEquip) && ex.level <= level;
      });
    });

    // 轮流交错的候选序列：pool1[0], pool2[0], ... pool1[1], pool2[1], ...
    const seq = [];
    for (let i = 0; ; i++) {
      let added = false;
      pools.forEach(function (pool) {
        if (i < pool.length) { seq.push(pool[i]); added = true; }
      });
      if (!added) break;
    }

    const picked = [];
    let remain = budget;
    seq.forEach(function (ex) {
      const cost = itemSec(ex, ex);
      if (cost > 0 && cost <= remain) { picked.push(ex); remain -= cost; }
    });
    return picked;
  }

  /** 自动标题：'M.D · 30分钟 · 臀腿侧重'（侧重取第一个 track 的中文名） */
  function autoTitle(dur) {
    const d = new Date();
    const t = tracks()[_param.focus[0]];
    return (d.getMonth() + 1) + '.' + d.getDate() + ' · ' + dur + '分钟 · ' + (t ? t.name : '') + '侧重';
  }

  /* ---------- ② 编辑卡片 ---------- */
  function buildEditCard() {
    const card = el('div', 'card');

    const title = el('div', 'pl-sec-title');
    title.textContent = '② 调整动作';
    card.appendChild(title);

    // 标题（可编辑；input 只改草稿不整页重渲染，避免输入失焦）
    const field = el('div', 'field');
    field.style.marginBottom = '10px';
    const lbl = el('label');
    lbl.textContent = '计划标题';
    field.appendChild(lbl);
    const input = el('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = _draft.title || '';
    input.addEventListener('input', function () { _draft.title = input.value; });
    field.appendChild(input);
    card.appendChild(field);

    // 估算时长 vs 目标时长
    const est = el('div', 'pl-est');
    const chip1 = el('span', 'chip');
    chip1.textContent = '估算约 ' + estMin(_draft.items) + ' 分钟';
    const chip2 = el('span', 'chip');
    chip2.textContent = '目标 ' + _draft.totalMin + ' 分钟';
    est.append(chip1, chip2);
    card.appendChild(est);

    // 分阶段列表（热身/主训/放松）
    PHASES.forEach(function (ph) {
      const items = _draft.items.filter(function (it) { return phaseOf(it) === ph.key; });
      const head = el('div', 'pl-phase-title');
      head.textContent = ph.name + ' · ' + items.length + ' 个';
      card.appendChild(head);
      items.forEach(function (it) { card.appendChild(buildItemRow(it)); });

      const add = el('button', 'chip pl-add-chip');
      add.type = 'button';
      add.textContent = '+ 添加动作';
      add.addEventListener('click', function () { openAddModal(ph.key, ph.name); });
      card.appendChild(add);
    });

    // 清空重来
    const clear = el('button', 'btn btn-ghost btn-block pl-clear-btn');
    clear.type = 'button';
    clear.textContent = '清空重来';
    clear.addEventListener('click', function () {
      BMF.confirm('清空当前编辑的动作，重新开始？').then(function (yes) {
        if (!yes) return;
        _draft = null;
        renderPlanner(_proot);
        BMF.toast('已清空，可重新生成');
      });
    });
    card.appendChild(clear);
    return card;
  }

  /** 单个动作编辑行：名称 + track 徽章 + 步进器 + 删除 */
  function buildItemRow(it) {
    const ex = findEx(it.exId);
    const row = el('div', 'list-item');
    const main = el('div', 'li-main');

    const line = el('div', 'pl-item-line');
    line.appendChild(nameLink(ex, 'li-title', '未知动作（' + it.exId + '）'));
    if (ex) { line.appendChild(trackBadge(ex.track)); line.appendChild(infoIcon(ex)); }
    main.appendChild(line);

    if (ex) {
      const ctrl = el('div', 'pl-ctrl');
      // 组数 ±1
      ctrl.appendChild(stepper(num(it.sets), 1, 1, 12,
        function (v) { return v + ' 组'; },
        function (v) { it.sets = v; }));
      if (ex.type === 'reps') {
        // 次数 ±2
        ctrl.appendChild(stepper(num(it.reps), 2, 2, 100,
          function (v) { return v + ' 次'; },
          function (v) { it.reps = v; }));
      } else {
        // 工作秒 ±5s / 休息秒 ±5s
        ctrl.appendChild(stepper(num(it.workSec), 5, 5, 600,
          function (v) { return v + ' 秒'; },
          function (v) { it.workSec = v; }));
        ctrl.appendChild(stepper(num(it.restSec), 5, 0, 300,
          function (v) { return '休 ' + v; },
          function (v) { it.restSec = v; }));
      }
      main.appendChild(ctrl);
    }
    row.appendChild(main);
    row.appendChild(buildDelBtn(it));
    return row;
  }

  /** 行尾删除按钮（直接删，无需确认） */
  function buildDelBtn(it) {
    const del = el('button', 'pl-del');
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除该动作');
    del.addEventListener('click', function () {
      if (!_draft) return;
      const i = _draft.items.indexOf(it);
      if (i >= 0) _draft.items.splice(i, 1);
      renderPlanner(_proot);
    });
    return del;
  }

  /** 小步进器：[- 值 +]，点按后改草稿并整页刷新（同步估算时长） */
  function stepper(val, step, min, max, fmt, onChange) {
    const wrap = el('div', 'pl-step');
    const minus = el('button', 'pl-step-btn');
    minus.type = 'button';
    minus.textContent = '−';
    const v = el('span', 'pl-step-val');
    const plus = el('button', 'pl-step-btn');
    plus.type = 'button';
    plus.textContent = '+';
    let cur = Math.max(min, Math.min(max, Math.round(num(val))));
    v.textContent = fmt(cur);
    function apply(next) {
      cur = Math.max(min, Math.min(max, next));
      onChange(cur);
      v.textContent = fmt(cur);
      renderPlanner(_proot);
    }
    minus.addEventListener('click', function () { apply(cur - step); });
    plus.addEventListener('click', function () { apply(cur + step); });
    wrap.append(minus, v, plus);
    return wrap;
  }

  /* ---------- 添加动作弹窗（可连续添加） ---------- */
  function openAddModal(phaseKey, phaseName) {
    const userEquip = BMF.store.getSettings().userEquip || {};
    const state = { q: '', track: 'all', equip: Object.assign({}, userEquip) };

    const body = el('div');

    // 搜索框（按名称过滤）
    const f = el('div', 'field');
    const fl = el('label');
    fl.textContent = '搜索动作名称';
    f.appendChild(fl);
    const input = el('input');
    input.type = 'search';
    input.placeholder = '如：深蹲 / 跳绳 / 反手';
    input.addEventListener('input', function () {
      state.q = input.value.trim();
      renderList();
    });
    f.appendChild(input);
    body.appendChild(f);

    // track 过滤 chips（用 tracks 配色做选中态）
    const tLabel = el('div', 'pl-modal-label');
    tLabel.textContent = '板块';
    body.appendChild(tLabel);
    const trackRow = el('div', 'pl-chips');
    function buildTrackChips() {
      trackRow.innerHTML = '';
      ['all'].concat(TRACK_ALL).forEach(function (k) {
        const c = el('button', 'chip' + (state.track === k ? ' active' : ''));
        c.type = 'button';
        const t = k === 'all' ? null : tracks()[k];
        c.textContent = k === 'all' ? '全部' : (t ? t.name : k);
        if (state.track === k && t) {
          // 选中态用 track 配色覆盖默认青柠色
          c.style.background = t.color;
          c.style.borderColor = t.color;
          c.style.color = '#0B0B0F';
          c.style.fontWeight = '600';
        }
        c.addEventListener('click', function () {
          state.track = k;
          buildTrackChips();
          renderList();
        });
        trackRow.appendChild(c);
      });
    }
    body.appendChild(trackRow);

    // 器材过滤 chips（默认按当前 userEquip）
    const eLabel = el('div', 'pl-modal-label');
    eLabel.textContent = '器材（勾选你当前可用的）';
    body.appendChild(eLabel);
    const equipRow = el('div', 'pl-chips');
    function buildEquipChips() {
      equipRow.innerHTML = '';
      Object.keys(EQUIP_NAMES).forEach(function (k) {
        const on = !!state.equip[k];
        const c = el('button', 'chip' + (on ? ' active' : ''));
        c.type = 'button';
        c.textContent = EQUIP_NAMES[k];
        c.addEventListener('click', function () {
          state.equip[k] = on ? 0 : 1;
          buildEquipChips();
          renderList();
        });
        equipRow.appendChild(c);
      });
    }
    body.appendChild(equipRow);

    // 动作列表（点选即以默认参数追加到对应 phase，弹窗保持开启）
    const listBox = el('div', 'pl-modal-list');
    body.appendChild(listBox);

    function renderList() {
      listBox.innerHTML = '';
      const list = exercises().filter(function (ex) {
        if (state.track !== 'all' && ex.track !== state.track) return false;
        if (!equipOk(ex, state.equip)) return false;
        if (state.q && ex.name.indexOf(state.q) < 0) return false;
        return true;
      });
      if (!list.length) {
        const tip = el('div', 'empty-tip');
        tip.textContent = '没有符合条件的动作';
        listBox.appendChild(tip);
        return;
      }
      list.forEach(function (ex) {
        const row = el('div', 'list-item pl-pick-row');
        const main = el('div', 'li-main');
        const line = el('div', 'pl-item-line');
        const name = el('span', 'li-title');
        name.textContent = ex.name;
        line.append(name, trackBadge(ex.track));
        const sub = el('div', 'li-sub');
        sub.textContent = summaryText(ex, ex);
        main.append(line, sub);
        row.appendChild(main);

        // 「详解」按钮：只看详情不添加（阻止冒泡，避免误触发整行的点选添加）
        const info = el('button', 'pl-info-btn');
        info.type = 'button';
        info.textContent = '详解';
        info.setAttribute('aria-label', '查看「' + ex.name + '」动作详解');
        info.addEventListener('click', function (e) {
          e.stopPropagation();
          BMF.showExerciseDetail(ex);
        });
        row.appendChild(info);

        // 已在草稿中的动作打标记
        if (_draft && _draft.items.some(function (it) { return it.exId === ex.id; })) {
          const b = el('span', 'badge');
          b.textContent = '已添加';
          row.appendChild(b);
        }

        row.addEventListener('click', function () {
          if (!_draft) return;
          _draft.items.push(itemFrom(ex, phaseKey));
          if (_proot) renderPlanner(_proot); // 编辑区同步刷新（弹窗仍在最上层）
          BMF.toast('已添加：' + ex.name);
          renderList(); // 刷新“已添加”标记
        });
        listBox.appendChild(row);
      });
    }

    buildTrackChips();
    buildEquipChips();
    renderList();

    // 「完成」关闭；列表点选不关闭，便于连续添加
    BMF.openModal({
      title: '添加动作 · ' + phaseName,
      body: body,
      actions: [{ label: '完成', primary: true }]
    });
  }

  /* ---------- ③ 保存卡片 ---------- */
  function buildSaveCard() {
    const card = el('div', 'card');
    const title = el('div', 'pl-sec-title');
    title.textContent = '③ 保存';
    card.appendChild(title);

    const save = el('button', 'btn btn-primary btn-block');
    save.type = 'button';
    save.textContent = '保存为今日计划';
    save.disabled = !_draft.items.length;
    save.addEventListener('click', saveDraft);
    card.appendChild(save);

    // 已保存过（或载入的已有计划）→ 提供立即跟练
    if (_draft.id) {
      const go = el('button', 'btn btn-block');
      go.type = 'button';
      go.style.marginTop = '10px';
      go.textContent = '立即跟练';
      go.disabled = !_draft.items.length;
      go.addEventListener('click', function () {
        if (playerBusy()) { BMF.toast('已在跟练中'); return; }
        playerOpen(planFromDraft());
      });
      card.appendChild(go);
    }
    return card;
  }

  /** 由当前草稿构造完整计划对象（items 深拷贝） */
  function planFromDraft() {
    return {
      id: _draft.id,
      date: BMF.today(),
      title: _draft.title || '训练计划',
      totalMin: _draft.totalMin,
      focus: _draft.focus.slice(),
      items: _draft.items.map(copyItem),
      createdAt: _draft.createdAt
    };
  }

  function saveDraft() {
    if (!_draft || !_draft.items.length) return;
    const plan = planFromDraft();
    plan.id = _draft.id || BMF.uuid();
    plan.createdAt = _draft.createdAt || Date.now();
    const saved = BMF.store.savePlan(plan);
    _draft.id = saved.id;
    _draft.createdAt = saved.createdAt;
    BMF.emit('bmf:plan-updated', saved);
    BMF.toast('已保存为今日计划');
    renderPlanner(_proot);
  }

  /* ---------- 我的计划列表 ---------- */
  function buildPlansCard() {
    const card = el('div', 'card');
    const title = el('div', 'pl-sec-title');
    title.textContent = '我的计划';
    card.appendChild(title);

    const plans = BMF.store.getPlans().slice(0, 7);
    if (!plans.length) {
      const tip = el('div', 'empty-tip');
      tip.textContent = '还没有保存过计划';
      card.appendChild(tip);
      return card;
    }
    plans.forEach(function (p) { card.appendChild(buildPlanRow(p)); });
    return card;
  }

  function buildPlanRow(p) {
    const row = el('div', 'list-item pl-pick-row');
    const main = el('div', 'li-main');
    const title = el('div', 'li-title');
    title.textContent = p.title || '训练计划';
    const sub = el('div', 'li-sub');
    sub.textContent = fmtPlanDate(p.date) + ' · ' + (p.totalMin || '?') + '分钟 · ' +
      (p.items ? p.items.length : 0) + ' 个动作';
    main.append(title, sub);
    row.appendChild(main);

    const del = el('button', 'pl-del');
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除该计划');
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      BMF.confirm('删除计划「' + (p.title || '') + '」？').then(function (yes) {
        if (!yes) return;
        BMF.store.deletePlan(p.id);
        BMF.emit('bmf:plan-updated', { id: p.id, deleted: true });
        renderPlanner(_proot);
        BMF.toast('已删除计划');
      });
    });
    row.appendChild(del);

    // 点击整行 → 载入编辑器（同页）
    row.addEventListener('click', function () { loadPlan(p); });
    return row;
  }

  /** '2026-09-13' → '9月13日' */
  function fmtPlanDate(date) {
    if (!date || date.length !== 10) return date || '';
    return Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日';
  }

  function loadPlan(p) {
    _draft = {
      id: p.id,
      createdAt: p.createdAt,
      title: p.title || '',
      totalMin: p.totalMin || 30,
      focus: (p.focus && p.focus.length ? p.focus : ['legs']).slice(),
      items: (p.items || []).map(copyItem)
    };
    // 参数卡与载入的草稿保持一致
    _param.dur = _draft.totalMin;
    _param.focus = _draft.focus.slice();
    renderPlanner(_proot);
    window.scrollTo(0, 0);
    BMF.toast('已载入计划，可调整后重新保存');
  }

  /* =====================================================
     今日页
     ===================================================== */

  function renderToday(root) {
    injectCss();
    root.innerHTML = '';
    root.appendChild(buildGreetCard());
    root.appendChild(buildTodayPlanCard());
    root.appendChild(buildStreakCard());
    root.appendChild(buildTipsFooter());
  }

  /* ---------- 问候卡片 ---------- */
  function buildGreetCard() {
    const card = el('div', 'card');
    const d = new Date();
    const t = el('div', 'td-date');
    t.textContent = '今天 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const w = el('div', 'td-week');
    w.textContent = '星期' + WEEKDAYS[d.getDay()] + ' · 羽力训练';
    card.append(t, w);
    return card;
  }

  /* ---------- 今日计划卡片 ---------- */
  function buildTodayPlanCard() {
    const plan = BMF.store.getPlanByDate(BMF.today());
    const card = el('div', 'card');

    // 无计划：空态卡片
    if (!plan) {
      const p1 = el('p', 'td-plan-title');
      p1.textContent = '今天还没有训练计划';
      const p2 = el('p', 'td-meta');
      p2.style.margin = '4px 0 14px';
      p2.textContent = '几分钟制定一份：热身、主训、放松自动排好，跟练计时开箱即用。';
      const btn = el('button', 'btn btn-primary btn-block');
      btn.type = 'button';
      btn.textContent = '去制定今日计划';
      btn.addEventListener('click', function () { BMF.showPage('plan'); });
      card.append(p1, p2, btn);
      return card;
    }

    // 标题 + 侧重点 badges + 估算信息
    const title = el('div', 'td-plan-title');
    title.textContent = plan.title || '今日训练';
    card.appendChild(title);

    const badges = el('div', 'td-badges');
    const focusArr = (plan.focus && plan.focus.length) ? plan.focus : focusFromItems(plan.items);
    focusArr.forEach(function (k) { if (tracks()[k]) badges.appendChild(trackBadge(k)); });
    if (badges.childNodes.length) card.appendChild(badges);

    const meta = el('div', 'td-meta');
    meta.textContent = '估算约 ' + estMin(plan.items) + ' 分钟 · ' + plan.items.length + ' 个动作';
    card.appendChild(meta);

    // 分阶段简表（热身/主训/放松）
    PHASES.forEach(function (ph) {
      const items = (plan.items || []).filter(function (it) { return phaseOf(it) === ph.key; });
      if (!items.length) return;
      const head = el('div', 'td-phase-name');
      head.textContent = ph.name;
      card.appendChild(head);
      items.forEach(function (it) {
        const ex = findEx(it.exId);
        const row = el('div', 'td-item-row');
        row.appendChild(nameLink(ex, 'td-item-name', it.exId));
        const sum = el('span', 'td-item-sum');
        sum.textContent = ex ? summaryText(ex, it) : '';
        row.appendChild(sum);
        card.appendChild(row);
      });
    });

    // 主按钮：开始跟练；次按钮：去调整
    const btns = el('div', 'td-btns');
    const go = el('button', 'btn btn-primary');
    go.type = 'button';
    go.textContent = '开始跟练';
    go.addEventListener('click', function () {
      if (playerBusy()) { BMF.toast('已在跟练中'); return; }
      playerOpen(plan);
    });
    const edit = el('button', 'btn btn-ghost');
    edit.type = 'button';
    edit.textContent = '去调整';
    edit.addEventListener('click', function () { BMF.showPage('plan'); });
    btns.append(go, edit);
    card.appendChild(btns);
    return card;
  }

  /** 从 items 反推侧重点（兼容 focus 缺失的外部计划） */
  function focusFromItems(items) {
    const set = {};
    (items || []).forEach(function (it) {
      const ex = findEx(it.exId);
      if (ex) set[ex.track] = 1;
    });
    return Object.keys(set);
  }

  /* ---------- 打卡激励卡片 ---------- */
  function buildStreakCard() {
    const card = el('div', 'card');
    const n = calcStreak();
    const main = el('div', 'td-streak-num');
    const sub = el('div', 'td-streak-txt');
    if (n > 0) {
      main.textContent = '已连续训练 ' + n + ' 天';
      sub.textContent = n >= 3 ? '节奏很稳，休息日记得拉伸放松' : '继续保持，连续 3 天就有小节奏了';
    } else {
      main.textContent = '还没有连续训练记录';
      sub.textContent = '今天完成一次跟练，就开启连续打卡的第 1 天';
    }
    card.append(main, sub);
    return card;
  }

  /** 连续训练天数：从今天（或截止昨天）往回数 */
  function calcStreak() {
    const set = {};
    BMF.store.getLogs().forEach(function (l) { if (l && l.date) set[l.date] = 1; });
    const d = new Date();
    if (!set[localDate(d)]) d.setDate(d.getDate() - 1); // 今天没练则从昨天起算
    let n = 0;
    while (set[localDate(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- 页脚安全提示 ---------- */
  function buildTipsFooter() {
    const tips = BMF.data.safetyTips || [];
    const wrap = el('div', 'td-tips');
    [0, 2].forEach(function (i) {
      if (tips[i]) {
        const t = el('div', 'td-tip');
        t.textContent = '安全提示：' + tips[i];
        wrap.appendChild(t);
      }
    });
    return wrap;
  }

  /* =====================================================
     事件监听与页面注册
     ===================================================== */

  // 计划变化：今日页 / 制定页（激活态时）重渲染
  BMF.on('bmf:plan-updated', function () {
    if (isPageActive('today')) renderToday(document.getElementById('today-root'));
    if (isPageActive('plan') && _proot) renderPlanner(_proot);
  });

  // 新增打卡：今日页（激活态时）重渲染（连续天数变化）
  BMF.on('bmf:log-added', function () {
    if (isPageActive('today')) renderToday(document.getElementById('today-root'));
  });

  BMF.registerPage('today', renderToday);
  BMF.registerPage('plan', renderPlanner);

  /* 跨模块契约：暴露当前编辑器里的草稿 */
  BMF.planner = {
    getDraft: function () { return _draft; }
  };

  // app.js 的 init 在 defer 阶段立即执行 showPage('today')，那时本文件尚未注册，
  // 首屏会停留在「该模块尚未加载」占位；此处若今日页已激活则补一次渲染
  if (isPageActive('today') && typeof BMF.showPage === 'function') {
    BMF.showPage('today');
  }
})();
