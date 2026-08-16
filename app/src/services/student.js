/**
 * student.js
 *
 * All ride-related logic for the student role.
 * Mirrors js/modules/student.js from main branch, rewritten for React Native:
 *  - No DOM manipulation
 *  - Returns data / calls callbacks instead of mutating HTML
 *  - UI feedback is handled by the screen via callbacks
 *
 * Exports:
 *   requestRide(params)         — create a request doc + run matching
 *   cancelRide(params)          — cancel active request / exit a ride
 *   payForRide(params)          — deduct fare, split rider / admin cut
 *   listenToRequest(id, cb)     — subscribe to a rideRequest doc
 *   listenToRide(id, uid, cb)   — subscribe to a ride doc
 *   listenToQueue(id, cb)       — subscribe to a waitingQueue doc
 *   fetchRideHistory(uid, cb)   — realtime ride history list
 *   deleteRideRecord(id)        — soft-delete a history item
 */

import {
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
} from "../config/firebase";

import { getRideStops } from "./campus-data";
import {
  calculateDetourScore,
  getDistance,
  insertStopsIntoQueue,
  calculateFare,
  getQueuePosition,
  estimateWaitTime,
} from "./ride-helpers";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_DETOUR_ACTIVE = 300; // metres — max detour to join an active ride
const MAX_DETOUR_IDLE   = 800; // metres — max distance to wake up a waiting rider

// Fare split: rider gets 13/15 of the fare, admin gets 2/15
const RIDER_SHARE_RATIO = 13 / 15;

// ─── MATCHING ────────────────────────────────────────────────────────────────

/**
 * Find the best ride for a new request, or queue the request if none is found.
 * Mirrors runMatching() in main branch.
 *
 * @param {string} requestId
 * @param {object} request   — same shape as the Firestore rideRequests doc
 */
export async function runMatching(requestId, request) {
  // 1. Try active rides first
  const activeSnap = await getDocs(
    query(collection(db, "rides"), where("status", "==", "active"))
  );

  let bestRide  = null;
  let bestScore = Infinity;

  activeSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.seats.available <= 0) return;
    const score = calculateDetourScore(data, request);
    if (score < bestScore && score < MAX_DETOUR_ACTIVE) {
      bestScore = score;
      bestRide  = { id: docSnap.id, ...data };
    }
  });

  if (bestRide) {
    await claimSeat(bestRide.id, requestId, request);
    return;
  }

  // 2. Try waiting/idle kekes
  const idleSnap = await getDocs(
    query(collection(db, "rides"), where("status", "==", "waiting"))
  );

  idleSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.seats.available <= 0) return;
    const dist = getDistance(data.currentLocation, request.pickup);
    if (dist < bestScore && dist < MAX_DETOUR_IDLE) {
      bestScore = dist;
      bestRide  = { id: docSnap.id, ...data };
    }
  });

  if (bestRide) {
    await claimSeat(bestRide.id, requestId, request);
    return;
  }

  // 3. No keke available — add to waiting queue
  const queueRef = await addDoc(collection(db, "waitingQueue"), {
    studentId:     request.studentId,
    studentName:   request.studentName,
    requestId,
    pickup:        request.pickup,
    dropoff:       request.dropoff,
    joinedAt:      serverTimestamp(),
    position:      await getQueuePosition(),
    estimatedWait: await estimateWaitTime(),
    notified:      false,
  });

  await updateDoc(doc(db, "rideRequests", requestId), {
    status:     "queued",
    queueDocId: queueRef.id,
  });
}

/**
 * Atomically claim a seat on a ride using a Firestore transaction.
 * Re-runs matching if the seat is taken mid-transaction.
 */
async function claimSeat(rideId, requestId, request) {
  const rideRef    = doc(db, "rides", rideId);
  const requestRef = doc(db, "rideRequests", requestId);

  try {
    await runTransaction(db, async (transaction) => {
      const rideSnap = await transaction.get(rideRef);
      if (!rideSnap.exists()) throw new Error("RIDE_NOT_FOUND");

      const ride = rideSnap.data();
      if (ride.seats.available <= 0) throw new Error("SEAT_GONE");

      const updatedQueue = insertStopsIntoQueue(ride.stopQueue, request);

      transaction.update(rideRef, {
        stopQueue: updatedQueue,
        [`passengers.${request.studentId}`]: {
          name:          request.studentName,
          pickupStatus:  "pending",
          dropoffStatus: "pending",
          fare:          calculateFare(request.pickup, request.dropoff),
          paid:          false,
        },
        "seats.occupied":  (ride.seats.occupied || 0) + 1,
        "seats.available": (ride.seats.available || 0) - 1,
        updatedAt:         serverTimestamp(),
      });

      transaction.update(requestRef, {
        status:        "matched",
        matchedRideId: rideId,
      });
    });
  } catch (err) {
    if (err.message === "SEAT_GONE") {
      // Race condition — retry matching
      await runMatching(requestId, request);
    } else {
      throw err;
    }
  }
}

// ─── REQUEST RIDE ────────────────────────────────────────────────────────────

/**
 * Create a ride request and kick off matching.
 *
 * @param {object} params
 * @param {string}   params.studentId
 * @param {string}   params.studentName
 * @param {string}   params.pickupId     — stop id from campus-data rideStops
 * @param {string}   params.dropoffId
 * @param {number}   params.walletBalance — current student wallet balance in kobo
 * @param {number}   params.debt         — outstanding debt in kobo
 *
 * @returns {{ requestId: string, pickup: object, dropoff: object }}
 * @throws {Error} with messages: "DEBT_OUTSTANDING:<amount>", "SAME_STOP", "STOP_NOT_FOUND", "NO_ACTIVE_REQUEST"
 */
export async function requestRide({ studentId, studentName, pickupId, dropoffId, walletBalance, debt }) {
  // Debt gate — same logic as checkDebtBeforeRide in main
  if (debt?.amount > 0) {
    throw new Error(`DEBT_OUTSTANDING:${debt.amount}`);
  }

  if (!pickupId || !dropoffId) {
    throw new Error("Select a pickup and drop-off location.");
  }
  if (pickupId === dropoffId) {
    throw new Error("SAME_STOP");
  }

  const rideStops = getRideStops();
  const pickupLoc  = rideStops.find(s => s.id === pickupId);
  const dropoffLoc = rideStops.find(s => s.id === dropoffId);

  if (!pickupLoc || !dropoffLoc) {
    throw new Error("STOP_NOT_FOUND");
  }

  const requestData = {
    studentId,
    studentName,
    pickup: {
      lat:   pickupLoc.lat,
      lng:   pickupLoc.lng,
      label: pickupLoc.name,
    },
    dropoff: {
      lat:   dropoffLoc.lat,
      lng:   dropoffLoc.lng,
      label: dropoffLoc.name,
    },
    rideType:      "pool",
    status:        "searching",
    matchedRideId: null,
    requestedAt:   serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "rideRequests"), requestData);

  // Matching is intentionally fire-and-forget so the UI can react to the
  // "searching" status immediately via listenToRequest.
  runMatching(ref.id, requestData).catch(err => {
    console.error("[student] runMatching failed:", err);
  });

  return { requestId: ref.id, pickup: requestData.pickup, dropoff: requestData.dropoff };
}

// ─── CANCEL RIDE ─────────────────────────────────────────────────────────────

/**
 * Cancel an active request and/or remove the student from an active ride.
 *
 * @param {{ requestId: string|null, rideId: string|null, studentId: string }} params
 * @throws {Error} "ALREADY_PICKED_UP" if student is already on board
 */
export async function cancelRide({ requestId, rideId, studentId }) {
  // Can't cancel after pickup
  if (rideId) {
    const rideSnap = await getDoc(doc(db, "rides", rideId));
    const ride     = rideSnap.exists() ? rideSnap.data() : null;
    const passenger = ride?.passengers?.[studentId];
    if (passenger?.pickupStatus === "completed") {
      throw new Error("ALREADY_PICKED_UP");
    }
  }

  // Cancel the request doc
  if (requestId) {
    const requestRef  = doc(db, "rideRequests", requestId);
    const requestSnap = await getDoc(requestRef);
    const request     = requestSnap.exists() ? requestSnap.data() : null;

    await updateDoc(requestRef, {
      status:      "cancelled",
      cancelledAt: serverTimestamp(),
    });

    // Remove from waiting queue if queued
    if (request?.queueDocId) {
      await deleteDoc(doc(db, "waitingQueue", request.queueDocId)).catch(() => {});
    }
  }

  // Remove student from the ride
  if (rideId) {
    const rideRef  = doc(db, "rides", rideId);
    const rideSnap = await getDoc(rideRef);
    if (rideSnap.exists()) {
      const ride        = rideSnap.data();
      const updatedQueue = (ride.stopQueue ?? []).filter(s => s.passengerId !== studentId);
      await updateDoc(rideRef, {
        stopQueue:                                            updatedQueue,
        [`passengers.${studentId}.pickupStatus`]:            "cancelled",
        "seats.occupied":  Math.max(0, (ride.seats.occupied  || 1) - 1),
        "seats.available": Math.min(ride.seats.total, (ride.seats.available || 0) + 1),
        updatedAt:         serverTimestamp(),
      });
    }
  }
}

// ─── PAY FOR RIDE ─────────────────────────────────────────────────────────────

/**
 * Pay the fare for an active ride using a Firestore transaction.
 * Splits earnings between the rider (13/15) and admin wallet (2/15).
 *
 * @param {{ rideId: string, studentId: string }} params
 * @throws {Error} "INSUFFICIENT_BALANCE" | "ALREADY_PAID" | "PASSENGER_NOT_FOUND"
 */
export async function payForRide({ rideId, studentId }) {
  const rideRef    = doc(db, "rides",        rideId);
  const studentRef = doc(db, "users",        studentId);
  const adminRef   = doc(db, "adminWallet",  "main");

  await runTransaction(db, async (transaction) => {
    const [rideSnap, studentSnap, adminSnap] = await Promise.all([
      transaction.get(rideRef),
      transaction.get(studentRef),
      transaction.get(adminRef),
    ]);

    if (!rideSnap.exists())    throw new Error("Ride not found");
    if (!studentSnap.exists()) throw new Error("Student not found");

    const ride    = rideSnap.data();
    const student = studentSnap.data();
    const admin   = adminSnap.exists() ? adminSnap.data() : { balance: 0, totalEarned: 0 };

    const passenger = ride.passengers?.[studentId];
    if (!passenger)      throw new Error("PASSENGER_NOT_FOUND");
    if (passenger.paid)  throw new Error("ALREADY_PAID");

    const fare        = passenger.fare;
    const balance     = student.wallet?.balance || 0;

    if (balance < fare) throw new Error("INSUFFICIENT_BALANCE");

    const riderShare = Math.floor(fare * RIDER_SHARE_RATIO);
    const adminShare = fare - riderShare;

    // Deduct from student
    transaction.update(studentRef, {
      "wallet.balance":       balance - fare,
      "wallet.lastDeduction": serverTimestamp(),
    });

    // Credit rider
    const riderRef  = doc(db, "users", ride.riderId);
    const riderSnap = await transaction.get(riderRef);
    if (riderSnap.exists()) {
      const rider = riderSnap.data();
      transaction.update(riderRef, {
        "earnings.balance":     (rider.earnings?.balance     || 0) + riderShare,
        "earnings.totalEarned": (rider.earnings?.totalEarned || 0) + riderShare,
      });

      // Wallet transaction log — rider earning
      const riderTxRef = doc(collection(db, "walletTransactions"));
      transaction.set(riderTxRef, {
        userId:      ride.riderId,
        type:        "earning",
        amount:      riderShare,
        balanceBefore: rider.earnings?.balance || 0,
        balanceAfter:  (rider.earnings?.balance || 0) + riderShare,
        description: "Ride fare received",
        rideId,
        createdAt:   serverTimestamp(),
      });
    }

    // Credit admin
    const adminBalance     = admin.balance     || 0;
    const adminTotalEarned = admin.totalEarned || 0;
    transaction.update(adminRef, {
      balance:     adminBalance     + adminShare,
      totalEarned: adminTotalEarned + adminShare,
      updatedAt:   serverTimestamp(),
    });

    // Mark student as paid on the ride doc
    transaction.update(rideRef, {
      [`passengers.${studentId}.paid`]: true,
    });

    // Wallet transaction log — student deduction
    const studentTxRef = doc(collection(db, "walletTransactions"));
    transaction.set(studentTxRef, {
      userId:        studentId,
      type:          "deduction",
      amount:        fare,
      balanceBefore: balance,
      balanceAfter:  balance - fare,
      description:   "Ride fare",
      rideId,
      createdAt:     serverTimestamp(),
    });

    // Wallet transaction log — admin commission
    const adminTxRef = doc(collection(db, "walletTransactions"));
    transaction.set(adminTxRef, {
      userId:        "admin",
      type:          "commission",
      amount:        adminShare,
      balanceBefore: adminBalance,
      balanceAfter:  adminBalance + adminShare,
      description:   "Commission from ride",
      rideId,
      createdAt:     serverTimestamp(),
    });
  });
}

// ─── LISTENERS ───────────────────────────────────────────────────────────────

/**
 * Subscribe to a rideRequest doc.
 *
 * Calls callback with a plain object describing the current state:
 *   { status, matchedRideId, queueDocId, queuePosition, pickup, dropoff }
 *
 * @param {string}   requestId
 * @param {Function} callback  (data: object | null) => void
 * @returns {() => void} unsubscribe
 */
export function listenToRequest(requestId, callback) {
  return onSnapshot(
    doc(db, "rideRequests", requestId),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => console.warn("[student] Request listener error:", err.code ?? err.message)
  );
}

/**
 * Subscribe to a ride doc and derive the student-facing summary.
 *
 * @param {string}   rideId
 * @param {string}   studentId
 * @param {Function} callback  (summary: object | null) => void
 * @returns {() => void} unsubscribe
 */
export function listenToRide(rideId, studentId, callback) {
  return onSnapshot(
    doc(db, "rides", rideId),
    (snap) => {
      if (!snap.exists()) return callback(null);
      const ride      = snap.data();
      const passenger = ride.passengers?.[studentId] ?? null;

      const pendingStops = (ride.stopQueue ?? []).filter(s => s.status === "pending");
      const myPickup     = pendingStops.find(
        s => s.passengerId === studentId && s.type === "pickup"
      );
      const myDropoff    = (ride.stopQueue ?? []).find(
        s => s.passengerId === studentId && s.type === "dropoff"
      );
      const stopsAway    = myPickup
        ? pendingStops.slice(0, pendingStops.indexOf(myPickup)).length
        : 0;

      // Check how close the keke is to the pickup (for "arriving" alerts)
      let distanceToPickup = null;
      if (ride.currentLocation && myPickup?.location) {
        distanceToPickup = getDistance(ride.currentLocation, myPickup.location);
      }

      callback({
        rideId,
        rideStatus:       ride.status,
        currentLocation:  ride.currentLocation ?? null,
        riderId:          ride.riderId ?? null,
        riderName:        ride.riderName ?? null,
        seats:            ride.seats,
        stopQueue:        ride.stopQueue ?? [],
        passenger,
        stopsAway,
        distanceToPickup,
        dropoffLabel:     myDropoff?.locationLabel ?? null,
        pickupStatus:     passenger?.pickupStatus  ?? "pending",
        paid:             passenger?.paid          ?? false,
        fare:             passenger?.fare          ?? 0,
        isCompleted:      ride.status === "completed",
      });
    },
    (err) => console.warn("[student] Ride listener error:", err.code ?? err.message)
  );
}

/**
 * Subscribe to a waiting queue doc.
 *
 * @param {string}   queueDocId
 * @param {Function} callback  ({ position, estimatedWait }) => void
 * @returns {() => void} unsubscribe
 */
export function listenToQueue(queueDocId, callback) {
  return onSnapshot(
    doc(db, "waitingQueue", queueDocId),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      callback({ position: data.position, estimatedWait: data.estimatedWait });
    },
    (err) => console.warn("[student] Queue listener error:", err.code ?? err.message)
  );
}

// ─── RIDE HISTORY ────────────────────────────────────────────────────────────

/**
 * Subscribe to ride history for a student (newest first).
 * Soft-deleted records are filtered out.
 *
 * @param {string}   studentId
 * @param {Function} callback  (rides: Array) => void
 * @returns {() => void} unsubscribe
 */
export function listenToRideHistory(studentId, callback) {
  const q = query(
    collection(db, "rideRequests"),
    where("studentId", "==", studentId),
    orderBy("requestedAt", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const rides = [];
      snap.forEach((d) => {
        const data = d.data();
        if (!data.deletedByStudent) {
          rides.push({ id: d.id, ...data });
        }
      });
      callback(rides);
    },
    (err) => {
      console.warn("[student] History listener error:", err.code ?? err.message);
      callback([]);
    }
  );
}

/**
 * Soft-delete a ride record from the student's history.
 * The document is NOT deleted — rider still sees it. We just set a flag.
 *
 * @param {string} requestId
 */
export async function deleteRideRecord(requestId) {
  await updateDoc(doc(db, "rideRequests", requestId), {
    deletedByStudent: true,
  });
}
