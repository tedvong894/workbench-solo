// 工作台·单机版 - Service Worker
// 与联网版缓存名完全隔离（solo- 前缀），两版互不影响
const CACHE_VERSION = 'solo-20261111-1129';
const CACHE = 'workbench-solo-shell-' + CACHE_VERSION;

const SHELL = [
  './',
  'index.html',
  'sw.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-512-flat.png',
  'apple-touch-icon.png'
];

// 2026-11-07：GitHub Pages 国内偶发「首字节 10 秒以上」，页面会白屏干等。
// 导航请求改为「网络 2.5 秒不回就立刻用缓存」，网络在后台继续更新缓存供下次打开。
const NAV_TIMEOUT = 2500;
const ADD_TIMEOUT = 8000;

function withTimeout(p, ms, fallback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (fallback !== undefined) resolve(fallback);
      else reject(new Error('timeout'));
    }, ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // index.html 不设超时：允许慢但最终成功，保证新缓存里一定有壳；
      // 其余资源 8 秒拿不到就跳过，不让 SW 安装被单个图标卡住
      .then((cache) => Promise.allSettled(SHELL.map((u) =>
        u === 'index.html' ? cache.add(u) : withTimeout(cache.add(u), ADD_TIMEOUT)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.match('index.html')).then((hasShell) => {
      // 只清本 app 的旧缓存（同域还有别的 app，不能全删）；
      // 新壳没缓存成功时保留旧缓存，让超时兜底始终有东西可用
      if (!hasShell) return self.clients.claim();
      return caches.keys()
        .then((keys) => Promise.all(keys
          .filter((k) => k !== CACHE && k.indexOf('workbench-solo-shell-') === 0)
          .map((k) => caches.delete(k))))
        .then(() => self.clients.claim());
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) { sameOrigin = false; }
  if (!sameOrigin) return;   // 跨域（字体等）透传，不拦截

  // 导航请求：有缓存就 2.5 秒超时兜底，页面立刻出来；无缓存（首次安装）只能等网络
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put('index.html', clone)).catch(() => {});
          }
          return res;
        });
        if (!cached) {
          return net.catch(() => new Response(
            '<!doctype html><meta charset="utf-8"><title>工作台</title>' +
            '<p style="font:14px/1.6 system-ui;padding:24px">首次加载超时，再打开一次即可（数据都在本机，不会丢）。</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          ));
        }
        // 超时或网络失败都用缓存；net 仍在后台跑，成功就顺手把缓存更新成新版
        return withTimeout(net, NAV_TIMEOUT, cached).catch(() => cached);
      })
    );
    return;
  }

  // 同源静态资源：缓存优先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
