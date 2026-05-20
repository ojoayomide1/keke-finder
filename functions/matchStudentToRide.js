const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { 
  getDistance, 
  calculateDetourScore, 
  matchStudentToRide, 
  getQueuePosition, 
  estimateWaitTime 
} = require("./rideHelpers");

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
