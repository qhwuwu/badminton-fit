window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · player.js
   全屏跟练播放器：
   步骤展开（每组 work + 组间 rest）→ 开始屏 → 跟练屏 →
   完成总结 → 打卡写入日志
   计时用 Date.now() 差值校正 drift；提示音用 Web Audio 合成；
   Wake Lock 全程 try/catch 静默
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 模块内样式（注入一次，不改动 style.css） ---------- */
  const PLAYER_CSS = [
    '.pl-top{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 8px 8px 16px;}',
    '.pl-title{flex:1;min-width:0;font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.pl-close{width:48px;height:48px;flex-shrink:0;border:none;background:transparent;color:var(--text);font-size:20px;border-radius:12px;cursor:pointer;}',
    '.pl-close:active{background:var(--surface2);}',
    '.pl-bar{height:4px;margin:0 16px;border-radius:2px;background:var(--surface2);overflow:hidden;}',
    '.pl-bar-val{height:100%;width:0;background:var(--accent);transition:width .3s ease;}',
    '.pl-body{flex:1;min-height:0;overflow-y:auto;padding:12px 20px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;}',
    '.pl-inner{margin:auto 0;display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;text-align:center;}',
    '.pl-foot{display:flex;justify-content:center;padding:10px 16px calc(14px + env(safe-area-inset-bottom));}',
    '.pl-pause{min-width:160px;}',
    '.pl-big{min-height:56px;width:100%;max-width:360px;font-size:17px;}',
    '.pl-ring-wrap{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.pl-timer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}',
    '.pl-ex-name{font-size:20px;font-weight:700;line-height:1.35;}',
    '.pl-sub{font-size:13px;color:var(--text-dim);}',
    '.pl-next-hint{font-size:13px;color:var(--text-dim);}',
    '.player-overlay .cue-list{text-align:left;align-self:stretch;max-width:360px;margin:4px auto 0;}',
    '.pl-check{width:88px;height:88px;display:flex;align-items:center;justify-content:center;font-size:52px;font-weight:800;color:var(--accent-ink);background:var(--accent);border-radius:50%;}',
    '.pl-done-title{font-size:22px;font-weight:800;}',
    '.pl-done-stats{width:100%;max-width:360px;display:flex;flex-direction:column;gap:8px;margin-top:4px;}',
    '.pl-stat-row{display:flex;justify-content:space-between;font-size:14px;color:var(--text-dim);}',
    '.pl-stat-row b{color:var(--text);font-weight:600;}',
    '.pl-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;}'
  ].join('');
  function injectCss() {
    if (document.getElementById('bmf-player-style')) return;
    const s = document.createElement('style');
    s.id = 'bmf-player-style';
    s.textContent = PLAYER_CSS;
    document.head.appendChild(s);
  }

  /* ---------- 常量与小工具 ---------- */
  const RING_R = 108;                       // 进度环半径（viewBox 240）
  const RING_C = 2 * Math.PI * RING_R;      // 周长 → stroke-dasharray
  const TRACK_KEYS = ['wrist', 'legs', 'cardio', 'backhand']; // 计入日志的板块

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  /** 大于 0 的有效数字，否则返回 0 */
  function num(v) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function findEx(id) {
    return (BMF.data.exercises || []).find(function (e) { return e.id === id; }) || null;
  }

  /* ---------- 运行期状态 ---------- */
  let session = null;   // 当前跟练会话；null = 未在跟练
  let ticker = null;    // 1s 定时器句柄
  let audioCtx = null;  // AudioContext（用户点击「开始训练」时才创建）
  let wakeLock = null;  // WakeLockSentinel

  /* ---------- 步骤展开：plan.items → [work, rest, work, ...] ---------- */
  function expandSteps(plan) {
    const works = [];
    (plan.items || []).forEach(function (item, itemIdx) {
      if (!item || !item.exId) return;
      const ex = findEx(item.exId);
      if (!ex) return; // 查不到详情的动作整体跳过
      const sets = Math.max(1, Math.round(num(item.sets) || num(ex.sets) || 1));
      const workSec = num(item.workSec) || num(ex.workSec) || 30;
      const restSec = num(item.restSec) || num(ex.restSec) || 0;
      const reps = num(item.reps) || num(ex.reps) || 0;
      for (let s = 1; s <= sets; s++) {
        works.push({ kind: 'work', item: item, itemIdx: itemIdx, ex: ex,
          setIndex: s, totalSets: sets, workSec: workSec, restSec: restSec, reps: reps });
      }
    });
    // 每个 work 后跟 rest；整个训练最后一个 work 之后不加
    const steps = [];
    works.forEach(function (w, i) {
      steps.push(w);
      if (i < works.length - 1 && w.restSec > 0) {
        steps.push({ kind: 'rest', sec: w.restSec });
      }
    });
    return steps;
  }

  /** 该 work 是否计时型（type:'timed'；非 'reps' 均按计时处理） */
  function isTimed(step) { return step.ex.type !== 'reps'; }

  /* ---------- 提示音（Web Audio 合成，无音频文件） ---------- */
  function ensureAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        audioCtx.resume().catch(function () { /* 静默 */ });
      }
    } catch (e) { audioCtx = null; }
  }
  /** 短促提示音：freq Hz，dur 秒 */
  function beep(freq, dur) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 静默 */ }
  }

  /* ---------- Wake Lock（全部 try/catch 静默） ---------- */
  function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator) || !session) return;
      navigator.wakeLock.request('screen')
        .then(function (lock) { wakeLock = lock; })
        .catch(function () { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  function releaseWakeLock() {
    try {
      if (wakeLock && wakeLock.release) {
        const p = wakeLock.release();
        if (p && p.catch) p.catch(function () { /* 静默 */ });
      }
    } catch (e) { /* 静默 */ }
    wakeLock = null;
  }
  // 回到前台且仍在跟练 → 重新申请锁，并立刻校正一次计时
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && isActive()) {
      if (session && session.state === 'running') {
        requestWakeLock();
        tick();
      }
    }
  });

  /* ---------- 定时器：1s tick + timestamp 差值校正 ---------- */
  function startTicker() {
    stopTicker();
    if (!session) return;
    session.lastTick = Date.now();
    ticker = setInterval(tick, 1000);
  }
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }
  function tick() {
    const s = session;
    if (!s || s.state !== 'running') { if (s) s.lastTick = Date.now(); return; }
    const now = Date.now();
    const delta = (now - s.lastTick) / 1000; // 真实流逝秒数（后台节流时一跳补齐）
    s.lastTick = now;
    if (delta <= 0) return;
    s.runSec += delta; // 只累计未暂停的运行时间
    const step = s.steps[s.idx];
    if (!step) return;
    if (step.kind === 'rest' || isTimed(step)) {
      s.remaining -= delta;
      const prev = Math.ceil(s.remaining + delta);
      const cur = Math.ceil(s.remaining);
      if (cur >= 1 && cur <= 3 && cur < prev) beep(880, 0.1); // 剩余 3/2/1 秒低音
      if (s.remaining <= 0) { advance(); return; }
      updateCountdownUI();
    }
  }

  /* ---------- 页面骨架与渲染 ---------- */
  function buildSkeleton(root, plan) {
    root.innerHTML = '';
    const top = el('div', 'pl-top');
    const title = el('div', 'pl-title');
    title.textContent = plan.title || '跟练';
    const closeBtn = el('button', 'pl-close');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '退出跟练');
    closeBtn.addEventListener('click', onAbort);
    top.append(title, closeBtn);

    const bar = el('div', 'pl-bar');
    const barVal = el('div', 'pl-bar-val');
    bar.appendChild(barVal);

    const body = el('div', 'pl-body');
    const inner = el('div', 'pl-inner');
    body.appendChild(inner);

    const foot = el('div', 'pl-foot');
    const pauseBtn = el('button', 'btn btn-ghost pl-pause');
    pauseBtn.type = 'button';
    pauseBtn.addEventListener('click', onTogglePause);
    foot.appendChild(pauseBtn);

    root.append(top, bar, body, foot);
    session.el = { root: root, body: body, inner: inner, barVal: barVal, foot: foot, pauseBtn: pauseBtn };
  }

  /** 开始屏：满足自动播放策略——AudioContext 在此按钮点击时创建 */
  function renderStart() {
    const s = session;
    s.el.foot.style.display = 'none';
    s.el.barVal.style.width = '0%';
    const inner = s.el.inner;
    inner.innerHTML = '';

    const t = el('div', 'pl-ex-name');
    t.style.fontSize = '24px';
    t.textContent = s.plan.title || '跟练训练';
    const sub = el('div', 'pl-sub');
    const exCount = Object.keys(s.steps.reduce(function (m, st) {
      if (st.kind === 'work') m[st.itemIdx] = 1; return m;
    }, {})).length;
    const estSec = s.steps.reduce(function (a, st) {
      return a + (st.kind === 'work' ? st.workSec : st.sec);
    }, 0);
    sub.textContent = exCount + ' 个动作 · 共 ' + s.totalWork + ' 组 · 约 ' +
      Math.max(1, Math.round(estSec / 60)) + ' 分钟';

    const startBtn = el('button', 'btn btn-primary btn-block pl-big');
    startBtn.type = 'button';
    startBtn.textContent = '开始训练';
    startBtn.addEventListener('click', onStart);

    inner.append(t, sub, startBtn);
  }

  function onStart() {
    const s = session;
    if (!s || s.state !== 'ready') return;
    ensureAudio();       // 用户手势内创建 AudioContext
    requestWakeLock();
    s.state = 'running';
    s.el.foot.style.display = '';
    updatePauseBtn();
    enterStep(0);
    startTicker();
  }

  /** 进入第 i 步：重置倒计时、渲染界面、播放步骤切换高音 */
  function enterStep(i) {
    const s = session;
    if (!s) return;
    s.idx = i;
    const step = s.steps[i];
    if (step.kind === 'rest') s.remaining = step.sec;
    else if (isTimed(step)) s.remaining = step.workSec;
    else s.remaining = 0; // 计次型无倒计时
    beep(1320, 0.25); // 步骤切换明亮高音
    renderStep();
  }

  function renderStep() {
    const s = session;
    const step = s.steps[s.idx];
    const inner = s.el.inner;
    inner.innerHTML = '';
    s.el.body.scrollTop = 0;
    s.ui = {};

    if (step.kind === 'work') {
      const ex = step.ex;
      // phase badge：热身 / 主训 / 放松
      const isEdge = ex.track === 'warmup' || ex.track === 'cooldown';
      const badge = el('span', 'badge');
      badge.style.setProperty('--badge', isEdge ? '#90A4AE' : '#C8F135');
      badge.style.setProperty('--badge-ink', '#0B0B0F');
      badge.textContent = ex.track === 'warmup' ? '热身' : ex.track === 'cooldown' ? '放松' : '主训';

      const name = el('div', 'pl-ex-name');
      name.textContent = ex.name;
      const setLine = el('div', 'pl-sub');
      setLine.textContent = '第 ' + step.setIndex + ' / ' + step.totalSets + ' 组';
      inner.append(badge, name, setLine);

      if (isTimed(step)) {
        // 计时型：进度环 + 大倒计时
        const wrap = el('div', 'pl-ring-wrap');
        wrap.innerHTML =
          '<svg class="ring" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">' +
          '<circle class="ring-bg" cx="120" cy="120" r="108" stroke-width="10"/>' +
          '<circle class="ring-val" cx="120" cy="120" r="108" stroke-width="10" ' +
          'stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="0"/></svg>';
        const tv = el('div', 'timer-big pl-timer');
        tv.textContent = Math.max(0, Math.ceil(s.remaining));
        wrap.appendChild(tv);
        inner.appendChild(wrap);
        s.ui.timer = tv;
        s.ui.ring = wrap.querySelector('.ring-val');
        s.ui.ringTotal = step.workSec;
      } else {
        // 计次型：大数字目标次数 + 完成按钮
        const repsBig = el('div', 'timer-big');
        repsBig.textContent = step.reps || '—';
        const repsSub = el('div', 'pl-sub');
        repsSub.textContent = '按建议节奏完成 ' + (step.reps || '') + ' 次';
        const doneBtn = el('button', 'btn btn-primary btn-block pl-big');
        doneBtn.type = 'button';
        doneBtn.textContent = '完成一组';
        doneBtn.addEventListener('click', advance);
        inner.append(repsBig, repsSub, doneBtn);
      }

      // 动作要点前 3 条
      if (Array.isArray(ex.cues) && ex.cues.length) {
        const ul = el('ul', 'cue-list');
        ex.cues.slice(0, 3).forEach(function (c) {
          const li = document.createElement('li');
          li.textContent = c;
          ul.appendChild(li);
        });
        inner.appendChild(ul);
      }
    } else {
      // 休息步骤：倒计时 + 跳过 + 下一动作提示
      const restName = el('div', 'pl-ex-name');
      restName.textContent = '休息一下';
      const wrap = el('div', 'pl-ring-wrap');
      wrap.innerHTML =
        '<svg class="ring" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">' +
        '<circle class="ring-bg" cx="120" cy="120" r="108" stroke-width="10"/>' +
        '<circle class="ring-val" cx="120" cy="120" r="108" stroke-width="10" ' +
        'stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="0"/></svg>';
      const tv = el('div', 'timer-big pl-timer');
      tv.textContent = Math.max(0, Math.ceil(s.remaining));
      wrap.appendChild(tv);
      const skipBtn = el('button', 'btn btn-ghost pl-big');
      skipBtn.type = 'button';
      skipBtn.textContent = '跳过休息';
      skipBtn.addEventListener('click', advance);
      inner.append(restName, wrap, skipBtn);
      s.ui.timer = tv;
      s.ui.ring = wrap.querySelector('.ring-val');
      s.ui.ringTotal = step.sec;

      const next = s.steps[s.idx + 1];
      if (next && next.kind === 'work') {
        const hint = el('div', 'pl-next-hint');
        hint.textContent = '下一个：' + next.ex.name + '（第 ' + next.setIndex + ' 组）';
        inner.appendChild(hint);
      }
    }
    updateBar();
  }

  /** 大倒计时数字与进度环刷新 */
  function updateCountdownUI() {
    const s = session;
    if (!s || !s.ui) return;
    if (s.ui.timer) s.ui.timer.textContent = Math.max(0, Math.ceil(s.remaining));
    if (s.ui.ring) {
      const total = s.ui.ringTotal || 1;
      const frac = Math.min(1, Math.max(0, (total - s.remaining) / total));
      s.ui.ring.style.strokeDashoffset = (RING_C * frac).toFixed(1);
    }
  }

  /** 顶部整体进度条：已完成 work 数 / 总 work 数 */
  function updateBar() {
    const s = session;
    if (!s) return;
    s.el.barVal.style.width = (s.totalWork ? (s.doneWork / s.totalWork) * 100 : 0) + '%';
  }

  /* ---------- 步骤推进 / 暂停 / 完成 ---------- */
  function advance() {
    const s = session;
    if (!s || s.state !== 'running') return;
    const step = s.steps[s.idx];
    if (step && step.kind === 'work') markWorkDone(step);
    if (s.idx + 1 >= s.steps.length) { finish(); return; }
    enterStep(s.idx + 1);
  }

  function markWorkDone(step) {
    const s = session;
    s.doneWork++;
    s.doneItemIdx[step.itemIdx] = true; // 该 item 至少完成一组
    const t = step.ex.track;
    if (TRACK_KEYS.indexOf(t) >= 0) s.trackSec[t] += step.workSec; // 热身/放松不计
    updateBar();
  }

  function onTogglePause() {
    const s = session;
    if (!s || s.state === 'ready' || s.state === 'done') return;
    if (s.state === 'running') { s.state = 'paused'; stopTicker(); }
    else { s.state = 'running'; startTicker(); }
    updatePauseBtn();
  }
  function updatePauseBtn() {
    const s = session;
    if (s) s.el.pauseBtn.textContent = s.state === 'paused' ? '继续' : '暂停';
  }

  /** 全部步骤完成 → 总结屏 */
  function finish() {
    const s = session;
    if (!s) return;
    s.state = 'done';
    stopTicker();
    updateBar();
    renderDone();
  }

  function renderDone() {
    const s = session;
    s.el.foot.style.display = 'none';
    const inner = s.el.inner;
    inner.innerHTML = '';

    const check = el('div', 'pl-check check-pop');
    check.textContent = '✓';
    const title = el('div', 'pl-done-title');
    title.textContent = '训练完成！';
    inner.append(check, title);

    const stats = el('div', 'pl-done-stats');
    function row(label, valueHtml, valueNode) {
      const r = el('div', 'pl-stat-row');
      const l = el('span'); l.textContent = label;
      const v = el('b');
      if (valueNode) v.appendChild(valueNode); else v.textContent = valueHtml;
      r.append(l, v);
      stats.appendChild(r);
    }
    row('实际用时', BMF.fmt.sec(Math.round(s.runSec)));
    const doneItems = Object.keys(s.doneItemIdx).length;
    row('完成动作', doneItems + ' / ' + s.plan.items.length);
    let anyTrack = false;
    TRACK_KEYS.forEach(function (k) {
      const min = Math.round(s.trackSec[k] / 60);
      if (s.trackSec[k] > 0) {
        anyTrack = true;
        const dot = el('span', 'pl-dot');
        dot.style.background = (BMF.data.tracks[k] || {}).color || 'var(--accent)';
        const wrap = el('span');
        wrap.appendChild(dot);
        wrap.appendChild(document.createTextNode(
          ((BMF.data.tracks[k] || {}).name || k) + ' ' + min + ' 分钟'));
        row('板块', '', wrap);
      }
    });
    if (!anyTrack) row('板块', '本计划无主训板块');
    inner.appendChild(stats);

    const btn = el('button', 'btn btn-primary btn-block pl-big');
    btn.type = 'button';
    btn.textContent = '完成并打卡';
    btn.addEventListener('click', onCheckIn);
    inner.appendChild(btn);
  }

  /** 打卡：写日志 → 广播 → 关闭 → toast → 跳进度页 */
  function onCheckIn() {
    const s = session;
    if (!s) return;
    const log = {
      id: BMF.uuid(),
      date: BMF.today(),
      planId: s.plan.id,
      planTitle: s.plan.title || '自定义训练',
      durationSec: Math.round(s.runSec),               // 只计未暂停运行时间
      doneItems: Object.keys(s.doneItemIdx).length,    // 至少完成一组的 item 数
      totalItems: s.plan.items.length,
      trackSec: {
        wrist: s.trackSec.wrist, legs: s.trackSec.legs,
        cardio: s.trackSec.cardio, backhand: s.trackSec.backhand
      },
      createdAt: Date.now()
    };
    BMF.store.addLog(log);
    BMF.emit('bmf:log-added', log);
    closePlayer();
    BMF.toast('训练完成，已打卡');
    BMF.showPage('progress');
  }

  /** ✕ 放弃：确认后直接清理，不写日志 */
  function onAbort() {
    const s = session;
    if (!s) return;
    if (s.state === 'ready') { closePlayer(); return; } // 尚未开始，无需确认
    BMF.confirm('放弃本次训练？进度不会保存').then(function (yes) {
      if (!yes || !session) return;
      closePlayer();
      BMF.toast('已放弃本次训练');
    });
  }

  /** 关闭覆盖层并清理全部运行期资源 */
  function closePlayer() {
    stopTicker();
    releaseWakeLock();
    session = null;
    const root = document.getElementById('player-root');
    if (root) {
      root.hidden = true;
      root.classList.remove('player-overlay');
      root.innerHTML = '';
    }
  }

  /* ---------- 对外 API ---------- */

  /** 打开全屏跟练播放器（planner/sync 调用） */
  function open(plan) {
    if (!plan || !Array.isArray(plan.items) || !plan.items.length) {
      BMF.toast('该计划没有可跟练的内容');
      return;
    }
    const steps = expandSteps(plan);
    if (!steps.length) {
      BMF.toast('计划中的动作都无法识别，无法跟练');
      return;
    }
    injectCss();
    if (session) closePlayer(); // 保险：清理残留会话

    const root = document.getElementById('player-root');
    if (!root) return;

    session = {
      plan: plan,
      steps: steps,
      idx: 0,
      state: 'ready',        // ready → running ⇄ paused → done
      remaining: 0,          // 当前倒计时剩余秒
      lastTick: 0,
      runSec: 0,             // 只累计未暂停运行秒数
      totalWork: steps.filter(function (s) { return s.kind === 'work'; }).length,
      doneWork: 0,
      doneItemIdx: {},       // itemIdx → 至少完成一组
      trackSec: { wrist: 0, legs: 0, cardio: 0, backhand: 0 },
      ui: null,
      el: null
    };

    root.hidden = false;
    root.classList.add('player-overlay');
    buildSkeleton(root, plan);
    renderStart();
  }

  /** 播放器是否正在展示 */
  function isActive() {
    const root = document.getElementById('player-root');
    return !!(session && root && !root.hidden);
  }

  BMF.player = { open: open, isActive: isActive };
})();
