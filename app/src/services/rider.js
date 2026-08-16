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
 * Set rider online/offline status
 * Uses separate riderStatus collection to avoid user document permission issues
 */
export async function setRiderStatus(riderId, isOnline) {
  try {
    await setDoc(doc(db, "riderStatus", riderId), {
      riderId,
      isOnline,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error("Error updating rider status:", error);
    return { success: false, error: error.message };
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
 * Listen to incoming ride requests for this rider
 */
export function listenToRideRequests(riderId, callback) {
  // Simple query - only filter by status, no ordering to avoid composite index
  const q = query(
    collection(db, "rideRequests"),
    where("status", "==", "pending")
  );

  return onSnapshot(q, (snapshot) => {
    const requests = [];
    snapshot.forEach((doc) => {
      requests.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort in memory by createdAt (newest first)
    requests.sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return aTime - bTime; // asc order (oldest first for fairness)
    });
    
    callback(requests);
  });
}

/**
 * Accept a ride request
 */
export async function acceptRideRequest(requestId, riderId) {
  try {
    const result = await runTransaction(db, async (transaction) => {
      const requestRef = doc(db, "rideRequests", requestId);
      const requestDoc = await transaction.get(requestRef);
      
      if (!requestDoc.exists() || requestDoc.data().status !== "pending") {
        throw new Error("Ride request no longer available");
      }

      const requestData = requestDoc.data();
      
      // Create ride document
      const rideRef = doc(collection(db, "rides"));
      transaction.set(rideRef, {
        requestId,
        riderId,
        studentId: requestData.studentId,
        studentName: requestData.studentName,
        pickup: requestData.pickup,
        dropoff: requestData.dropoff,
        status: "matched",
        pickupStatus: "pending",
        dropoffStatus: "pending",
        fare: TOTAL_FARE_KOBO,
        riderShare: RIDER_SHARE_KOBO,
        adminShare: ADMIN_SHARE_KOBO,
        createdAt: serverTimestamp(),
        matchedAt: serverTimestamp(),
      });

      // Update request status
      transaction.update(requestRef, {
        status: "matched",
        riderId,
        rideId: rideRef.id,
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
 * Mark pickup as completed
 */
export async function completePickup(rideId) {
  try {
    await updateDoc(doc(db, "rides", rideId), {
      pickupStatus: "completed",
      status: "onTrip",
      pickedUpAt: serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error("Error completing pickup:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark dropoff as completed
 */
export async function completeDropoff(rideId) {
  try {
    const result = await runTransaction(db, async (transaction) => {
      const rideRef = doc(db, "rides", rideId);
      const rideDoc = await transaction.get(rideRef);
      
      if (!rideDoc.exists()) {
        throw new Error("Ride not found");
      }

      const rideData = rideDoc.data();
      
      // Update ride status
      transaction.update(rideRef, {
        dropoffStatus: "completed", 
        status: "completed",
        completedAt: serverTimestamp(),
      });

      // Update rider earnings
      const riderRef = doc(db, "users", rideData.riderId);
      const riderDoc = await transaction.get(riderRef);
      
      if (riderDoc.exists()) {
        const currentEarnings = riderDoc.data().earnings || { balance: 0, totalEarned: 0 };
        transaction.update(riderRef, {
          earnings: {
            ...currentEarnings,
            balance: currentEarnings.balance + rideData.riderShare,
            totalEarned: currentEarnings.totalEarned + rideData.riderShare,
            lastEarning: {
              amount: rideData.riderShare,
              rideId,
              earnedAt: serverTimestamp(),
            },
          },
        });
      }

      return rideData.riderShare;
    });

    return { success: true, earned: result };
  } catch (error) {
    console.error("Error completing dropoff:", error);
    return { success: false, error: error.message };
  }
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
      balance: earnings.balance || 0,
      totalEarned: earnings.totalEarned || 0,
      todayEarnings,
      totalRides,
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

// ─── UTILITIES ───────────────────────────────────────────────────────────────

/**
 * Format currency from kobo to naira
 */
export function formatNaira(kobo) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

/**
 * Get next action for a ride (pickup or dropoff)
 */
export function getNextRideAction(ride) {
  if (!ride) return null;
  
  if (ride.pickupStatus === "pending") {
    return {
      type: "pickup",
      label: `Pick up ${ride.studentName}`,
      location: ride.pickup,
    };
  } else if (ride.dropoffStatus === "pending") {
    return {
      type: "dropoff", 
      label: `Drop off ${ride.studentName}`,
      location: ride.dropoff,
    };
  }
  
  return null;
}