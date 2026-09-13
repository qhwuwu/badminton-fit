/* =====================================================
   羽力训练 · sw.js
   Service Worker：网络优先 + 缓存兜底（仅同源 GET）
   - 在线时始终取最新文件并回填缓存（个人应用频繁改动，避免旧版缓存卡死）
   - 离线时回退缓存，保证主屏图标离线可用
   ===================================================== */
const CACHE = 'bmf-v3';

// 预缓存清单（与 index.html 引用保持一致，含版本号参数）
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=2',
  './js/store.js?v=2',
  './js/data.js?v=2',
  './js/app.js?v=2',
  './js/planner.js?v=2',
  './js/library.js?v=2',
  './js/player.js?v=2',
  './js/sync.js?v=2',
  './js/progress.js?v=2',
  './js/vendor/qrcode.min.js?v=2',
  './js/vendor/jsqr.min.js?v=2'
];

/* 安装：逐个 cache.add 并容错（jsqr.min.js 等个别文件缺失时不会导致整体失败） */
self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(function (url) {
      return cache.add(url).catch(function () { /* 单个资源缺失时静默跳过 */ });
    }));
    await self.skipWaiting();
  })());
});

/* 激活：清理旧版本缓存 + 立即接管所有客户端 */
self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

/* 拦截请求：仅处理同源 GET；网络优先，失败回退缓存（离线兜底） */
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  e.respondWith((async function () {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      // 离线且未缓存
      return new Response('离线且资源未缓存', { status: 504, statusText: 'Offline' });
    }
  })());
});
