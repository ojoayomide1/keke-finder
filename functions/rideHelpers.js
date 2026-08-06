const { getFirestore } = require("firebase-admin/firestore");
const db = getFirestore();

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

function calculateDetourScore(ride, request) {
  const pickupDetour  = getDistance(ride.currentLocation, request.pickup);
  const dropoffAddition = getDistance(request.pickup, request.dropoff);
  return pickupDetour + dropoffAddition;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

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

function calculateFare(pickup, dropoff) {
  const distanceMetres = getDistance(pickup, dropoff);
  const BASE_FARE = 100;
  const PER_100M  = 10;
  return BASE_FARE + Math.floor(distanceMetres / 100) * PER_100M;
}

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

async function getQueuePosition() {
  const snapshot = await db.collection("waitingQueue").count().get();
  return snapshot.data().count + 1;
}

async function estimateWaitTime() {
  // Simple heuristic
  const count = await getQueuePosition();
  return `${count * 4}-${count * 6} mins`;
}

async function runMatchingForRequest(request, requestId) {
  // ── STEP 1: Try active keke ──────────────────
  const activeRides = await db.collection("rides")
    .where("status", "==", "active")
    .where("seats.available", ">", 0)
    .get();

  let bestRide = null;
  let bestScore = Infinity;

  activeRides.forEach((doc) => {
    const ride = { id: doc.id, ...doc.data() };
    const score = calculateDetourScore(ride, request);
    if (score < 300) { // MAX_DETOUR_ACTIVE
      if (score < bestScore) {
        bestScore = score;
        bestRide = ride;
      }
    }
  });

  if (bestRide) {
    await matchStudentToRide(bestRide, request, requestId);
    return bestRide;
  }

  // ── STEP 2: Try idle keke ────────
  const idleRides = await db.collection("rides")
    .where("status", "==", "waiting")
    .where("seats.available", ">", 0)
    .get();

  idleRides.forEach((doc) => {
    const ride = { id: doc.id, ...doc.data() };
    const score = getDistance(ride.currentLocation, request.pickup);
    if (score < 800) { // MAX_DETOUR_IDLE
      if (score < bestScore) {
        bestScore = score;
        bestRide = ride;
      }
    }
  });

  if (bestRide) {
    await matchStudentToRide(bestRide, request, requestId);
    return bestRide;
  }

  return null;
}

module.exports = {
  getDistance,
  calculateDetourScore,
  insertStopsIntoQueue,
  matchStudentToRide,
  getQueuePosition,
  estimateWaitTime,
  runMatchingForRequest
};
