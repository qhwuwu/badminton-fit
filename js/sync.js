window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · sync.js
   计划同步（纯本地，无任何外网请求）：
   - 口令码：BMF1: + Base64URL(UTF-8 紧凑 JSON)，短键省体积
   - 生成二维码（vendor/qrcode-generator）+ 复制口令
   - 扫码导入（BarcodeDetector 优先，jsQR 兜底）/ 粘贴口令导入
   - 导出自包含「训练卡」单文件 HTML（内嵌简化跟练器）
   注意：本脚本在 app.js 之后加载（index.html 已保证 defer 顺序）。
   ===================================================== */
(function () {
  const BMF = window.BMF;

  /* ---------- 常量 ---------- */
  const CODE_PREFIX = 'BMF1:';                    // 口令前缀（版本 1）
  const QR_WARN_LEN = 2500;                       // 超过该长度提示扫码困难
  const CODE_RE = /BMF1:[A-Za-z0-9_\-]+/;         // 从粘贴文本中提取口令
  const PHASE_NAME = { warmup: '热身', main: '主训', cooldown: '放松' };

  /* ---------- 模块内样式（注入一次，不改动 style.css） ---------- */
  const SYNC_CSS = [
    '.sync-card{margin-top:14px}',
    '.sync-card-title{font-size:16px;font-weight:700}',
    '.sync-desc{font-size:13px;color:var(--text-dim);margin:6px 0 12px}',
    '.sync-btns{display:flex;flex-direction:column;gap:10px}',
    '.sync-src-row{display:flex;align-items:center;gap:12px;padding:10px 2px;min-height:48px;cursor:pointer;border-top:1px solid var(--border)}',
    '.sync-src-list .sync-src-row:first-child{border-top:none}',
    '.sync-hint{font-size:12px;color:var(--text-dim);margin:10px 0 0}',
    '.sync-warn{font-size:12px;color:#FFB74D;margin:10px 0 0}',
    '.bmf-qr-wrap{display:flex;justify-content:center;margin-bottom:12px}',
    '.bmf-qr-box{background:#fff;padding:12px;border-radius:8px;max-width:280px;line-height:0}', // 白色内衬底保证深色主题下扫码对比度
    '.bmf-qr-box svg{display:block;max-width:100%;height:auto}',
    '.sync-code-ta{display:block;width:100%;min-height:76px;margin-top:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);font-size:12px;font-family:inherit;resize:vertical;word-break:break-all;outline:none}',
    '.sync-copy-btn{margin-top:10px}',
    '.sync-paste-label{font-size:13px;color:var(--text-dim);margin:12px 0 0}',
    '.sync-status{font-size:13px;color:var(--text-dim);margin:0 0 10px}',
    '.sync-video{display:block;width:100%;max-height:300px;min-height:180px;background:#000;border-radius:12px;object-fit:cover}',
    '.sync-preview-sum{font-size:14px;margin:0 0 10px}',
    '.sync-preview-list li{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--border);font-size:14px}',
    '.sync-preview-list li:first-child{border-top:none}',
    '.sync-preview-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sync-preview-more{font-size:12px;color:var(--text-dim)}'
  ].join('');
  function injectCss() {
    if (document.getElementById('bmf-sync-style')) return;
    const s = document.createElement('style');
    s.id = 'bmf-sync-style';
    s.textContent = SYNC_CSS;
    document.head.appendChild(s);
  }

  /* ---------- 小工具 ---------- */

  /** 建元素并挂 class */
  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /** 按 exId 查动作详情（查不到返回 null） */
  function findEx(id) {
    return ((BMF.data && BMF.data.exercises) || []).find(function (e) { return e.id === id; }) || null;
  }

  /** 大于 0 的有效数字，否则 0 */
  function num(v) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** 当前编辑草稿（planner.js 提供；可能未加载，需防御） */
  function getDraft() {
    try {
      if (BMF.planner && typeof BMF.planner.getDraft === 'function') {
        return BMF.planner.getDraft();
      }
    } catch (e) { /* 静默 */ }
    return null;
  }

  /** HTML 静态文本转义（用于训练卡内联内容） */
  function htmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- Base64URL 编解码（UTF-8 安全） ---------- */

  /** 字节数组 → Base64URL（+→- /→_ 去 =） */
  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Base64URL → 字节数组（还原 -_ 与填充） */
  function b64urlToBytes(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* =====================================================
     口令码：plan ⇄ BMF1:Base64URL(UTF-8 JSON)
     紧凑格式：{v:1,d:日期,t:标题,m:总分钟,f:focus数组,
               i:[[exId,phase,sets,workSec,restSec,reps],...]}
     ===================================================== */

  /** plan → 口令码字符串（BMF1:xxx），无副作用 */
  function encodePlan(plan) {
    const p = plan || {};
    const items = (Array.isArray(p.items) ? p.items : [])
      .filter(function (it) { return it && typeof it.exId === 'string' && it.exId; })
      .map(function (it) {
        return [
          it.exId,
          (it.phase === 'warmup' || it.phase === 'cooldown') ? it.phase : 'main',
          Math.round(num(it.sets)),
          Math.round(num(it.workSec)),
          Math.round(num(it.restSec)),
          Math.round(num(it.reps))
        ];
      });
    const payload = {
      v: 1,
      d: (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) ? p.date : BMF.today(),
      t: typeof p.title === 'string' ? p.title : '',
      m: Math.round(num(p.totalMin)),
      f: (Array.isArray(p.focus) ? p.focus : []).filter(function (x) { return typeof x === 'string'; }),
      i: items
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)); // UTF-8 中文安全
    return CODE_PREFIX + bytesToB64url(bytes);
  }

  /**
   * 口令码 → plan（严格校验，非法抛 Error，message 为中文提示）
   * id：payload 内带 id 则沿用，否则生成新 uuid；date 沿用 payload 的 d。
   */
  function decodeCode(str) {
    if (typeof str !== 'string' || str.indexOf(CODE_PREFIX) !== 0) {
      throw new Error('口令格式不正确（缺少 BMF1: 前缀）');
    }
    const b64 = str.slice(CODE_PREFIX.length);
    if (!b64 || !/^[A-Za-z0-9_\-]+$/.test(b64)) {
      throw new Error('口令包含非法字符');
    }
    let payload;
    try {
      const json = new TextDecoder('utf-8', { fatal: true }).decode(b64urlToBytes(b64)); // 非法 UTF-8 在此抛错
      payload = JSON.parse(json);
    } catch (e) {
      throw new Error('口令解析失败，内容可能不完整');
    }
    if (!payload || typeof payload !== 'object' || payload.v !== 1) {
      throw new Error('口令版本无法识别');
    }
    if (typeof payload.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.d)) {
      throw new Error('口令中的日期不合法');
    }
    if (typeof payload.t !== 'string') {
      throw new Error('口令中的标题不合法');
    }
    if (payload.f !== undefined && !Array.isArray(payload.f)) {
      throw new Error('口令中的板块字段不合法');
    }
    if (!Array.isArray(payload.i) || !payload.i.length) {
      throw new Error('口令中没有动作内容');
    }
    const items = [];
    for (let k = 0; k < payload.i.length; k++) {
      const row = payload.i[k];
      if (!Array.isArray(row) || row.length !== 6) throw new Error('动作条目结构不合法');
      const exId = row[0], phase = row[1];
      if (typeof exId !== 'string' || !exId) throw new Error('动作条目缺少动作编号');
      if (phase !== 'warmup' && phase !== 'main' && phase !== 'cooldown') throw new Error('动作阶段不合法');
      const nums = [row[2], row[3], row[4], row[5]];
      for (let j = 0; j < 4; j++) {
        const n = Number(nums[j]);
        if (!isFinite(n) || n < 0) throw new Error('动作数值不合法');
      }
      items.push({
        exId: exId, phase: phase,
        sets: Math.round(Number(row[2])),
        workSec: Math.round(Number(row[3])),
        restSec: Math.round(Number(row[4])),
        reps: Math.round(Number(row[5]))
      });
    }
    return {
      id: (typeof payload.id === 'string' && payload.id) ? payload.id : BMF.uuid(),
      date: payload.d,
      title: payload.t || '同步计划',
      totalMin: Math.round(num(payload.m)),
      focus: (Array.isArray(payload.f) ? payload.f : []).filter(function (x) { return typeof x === 'string'; }),
      items: items
      // createdAt / updatedAt 由 store.savePlan 自动补
    };
  }

  /* =====================================================
     #sync-root 渲染：同步到手机卡片（每次切入 plan 页重渲染）
     ===================================================== */
  function renderSyncRoot() {
    const root = document.getElementById('sync-root');
    if (!root) return;
    injectCss();
    root.innerHTML = '';

    const card = el('div', 'card sync-card');
    const title = el('div', 'sync-card-title');
    title.textContent = '同步到手机';
    const desc = el('p', 'sync-desc');
    desc.textContent = '在电脑上制定计划，手机扫码或粘贴口令即可跟练，全程离线。';

    const btns = el('div', 'sync-btns');
    function mkBtn(label, primary, fn) {
      const b = el('button', 'btn btn-block' + (primary ? ' btn-primary' : ''));
      b.type = 'button';
      b.textContent = label; // .btn 自带 min-height:48px
      b.addEventListener('click', fn);
      return b;
    }
    btns.append(
      mkBtn('生成同步码', true, function () {
        openPlanPicker('生成二维码', openQrModal);
      }),
      mkBtn('扫码 / 粘贴导入', false, openScanModal),
      mkBtn('导出训练卡', false, function () {
        openPlanPicker('导出训练卡', exportCard);
      })
    );

    card.append(title, desc, btns);
    root.appendChild(card);
  }

  /* =====================================================
     计划来源选择弹窗（生成同步码 / 导出训练卡共用）
     单选：最近 10 个已保存计划 + 当前编辑草稿（可能不存在）
     默认选中：草稿 > 最近保存
     ===================================================== */
  function openPlanPicker(actionLabel, onConfirm) {
    injectCss();
    const draft = getDraft();
    const plans = BMF.store.getPlans().slice(0, 10);
    if (!draft && !plans.length) { BMF.toast('还没有可用的计划'); return; }

    const body = el('div');
    const list = el('div', 'sync-src-list');
    const NAME = 'bmf-sync-src';
    function row(value, title, sub, checked) {
      const lab = el('label', 'sync-src-row');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = NAME;
      input.value = value;
      input.checked = !!checked;
      const main = el('div', 'li-main');
      const t = el('div', 'li-title'); t.textContent = title;
      const s = el('div', 'li-sub'); s.textContent = sub;
      main.append(t, s);
      lab.append(input, main);
      return lab;
    }
    if (draft) {
      list.appendChild(row('__draft__', '当前编辑草稿',
        (draft.date || '未设日期') + ' · ' + (draft.title || '未命名计划'), true));
    }
    plans.forEach(function (p, i) {
      list.appendChild(row(p.id, p.date || '未设日期', p.title || '未命名计划', !draft && i === 0));
    });
    body.appendChild(list);
    if (draft) {
      const hint = el('p', 'sync-hint');
      hint.textContent = '「当前编辑草稿」为制定页正在编辑、尚未保存的内容。';
      body.appendChild(hint);
    }

    BMF.openModal({
      title: '选择计划',
      body: body,
      actions: [
        { label: '取消' },
        {
          label: actionLabel, primary: true,
          onClick: function () {
            const sel = list.querySelector('input[name="' + NAME + '"]:checked');
            if (!sel) { BMF.toast('请先选择一个计划'); return false; }
            let plan = null;
            if (sel.value === '__draft__') plan = getDraft();
            else plan = plans.find(function (p) { return p.id === sel.value; }) || null;
            if (!plan) { BMF.toast('未找到该计划'); return false; }
            if (!Array.isArray(plan.items) || !plan.items.length) {
              BMF.toast('该计划还没有动作内容');
              return false;
            }
            onConfirm(plan); // 校验通过后本弹窗自动关闭
          }
        }
      ]
    });
  }

  /* =====================================================
     生成同步码：二维码 + 口令文本 + 复制
     ===================================================== */

  /** 生成二维码 SVG 字符串；过长抛错由调用方兜底 */
  function makeQrSvg(code) {
    if (typeof qrcode === 'undefined') throw new Error('二维码组件未加载');
    const qr = qrcode(0, 'L'); // typeNumber 0 = 自动挑最小可容纳版本
    qr.addData(code);
    qr.make();
    const count = qr.getModuleCount();
    // 按模块数自适应 cellSize（目标显示区约 256px），常规计划落在 6-8
    const cell = Math.max(2, Math.min(8, Math.floor(256 / count)));
    return qr.createSvgTag(cell, Math.max(2, cell * 2));
  }

  /** 复制口令：clipboard API 优先，失败退回 execCommand */
  function copyCodeText(text, ta) {
    const OK = '口令已复制，可通过微信发送给手机';
    function fallback() {
      try {
        if (ta) { ta.focus(); ta.select(); }
        const ok = document.execCommand('copy');
        BMF.toast(ok ? OK : '复制失败，请长按口令手动复制');
      } catch (e) {
        BMF.toast('复制失败，请长按口令手动复制');
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { BMF.toast(OK); }, fallback);
    } else {
      fallback();
    }
  }

  function openQrModal(plan) {
    injectCss();
    const code = encodePlan(plan);
    const body = el('div');

    // 二维码（白色内衬底 + 限宽 280px）
    let svg = '';
    try { svg = makeQrSvg(code); } catch (e) { svg = ''; }
    if (svg) {
      const wrap = el('div', 'bmf-qr-wrap');
      const box = el('div', 'bmf-qr-box');
      box.innerHTML = svg;
      wrap.appendChild(box);
      body.appendChild(wrap);
    } else {
      const p = el('p', 'sync-hint');
      p.textContent = '内容过长，无法生成二维码，请使用下方口令粘贴导入。';
      body.appendChild(p);
    }

    // 口令文本 + 复制按钮
    const label = el('div', 'sync-paste-label');
    label.textContent = '口令文本';
    const ta = document.createElement('textarea');
    ta.className = 'sync-code-ta';
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.value = code;
    const copyBtn = el('button', 'btn btn-primary btn-block sync-copy-btn');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制口令';
    copyBtn.addEventListener('click', function () { copyCodeText(code, ta); });
    body.append(label, ta, copyBtn);

    // 容量警告（QR 容量友好阈值）
    if (code.length > QR_WARN_LEN) {
      const warn = el('p', 'sync-warn');
      warn.textContent = '内容较长（' + code.length + ' 字符），扫码可能困难，建议用口令粘贴或训练卡。';
      body.appendChild(warn);
    }
    const hint = el('p', 'sync-hint');
    hint.textContent = '手机端打开「羽力训练」→ 制定 → 扫码 / 粘贴导入';
    body.appendChild(hint);

    BMF.openModal({ title: '同步码', body: body, actions: [{ label: '关闭' }] });
  }

  /* =====================================================
     导入：扫码 / 粘贴共用 handleCode
     ===================================================== */

  /** 从任意文本中提取口令 → 解码 → 预览弹窗 */
  function handleCode(text) {
    const m = String(text == null ? '' : text).match(CODE_RE);
    if (!m) { BMF.toast('未识别到有效口令'); return; }
    let plan;
    try {
      plan = decodeCode(m[0]);
    } catch (e) {
      BMF.toast((e && e.message) || '口令无效');
      return;
    }
    openImportPreview(plan);
  }

  /** 导入预览：概要 + 前 12 条动作清单 → 保存 / 跟练 */
  function openImportPreview(plan) {
    injectCss();
    const body = el('div');
    const sum = el('p', 'sync-preview-sum');
    sum.textContent = plan.title + ' · ' + plan.date + ' · ' +
      plan.totalMin + ' 分钟 · ' + plan.items.length + ' 个动作';
    body.appendChild(sum);

    const ul = el('ul', 'sync-preview-list');
    plan.items.slice(0, 12).forEach(function (it) {
      const li = document.createElement('li');
      const tag = el('span', 'badge');
      const edge = it.phase === 'warmup' || it.phase === 'cooldown';
      tag.style.setProperty('--badge', edge ? '#90A4AE' : '#C8F135');
      tag.style.setProperty('--badge-ink', '#0B0B0F');
      tag.textContent = PHASE_NAME[it.phase] || '主训';
      const name = el('span', 'sync-preview-name');
      const ex = findEx(it.exId);
      name.textContent = ex ? ex.name : (it.exId + '（动作已失效）');
      li.append(tag, name);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    if (plan.items.length > 12) {
      const more = el('p', 'sync-preview-more');
      more.textContent = '… 共 ' + plan.items.length + ' 个动作';
      body.appendChild(more);
    }

    BMF.openModal({
      title: '导入计划',
      body: body,
      actions: [
        { label: '取消' },
        { label: '导入并保存', primary: true, onClick: function () { return doImport(plan, false); } },
        { label: '导入并跟练', onClick: function () { return doImport(plan, true); } }
      ]
    });
  }

  /**
   * 执行导入：savePlan（同 id 覆盖更新）→ 广播 → toast；
   * follow=true 时打开跟练播放器（播放器已激活则仅 toast）。
   * 返回 false 可让预览弹窗保持打开（保存失败场景）。
   */
  function doImport(plan, follow) {
    const saved = BMF.store.savePlan(plan);
    if (!saved) { BMF.toast('保存失败，请重试'); return false; }
    BMF.emit('bmf:plan-updated', saved);
    BMF.toast('已导入计划');
    if (follow) {
      if (BMF.player && typeof BMF.player.isActive === 'function' && BMF.player.isActive()) {
        BMF.toast('已有跟练进行中，计划已保存');
        return;
      }
      if (BMF.player && typeof BMF.player.open === 'function') {
        BMF.player.open(saved);
      } else {
        BMF.toast('跟练模块未加载');
      }
    }
  }

  /* =====================================================
     扫码弹窗：BarcodeDetector 优先 / jsQR 兜底 / 都不支持提示粘贴
     弹窗底部常驻「手动粘贴口令」textarea + [识别口令]
     关闭弹窗或识别成功时停掉所有 track 并 clearInterval
     ===================================================== */
  let scanSession = null; // { stream, timer, closed }

  /** 停止扫码会话：清定时器 + 停全部媒体轨（幂等） */
  function stopScan() {
    if (!scanSession) return;
    if (scanSession.timer) { clearInterval(scanSession.timer); scanSession.timer = null; }
    if (scanSession.stream) {
      scanSession.stream.getTracks().forEach(function (t) {
        try { t.stop(); } catch (e) { /* 静默 */ }
      });
      scanSession.stream = null;
    }
    scanSession.closed = true;
    scanSession = null;
  }

  function openScanModal() {
    injectCss();
    const body = el('div');

    const status = el('p', 'sync-status');
    status.textContent = '正在启动摄像头…';
    const video = document.createElement('video');
    video.className = 'sync-video';
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    const canvas = document.createElement('canvas'); // jsQR 帧识别用，隐藏
    canvas.hidden = true;

    const pasteLabel = el('div', 'sync-paste-label');
    pasteLabel.textContent = '手动粘贴口令（扫码不可用时使用）';
    const ta = document.createElement('textarea');
    ta.className = 'sync-code-ta';
    ta.spellcheck = false;
    ta.placeholder = '粘贴包含 BMF1: 口令的文本…';
    const pasteBtn = el('button', 'btn btn-block sync-copy-btn');
    pasteBtn.type = 'button';
    pasteBtn.textContent = '识别口令';

    body.append(status, video, canvas, pasteLabel, ta, pasteBtn);

    scanSession = { stream: null, timer: null, closed: false };
    let modalClose = null;

    /** 识别到内容（扫码或粘贴）→ 停资源 → 关弹窗 → 进入导入流程 */
    function finish(raw) {
      if (!scanSession || scanSession.closed) return;
      stopScan();
      if (modalClose) modalClose();
      handleCode(raw);
    }

    pasteBtn.addEventListener('click', function () {
      const val = (ta.value || '').trim();
      if (!val) { BMF.toast('请先粘贴口令文本'); return; }
      if (!CODE_RE.test(val)) { BMF.toast('未识别到有效口令（需含 BMF1:）'); return; } // 保持弹窗打开便于修改
      finish(val);
    });

    /** 不支持扫码：仅提示，不弹 toast */
    function unsupported(msg) {
      if (!scanSession || scanSession.closed) return;
      status.textContent = msg;
      video.hidden = true;
    }
    /** 摄像头失败/异常：toast + 自动切到手动粘贴 */
    function camError(name) {
      if (!scanSession || scanSession.closed) return;
      status.textContent = '摄像头不可用（' + name + '），请在下方粘贴口令导入。';
      video.hidden = true;
      BMF.toast('无法打开摄像头，请粘贴口令导入');
      try { ta.focus(); } catch (e) { /* 静默 */ }
    }

    modalClose = BMF.openModal({
      title: '扫码 / 粘贴导入',
      body: body,
      actions: [{ label: '关闭' }],
      onClose: stopScan // 按钮 / 遮罩任意方式关闭都释放资源
    });

    startCamera(video, canvas, status, finish, unsupported, camError);
  }

  /**
   * 启动摄像头并循环识别（300ms 一帧）：
   * 优先 BarcodeDetector（直接喂 video）；否则 jsQR（帧画到 canvas）。
   */
  function startCamera(video, canvas, status, onCode, onUnsupported, onCameraError) {
    let detector = null;
    if ('BarcodeDetector' in window) {
      try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
      catch (e) { detector = null; }
    }
    const hasJsQr = typeof window.jsQR !== 'undefined';
    if (!detector && !hasJsQr) {
      onUnsupported('当前浏览器不支持扫码，请使用粘贴口令导入。');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onUnsupported('当前环境无法调用摄像头，请使用粘贴口令导入。');
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        if (!scanSession || scanSession.closed) { // 弹窗已提前关闭：立即释放
          stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* 静默 */ } });
          return null;
        }
        scanSession.stream = stream;
        video.srcObject = stream;
        return video.play();
      })
      .then(function () {
        if (!scanSession || scanSession.closed) return;
        status.textContent = '将二维码对准摄像头，识别后自动导入';

        if (detector) {
          // 路线 1：BarcodeDetector 原生识别
          scanSession.timer = setInterval(function () {
            if (!scanSession || scanSession.closed) return;
            try {
              detector.detect(video).then(function (codes) {
                if (codes && codes.length && scanSession && !scanSession.closed) {
                  const v = codes[0] && codes[0].rawValue;
                  if (v) onCode(v);
                }
              }).catch(function () { /* 单帧失败忽略 */ });
            } catch (e) { /* 单帧异常忽略 */ }
          }, 300);
        } else {
          // 路线 2：jsQR 逐帧识别
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          scanSession.timer = setInterval(function () {
            if (!scanSession || scanSession.closed) return;
            const w = video.videoWidth, h = video.videoHeight;
            if (!w || !h || video.readyState < 2) return;
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            try {
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const res = window.jsQR(img.data, w, h);
              if (res && res.data) onCode(res.data);
            } catch (e) { /* 单帧异常忽略 */ }
          }, 300);
        }
      })
      .catch(function (err) {
        if (!scanSession || scanSession.closed) return;
        onCameraError((err && err.name) || '异常');
      });
  }

  /* =====================================================
     导出训练卡：自包含单文件 HTML（零外部依赖，可双击离线打开）
     内嵌：口令 payload + 动作信息 + 简化跟练器 + 导入主应用
     注意：卡内内联脚本一律不用反引号与 ${}，避免模板字符串转义问题
     ===================================================== */

  function buildCardHtml(plan) {
    const code = encodePlan(plan);
    const items = plan.items || [];
    const title = plan.title || '羽力训练卡';
    const date = plan.date || BMF.today();

    // 内嵌动作信息：仅本计划用到的（id → 名称/类型），供卡内跟练器展开步骤
    const exInfo = {};
    items.forEach(function (it) {
      const ex = findEx(it.exId);
      if (ex && !exInfo[it.exId]) {
        exInfo[it.exId] = { name: ex.name, type: ex.type === 'reps' ? 'reps' : 'timed' };
      }
    });

    // 动作清单：导出时静态渲染（卡内无需查表），未知动作标注失效
    const rows = items.map(function (it) {
      const ex = findEx(it.exId);
      const name = ex ? ex.name : (it.exId + '（动作已失效）');
      const edge = it.phase === 'warmup' || it.phase === 'cooldown';
      const unit = (num(it.reps) > 0)
        ? (it.sets + ' 组 × ' + it.reps + ' 次')
        : ((it.sets || 0) + ' 组 × ' + (it.workSec || 0) + ' 秒');
      return '<li><span class="tag' + (edge ? '' : ' main') + '">' + (PHASE_NAME[it.phase] || '主训') + '</span>' +
        '<span class="ex-name">' + htmlEsc(name) + '</span>' +
        '<span class="ex-sets">' + htmlEsc(unit) + '</span></li>';
    }).join('');

    // JSON 内嵌前转义 <，防止 </script> 提前截断
    const exJson = JSON.stringify(exInfo).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<!-- 羽力训练卡：自包含单文件，零外部依赖，可离线双击打开 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0B0F">
<meta name="color-scheme" content="dark">
<title>羽力训练卡 · ${htmlEsc(title)}</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{background:#0B0B0F;color:#F2F2F5;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:480px;margin:0 auto;padding:24px 16px calc(36px + env(safe-area-inset-bottom))}
h1{font-size:22px;font-weight:800;margin:0 0 4px}
h2{font-size:16px;font-weight:700;margin:0 0 6px}
.meta{font-size:13px;color:#9A9AA5}
.card{background:#15151C;border-radius:16px;padding:16px;margin-top:14px}
.exlist li{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.07);font-size:14px}
.exlist li:first-child{border-top:none}
.tag{flex-shrink:0;display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;line-height:1.6;background:#2A2A33;color:#F2F2F5;white-space:nowrap}
.tag.main{background:#C8F135;color:#0B0B0F;font-weight:600}
.ex-name{flex:1;min-width:0}
.ex-sets{flex-shrink:0;color:#9A9AA5;font-size:12px}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;width:100%;margin-top:12px;padding:0 20px;border:none;border-radius:12px;font-size:16px;font-weight:600;font-family:inherit;background:#1E1E28;color:#F2F2F5;cursor:pointer}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.45;pointer-events:none}
.btn-primary{background:#C8F135;color:#0B0B0F;font-weight:700}
.btn-ghost{background:transparent;border:1.5px solid #9A9AA5}
summary{cursor:pointer;font-size:15px;font-weight:700}
textarea{display:block;width:100%;min-height:80px;margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:#1E1E28;color:#F2F2F5;font-size:12px;font-family:inherit;resize:vertical;word-break:break-all}
.tip{font-size:12px;color:#9A9AA5;margin:10px 0 0}
.err{font-size:13px;color:#FF5C5C;margin:10px 0 0}
.timer-big{font-size:64px;font-weight:800;line-height:1.15;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:1px}
#player{position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;background:#0B0B0F;padding:calc(14px + env(safe-area-inset-top)) 18px calc(20px + env(safe-area-inset-bottom));overflow-y:auto}
#player[hidden]{display:none}
.pl-top{display:flex;align-items:center;gap:8px}
.pl-title{flex:1;min-width:0;font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-close{width:48px;height:48px;flex-shrink:0;margin-right:-10px;border:none;border-radius:12px;background:transparent;color:#F2F2F5;font-size:20px;cursor:pointer}
.pl-close:active{background:#1E1E28}
.pl-bar{height:4px;flex-shrink:0;border-radius:2px;background:#1E1E28;overflow:hidden;margin:4px 0 12px}
.pl-bar-val{height:100%;width:0;background:#C8F135;transition:width .3s ease}
.pl-inner{flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;margin:auto 0;width:100%}
.pl-tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;background:#C8F135;color:#0B0B0F;font-weight:600}
.pl-tag.edge{background:#2A2A33;color:#F2F2F5}
.pl-name{font-size:20px;font-weight:700;line-height:1.35}
.pl-sub{font-size:13px;color:#9A9AA5}
.pl-check{width:88px;height:88px;display:flex;align-items:center;justify-content:center;font-size:52px;font-weight:800;color:#0B0B0F;background:#C8F135;border-radius:50%}
.pl-stats{font-size:14px;color:#9A9AA5}
.pl-stats b{color:#F2F2F5;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <div id="intro">
    <h1>${htmlEsc(title)}</h1>
    <div class="meta">${htmlEsc(date)} · 约 ${Math.round(num(plan.totalMin))} 分钟 · ${items.length} 个动作</div>
    <div class="card">
      <h2>动作清单</h2>
      <ul class="exlist">${rows}</ul>
    </div>
    <details class="card">
      <summary>口令码（可复制回传电脑端）</summary>
      <textarea id="code-ta" readonly spellcheck="false">${code}</textarea>
      <button id="copy-btn" class="btn" type="button">复制口令</button>
    </details>
    <button id="start-btn" class="btn btn-primary" type="button">开始跟练</button>
    <button id="import-btn" class="btn" type="button">导入到羽力训练</button>
    <p class="err" id="data-error" hidden>口令数据已损坏，无法跟练或导入。</p>
    <p class="tip" id="import-tip" hidden></p>
    <p class="tip">本卡片为独立文件，可离线双击打开，无需联网。</p>
  </div>
  <div id="player" hidden>
    <div class="pl-top">
      <div class="pl-title">${htmlEsc(title)}</div>
      <button class="pl-close" id="pl-close" type="button" aria-label="退出跟练">✕</button>
    </div>
    <div class="pl-bar"><div class="pl-bar-val" id="pl-bar-val"></div></div>
    <div class="pl-inner" id="pl-body"></div>
  </div>
</div>
<script id="bmf-payload" type="text/plain" data-plan-id="${htmlEsc(plan.id || '')}">${code}</script>
<script id="bmf-exinfo" type="application/json">${exJson}</script>
<script>
/* 羽力训练卡 · 卡内逻辑（自包含，不依赖任何外部资源） */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function b64uToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function fmtSec(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  function genId() {
    return 'bmf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  function phaseName(p) {
    return p === 'warmup' ? '热身' : p === 'cooldown' ? '放松' : '主训';
  }

  /* ---------- 读取并解码内嵌口令 ---------- */
  var payload = null;
  var exInfo = {};
  try {
    var raw = ($('bmf-payload').textContent || '').replace(/^\\s+|\\s+$/g, '');
    if (raw.indexOf('BMF1:') !== 0) throw new Error('prefix');
    var json = new TextDecoder('utf-8').decode(b64uToBytes(raw.slice(5)));
    payload = JSON.parse(json);
    if (!payload || payload.v !== 1 || !payload.i || !payload.i.length) throw new Error('payload');
    exInfo = JSON.parse($('bmf-exinfo').textContent) || {};
  } catch (e) { payload = null; }

  var PLAN_ID = $('bmf-payload').getAttribute('data-plan-id') || genId();
  var ITEMS = payload ? payload.i : [];

  function itemName(id) {
    return (exInfo[id] && exInfo[id].name) || (id + '（动作已失效）');
  }

  /* ---------- 复制口令（clipboard 优先，execCommand 兜底） ---------- */
  $('copy-btn').onclick = function () {
    var ta = $('code-ta');
    function mark() {
      var b = $('copy-btn');
      b.textContent = '已复制 ✓';
      setTimeout(function () { b.textContent = '复制口令'; }, 1600);
    }
    function fallback() {
      try {
        ta.focus();
        ta.select();
        document.execCommand('copy');
        mark();
      } catch (e) { alert('复制失败，请长按口令文本手动复制'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(mark, fallback);
    } else { fallback(); }
  };

  /* ---------- 导入到主应用（同键 'bmf.v1.plans' 同结构，upsert） ---------- */
  $('import-btn').onclick = function () {
    if (!payload) { alert('口令数据已损坏，无法导入'); return; }
    try {
      var plan = {
        id: PLAN_ID,
        date: payload.d,
        title: payload.t || '训练卡计划',
        totalMin: payload.m || 0,
        focus: payload.f || [],
        items: ITEMS.map(function (r) {
          return { exId: r[0], phase: r[1], sets: r[2], workSec: r[3], restSec: r[4], reps: r[5] };
        }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      var arr = [];
      try {
        var saved = localStorage.getItem('bmf.v1.plans');
        var parsed = saved ? JSON.parse(saved) : [];
        if (Array.isArray(parsed)) arr = parsed;
      } catch (e2) { arr = []; }
      var hit = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === PLAN_ID) { hit = i; break; }
      }
      if (hit >= 0) {
        plan.createdAt = arr[hit].createdAt || plan.createdAt;
        arr[hit] = plan;
      } else {
        arr.push(plan);
      }
      localStorage.setItem('bmf.v1.plans', JSON.stringify(arr));
      var tip = $('import-tip');
      tip.hidden = false;
      tip.textContent = '已导入，请在同一浏览器打开主应用查看';
    } catch (e3) {
      alert('当前环境不支持本地存储，无法导入主应用；训练卡本身仍可跟练。');
    }
  };

  /* ---------- 简化跟练器（与主应用同规则展开步骤） ---------- */
  var steps = [], idx = 0, totalWork = 0, doneWork = 0;
  var doneItems = {}, runSec = 0, lastTick = 0, timer = null, remaining = 0, playing = false;

  function expandSteps() {
    var works = [];
    ITEMS.forEach(function (r) {
      if (!exInfo[r[0]]) return; /* 查不到详情的动作整体跳过（同主应用规则） */
      var sets = Math.max(1, Math.round(Number(r[2]) || 1));
      var workSec = Math.max(1, Math.round(Number(r[3]) || 30));
      var restSec = Math.max(0, Math.round(Number(r[4]) || 0));
      var reps = Math.max(0, Math.round(Number(r[5]) || 0));
      var timed = exInfo[r[0]].type !== 'reps';
      for (var s = 1; s <= sets; s++) {
        works.push({ kind: 'work', exId: r[0], phase: r[1], setIndex: s,
          totalSets: sets, workSec: workSec, restSec: restSec, reps: reps, timed: timed });
      }
    });
    var out = [];
    works.forEach(function (w, i) {
      out.push(w);
      if (i < works.length - 1 && w.restSec > 0) out.push({ kind: 'rest', sec: w.restSec });
    });
    return out;
  }

  function updateBar() {
    var pct = totalWork ? (doneWork / totalWork) * 100 : 0;
    $('pl-bar-val').style.width = pct + '%';
  }

  function enterStep(i) {
    idx = i;
    var st = steps[i];
    remaining = st.kind === 'rest' ? st.sec : (st.timed ? st.workSec : 0);
    renderStep();
  }

  function renderStep() {
    var st = steps[idx];
    var html = '';
    if (st.kind === 'work') {
      var edge = st.phase === 'warmup' || st.phase === 'cooldown';
      html += '<div class="pl-tag' + (edge ? ' edge' : '') + '">' + phaseName(st.phase) + '</div>';
      html += '<div class="pl-name">' + esc(itemName(st.exId)) + '</div>';
      html += '<div class="pl-sub">第 ' + st.setIndex + ' / ' + st.totalSets + ' 组</div>';
      if (st.timed) {
        /* 计时型：大号倒计时，到 0 自动进入下一步 */
        html += '<div class="timer-big" id="pl-num">' + Math.max(0, Math.ceil(remaining)) + '</div>';
      } else {
        /* 计次型：目标次数 + 完成按钮 */
        html += '<div class="timer-big">' + (st.reps || '—') + '</div>';
        html += '<div class="pl-sub">按建议节奏完成 ' + (st.reps || '') + ' 次</div>';
        html += '<button class="btn btn-primary" id="pl-act" type="button">完成一组</button>';
      }
    } else {
      /* 休息：自动倒计时 + 跳过 */
      html += '<div class="pl-name">休息一下</div>';
      html += '<div class="timer-big" id="pl-num">' + Math.max(0, Math.ceil(remaining)) + '</div>';
      html += '<button class="btn btn-ghost" id="pl-act" type="button">跳过休息</button>';
      var nx = steps[idx + 1];
      if (nx && nx.kind === 'work') {
        html += '<div class="pl-sub">下一个：' + esc(itemName(nx.exId)) + '（第 ' + nx.setIndex + ' 组）</div>';
      }
    }
    $('pl-body').innerHTML = html;
    var act = $('pl-act');
    if (act) act.onclick = advance;
    updateBar();
  }

  function advance() {
    var st = steps[idx];
    if (st && st.kind === 'work') {
      doneWork++;
      doneItems[st.exId] = true;
      updateBar();
    }
    if (idx + 1 >= steps.length) { finish(); return; }
    enterStep(idx + 1);
  }

  /* 计时用 Date.now() 差值校正（后台回来一跳补齐，与主应用一致） */
  function tick() {
    var st = steps[idx];
    if (!st) return;
    var now = Date.now();
    var delta = (now - lastTick) / 1000;
    lastTick = now;
    if (delta <= 0) return;
    runSec += delta;
    if (st.kind === 'rest' || st.timed) {
      remaining -= delta;
      if (remaining <= 0) { advance(); return; }
      var num = $('pl-num');
      if (num) num.textContent = Math.max(0, Math.ceil(remaining));
    }
  }

  function startTimer() {
    stopTimer();
    lastTick = Date.now();
    timer = setInterval(tick, 1000);
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function finish() {
    stopTimer();
    playing = false;
    updateBar();
    var html = '';
    html += '<div class="pl-check">✓</div>';
    html += '<div class="pl-name">训练完成！</div>';
    html += '<div class="pl-stats">用时 <b>' + fmtSec(runSec) + '</b> · 完成 <b>' + Object.keys(doneItems).length + ' / ' + ITEMS.length + '</b> 个动作</div>';
    html += '<button class="btn btn-primary" id="pl-again" type="button">再练一次</button>';
    $('pl-body').innerHTML = html;
    $('pl-again').onclick = startPlay;
  }

  function startPlay() {
    if (!payload) { alert('口令数据已损坏，无法跟练'); return; }
    steps = expandSteps();
    if (!steps.length) { alert('计划中的动作都无法识别，无法跟练'); return; }
    idx = 0; doneWork = 0; doneItems = {}; runSec = 0; playing = true;
    totalWork = 0;
    steps.forEach(function (s) { if (s.kind === 'work') totalWork++; });
    $('intro').hidden = true;
    $('player').hidden = false;
    $('pl-title').textContent = payload.t || '跟练训练';
    enterStep(0);
    startTimer();
  }

  $('start-btn').onclick = startPlay;

  $('pl-close').onclick = function () {
    if (playing && !window.confirm('退出跟练？进度不会保存')) return;
    stopTimer();
    playing = false;
    $('player').hidden = true;
    $('intro').hidden = false;
  };

  if (!payload) {
    $('start-btn').disabled = true;
    $('import-btn').disabled = true;
    $('data-error').hidden = false;
  }
})();
</script>
</body>
</html>`;
  }

  /** 组装并下载训练卡（文件名含日期），报告总长度 */
  function exportCard(plan) {
    const html = buildCardHtml(plan);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.download = '羽力训练卡_' + (plan.date || BMF.today()) + '.html';
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    console.log('[bmf] 训练卡已生成，字符串总长度：' + html.length + ' 字符');
    BMF.toast('已导出训练卡（' + html.length + ' 字符）');
  }

  /* =====================================================
     包装 showPage：切入 plan 页时渲染 #sync-root
     （不改 app.js；本脚本在 app.js 之后加载，index.html 已保证）
     ===================================================== */
  const _show = BMF.showPage.bind(BMF);
  BMF.showPage = function (id) {
    _show(id);
    if (id === 'plan') renderSyncRoot();
  };

  /* ---------- 暴露全局 API ---------- */
  BMF.sync = {
    encodePlan: encodePlan,   // plan → 'BMF1:xxx'
    decodeCode: decodeCode,  // 'BMF1:xxx' → plan（非法抛 Error）
    renderSyncRoot: renderSyncRoot
  };
})();
