# NavCamp — Architecture Reference

Technical reference for developers joining the project.

---

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                  NavCamp App                        │
│         Expo / React Native (expo-rewrite)          │
│                                                     │
│  Student UI          Rider UI          Web (Leaflet)│
└────────────┬────────────────┬───────────────────────┘
             │                │
             ▼                ▼
┌─────────────────────────────────────────────────────┐
│                   Firebase                          │
│  ┌──────────────┐   ┌──────────────────────────┐   │
│  │  Auth        │   │  Firestore               │   │
│  │  (email/pw + │   │  (all app data, real-time│   │
│  │   biometric) │   │   listeners + offline    │   │
│  └──────────────┘   │   persistence)           │   │
│                     └──────────────────────────┘   │
└────────────────────────────┬────────────────────────┘
                             │ webhook
                             ▼
┌─────────────────────────────────────────────────────┐
│           Cloudflare Worker                         │
│  navcamp-webhook.ojopraise423.workers.dev           │
│                                                     │
│  POST /paystack/create-virtual-account              │
│  POST /paystack/webhook  (charge.success)           │
└────────────────────────────┬────────────────────────┘
                             │ API calls
                             ▼
                    ┌─────────────────┐
                    │    Paystack     │
                    │  (transactions, │
                    │   webhooks)     │
                    └─────────────────┘
```

---

## Auth Flow

1. User opens app → `RootNavigator` calls `onAuthStateChanged`
2. If no session → `AuthNavigator` → `LoginScreen`
3. Login/signup via Firebase Auth (email + password)
4. On success → fetch `users/{uid}` from Firestore to get `role`
5. Role routes to `StudentNavigator` or `RiderNavigator`
6. Biometric login stores credentials in device secure storage via
   `expo-local-authentication`. On subsequent opens, biometric prompt
   fires automatically and signs in with stored credentials.

**Admin role** is a separate `isAdmin: true` flag on the user doc.
Admin users are not routed differently in the app — the admin panel
is a separate web app entirely.

---

## Role System

| Role | Access |
|---|---|
| `student` | Home, Wallet, Map, Pathfinder, Profile |
| `rider` | Home (ride management), Earnings, Map, Profile |
| `isAdmin: true` | Admin panel (separate web app) |

Roles are set in Firestore at signup and enforced by security rules.
They cannot be changed client-side.

---

## Firestore Collections — Full Reference

### `users/{uid}`
```js
{
  name:        string,
  email:       string,
  phone:       string,
  role:        "student" | "rider",
  createdAt:   timestamp,
  isAdmin:     boolean,          // optional, admin only

  // student only
  matricNo:    string,
  level:       string,           // "100L" – "600L"
  department:  string | null,
  wallet: {
    balance:       number,       // kobo
    currency:      "NGN",
    lastTopUp:     timestamp | null,
    lastDeduction: timestamp | null,
  },
  debt: {
    amount:    number,           // kobo
    rideId:    string | null,
    incurredAt: timestamp | null,
  },

  // rider only
  plateNo:     string,
  vehicleType: "keke" | "shuttle",
  earnings: {
    balance:    number,          // kobo
    totalEarned: number,
    lastPayout: timestamp | null,
  },
}
```

### `rides/{rideId}`
Created when a rider goes online. One doc per active ride session.
```js
{
  riderId:         string,
  riderName:       string,
  status:          "waiting" | "matched" | "onTrip" | "completed",
  seats: {
    total:     number,
    occupied:  number,
    available: number,
  },
  stopQueue:       array,        // ordered list of pending pickup/dropoff stops
  passengers:      map,          // { [studentId]: passengerObject }
  currentLocation: { lat, lng } | null,
  createdAt:       timestamp,
  updatedAt:       timestamp,
}
```

### `rideRequests/{requestId}`
Created when a student requests a ride.
```js
{
  studentId:     string,
  studentName:   string,
  pickup:        { lat, lng, label },
  dropoff:       { lat, lng, label },
  rideType:      "pool",
  status:        "searching" | "matched" | "queued" | "cancelled" | "completed",
  matchedRideId: string | null,
  queueDocId:    string | null,
  paymentMethod: "wallet" | "cash",
  requestedAt:   timestamp,
}
```

### `waitingQueue/{queueId}`
Created when no ride is available and student is queued.
```js
{
  studentId:     string,
  studentName:   string,
  requestId:     string,
  pickup:        { lat, lng, label },
  dropoff:       { lat, lng, label },
  paymentMethod: "wallet" | "cash",
  joinedAt:      timestamp,
  position:      number,
  estimatedWait: string,
  notified:      boolean,
}
```

### `walletTransactions/{txId}`
Immutable log. Never updated after creation.
```js
{
  userId:        string,
  type:          "topup" | "deduction" | "earning" | "commission" | "refund",
  amount:        number,         // kobo
  balanceBefore: number,
  balanceAfter:  number,
  description:   string,
  reference:     string | null,  // Paystack reference
  rideId:        string | null,
  status:        "success",
  createdAt:     timestamp,
}
```

### `topUpRequests/{requestId}`
Created before payment, updated after webhook fires.
```js
{
  studentId:  string,
  amount:     number,            // kobo
  reference:  string,            // Paystack reference — used for idempotency
  status:     "pending" | "credited",
  createdAt:  timestamp,
  creditedAt: timestamp | null,
}
```

### `riderStatus/{riderId}`
Single doc per rider, overwritten on status change.
```js
{
  riderId:   string,
  isOnline:  boolean,
  lastSeen:  timestamp,
  updatedAt: timestamp,
}
```

### `rideLocations/{riderId}`
Live GPS position, updated every few seconds while rider is on trip.
```js
{
  riderId:   string,
  lat:       number,
  lng:       number,
  updatedAt: timestamp,
}
```

### `adminWallet/main`
Single doc tracking admin commission balance.
```js
{
  balance:     number,           // kobo
  totalEarned: number,
  updatedAt:   timestamp,
}
```

### `authorized_students/{matricNo}`
Whitelist for student signup verification. MatricNo is the doc ID
with `/` replaced by `-`.
```js
{
  name:       string,
  department: string,
  level:      string,
}
```

### `authorized_riders/{plateNo}`
Whitelist for rider signup verification.
```js
{
  name:  string,
  phone: string,
}
```

---

## Ride Matching Algorithm

Lives in `src/services/student.js → runMatching()`.

```
New request created
  │
  ├─ 1. Query rides WHERE status == "onTrip"
  │      Score each by detour distance to pickup
  │      If best score < 300m → claimSeat() on that ride
  │
  ├─ 2. Query rides WHERE status == "matched"
  │      Score each by distance from rider current location to pickup
  │      If best score < 800m → claimSeat() on that ride
  │
  └─ 3. No ride found → add to waitingQueue
         Batch write: waitingQueue doc + update rideRequest to "queued"
         (atomic — both writes succeed or neither does)

claimSeat() runs inside a Firestore transaction:
  - Re-reads the ride doc to check seats.available > 0
  - If seat was taken by a race condition → retry runMatching()
  - Otherwise → update ride (stopQueue, passengers, seats) + request (matched)
```

---

## Wallet & Payment Flow

```
Student taps "Top Up" → initiateTopUp() in wallet.js
  → POST to Cloudflare Worker with Firebase ID token
  → Worker verifies token via Firebase Identity Toolkit
  → Worker calls Paystack transaction/initialize
  → Returns { paymentUrl, reference }
  → App opens paymentUrl in browser

Student completes payment in browser
  → Paystack fires charge.success webhook to Worker
  → Worker verifies HMAC-SHA512 signature
  → Worker checks topUpRequests for reference (idempotency guard)
  → Worker credits users/{studentId}.wallet.balance in Firestore
  → Worker creates walletTransactions doc
  → Worker marks topUpRequests doc as "credited"

App detects balance change via onSnapshot listener on users/{uid}
  → Compares wallet.lastTopUp timestamp
  → Calls clearDebtAfterTopUp() if student has outstanding debt
```

Fare split on ride payment (runs client-side in a Firestore transaction):
- Total fare: ₦150 (15,000 kobo)
- Rider share: 13/15 = ₦130
- Admin share: 2/15 = ₦20

*(Note: the README states ₦100/₦50 split — verify which is live in `student.js`
`TOTAL_FARE_KOBO` and `RIDER_SHARE_RATIO` constants before launch)*

---

## Map Data Pipeline

Map data is **not** stored in Firestore. It is bundled into the app at build time.

```
QGIS
  → Export layers as GeoJSON → map-data/source/
      buildings.geojson
      roads.geojson
      walkways.geojson
      places.geojson
      entrances.geojson
      indoor_places.json   (edited via indoor-editor tool)

npm run map:export
  → scripts/campus-map.js
  → Bundles all sources into map-data/exports/veritas-map.json

App startup
  → Imports veritas-map.json statically
  → campus-data.js applies it to CAMPUS_MAP_DATA
  → Map renders from in-memory data — zero network requests
```

The `campusData/main` Firestore document exists for legacy reasons.
`applyCampusData()` in campus-data.js is intentionally a no-op —
the bundled JSON always wins.

---

## Offline Persistence

Firestore offline persistence is enabled in `src/config/firebase.js`:

- **Web**: `initializeFirestore` with `persistentLocalCache` + `persistentMultipleTabManager`
  — uses IndexedDB, works across multiple browser tabs
- **Native (Android)**: handled automatically by the React Native Firebase SDK

This means students in low-signal areas (inside buildings, basements) still
see cached map data and ride state. Queued writes (e.g. ride requests) are
replayed automatically when connectivity returns.

---

## Security Rules

Rules live outside the app repo at:
`ULTIMATE PROJECT/firestore.rules`

Key design decisions:
- `isAdmin()` checks `users/{uid}.isAdmin == true` — there is no admin role string,
  only a boolean flag set manually
- Ride matching writes are validated with `getAfter()` — Firestore verifies the
  linked ride/queue doc exists before allowing the batch to commit
- `walletTransactions` are write-once (no update or delete allowed)
- `authorized_students` and `authorized_riders` are publicly readable
  (needed for signup verification before auth exists) but only admin-writable

---

## Scalability Notes

- All list queries use `limit()` — no unbounded collection scans
- Composite indexes defined in `firestore.indexes.json` and deployed
- In-memory sorts replaced with server-side `orderBy` on indexed fields
- Paystack webhook is idempotent — duplicate `charge.success` events are
  detected via `reference` field in `topUpRequests` before any wallet write
- Location updates (`rideLocations`) should be throttled to max 1 write/10s
  to stay within Firestore's 1 write/sec per document limit at scale

---

## Adding a New Campus (Future)

The codebase is Veritas-specific in two places:

1. `map-data/` — all GeoJSON is Veritas geometry. New campus needs its own QGIS project.
2. `authorized_students` / `authorized_riders` collections — Veritas-specific whitelists.

Everything else (matching, wallet, auth, rides) is campus-agnostic.
Multi-tenancy would require a `campusId` field on all collections and
scoped security rules — doable but not yet designed.
