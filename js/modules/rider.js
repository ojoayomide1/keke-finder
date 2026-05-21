import { state } from "./state.js";
import { db, collection, addDoc, updateDoc, doc, getDoc, getDocs, serverTimestamp, onSnapshot, query, orderBy, runTransaction } from "../firebase.js";
import { showToast, setButtonVisible, updateBottomSheet, updateRideDetails } from "./ui.js";
import { initMap, animateMarker } from "./map-manager.js";
import { calculateFare, getDistance, insertStopsIntoQueue } from "./ride-helpers.js";
import { checkLowBalance } from "../wallet.js";

let previousStatus = null;
const MAX_QUEUE_PICKUP_DISTANCE = 800;
const RIDER_SHARE_KOBO = 10000;
const ADMIN_SHARE_KOBO = 5000;
const TOTAL_FARE_KOBO = 15000;

export function updateRiderDashboardUI() {
  if (!state.currentUser) return;
  const el = document.getElementById("riderDashName");
  if (el) el.innerText = state.currentUser.displayName;
}

export function updateAvailableRidesList(rides) {
  // This might be repurposed for "Upcoming Stops" or similar if needed on dashboard
  const list = document.getElementById("availableRidesList");
  if (!list) return;
  if (rides.length === 0) {
    list.innerHTML = '<p class="empty-state">No active passengers. Stay tuned!</p>';
    return;
  }
  // List current passengers in the keke
  list.innerHTML = rides.map(r => `
    <div class="ride-item">
      <div class="ride-info">
        <h4>Passenger: ${r.name}</h4>
        <p>Fare: ₦${r.fare}</p>
        <p>Status: ${r.pickupStatus === 'completed' ? 'On board' : 'Waiting for pickup'}</p>
      </div>
    </div>
  `).join("");
}

export function updateRiderControls(ride) {
  const container = document.getElementById("riderControls");
  if (!container) return;

  const nextStop = ride.stopQueue.find(s => s.status === "pending");
  if (!nextStop) {
    container.innerHTML = `<p>All stops completed!</p>`;
    return;
  }

  const label = nextStop.type === "pickup" ? `Pick up ${nextStop.passengerName}` : `Drop off ${nextStop.passengerName}`;
  const btnClass = nextStop.type === "pickup" ? "yellow" : "green";

  // Update the sheet title and sub with next stop info for minimized state
  const sheet = document.getElementById("riderSheet");
  if (sheet) {
    const titleEl = document.getElementById("riderSheetTitle");
    const subEl = document.getElementById("riderSheetSub");
    if (titleEl) titleEl.innerText = label;
    if (subEl) subEl.innerText = nextStop.locationLabel;
    
    // Auto-expand if a new stop appears and we were on dashboard
    if (sheet.classList.contains("hidden")) {
      sheet.classList.remove("minimized");
      sheet.classList.add("expanded");
    }
  }

  container.innerHTML = `
    <button onclick="markStopComplete('${ride.id}', '${nextStop.stopId}', ${JSON.stringify(nextStop).replace(/"/g, '&quot;')})" class="${btnClass}" style="width:100%">
      Arrived at ${nextStop.type === 'pickup' ? 'Pickup' : 'Drop-off'}
    </button>
  `;
}

export async function markStopComplete(rideId, stopId, stop) {
  try {
    const rideRef  = doc(db, "rides", rideId);
    let updatedStudentBalance = null;

    await runTransaction(db, async (transaction) => {
      const rideSnap = await transaction.get(rideRef);
      if (!rideSnap.exists()) throw new Error("Ride not found");

      const ride = rideSnap.data();
      if (ride.riderId !== state.currentUser?.uid) throw new Error("Only this ride's rider can complete stops");

      const currentStop = (ride.stopQueue || []).find(s => s.stopId === stopId);
      if (!currentStop || currentStop.status === "completed") return;

      const updatedQueue = ride.stopQueue.map(s =>
        s.stopId === stopId ? { ...s, status: "completed" } : s
      );

      const updates = {
        stopQueue: updatedQueue,
        updatedAt: serverTimestamp()
      };

      if (currentStop.type === "pickup") {
        updates[`passengers.${currentStop.passengerId}.pickupStatus`] = "completed";
        if (ride.status === "waiting") updates.status = "active";
      }

      if (currentStop.type === "dropoff") {
        updates[`passengers.${currentStop.passengerId}.dropoffStatus`] = "completed";
        await applyFareSplit(transaction, currentStop.passengerId, ride.riderId, rideId);
      }

      if (updatedQueue.every(s => s.status === "completed")) updates.status = "completed";
      transaction.update(rideRef, updates);
    });

    if (stop.type === "dropoff") {
      const studentSnap = await getDoc(doc(db, "users", stop.passengerId));
      updatedStudentBalance = studentSnap.data()?.wallet?.balance || 0;
      checkLowBalance(updatedStudentBalance);
    }

    showToast(`${stop.type === 'pickup' ? 'Pickup' : 'Drop-off'} completed`);
  } catch (err) {
    console.error(err);
    showToast("Failed to update stop", "error");
  }
}

async function applyFareSplit(transaction, studentId, riderId, rideId) {
  const studentRef = doc(db, "users", studentId);
  const riderRef = doc(db, "users", riderId);
  const adminRef = doc(db, "adminWallet", "main");

  const studentSnap = await transaction.get(studentRef);
  const riderSnap = await transaction.get(riderRef);
  const adminSnap = await transaction.get(adminRef);

  if (!studentSnap.exists() || !riderSnap.exists()) throw new Error("Missing wallet user");

  const student = studentSnap.data();
  const rider = riderSnap.data();
  const admin = adminSnap.exists() ? adminSnap.data() : { balance: 0, totalEarned: 0 };
  const currentBalance = student.wallet?.balance || 0;
  const riderBalance = rider.earnings?.balance || 0;
  const riderTotalEarned = rider.earnings?.totalEarned || 0;
  const adminBalance = admin.balance || admin.wallet?.balance || 0;
  const adminTotalEarned = admin.totalEarned || admin.wallet?.totalEarned || 0;

  if (currentBalance >= TOTAL_FARE_KOBO) {
    const studentNewBalance = currentBalance - TOTAL_FARE_KOBO;
    transaction.update(studentRef, {
      "wallet.balance": studentNewBalance,
      "wallet.lastDeduction": serverTimestamp()
    });
    transaction.update(riderRef, {
      "earnings.balance": riderBalance + RIDER_SHARE_KOBO,
      "earnings.totalEarned": riderTotalEarned + RIDER_SHARE_KOBO
    });
    transaction.update(adminRef, {
      balance: adminBalance + ADMIN_SHARE_KOBO,
      totalEarned: adminTotalEarned + ADMIN_SHARE_KOBO,
      lastUpdated: serverTimestamp()
    });

    addWalletTransaction(transaction, studentId, "deduction", TOTAL_FARE_KOBO, currentBalance, studentNewBalance, "Ride fare", rideId);
    addWalletTransaction(transaction, riderId, "earning", RIDER_SHARE_KOBO, riderBalance, riderBalance + RIDER_SHARE_KOBO, "Ride fare received", rideId);
    addWalletTransaction(transaction, "admin", "commission", ADMIN_SHARE_KOBO, adminBalance, adminBalance + ADMIN_SHARE_KOBO, "Commission from ride", rideId);
    return;
  }

  const debtAmount = TOTAL_FARE_KOBO - currentBalance;
  const riderActual = Math.floor(currentBalance * (RIDER_SHARE_KOBO / TOTAL_FARE_KOBO));
  const adminActual = currentBalance - riderActual;

  transaction.update(studentRef, {
    "wallet.balance": 0,
    "wallet.lastDeduction": serverTimestamp(),
    "debt.amount": debtAmount,
    "debt.rideId": rideId,
    "debt.incurredAt": serverTimestamp()
  });
  transaction.update(riderRef, {
    "earnings.balance": riderBalance + riderActual,
    "earnings.totalEarned": riderTotalEarned + riderActual
  });
  transaction.update(adminRef, {
    balance: adminBalance + adminActual,
    totalEarned: adminTotalEarned + adminActual,
    lastUpdated: serverTimestamp()
  });

  addWalletTransaction(transaction, studentId, "deduction", currentBalance, currentBalance, 0, `Partial fare - ${debtAmount / 100} NGN debt recorded`, rideId);
  if (riderActual > 0) addWalletTransaction(transaction, riderId, "earning", riderActual, riderBalance, riderBalance + riderActual, "Partial ride fare received", rideId);
  if (adminActual > 0) addWalletTransaction(transaction, "admin", "commission", adminActual, adminBalance, adminBalance + adminActual, "Partial commission from ride", rideId);
}

function addWalletTransaction(transaction, userId, type, amount, balanceBefore, balanceAfter, description, rideId) {
  transaction.set(doc(collection(db, "walletTransactions")), {
    userId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    description,
    reference: null,
    rideId,
    status: "success",
    createdAt: serverTimestamp()
  });
}

export function listenToActiveRide(rideId) {
  return onSnapshot(doc(db, "rides", rideId), async (snapshot) => {
    const ride = snapshot.data();
    if (!ride) return;

    if (ride.status === "completed") {
        showToast("All stops completed!");
        state.currentRideId = null;
        state.riderDocId = null; // Clear so a new ride doc is created next time they go live
        document.getElementById("riderSheet").classList.add("hidden");
        if (window.hideRiderMap) window.hideRiderMap();
        
        // Reset Dashboard Stats
        const detailsContainer = document.getElementById("riderRideDetails");
        if (detailsContainer) detailsContainer.innerHTML = "";
        document.getElementById("riderTitle").innerText = "Online & Ready";
        document.getElementById("riderSub").innerText = "All passengers dropped off. Waiting for new requests.";
        
        // In the client-only flow, riders trigger nearby queue notifications.
        if (previousStatus !== "completed") {
          await notifyQueuedStudentsNearby(ride.currentLocation);
        }
        previousStatus = "completed";
        return;
    }

    // AUTO-TRANSITION TO LIVE VIEW ONLY IF THERE ARE PENDING STOPS
    const hasPendingStops = ride.stopQueue.some(s => s.status === "pending");
    const isLiveViewHidden = document.getElementById("riderLiveView")?.classList.contains("hidden");

    if (hasPendingStops && (ride.status === "waiting" || ride.status === "active")) {
      if (isLiveViewHidden) {
        if (window.switchTab) window.switchTab('live');
        document.getElementById("riderSheet")?.classList.remove("hidden");
      }
    } else if (!hasPendingStops) {
      // If no stops, stay on/return to dashboard but show online status
      if (!isLiveViewHidden) {
        if (window.switchTab) window.switchTab('home');
      }
      document.getElementById("riderTitle").innerText = "Online & Ready";
      document.getElementById("riderSub").innerText = "Waiting for passengers...";
    }

    previousStatus = ride.status;

    updateRiderControls({ id: snapshot.id, ...ride });
    
    const nextStop = ride.stopQueue.find(s => s.status === "pending");
    
    if (nextStop) {
      updateBottomSheet(
        nextStop.type === 'pickup' ? "Heading to Pickup" : "Heading to Drop-off",
        nextStop.locationLabel,
        "rider"
      );
    }

    // Update stats on dashboard or sheet
    const statsHtml = `
      <div style="display:flex; justify-content:space-around; padding:15px; background:#f9fafb; border-radius:12px; margin:10px 0;">
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:#6b7280;">Seats</div>
          <div style="font-weight:bold;">${ride.seats.occupied}/${ride.seats.total}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:#6b7280;">Passengers</div>
          <div style="font-weight:bold;">${Object.keys(ride.passengers).length}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:#6b7280;">Next Stop</div>
          <div style="font-weight:bold;">${nextStop ? nextStop.passengerName : "None"}</div>
        </div>
      </div>
    `;
    
    const detailsContainer = document.getElementById("riderRideDetails");
    if (detailsContainer) detailsContainer.innerHTML = statsHtml;

    // Also update sheet details if visible
    const sheetDetails = document.getElementById("riderSheetDetails");
    if (sheetDetails) sheetDetails.innerHTML = statsHtml;

    updateRideDetails("rider", [
      { label: "Seats", value: `${ride.seats.occupied}/${ride.seats.total}` },
      { label: "Passengers", value: Object.keys(ride.passengers).length },
      { label: "Next Stop", value: nextStop ? nextStop.passengerName : "None" }
    ]);

    if (window.updateRideUI) window.updateRideUI(ride);
  });
}

async function notifyQueuedStudentsNearby(completedLocation) {
  const queueSnap = await getDocs(
    query(collection(db, "waitingQueue"), orderBy("joinedAt"))
  );

  for (const docSnap of queueSnap.docs) {
    const student = docSnap.data();
    const distance = getDistance(completedLocation, student.pickup);
    if (distance < 500) {
      // Update their queue doc so their onSnapshot fires and shows the message
      await updateDoc(docSnap.ref, { notified: true });
      break; // Only notify the first eligible student (FIFO)
    }
  }
}

export async function drainWaitingQueueForRide(rideId) {
  const rideRef = doc(db, "rides", rideId);
  const queueSnap = await getDocs(
    query(collection(db, "waitingQueue"), orderBy("joinedAt"))
  );

  for (const queueDoc of queueSnap.docs) {
    const queued = queueDoc.data();
    if (queued.notified) continue;

    const requestRef = doc(db, "rideRequests", queued.requestId);

    try {
      const matched = await runTransaction(db, async (transaction) => {
        const rideSnap = await transaction.get(rideRef);

        if (!rideSnap.exists()) return false;

        const ride = rideSnap.data();

        if (ride.riderId !== state.currentUser?.uid) return false;
        if (!["waiting", "active"].includes(ride.status)) return false;
        if ((ride.seats?.available || 0) <= 0) return false;
        if (!queued.requestId || !queued.studentId) return false;
        if (queued.studentId in (ride.passengers || {})) return false;

        const pickupDistance = getDistance(ride.currentLocation, queued.pickup);
        if (pickupDistance > MAX_QUEUE_PICKUP_DISTANCE) return false;

        const request = {
          studentId: queued.studentId,
          studentName: queued.studentName || "Queued Student",
          pickup: queued.pickup,
          dropoff: queued.dropoff
        };

        const updatedQueue = insertStopsIntoQueue(ride.stopQueue || [], request);

        transaction.update(rideRef, {
          stopQueue: updatedQueue,
          [`passengers.${queued.studentId}`]: {
            name: request.studentName,
            pickupStatus: "pending",
            dropoffStatus: "pending",
            fare: calculateFare(request.pickup, request.dropoff)
          },
          "seats.occupied": (ride.seats.occupied || 0) + 1,
          "seats.available": (ride.seats.available || 0) - 1,
          updatedAt: serverTimestamp()
        });

        transaction.update(requestRef, {
          status: "matched",
          matchedRideId: rideId
        });

        transaction.update(queueDoc.ref, {
          notified: true
        });

        return true;
      });

      if (!matched) continue;

      const latestRide = await getDoc(rideRef);
      if (!latestRide.exists() || (latestRide.data().seats?.available || 0) <= 0) break;
    } catch (err) {
      console.warn("Queue match skipped:", err);
    }
  }
}

export async function completeRide() {
  // Manual override to complete ride if needed
  if (!state.currentRideId) return;
  await updateDoc(doc(db, "rides", state.currentRideId), { status: "completed" });
  state.currentRideId = null;
  document.getElementById("riderSheet")?.classList.add("hidden");
  if (window.switchTab) window.switchTab('home');
  showToast("Ride completed manually");
}

// Global binding for the markStopComplete called from HTML
window.markStopComplete = markStopComplete;
