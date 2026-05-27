# Campus Transport App — Ride Logic Specification
**Version 2.0 | Pool Ride System Rebuild**
**Stack: HTML, CSS, JavaScript, Firebase (Firestore + Cloud Functions)**

---

## 1. Overview

This document replaces the existing 1-student-to-1-rider logic with a full shared pool ride system. The app now has one ride mode:

| Mode | Description | Seats |
|------|-------------|-------|
| **Pool Ride** | Shared keke, smart seat matching | Up to 4 students |

The existing auth, role select, profile, and map logic remain untouched. Only the ride request flow, rider UI, and matching logic are being rebuilt.

---

## 2. Firestore Data Structure

### 2.1 `rides` Collection
One document per active keke session. Created by the rider when they go online.

```javascript
rides / {rideId} / {
  riderId: "uid_of_rider",
  kekeId: "keke_plate_or_id",
  status: "waiting" | "active" | "completed",
  // waiting = keke is at base, not yet moving
  // active  = keke is on the road
  // completed = all stops done

  seats: {
    total: 4,
    occupied: 2,
    available: 2
  },

  currentLocation: {
    lat: 9.0563,
    lng: 7.4985
  },

  // The core of the new logic — an ordered list of mixed pickups and dropoffs
  stopQueue: [
    {
      stopId: "stop_001",
      type: "pickup" | "dropoff",
      passengerId: "uid_of_student",
      passengerName: "Amaka",
      location: { lat: 9.0571, lng: 7.4990 },
      locationLabel: "Hostel C Gate",
      status: "pending" | "completed" | "skipped",
      estimatedArrival: timestamp
    }
    // ...more stops, mixed pickups and dropoffs
  ],

  passengers: {
    "uid_tunde": {
      name: "Tunde",
      pickupStopId: "stop_000",
      dropoffStopId: "stop_002",
      pickupStatus: "pending" | "completed",
      dropoffStatus: "pending" | "completed",
      fare: 150
    }
    // ...one entry per passenger
  },

  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Key rule:** A passenger's dropoff stop always appears after their pickup stop in the queue. This is enforced by the insertion algorithm. Everything else (order of pickups vs dropoffs for different passengers) is flexible and optimised for shortest total route.

---

### 2.2 `rideRequests` Collection
Created when a student submits a ride request. Watched by the matching Cloud Function.

```javascript
rideRequests / {requestId} / {
  studentId: "uid_ayomide",
  studentName: "Ayomide",

  pickup: {
    lat: 9.0563,
    lng: 7.4985,
    label: "Faculty of Science"
  },

  dropoff: {
    lat: 9.0590,
    lng: 7.5010,
    label: "Admin Block"
  },

  rideType: "pool",
  status: "searching" | "matched" | "queued" | "cancelled",
  matchedRideId: null,   // filled when matched to a ride
  queuePosition: null,   // filled when no keke is available

  requestedAt: timestamp
}
```

---

### 2.3 `waitingQueue` Collection
Students who couldn't be matched to any active or idle keke.

```javascript
waitingQueue / {queueId} / {
  studentId: "uid_ayomide",
  requestId: "original_request_id",

  pickup: { lat, lng, label },
  dropoff: { lat, lng, label },

  joinedAt: timestamp,
  position: 3,            // recalculated in real time as others get matched
  estimatedWait: "8-12 mins",
  notified: false
}
```

---

### 2.4 `scheduledRides` Collection
For students who book rides up to 30 minutes in advance.

```javascript
scheduledRides / {scheduleId} / {
  studentId: "uid_ayomide",
  pickup: { lat, lng, label },
  dropoff: { lat, lng, label },
  scheduledFor: timestamp,
  status: "pending" | "confirmed" | "cancelled",
  assignedRideId: null    // filled by the scheduler function
}
```

---

## 3. Matching Algorithm (Cloud Function)

**Trigger:** New document created in `rideRequests`

**File:** `functions/matchStudentToRide.js`

```javascript
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");

const db = getFirestore();

// Thresholds
const MAX_DETOUR_ACTIVE = 300;   // metres — for moving keke
const MAX_DETOUR_IDLE   = 800;   // metres — for idle keke at base

exports.matchStudentToRide = onDocumentCreated(
  "rideRequests/{requestId}",
  async (event) => {
    const request = event.data.data();
    const requestId = event.params.requestId;

    // ── STEP 1: Try active keke (already on the road) ──────────────────
    const activeRides = await db.collection("rides")
      .where("status", "==", "active")
      .where("seats.available", ">", 0)
      .get();

    let bestRide = null;
    let bestScore = Infinity;

    activeRides.forEach((doc) => {
      const ride = { id: doc.id, ...doc.data() };
      const score = calculateDetourScore(ride, request);
      if (score < bestScore && score < MAX_DETOUR_ACTIVE) {
        bestScore = score;
        bestRide = ride;
      }
    });

    if (bestRide) {
      await matchStudentToRide(bestRide, request, requestId);
      return;
    }

    // ── STEP 2: Try idle keke (waiting at base, not yet moving) ────────
    const idleRides = await db.collection("rides")
      .where("status", "==", "waiting")
      .where("seats.available", ">", 0)
      .get();

    idleRides.forEach((doc) => {
      const ride = { id: doc.id, ...doc.data() };
      const score = getDistance(ride.currentLocation, request.pickup);
      if (score < bestScore && score < MAX_DETOUR_IDLE) {
        bestScore = score;
        bestRide = ride;
      }
    });

    if (bestRide) {
      await matchStudentToRide(bestRide, request, requestId);
      return;
    }

    // ── STEP 3: Add to waiting queue ────────────────────────────────────
    const queueRef = await db.collection("waitingQueue").add({
      studentId: request.studentId,
      requestId: requestId,
      pickup: request.pickup,
      dropoff: request.dropoff,
      joinedAt: new Date(),
      position: await getQueuePosition(),
      estimatedWait: await estimateWaitTime(),
      notified: false
    });

    await db.collection("rideRequests").doc(requestId).update({
      status: "queued",
      queueDocId: queueRef.id
    });
  }
);
```

---

## 4. Helper Functions

**File:** `functions/rideHelpers.js`

### 4.1 `getDistance` — Haversine formula, returns metres
```javascript
function getDistance(pointA, pointB) {
  const R = 6371000;
  const lat1 = pointA.lat * Math.PI / 180;
  const lat2 = pointB.lat * Math.PI / 180;
  const dLat = (pointB.lat - pointA.lat) * Math.PI / 180;
  const dLng = (pointB.lng - pointA.lng) * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

---

### 4.2 `calculateDetourScore` — how much extra distance does this student add?
```javascript
function calculateDetourScore(ride, request) {
  const pickupDetour  = getDistance(ride.currentLocation, request.pickup);
  const dropoffAddition = getDistance(request.pickup, request.dropoff);
  return pickupDetour + dropoffAddition;
}
```

---

### 4.3 `insertStopsIntoQueue` — the core routing logic
Finds the best position to insert a new student's pickup and dropoff into the existing queue, with the minimum increase in total route distance.

```javascript
function insertStopsIntoQueue(currentQueue, request) {
  const pendingStops   = currentQueue.filter(s => s.status === "pending");
  const completedStops = currentQueue.filter(s => s.status === "completed");

  const newPickup = {
    stopId: generateId(),
    type: "pickup",
    passengerId: request.studentId,
    passengerName: request.studentName,
    location: request.pickup,
    locationLabel: request.pickup.label,
    status: "pending"
  };

  const newDropoff = {
    stopId: generateId(),
    type: "dropoff",
    passengerId: request.studentId,
    passengerName: request.studentName,
    location: request.dropoff,
    locationLabel: request.dropoff.label,
    status: "pending"
  };

  let bestCost        = Infinity;
  let bestPickupIndex = pendingStops.length;
  let bestDropoffIndex = pendingStops.length + 1;

  // Try every valid (pickup position, dropoff position) pair
  // RULE: dropoff index must always be greater than pickup index
  for (let i = 0; i <= pendingStops.length; i++) {
    for (let j = i + 1; j <= pendingStops.length + 1; j++) {
      const cost = calculateInsertionCost(pendingStops, newPickup, newDropoff, i, j);
      if (cost < bestCost) {
        bestCost = cost;
        bestPickupIndex  = i;
        bestDropoffIndex = j;
      }
    }
  }

  const result = [...pendingStops];
  result.splice(bestPickupIndex, 0, newPickup);
  result.splice(bestDropoffIndex, 0, newDropoff);

  return [...completedStops, ...result];
}

function calculateInsertionCost(queue, pickup, dropoff, pickupIdx, dropoffIdx) {
  const testQueue = [...queue];
  testQueue.splice(pickupIdx, 0, pickup);
  testQueue.splice(dropoffIdx, 0, dropoff);

  let newDistance = 0;
  for (let i = 0; i < testQueue.length - 1; i++) {
    newDistance += getDistance(testQueue[i].location, testQueue[i + 1].location);
  }

  let originalDistance = 0;
  for (let i = 0; i < queue.length - 1; i++) {
    originalDistance += getDistance(queue[i].location, queue[i + 1].location);
  }

  return newDistance - originalDistance;
}
```

---

### 4.4 `matchStudentToRide` — atomic Firestore write
```javascript
async function matchStudentToRide(ride, request, requestId) {
  const updatedQueue = insertStopsIntoQueue(ride.stopQueue, request);

  const batch = db.batch();

  batch.update(db.collection("rides").doc(ride.id), {
    stopQueue: updatedQueue,
    [`passengers.${request.studentId}`]: {
      name: request.studentName,
      pickupStatus: "pending",
      dropoffStatus: "pending",
      fare: calculateFare(request.pickup, request.dropoff)
    },
    "seats.occupied":  ride.seats.occupied + 1,
    "seats.available": ride.seats.available - 1
  });

  batch.update(db.collection("rideRequests").doc(requestId), {
    status: "matched",
    matchedRideId: ride.id
  });

  await batch.commit();
}
```

---

### 4.5 `calculateFare`
```javascript
function calculateFare(pickup, dropoff) {
  const distanceMetres = getDistance(pickup, dropoff);
  const BASE_FARE = 100;
  const PER_100M  = 10;
  return BASE_FARE + Math.floor(distanceMetres / 100) * PER_100M;
}
```
Adjust `BASE_FARE` and `PER_100M` to match actual campus rates.

---

## 5. When a Ride Completes Near a Queued Student (Cloud Function)

**Trigger:** `rides/{rideId}` document updated to `status: "completed"`

**File:** `functions/onRideCompleted.js`

```javascript
exports.onRideCompleted = onDocumentUpdated(
  "rides/{rideId}",
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only react when status changes to completed
    if (before.status === after.status) return;
    if (after.status !== "completed") return;

    const completedLocation = after.currentLocation;

    // Find queued students near where this keke just finished
    const queuedStudents = await db.collection("waitingQueue")
      .orderBy("joinedAt")   // FIFO — fairest approach
      .get();

    for (const doc of queuedStudents.docs) {
      const student = doc.data();
      const distance = getDistance(completedLocation, student.pickup);

      if (distance < 500) {
        // Notify this student — a keke just freed up near them
        await notifyStudent(student.studentId, {
          type: "ride_incoming",
          message: "A keke just finished nearby and may be heading your way.",
          eta: "2-4 mins"
        });

        await doc.ref.update({ notified: true });
        break; // Only notify the first eligible student in the queue
      }
    }
  }
);
```

---

## 6. Scheduled Rides Cloud Function

**Trigger:** Runs on a schedule every 10 minutes

**File:** `functions/processScheduledRides.js`

```javascript
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.processScheduledRides = onSchedule("every 10 minutes", async () => {
  const now = new Date();
  const in30Mins = new Date(now.getTime() + 30 * 60 * 1000);

  // Find rides scheduled to depart in the next 30 minutes
  const upcoming = await db.collection("scheduledRides")
    .where("status", "==", "pending")
    .where("scheduledFor", ">=", now)
    .where("scheduledFor", "<=", in30Mins)
    .get();

  for (const doc of upcoming.docs) {
    const schedule = doc.data();

    // Treat it like a normal pool request and run matching
    const fakeRequest = {
      studentId: schedule.studentId,
      studentName: schedule.studentName,
      pickup:  schedule.pickup,
      dropoff: schedule.dropoff,
      rideType: "pool"
    };

    // Reuse the same matching logic
    const matched = await runMatchingForRequest(fakeRequest);

    if (matched) {
      await doc.ref.update({
        status: "confirmed",
        assignedRideId: matched.rideId
      });
    }
  }
});
```

---

## 7. Marking Stops Complete (Client-Side, Rider)

**File:** `js/rider.js`

```javascript
async function markStopComplete(rideId, stopId, stop) {
  const rideRef  = doc(db, "rides", rideId);
  const rideSnap = await getDoc(rideRef);
  const ride     = rideSnap.data();

  const updatedQueue = ride.stopQueue.map(s =>
    s.stopId === stopId ? { ...s, status: "completed" } : s
  );

  const updates = {
    stopQueue:  updatedQueue,
    updatedAt:  serverTimestamp()
  };

  if (stop.type === "pickup") {
    updates[`passengers.${stop.passengerId}.pickupStatus`] = "completed";
  }

  if (stop.type === "dropoff") {
    updates[`passengers.${stop.passengerId}.dropoffStatus`] = "completed";
    await deductFare(stop.passengerId, ride.passengers[stop.passengerId].fare);
  }

  // Close the ride if all stops are done
  const allDone = updatedQueue.every(s => s.status === "completed");
  if (allDone) updates.status = "completed";

  await updateDoc(rideRef, updates);
}
```

---

## 8. Real-Time Listeners

### 8.1 Student listens to their matched ride
```javascript
// Called after student is matched (matchedRideId is available on their request doc)
function listenToRide(matchedRideId, currentUserId) {
  return onSnapshot(doc(db, "rides", matchedRideId), (snapshot) => {
    const ride = snapshot.data();

    const pendingStops = ride.stopQueue.filter(s => s.status === "pending");
    const myPickup     = pendingStops.find(
      s => s.passengerId === currentUserId && s.type === "pickup"
    );

    const stopsBeforeMyPickup = myPickup
      ? pendingStops.filter((s, idx) => idx < pendingStops.indexOf(myPickup))
      : [];

    updateStudentRideUI({
      kekeLocation:    ride.currentLocation,
      stopsAway:       stopsBeforeMyPickup.length,
      nextStop:        pendingStops[0],
      passengers:      Object.values(ride.passengers),
      seatsOccupied:   ride.seats.occupied
    });
  });
}
```

### 8.2 Student listens to their request (to know when matched or queued)
```javascript
function listenToRequest(requestId) {
  return onSnapshot(doc(db, "rideRequests", requestId), (snapshot) => {
    const request = snapshot.data();

    if (request.status === "matched") {
      showRideFoundUI(request.matchedRideId);
      listenToRide(request.matchedRideId, currentUserId);
    }

    if (request.status === "queued") {
        listenToQueuePosition(request.queueDocId);
    }
  });
}
```

### 8.3 Student listens to their queue position
```javascript
function listenToQueuePosition(queueDocId) {
  return onSnapshot(doc(db, "waitingQueue", queueDocId), (snapshot) => {
    const queue = snapshot.data();
    updateQueueUI({
      position:      queue.position,
      estimatedWait: queue.estimatedWait,
      notified:      queue.notified
    });
  });
}
```

### 8.4 Rider listens to their active ride
```javascript
function listenToActiveRide(rideId) {
  return onSnapshot(doc(db, "rides", rideId), (snapshot) => {
    const ride = snapshot.data();
    const nextStop = ride.stopQueue.find(s => s.status === "pending");
    const upcomingStops = ride.stopQueue.filter(s => s.status === "pending").slice(1);

    updateRiderUI({
      nextStop,
      upcomingStops,
      seatsOccupied: ride.seats.occupied,
      seatsAvailable: ride.seats.available
    });
  });
}
```

---

## 9. UI Specifications

### 9.1 Rider UI — Active Ride Card

```
┌──────────────────────────────────────┐
│  🛺  Active Ride  •  3 passengers    │
│  1 seat still available              │
│                                      │
│  NEXT STOP                           │
│  🟢 PICKUP — Amaka                   │
│  Hostel C Gate  •  400m away         │
│                                      │
│  [  ✓ Arrived  ]  [  Skip  ]         │
│                                      │
│  Coming up:                          │
│  🔴 DROPOFF — Tunde  •  Library      │
│  🔴 DROPOFF — Amaka  •  Admin Block  │
│                                      │
└──────────────────────────────────────┘
```

- "Arrived" calls `markStopComplete()`
- "Skip" marks the stop as `skipped` and advances the queue (use sparingly — rider should have a reason)
- The map behind this card shows the full route with all pending stops pinned

---

### 9.2 Student UI — Searching State

```
┌──────────────────────────────────────┐
│  🔍  Finding your ride...            │
│                                      │
│  Pickup:   Faculty of Science        │
│  Dropoff:  Admin Block               │
│                                      │
│  Checking available keke...          │
│                                      │
│  [       Cancel Request       ]      │
└──────────────────────────────────────┘
```

---

### 9.3 Student UI — In Queue State

```
┌──────────────────────────────────────┐
│  ⏳  You're in the queue             │
│                                      │
│  Position:  #3                       │
│  Est. wait: 8–12 minutes             │
│                                      │
│  2 keke active on campus             │
│                                      │
│  [  🕐 Schedule for Later           ]│
│  [  Cancel                          ]│
└──────────────────────────────────────┘
```

---

### 9.4 Student UI — Ride Found / On the Way

```
┌──────────────────────────────────────┐
│  ✅  Keke is on the way!             │
│                                      │
│  Rider: Musa  •  KJA-123            │
│  2 stops before your pickup          │
│  Est. arrival: ~6 mins               │
│                                      │
│  Also in this keke:                  │
│  Tunde, Chiamaka                     │
│                                      │
│  [       View on Map       ]         │
└──────────────────────────────────────┘
```

---

## 10. Full Request Flow (End to End)

```
1. Student submits ride request
   └── rideRequests/{id} created with status: "searching"

2. Cloud Function triggers (matchStudentToRide)
   ├── Try active keke   → match found? → go to step 3
   ├── Try idle keke     → match found? → go to step 3
   └── No match          → add to waitingQueue

3. Student matched to keke
   ├── stopQueue updated with new pickup + dropoff inserted optimally
   ├── seats.occupied++, seats.available--
   ├── request.status = "matched", matchedRideId filled
   └── Student UI transitions to "On the Way" screen

4. Rider moves through stops
   └── Taps "Arrived" at each stop
       ├── pickup  → passengerId.pickupStatus = "completed"
       └── dropoff → passengerId.dropoffStatus = "completed" + deductFare()

5. All stops completed
   └── ride.status = "completed"
       ├── Rider UI shows summary + earnings
       └── Students each see their trip receipt
```

---

## 11. Notes for Your Coding Agent

- **Do not touch** the existing auth, role select, profile, or map sections. Only the ride request flow and rider active-ride UI are being rebuilt.
- All Cloud Functions go in the `/functions` folder. Make sure `firebase-functions` v2 is installed (`npm install firebase-functions@latest` inside `/functions`).
- The `insertStopsIntoQueue` and `calculateInsertionCost` functions are pure JavaScript — no Firebase calls inside them. Keep them that way so they're easy to unit test.
- Use `onSnapshot` for all real-time UI updates. Never poll Firestore with `getDoc` in a `setInterval`.
- The `generateId()` used inside `insertStopsIntoQueue` can just be `Math.random().toString(36).substr(2, 9)` for now.
- Firestore security rules: students can only read the ride they are matched to. Riders can only write to rides they own. The Cloud Function (admin SDK) bypasses rules.
- Start by migrating the Firestore data model (Section 2), then write and deploy the Cloud Functions (Sections 3–6), then update the client-side UI (Sections 7–9) last.
