export function getDistance(pointA, pointB) {
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

export function calculateDetourScore(ride, request) {
  const pickupDetour  = getDistance(ride.currentLocation, request.pickup);
  const dropoffAddition = getDistance(request.pickup, request.dropoff);
  return pickupDetour + dropoffAddition;
}

export function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export function insertStopsIntoQueue(currentQueue, request) {
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

export function calculateFare(pickup, dropoff) {
  const distanceMetres = getDistance(pickup, dropoff);
  const BASE_FARE = 100;
  const PER_100M  = 10;
  return BASE_FARE + Math.floor(distanceMetres / 100) * PER_100M;
}

export async function getQueuePosition() {
  // Students are not allowed to list/count the full waitingQueue.
  // Keep this local until a dedicated queueStats document is added.
  return 1;
}

export async function estimateWaitTime() {
  const count = await getQueuePosition();
  return `${count * 4}-${count * 6} mins`;
}
