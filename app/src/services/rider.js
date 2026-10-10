/**
 * rider.js
 *
 * Rider service for managing online status, ride requests, earnings, and passenger management.
 * Ported from main branch js/modules/rider.js for React Native/Expo.
 */

import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "../config/firebase";

import { calculateFare, getDistance } from "./ride-helpers";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_QUEUE_PICKUP_DISTANCE = 800; // meters
const RIDER_SHARE_KOBO = 10000;        // ₦100.00
const ADMIN_SHARE_KOBO = 5000;         // ₦50.00  
const TOTAL_FARE_KOBO = 15000;         // ₦150.00

// ─── RIDER STATUS MANAGEMENT ─────────────────────────────────────────────────

/**
 * Set rider online/offline status.
 * Going online creates a rides doc and immediately drains the waiting queue.
 * Going offline marks the ride as completed (if no active passengers).
 */
export async function setRiderStatus(riderId, isOnline, riderName = null) {
  try {
    await setDoc(doc(db, "riderStatus", riderId), {
      riderId,
      isOnline,
      lastSeen:  serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (!isOnline) {
      // Going offline — mark any waiting/matched ride as completed
      const activeSnap = await getDocs(query(
        collection(db, "rides"),
        where("riderId", "==", riderId),
        where("status", "in", ["waiting", "matched"])
      ));
      for (const d of activeSnap.docs) {
        const ride = d.data();
        const hasPending = (ride.stopQueue ?? []).some(s => s.status === "pending");
        if (!hasPending) {
          await updateDoc(d.ref, { status: "completed", updatedAt: serverTimestamp() });
        }
        // If has pending stops, leave them — rider needs to finish
      }
      return { success: true };
    }

    // Going online — find or create a ride doc
    const existingSnap = await getDocs(query(
      collection(db, "rides"),
      where("riderId", "==", riderId),
      where("status", "in", ["waiting", "matched", "onTrip"])
    ));

    let rideId;
    if (!existingSnap.empty) {
      // Resume existing ride
      rideId = existingSnap.docs[0].id;
    } else {
      // Create fresh ride doc
      const rideRef = await addDoc(collection(db, "rides"), {
        riderId,
        riderName: riderName ?? riderId,
        status:    "waiting",
        seats: { total: 3, occupied: 0, available: 3 },
        currentLocation: null,
        stopQueue:  [],
        passengers: {},
        requestIds: [],
        createdAt:  serverTimestamp(),
        updatedAt:  serverTimestamp(),
      });
      rideId = rideRef.id;
    }

    // Drain waiting queue into this ride
    await drainWaitingQueue(rideId, riderId);

    return { success: true, rideId };
  } catch (error) {
    console.error("Error updating rider status:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Drain the waitingQueue into a ride — auto-match queued students.
 * Also picks up any "searching" requests.
 * Called when rider goes online and whenever the queue changes.
 */
export async function drainWaitingQueue(rideId, riderId) {
  try {
    const rideRef  = doc(db, "rides", rideId);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) return;

    const ride = rideSnap.data();
    if (ride.riderId !== riderId) return;
    if (!["waiting", "matched", "onTrip"].includes(ride.status)) return;

    const seats = ride.seats ?? { total: 3, occupied: 0, available: 3 };
    if (seats.available <= 0) return;

    // 1. Process waitingQueue (students who queued before a rider was online)
    const queueSnap = await getDocs(
      query(collection(db, "waitingQueue"), orderBy("joinedAt"))
    );

    for (const queueDoc of queueSnap.docs) {
      const queued = queueDoc.data();
      if (queued.notified) continue;
      if (!queued.requestId || !queued.studentId) continue;

      try {
        const matched = await runTransaction(db, async (tx) => {
          const freshRide = await tx.get(rideRef);
          if (!freshRide.exists()) return false;

          const r     = freshRide.data();
          const seats = r.seats ?? { total: 3, occupied: 0, available: 3 };
          if (seats.available <= 0) return false;
          if (queued.studentId in (r.passengers ?? {})) return false;

          const request = {
            studentId:   queued.studentId,
            studentName: queued.studentName ?? "Student",
            pickup:      queued.pickup,
            dropoff:     queued.dropoff,
            paymentMethod: queued.paymentMethod ?? "wallet",
          };

          const newStops = insertStopsIntoQueue(r.stopQueue ?? [], request);

          tx.update(rideRef, {
            stopQueue: newStops,
            requestIds: [...new Set([...(r.requestIds ?? []), queued.requestId])],
            [`passengers.${queued.studentId}`]: {
              studentId:     queued.studentId,
              studentName:   queued.studentName ?? "Student",
              pickup:        queued.pickup,
              dropoff:       queued.dropoff,
              pickupStatus:  "pending",
              dropoffStatus: "pending",
              fare:          TOTAL_FARE_KOBO,
              paymentMethod: queued.paymentMethod ?? "wallet",
            },
            "seats.occupied":  (seats.occupied  ?? 0) + 1,
            "seats.available": (seats.available ?? 3) - 1,
            fare:              (r.fare ?? 0) + TOTAL_FARE_KOBO,
            riderShare:        (r.riderShare ?? 0) + RIDER_SHARE_KOBO,
            adminShare:        (r.adminShare ?? 0) + ADMIN_SHARE_KOBO,
            status:            r.status === "waiting" ? "matched" : r.status,
            updatedAt:         serverTimestamp(),
          });

          tx.update(doc(db, "rideRequests", queued.requestId), {
            status:        "matched",
            matchedRideId: rideId,
            riderId,
            matchedAt:     serverTimestamp(),
          });

          tx.update(queueDoc.ref, { notified: true });
          return true;
        });

        if (!matched) continue;

        // Check if full after each match
        const refreshed = await getDoc(rideRef);
        if ((refreshed.data()?.seats?.available ?? 0) <= 0) break;
      } catch (err) {
        console.warn("[drainQueue] skipped queued student:", err.message);
      }
    }

    // 2. Also pick up any "searching" requests that aren't queued yet
    const searchingSnap = await getDocs(query(
      collection(db, "rideRequests"),
      where("status", "==", "searching")
    ));

    for (const reqDoc of searchingSnap.docs) {
      const req = reqDoc.data();
      if (!req.studentId) continue;

      try {
        const matched = await runTransaction(db, async (tx) => {
          const freshRide = await tx.get(rideRef);
          if (!freshRide.exists()) return false;

          const r     = freshRide.data();
          const seats = r.seats ?? { total: 3, occupied: 0, available: 3 };
          if (seats.available <= 0) return false;
          if (req.studentId in (r.passengers ?? {})) return false;

          const request = {
            studentId:    req.studentId,
            studentName:  req.studentName ?? "Student",
            pickup:       req.pickup,
            dropoff:      req.dropoff,
            paymentMethod: req.paymentMethod ?? "wallet",
          };

          const newStops = insertStopsIntoQueue(r.stopQueue ?? [], request);

          tx.update(rideRef, {
            stopQueue: newStops,
            requestIds: [...new Set([...(r.requestIds ?? []), reqDoc.id])],
            [`passengers.${req.studentId}`]: {
              studentId:     req.studentId,
              studentName:   req.studentName ?? "Student",
              pickup:        req.pickup,
              dropoff:       req.dropoff,
              pickupStatus:  "pending",
              dropoffStatus: "pending",
              fare:          TOTAL_FARE_KOBO,
              paymentMethod: req.paymentMethod ?? "wallet",
            },
            "seats.occupied":  (seats.occupied  ?? 0) + 1,
            "seats.available": (seats.available ?? 3) - 1,
            fare:              (r.fare ?? 0) + TOTAL_FARE_KOBO,
            riderShare:        (r.riderShare ?? 0) + RIDER_SHARE_KOBO,
            adminShare:        (r.adminShare ?? 0) + ADMIN_SHARE_KOBO,
            status:            r.status === "waiting" ? "matched" : r.status,
            updatedAt:         serverTimestamp(),
          });

          tx.update(reqDoc.ref, {
            status:        "matched",
            matchedRideId: rideId,
            riderId,
            matchedAt:     serverTimestamp(),
          });
          return true;
        });

        if (!matched) continue;

        const refreshed = await getDoc(rideRef);
        if ((refreshed.data()?.seats?.available ?? 0) <= 0) break;
      } catch (err) {
        console.warn("[drainQueue] skipped searching request:", err.message);
      }
    }
  } catch (err) {
    console.warn("[drainWaitingQueue] error:", err.message);
  }
}

/**
 * Get current rider status
 */
export async function getRiderStatus(riderId) {
  try {
    const statusDoc = await getDoc(doc(db, "riderStatus", riderId));
    if (statusDoc.exists()) {
      return { isOnline: statusDoc.data().isOnline || false };
    }
    return { isOnline: false };
  } catch (error) {
    console.error("Error getting rider status:", error);
    return { isOnline: false };
  }
}

/**
 * Listen to incoming ride requests for this rider.
 * Shows both "searching" requests (just submitted) and "queued" requests
 * (waiting because no rider was online when they submitted).
 */
export function listenToRideRequests(riderId, callback) {
  const q = query(
    collection(db, "rideRequests"),
    where("status", "in", ["searching", "queued"])
  );

  return onSnapshot(q, (snapshot) => {
    const requests = [];
    snapshot.forEach((doc) => {
      requests.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort oldest first so riders see requests in fair order
    requests.sort((a, b) => {
      const aTime = a.requestedAt?.toMillis ? a.requestedAt.toMillis() : 0;
      const bTime = b.requestedAt?.toMillis ? b.requestedAt.toMillis() : 0;
      return aTime - bTime;
    });
    
    callback(requests);
  });
}

/**
 * Accept a ride request and integrate into multi-stop queue
 */
export async function acceptRideRequest(requestId, riderId) {
  try {
    const result = await runTransaction(db, async (transaction) => {
      const requestRef = doc(db, "rideRequests", requestId);
      const requestDoc = await transaction.get(requestRef);
      
      if (!requestDoc.exists() || !["searching", "queued"].includes(requestDoc.data().status)) {
        throw new Error("Ride request no longer available");
      }

      const requestData = requestDoc.data();
      
      // Check if rider has an existing active ride to add stops to
      const existingRidesQuery = query(
        collection(db, "rides"),
        where("riderId", "==", riderId),
        where("status", "in", ["matched", "onTrip"])
      );
      
      const existingRidesSnap = await getDocs(existingRidesQuery);
      
      let rideRef;
      let rideData;
      
      if (existingRidesSnap.empty) {
        // Create new ride with initial stop queue
        rideRef = doc(collection(db, "rides"));
        const stopQueue = [
          {
            stopId: generateId(),
            type: "pickup",
            passengerId: requestData.studentId,
            passengerName: requestData.studentName,
            location: requestData.pickup,
            locationLabel: requestData.pickup.name || requestData.pickup.label,
            status: "pending"
          },
          {
            stopId: generateId(),
            type: "dropoff", 
            passengerId: requestData.studentId,
            passengerName: requestData.studentName,
            location: requestData.dropoff,
            locationLabel: requestData.dropoff.name || requestData.dropoff.label,
            status: "pending"
          }
        ];
        
        rideData = {
          requestIds: [requestId],
          riderId,
          riderName: requestData.riderName ?? null,
          passengers: {
            [requestData.studentId]: {
              studentId: requestData.studentId,
              studentName: requestData.studentName,
              pickup: requestData.pickup,
              dropoff: requestData.dropoff,
              pickupStatus: "pending",
              dropoffStatus: "pending",
              fare: TOTAL_FARE_KOBO,
              paymentMethod: requestData.paymentMethod ?? "wallet",
            }
          },
          stopQueue,
          seats: {
            total: 3,
            occupied: 1,
            available: 2,
          },
          status: "matched",
          fare: TOTAL_FARE_KOBO,
          riderShare: RIDER_SHARE_KOBO,
          adminShare: ADMIN_SHARE_KOBO,
          paymentMethod: requestData.paymentMethod ?? "wallet",
          createdAt: serverTimestamp(),
          matchedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        
        transaction.set(rideRef, rideData);
      } else {
        // Add to existing ride's stop queue
        const existingRideDoc = existingRidesSnap.docs[0];
        rideRef = existingRideDoc.ref;
        const existingRide = existingRideDoc.data();
        
        // Use insertStopsIntoQueue logic (implemented below)
        const newStops = insertStopsIntoQueue(existingRide.stopQueue || [], requestData);
        
        const updatedPassengers = {
          ...existingRide.passengers,
          [requestData.studentId]: {
            studentId: requestData.studentId,
            studentName: requestData.studentName,
            pickup: requestData.pickup,
            dropoff: requestData.dropoff,
            pickupStatus: "pending",
            dropoffStatus: "pending",
            fare: TOTAL_FARE_KOBO,
            paymentMethod: requestData.paymentMethod ?? "wallet",
          }
        };
        
        transaction.update(rideRef, {
          requestIds: [...(existingRide.requestIds || []), requestId],
          passengers: updatedPassengers,
          stopQueue: newStops,
          fare: existingRide.fare + TOTAL_FARE_KOBO,
          riderShare: existingRide.riderShare + RIDER_SHARE_KOBO,
          adminShare: existingRide.adminShare + ADMIN_SHARE_KOBO,
          updatedAt: serverTimestamp(),
        });
        
        rideData = {
          ...existingRide,
          passengers: updatedPassengers,
          stopQueue: newStops,
        };
      }

      // Update request status
      transaction.update(requestRef, {
        status: "matched",
        riderId,
        rideId: rideRef.id,
        matchedRideId: rideRef.id,
        matchedAt: serverTimestamp(),
      });

      return rideRef.id;
    });

    return { success: true, rideId: result };
  } catch (error) {
    console.error("Error accepting ride:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate unique ID for stops
 */
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Insert pickup/dropoff stops optimally into existing queue
 * Ported from main branch ride-helpers.js
 */
function insertStopsIntoQueue(currentQueue, request) {
  const pendingStops = currentQueue.filter(s => s.status === "pending");
  const completedStops = currentQueue.filter(s => s.status === "completed");

  const newPickup = {
    stopId: generateId(),
    type: "pickup",
    passengerId: request.studentId,
    passengerName: request.studentName,
    location: request.pickup,
    locationLabel: request.pickup.name || request.pickup.label,
    status: "pending"
  };

  const newDropoff = {
    stopId: generateId(),
    type: "dropoff",
    passengerId: request.studentId,
    passengerName: request.studentName,
    location: request.dropoff,
    locationLabel: request.dropoff.name || request.dropoff.label,
    status: "pending"
  };

  // Simple insertion: add pickup at best position, dropoff after
  let bestCost = Infinity;
  let bestPickupIndex = pendingStops.length;
  let bestDropoffIndex = pendingStops.length + 1;

  // For now, just append to end (can optimize later with distance calculations)
  const result = [...pendingStops, newPickup, newDropoff];
  return [...completedStops, ...result];
}

/**
 * Decline a ride request
 */
export async function declineRideRequest(requestId) {
  try {
    // Just leave it pending for other riders to pick up
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ─── ACTIVE RIDE MANAGEMENT ──────────────────────────────────────────────────

/**
 * Listen to active rides for this rider
 */
export function listenToActiveRides(riderId, callback) {
  // Simple query - only filter by riderId, no ordering to avoid composite index
  const q = query(
    collection(db, "rides"),
    where("riderId", "==", riderId)
  );

  return onSnapshot(q, (snapshot) => {
    const rides = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Filter in memory to avoid composite index requirement
      if (data.status === "matched" || data.status === "onTrip") {
        rides.push({ id: doc.id, ...data });
      }
    });
    // Sort in memory by createdAt
    rides.sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime; // desc order
    });
    callback(rides);
  });
}

/**
 * Mark next stop as completed (pickup or dropoff)
 */
export async function completeNextStop(rideId) {
  try {
    const result = await runTransaction(db, async (transaction) => {
      const rideRef = doc(db, "rides", rideId);
      const rideDoc = await transaction.get(rideRef);
      
      if (!rideDoc.exists()) {
        throw new Error("Ride not found");
      }

      const rideData = rideDoc.data();
      const riderRef = doc(db, "users", rideData.riderId);
      const riderDoc = await transaction.get(riderRef);
      const requestRefs = (rideData.requestIds ?? []).map((requestId) => doc(db, "rideRequests", requestId));
      const requestDocs = [];
      for (const requestRef of requestRefs) {
        requestDocs.push(await transaction.get(requestRef));
      }
      const stopQueue = rideData.stopQueue || [];
      
      // Find next pending stop
      const nextStop = stopQueue.find(s => s.status === "pending");
      if (!nextStop) {
        throw new Error("No pending stops");
      }

      // Mark stop as completed
      const updatedQueue = stopQueue.map(s =>
        s.stopId === nextStop.stopId ? { ...s, status: "completed" } : s
      );

      const updates = {
        stopQueue: updatedQueue,
        updatedAt: serverTimestamp()
      };

      // Update passenger status
      if (nextStop.type === "pickup") {
        updates[`passengers.${nextStop.passengerId}.pickupStatus`] = "completed";
        updates.status = "onTrip";
      } else if (nextStop.type === "dropoff") {
        updates[`passengers.${nextStop.passengerId}.dropoffStatus`] = "completed";
        
        // Check if all stops are completed
        const remainingStops = updatedQueue.filter(s => s.status === "pending");
        if (remainingStops.length === 0) {
          updates.status = "completed";
          updates.completedAt = serverTimestamp();

          requestDocs.forEach((requestDoc, index) => {
            if (requestDoc.exists() && requestDoc.data().status === "matched") {
              transaction.update(requestRefs[index], {
                status: "completed",
                completedAt: serverTimestamp(),
              });
            }
          });
          if (riderDoc.exists()) {
            const currentEarnings = riderDoc.data().earnings || { balance: 0, totalEarned: 0 };
            const passengerList = Object.values(rideData.passengers || {});

            // Split earnings by payment method across all passengers
            let walletShare = 0;
            let cashShare   = 0;
            passengerList.forEach((p) => {
              const passengerFare = p.fare ?? rideData.riderShare ?? 0;
              const method = p.paymentMethod ?? "wallet";
              // Use the per-passenger rider share (riderShare stored on ride is the total)
              // We approximate per-passenger rider share from the ride-level ratio
              const totalRiderShare = rideData.riderShare ?? (passengerList.length * RIDER_SHARE_KOBO);
              const perPassengerRiderShare = passengerList.length > 0
                ? Math.floor(totalRiderShare / passengerList.length)
                : RIDER_SHARE_KOBO;
              if (method === "cash") {
                cashShare += perPassengerRiderShare;
              } else {
                walletShare += perPassengerRiderShare;
              }
            });

            // Credit wallet earnings only for wallet rides
            if (walletShare > 0) {
              transaction.update(riderRef, {
                "earnings.balance":     (currentEarnings.balance     || 0) + walletShare,
                "earnings.totalEarned": (currentEarnings.totalEarned || 0) + walletShare,
                "earnings.lastEarning": {
                  amount:   walletShare,
                  rideId,
                  earnedAt: serverTimestamp(),
                },
              });
            }

            // Track cash earnings separately — no wallet credit, just a record
            if (cashShare > 0) {
              const currentCash = riderDoc.data().cashEarnings || { totalCollected: 0, rideCount: 0 };
              transaction.update(riderRef, {
                "cashEarnings.totalCollected": (currentCash.totalCollected || 0) + cashShare,
                "cashEarnings.rideCount":      (currentCash.rideCount      || 0) + 1,
                "cashEarnings.lastCollection": {
                  amount:      cashShare,
                  rideId,
                  collectedAt: serverTimestamp(),
                },
              });
            }
          }
        }
      }

      transaction.update(rideRef, updates);

      return {
        stopType: nextStop.type,
        passengerName: nextStop.passengerName,
        isCompleted: updates.status === "completed",
        earned: updates.status === "completed" ? (rideData.riderShare ?? (Object.keys(rideData.passengers ?? {}).length * RIDER_SHARE_KOBO)) : 0,
      };
    });

    return { success: true, ...result };
  } catch (error) {
    console.error("Error completing stop:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get next action for current ride (what stop is next)
 */
export function getNextRideAction(ride) {
  if (!ride || !ride.stopQueue) return null;
  
  const nextStop = ride.stopQueue.find(s => s.status === "pending");
  if (!nextStop) return null;
  
  return {
    type: nextStop.type,
    label: nextStop.type === "pickup" 
      ? `Pick up ${nextStop.passengerName}` 
      : `Drop off ${nextStop.passengerName}`,
    location: nextStop.location,
    locationLabel: nextStop.locationLabel,
    stopId: nextStop.stopId,
  };
}

// ─── EARNINGS & STATS ────────────────────────────────────────────────────────

/**
 * Fetch rider earnings and stats
 */
export async function fetchRiderStats(riderId) {
  try {
    const userDoc = await getDoc(doc(db, "users", riderId));
    if (!userDoc.exists()) {
      return { balance: 0, totalEarned: 0, todayEarnings: 0, totalRides: 0 };
    }

    const userData = userDoc.data();
    const earnings = userData.earnings || { balance: 0, totalEarned: 0 };

    // Simplified: get all rides for this rider (no ordering to avoid composite index)
    const ridesQuery = query(
      collection(db, "rides"),
      where("riderId", "==", riderId)
    );
    
    const ridesSnap = await getDocs(ridesQuery);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayEarnings = 0;
    let totalRides = 0;
    
    ridesSnap.docs.forEach((doc) => {
      const rideData = doc.data();
      
      // Count completed rides
      if (rideData.status === "completed") {
        totalRides++;
        
        // Check if completed today (filter in memory)
        if (rideData.completedAt) {
          const completedDate = rideData.completedAt.toDate ? 
            rideData.completedAt.toDate() : new Date(rideData.completedAt);
          
          if (completedDate >= today) {
            todayEarnings += (rideData.riderShare || 0);
          }
        }
      }
    });

    return {
      balance:      earnings.balance      || 0,
      totalEarned:  earnings.totalEarned  || 0,
      todayEarnings,
      totalRides,
      cashCollected: userData.cashEarnings?.totalCollected || 0,
      cashRideCount: userData.cashEarnings?.rideCount      || 0,
    };
  } catch (error) {
    console.error("Error fetching rider stats:", error);
    return { balance: 0, totalEarned: 0, todayEarnings: 0, totalRides: 0 };
  }
}

/**
 * Listen to rider earnings updates
 */
export function listenToRiderEarnings(riderId, callback) {
  return onSnapshot(doc(db, "users", riderId), (doc) => {
    if (doc.exists()) {
      const earnings = doc.data().earnings || { balance: 0, totalEarned: 0 };
      callback(earnings);
    }
  });
}

/**
 * Listen to rider transaction history (earnings)
 */
export function listenToRiderTransactions(riderId, callback) {
  const q = query(
    collection(db, "walletTransactions"),
    where("userId", "==", riderId),
    where("type", "in", ["earning", "withdrawal"])
  );

  return onSnapshot(q, (snapshot) => {
    const transactions = [];
    snapshot.forEach((doc) => {
      transactions.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort by date (newest first)
    transactions.sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
    
    callback(transactions);
  });
}

/**
 * Listen to rider withdrawal requests
 */
export function listenToRiderWithdrawals(riderId, callback) {
  const q = query(
    collection(db, "withdrawalRequests"),
    where("riderId", "==", riderId)
  );

  return onSnapshot(q, (snapshot) => {
    const withdrawals = [];
    snapshot.forEach((doc) => {
      withdrawals.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort by date (newest first)
    withdrawals.sort((a, b) => {
      const aTime = a.requestedAt?.toMillis ? a.requestedAt.toMillis() : 0;
      const bTime = b.requestedAt?.toMillis ? b.requestedAt.toMillis() : 0;
      return bTime - aTime;
    });
    
    callback(withdrawals);
  });
}

/**
 * Request withdrawal (ported from main branch riderWallet.js)
 */
export async function requestWithdrawal(riderId, amountNaira, bankDetails) {
  try {
    const amountKobo = Math.round(amountNaira * 100);
    const riderRef = doc(db, "users", riderId);

    await runTransaction(db, async (transaction) => {
      const riderSnap = await transaction.get(riderRef);
      const rider = riderSnap.data();
      const balance = rider?.earnings?.balance || 0;

      if (balance < amountKobo) {
        throw new Error("Insufficient earnings balance");
      }

      // Deduct from rider balance
      transaction.update(riderRef, {
        "earnings.balance": balance - amountKobo
      });

      // Create withdrawal request
      transaction.set(doc(collection(db, "withdrawalRequests")), {
        riderId,
        riderName: rider.name || rider.displayName || "Rider",
        amount: amountKobo,
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        accountName: bankDetails.accountName,
        status: "pending",
        requestedAt: serverTimestamp(),
        paidAt: null,
        rejectedReason: null
      });
    });

    return { success: true };
  } catch (error) {
    console.error("Error requesting withdrawal:", error);
    return { success: false, error: error.message };
  }
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

/**
 * Format currency from kobo to naira
 */
export function formatNaira(kobo) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

