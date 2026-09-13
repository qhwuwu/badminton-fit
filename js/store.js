window.BMF = window.BMF || {};
/* =====================================================
   羽力训练 · store.js
   本地存储层：计划 / 训练记录 / 设置
   所有 localStorage 读写均 try/catch（兼容 file:// 隐私模式等场景）
   ===================================================== */
(function () {
  const BMF = window.BMF;

  // localStorage 键名（项目契约约定）
  const KEYS = {
    plans: 'bmf.v1.plans',
    logs: 'bmf.v1.logs',
    settings: 'bmf.v1.settings'
  };

  // 设置默认值
  const DEFAULT_SETTINGS = {
    theme: 'dark',
    userEquip: { none: 1, weight: 1, dumbbell: 1, rope: 1, racket: 1, bed: 1, towel: 1, court: 0 }
  };

  /** 安全读取：解析失败或不存在时返回 fallback */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (e) {
      return fallback;
    }
  }

  /** 安全写入：失败（配额/隐私模式）时静默返回 false */
  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      return false;
    }
  }

  const store = {
    /* ---------- 计划 ---------- */

    /** 全部计划，按 updatedAt 倒序（最近编辑在前） */
    getPlans() {
      const arr = read(KEYS.plans, []);
      if (!Array.isArray(arr)) return [];
      return arr.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    /** 保存计划（upsert）：存在同 id 则覆盖，否则新增；自动刷新 updatedAt */
    savePlan(plan) {
      if (!plan || !plan.id) return null;
      const arr = read(KEYS.plans, []);
      if (!Array.isArray(arr)) return null;
      const now = Date.now();
      const idx = arr.findIndex(p => p && p.id === plan.id);
      const next = Object.assign({}, plan, {
        createdAt: plan.createdAt || (idx >= 0 ? arr[idx].createdAt : now),
        updatedAt: now
      });
      if (idx >= 0) arr[idx] = next;
      else arr.push(next);
      write(KEYS.plans, arr);
      return next;
    },

    /** 删除计划，返回是否删除成功 */
    deletePlan(id) {
      const arr = read(KEYS.plans, []);
      if (!Array.isArray(arr)) return false;
      const next = arr.filter(p => p && p.id !== id);
      write(KEYS.plans, next);
      return next.length !== arr.length;
    },

    /** 按日期取计划（'YYYY-MM-DD'）；同日多条时取 updatedAt 最新的一条 */
    getPlanByDate(date) {
      const arr = read(KEYS.plans, []);
      if (!Array.isArray(arr)) return null;
      const matched = arr.filter(p => p && p.date === date);
      if (!matched.length) return null;
      matched.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return matched[0];
    },

    /* ---------- 训练记录 ---------- */

    /** 全部训练记录，按 date 倒序（同日按 createdAt 倒序） */
    getLogs() {
      const arr = read(KEYS.logs, []);
      if (!Array.isArray(arr)) return [];
      return arr.slice().sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1; // 字符串日期直接比较
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    },

    /** 追加一条训练记录，自动补 id 与 createdAt，返回补全后的记录 */
    addLog(log) {
      const arr = read(KEYS.logs, []);
      if (!Array.isArray(arr)) return null;
      const item = Object.assign(
        { id: BMF.uuid ? BMF.uuid() : 'log-' + Date.now().toString(36), createdAt: Date.now() },
        log
      );
      arr.push(item);
      write(KEYS.logs, arr);
      return item;
    },

    /* ---------- 设置 ---------- */

    /** 读取设置（与默认值合并，userEquip 单独深合并一层） */
    getSettings() {
      const saved = read(KEYS.settings, null) || {};
      const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
      merged.userEquip = Object.assign({}, DEFAULT_SETTINGS.userEquip, saved.userEquip || {});
      return merged;
    },

    /** 更新设置：浅合并后整体写回，返回合并后的完整设置 */
    setSettings(patch) {
      const cur = store.getSettings();
      const next = Object.assign({}, cur, patch || {});
      if (patch && patch.userEquip) {
        next.userEquip = Object.assign({}, cur.userEquip, patch.userEquip);
      }
      write(KEYS.settings, next);
      return next;
    }
  };

  BMF.store = store;
})();
