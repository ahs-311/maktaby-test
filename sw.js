/* مكتبي الإلكتروني — Service Worker (يعمل أونلاين وأوفلاين) */
const VERSION = "maktabi-v1.8.3-libadmin";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./mk-config.js",
  "./mk-cloud.js",
  "./mk-details.js",
  "./mk-editor.js",
  "./vendor/jszip.min.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./library/catalog.js",
  "./library/search-index.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // لا نتدخل في الطلبات الخارجية (واتساب، سحابة...)

  // صفحات التطبيق: الشبكة أولًا (لأخذ آخر تحديث) ثم النسخة المخزنة عند انقطاع الإنترنت
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then((r) => r || caches.match("./index.html"))
            .then((r) => r || caches.match("./"))
        )
    );
    return;
  }

  // باقي الملفات: من الذاكرة أولًا مع تحديثها في الخلفية
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});


/* إشعارات محلية عبر Service Worker (أندرويد/كروم) */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data.type === 'SHOW_NOTIFICATION') {
    const title = data.title || 'مكتبي';
    const options = Object.assign({
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: data.tag || ('mk-' + Date.now()),
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url: data.url || './' }
    }, data.options || {});
    event.waitUntil(
      self.registration.showNotification(title, options).catch((err) => {
        console.warn('SW showNotification failed', err);
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && 'focus' in c) {
          c.postMessage({ type: 'NOTIFICATION_CLICK', tag: event.notification.tag });
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});


/* Web Push — جاهز عند تفعيل الخادم ومفاتيح VAPID (لا يُرسل شيء قبل ذلك) */
self.addEventListener('push', (event) => {
  let payload = { title: 'مكتبي', body: 'لديك تنبيه جديد', url: './' };
  try {
    if (event.data) {
      const j = event.data.json();
      payload = Object.assign(payload, j);
    }
  } catch (e) {
    try { payload.body = event.data ? event.data.text() : payload.body; } catch (e2) {}
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'مكتبي', {
      body: payload.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: payload.tag || ('mk-push-' + Date.now()),
      data: { url: payload.url || './' },
      renotify: true,
      vibrate: [120, 60, 120]
    })
  );
});
