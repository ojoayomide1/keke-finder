const CACHE_NAME = 'oprides-cache-v1';

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

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Stale-While-Revalidate Strategy)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Bypass caching for Firestore, authentication endpoints, or Paystack APIs
  if (
    event.request.method !== 'GET' ||
    requestUrl.hostname.includes('firestore.googleapis.com') ||
    requestUrl.hostname.includes('identitytoolkit.googleapis.com') ||
    requestUrl.hostname.includes('securetoken.googleapis.com') ||
    requestUrl.hostname.includes('workers.dev') ||
    requestUrl.hostname.includes('paystack.com')
  ) {
    return; // Fallback to default browser network fetching
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Cache the updated network response for next time if request was successful
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Network request failed; serving from cache fallback if available:', err);
        });

        // Return cached response instantly if available, else wait for network
        return cachedResponse || fetchPromise;
      });
    })
  );
});
