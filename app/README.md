# NavCamp

Campus navigation and transport app for Veritas University Abuja.
Built with Expo (React Native), Firebase, and Leaflet.

**Authors:** Ojo Ayomide Praise · Onuba Daniel Chukwuebuka

---

## What it does

- **Pathfinder** — walk route finder across campus. Search any location, get a routed path on the map.
- **Keke Rides** — on-demand shared keke rides between campus stops. Students request, riders accept. *(locked for MVP)*
- **Wallet** — in-app wallet funded via Paystack bank transfer. Used to pay for rides.
- **Campus Map** — live interactive map of Veritas: buildings, roads, walkways, facilities, pickup points.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile/Web App | Expo SDK 57, React Native 0.86, React 19 |
| Web Map | Leaflet + react-leaflet |
| State | Zustand |
| Backend/DB | Firebase Firestore |
| Auth | Firebase Auth |
| Payments | Paystack (via Cloudflare Worker webhook) |
| Push Notifications | Expo Notifications |
| Map Data | QGIS → GeoJSON → custom export pipeline |

---

## Repo Structure

```
app/
├── src/
│   ├── screens/
│   │   ├── auth/         # Login + signup
│   │   ├── student/      # Home, Map, Pathfinder, Wallet, Profile
│   │   └── rider/        # Home, Map, Earnings, Profile
│   ├── services/         # Firebase logic (student, rider, wallet, campus-data)
│   ├── navigation/       # Root navigator + role-based routing
│   ├── components/       # Shared components (MapView)
│   ├── store/            # Zustand global state
│   └── config/           # Firebase init
├── map-data/
│   ├── source/           # QGIS GeoJSON exports (buildings, roads, places, etc.)
│   └── exports/          # veritas-map.json — bundled into app at build time
├── tools/
│   └── indoor-editor/    # Local tool for editing indoor_places.json
├── cloudflare-worker/    # Paystack webhook + wallet top-up handler
├── server/               # Legacy VPS Express server (superseded by CF worker)
├── android/              # Expo bare Android project
├── firestore.indexes.json
├── firebase.json
└── AGENTS.md
```

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Original web-only version (legacy) |
| `expo-rewrite` | Current active branch — Expo React Native rewrite |

All active development happens on `expo-rewrite`.

---

## Local Setup

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Firebase CLI: `npm install -g firebase-tools`

### Install
```bash
cd app
npm install
```

### Run
```bash
# Expo dev server (iOS/Android/Web)
npm start

# Web only
npm run web

# Android
npm run android
```

---

## Environment

No `.env` file needed for the app itself — Firebase config is public and lives in
`src/config/firebase.js` (this is safe for client-side Firebase SDK).

The Cloudflare Worker needs secrets set via Wrangler:
```
PAYSTACK_SECRET_KEY
PROJECT_ID
SERVICE_ACCOUNT_EMAIL
SERVICE_ACCOUNT_PRIVATE_KEY
FIREBASE_WEB_API_KEY
```

Set them with:
```bash
wrangler secret put PAYSTACK_SECRET_KEY
```

---

## Map Data

Map data comes from QGIS, not Firestore. The pipeline is:

1. Edit campus features in QGIS (buildings, roads, walkways, places, entrances)
2. Export each layer as GeoJSON into `map-data/source/`
3. Run `npm run map:export` to bundle everything into `map-data/exports/veritas-map.json`
4. The app loads the bundled JSON at startup — no network request needed for map data

**Do not edit map data through the admin panel.** Use QGIS for geometry.
The admin panel only handles operational overrides (e.g. closing a road temporarily).

Indoor places (`indoor_places.json`) are edited via the indoor editor tool:
```bash
npm run indoor-editor
# opens http://localhost:3737
```

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `users` | All user profiles (students + riders). Role stored as `"student"` or `"rider"`. |
| `rides` | Active keke ride sessions created by riders |
| `rideRequests` | Student ride requests. Matched to rides by the matching algorithm |
| `waitingQueue` | Students queued when no rider is available |
| `riderStatus` | Rider online/offline status, last seen |
| `rideLocations` | Live rider GPS position (updated every few seconds) |
| `walletTransactions` | Full transaction log for all wallet credits and debits |
| `topUpRequests` | Paystack top-up sessions (pending → credited) |
| `adminWallet` | Running admin commission balance |
| `withdrawalRequests` | Rider payout requests |
| `campusData` | Legacy Firestore map data doc (disabled — bundled JSON is used instead) |
| `authorized_students` | Whitelist of valid matric numbers for signup verification |
| `authorized_riders` | Whitelist of valid plate numbers for rider signup |
| `support_requests` | In-app support tickets |
| `notifications` | Push notification records |

---

## Deploying Firestore Indexes

```bash
node %APPDATA%\npm\node_modules\firebase-tools\lib\bin\firebase.js \
  deploy --only firestore:indexes --project keke-finder-cd5fe
```

*(PowerShell blocks the `firebase` alias — use the full node path above on Windows)*

---

## Payments Architecture

```
Student taps "Top Up"
  → app calls Cloudflare Worker /paystack/create-virtual-account
  → Worker creates Paystack transaction, returns payment URL
  → Student completes payment in browser
  → Paystack fires charge.success webhook → Worker
  → Worker verifies signature, checks idempotency, credits wallet in Firestore
```

Webhook is live at: `https://navcamp-webhook.ojopraise423.workers.dev`

Ride fare split: ₦150 total → ₦100 to rider, ₦50 to admin commission.
