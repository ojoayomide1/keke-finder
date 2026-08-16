/**
 * ride-helpers.js
 *
 * Pure utility functions for ride matching and fare calculation.
 * Mirrors js/modules/ride-helpers.js from main branch.
 * No Firebase, no UI — all functions are synchronous except
 * getQueuePosition / estimateWaitTime which are stubs kept for API parity.
 */

// ─── DISTANCE ────────────────────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lng points (in metres).
 *
 * @param {{ lat: number, lng: number }} pointA
 * @param {{ lat: number, lng: number }} pointB
 * @returns {number} distance in metres
 */
export function getDistance(pointA, pointB) {
  const R = 6371000;
  const lat1 = pointA.lat * (Math.PI / 180);
  const lat2 = pointB.lat * (Math.PI / 180);
  const dLat = (pointB.lat - pointA.lat) * (Math.PI / 180);
  const dLng = (pointB.lng - pointA.lng) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── MATCHING ────────────────────────────────────────────────────────────────

/**
 * Detour score for matching a ride request to an active keke.
 * Lower = better fit.
 *
 * @param {{ currentLocation: { lat, lng } }} ride
 * @param {{ pickup: { lat, lng }, dropoff: { lat, lng } }} request
 * @returns {number} score in metres
 */
export function calculateDetourScore(ride, request) {
  const pickupDetour     = getDistance(ride.currentLocation, request.pickup);
  const dropoffAddition  = getDistance(request.pickup, request.dropoff);
  return pickupDetour + dropoffAddition;
}

/**
 * Calculate the total extra distance caused by inserting a new pickup+dropoff
 * pair at positions (pickupIdx, dropoffIdx) in an existing stop queue.
 */
function calculateInsertionCost(queue, pickup, dropoff, pickupIdx, dropoffIdx) {
  const testQueue = [...queue];
  testQueue.splice(pickupIdx, 0, pickup);
  testQueue.splice(dropoffIdx, 0, dropoff);

  let newDist = 0;
  for (let i = 0; i < testQueue.length - 1; i++) {
    newDist += getDistance(testQueue[i].location, testQueue[i + 1].location);
  }

  let originalDist = 0;
  for (let i = 0; i < queue.length - 1; i++) {
    originalDist += getDistance(queue[i].location, queue[i + 1].location);
  }

  return newDist - originalDist;
}

// ─── STOP QUEUE ──────────────────────────────────────────────────────────────

/** Simple ID generator for stop queue entries. */
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Insert a new passenger's pickup and dropoff into the existing stop queue
 * at the position that minimises total detour distance.
 *
 * @param {Array}  currentQueue - existing stopQueue from a ride doc
 * @param {object} request      - { studentId, studentName, pickup, dropoff }
 * @returns {Array} updated stopQueue
 */
export function insertStopsIntoQueue(currentQueue, request) {
  const pendingStops   = currentQueue.filter(s => s.status === "pending");
  const completedStops = currentQueue.filter(s => s.status === "completed");

  const newPickup = {
    stopId:         generateId(),
    type:           "pickup",
    passengerId:    request.studentId,
    passengerName:  request.studentName,
    location:       request.pickup,
    locationLabel:  request.pickup.label,
    status:         "pending",
  };

  const newDropoff = {
    stopId:         generateId(),
    type:           "dropoff",
    passengerId:    request.studentId,
    passengerName:  request.studentName,
    location:       request.dropoff,
    locationLabel:  request.dropoff.label,
    status:         "pending",
  };

  let bestCost        = Infinity;
  let bestPickupIdx   = pendingStops.length;
  let bestDropoffIdx  = pendingStops.length + 1;

  for (let i = 0; i <= pendingStops.length; i++) {
    for (let j = i + 1; j <= pendingStops.length + 1; j++) {
      const cost = calculateInsertionCost(pendingStops, newPickup, newDropoff, i, j);
      if (cost < bestCost) {
        bestCost       = cost;
        bestPickupIdx  = i;
        bestDropoffIdx = j;
      }
    }
  }

  const result = [...pendingStops];
  result.splice(bestPickupIdx,  0, newPickup);
  result.splice(bestDropoffIdx, 0, newDropoff);

  return [...completedStops, ...result];
}

// ─── FARE ─────────────────────────────────────────────────────────────────────

/**
 * Calculate fare in kobo (₦1 = 100 kobo) based on straight-line distance.
 *   Base: ₦100 flat
 *   + ₦10 per 100m
 *
 * @param {{ lat: number, lng: number }} pickup
 * @param {{ lat: number, lng: number }} dropoff
 * @returns {number} fare in kobo
 */
export function calculateFare(pickup, dropoff) {
  const distanceMetres = getDistance(pickup, dropoff);
  const BASE_FARE = 10000;   // ₦100 in kobo
  const PER_100M  = 1000;    // ₦10 per 100m in kobo
  return BASE_FARE + Math.floor(distanceMetres / 100) * PER_100M;
}

/**
 * Format kobo value to a human-readable Naira string.
 * e.g. 15000 → "₦150"
 *
 * @param {number} kobo
 * @returns {string}
 */
export function formatNaira(kobo = 0) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format((Number(kobo) || 0) / 100);
}

// ─── QUEUE HELPERS ───────────────────────────────────────────────────────────
// Students are not allowed to count the full waitingQueue in Firestore rules.
// These return sensible defaults until a queueStats doc is added.

/** @returns {Promise<number>} estimated queue position */
export async function getQueuePosition() {
  return 1;
}

/** @returns {Promise<string>} human-readable wait estimate */
export async function estimateWaitTime() {
  const pos = await getQueuePosition();
  return `${pos * 4}–${pos * 6} mins`;
}
