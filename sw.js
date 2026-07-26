const CACHE_NAME = 'oprides-cache-v2';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css?v=1.2.1',
  '/js/app.js?v=1.2.1',
  '/js/auth.js',
  '/js/firebase.js',
  '/js/wallet.js',
  '/js/riderWallet.js',
  '/js/campus-data.js',
  '/js/campus-map.js',
  '/js/modules/biometrics.js',
  '/js/modules/campus-router.js',
  '/js/modules/map-manager.js',
  '/js/modules/ride-helpers.js',
  '/js/modules/rider.js',
  '/js/modules/scheduled-rides.js',
  '/js/modules/state.js',
  '/js/modules/student.js',
  '/js/modules/ui.js',
  '/css/variables.css?v=1.2.1',
  '/css/animations.css?v=1.2.1',
  '/css/base.css?v=1.2.1',
  '/css/auth.css?v=1.2.1',
  '/css/dashboard.css?v=1.2.1',
  '/css/map.css?v=1.2.1',
  '/css/components.css?v=1.2.1',
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap'
];

// install — precache all the assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// activate — clear out old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// fetch — stale-while-revalidate strategy
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // skip firestore, auth, paystack — those should always be fresh from network
  if (
    event.request.method !== 'GET' ||
    requestUrl.hostname.includes('firestore.googleapis.com') ||
    requestUrl.hostname.includes('identitytoolkit.googleapis.com') ||
    requestUrl.hostname.includes('securetoken.googleapis.com') ||
    requestUrl.hostname.includes('workers.dev') ||
    requestUrl.hostname.includes('paystack.com')
  ) {
    return; // let the browser handle it normally
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // update the cache with the latest version
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[SW] network failed, falling back to cache:', err);
        });

        // serve cache immediately, fetch in background
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// push notifications
self.addEventListener('push', (event) => {
  let data = { title: 'OpRides', body: 'New update on your ride!' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'OpRides', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// when user taps the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        const urlObj = new URL(client.url);
        if (urlObj.pathname === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/');
      }
    })
  );
});
