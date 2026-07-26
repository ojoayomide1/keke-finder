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
  // might use this for "Upcoming Stops" on dashboard later
  const list = document.getElementById("availableRidesList");
  if (!list) return;
  if (rides.length === 0) {
    list.innerHTML = '<p class="empty-state">No active passengers. Stay tuned!</p>';
    return;
  }
  // show who's currently in the keke
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

  // update the minimized sheet header with next stop info
  const sheet = document.getElementById("riderSheet");
  if (sheet) {
    const titleEl = document.getElementById("riderSheetTitle");
    const subEl = document.getElementById("riderSheetSub");
    if (titleEl) titleEl.innerText = label;
    if (subEl) subEl.innerText = nextStop.locationLabel;
    
    // pop the sheet open if it was hidden
    if (sheet.classList.contains("hidden")) {
      sheet.classList.remove("hidden", "expanded");
      sheet.classList.add("minimized");
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
        const passenger = ride.passengers?.[currentStop.passengerId];
        if (!passenger?.paid) {
          await applyFareSplit(transaction, currentStop.passengerId, ride.riderId, rideId);
        }
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
    const studentUpdate = {
      "wallet.balance": studentNewBalance,
      "wallet.lastDeduction": serverTimestamp()
    };
    if (!student.wallet?.currency) studentUpdate["wallet.currency"] = "NGN";
    
    transaction.update(studentRef, studentUpdate);
    transaction.update(riderRef, {
      "earnings.balance": riderBalance + RIDER_SHARE_KOBO,
      "earnings.totalEarned": riderTotalEarned + RIDER_SHARE_KOBO
    });
    writeAdminWalletTotals(transaction, adminRef, adminBalance + ADMIN_SHARE_KOBO, adminTotalEarned + ADMIN_SHARE_KOBO);

    addWalletTransaction(transaction, studentId, "deduction", TOTAL_FARE_KOBO, currentBalance, studentNewBalance, "Ride fare", rideId);
    addWalletTransaction(transaction, riderId, "earning", RIDER_SHARE_KOBO, riderBalance, riderBalance + RIDER_SHARE_KOBO, "Ride fare received", rideId);
    addWalletTransaction(transaction, "admin", "commission", ADMIN_SHARE_KOBO, adminBalance, adminBalance + ADMIN_SHARE_KOBO, "Commission from ride", rideId);
    return;
  }

  const debtAmount = TOTAL_FARE_KOBO - currentBalance;
  const riderActual = Math.floor(currentBalance * (RIDER_SHARE_KOBO / TOTAL_FARE_KOBO));
  const adminActual = currentBalance - riderActual;

  const studentUpdate = {
    "wallet.balance": 0,
    "wallet.lastDeduction": serverTimestamp(),
    "debt.amount": debtAmount,
    "debt.rideId": rideId,
    "debt.incurredAt": serverTimestamp()
  };
  if (!student.wallet?.currency) studentUpdate["wallet.currency"] = "NGN";

  transaction.update(studentRef, studentUpdate);
  transaction.update(riderRef, {
    "earnings.balance": riderBalance + riderActual,
    "earnings.totalEarned": riderTotalEarned + riderActual
  });
  writeAdminWalletTotals(transaction, adminRef, adminBalance + adminActual, adminTotalEarned + adminActual);

  addWalletTransaction(transaction, studentId, "deduction", currentBalance, currentBalance, 0, `Partial fare - ${debtAmount / 100} NGN debt recorded`, rideId);
  if (riderActual > 0) addWalletTransaction(transaction, riderId, "earning", riderActual, riderBalance, riderBalance + riderActual, "Partial ride fare received", rideId);
  if (adminActual > 0) addWalletTransaction(transaction, "admin", "commission", adminActual, adminBalance, adminBalance + adminActual, "Partial commission from ride", rideId);
}

export function writeAdminWalletTotals(transaction, adminRef, balance, totalEarned) {
  transaction.set(adminRef, {
      balance,
      totalEarned,
      lastUpdated: serverTimestamp()
    },
    { merge: true }
  );
}

export function addWalletTransaction(transaction, userId, type, amount, balanceBefore, balanceAfter, description, rideId) {
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
        state.riderDocId = null; // reset so next time they go live a fresh doc is created
        document.getElementById("riderSheet").classList.add("hidden");
        if (window.hideRiderMap) window.hideRiderMap();
        
        // wipe the ride details panel
        const detailsContainer = document.getElementById("riderRideDetails");
        if (detailsContainer) detailsContainer.innerHTML = "";
        
        // handle graceful offline if rider asked to go offline mid-trip
        if (ride.isGoingOffline) {
          await toggleOnlineStatus();
          previousStatus = "completed";
          return;
        }

        document.getElementById("riderTitle").innerText = "Online & Ready";
        document.getElementById("riderSub").innerText = "All passengers dropped off. Waiting for new requests.";
        
        // rider triggers queue notifications after dropping off — no cloud function needed
        if (previousStatus !== "completed") {
          await notifyQueuedStudentsNearby(ride.currentLocation);
        }
        previousStatus = "completed";
        return;
    }

    // auto-switch to live view when there are pending stops
    const hasPendingStops = ride.stopQueue.some(s => s.status === "pending");
    const isLiveViewHidden = document.getElementById("riderLiveView")?.classList.contains("hidden");

    if (hasPendingStops && (ride.status === "waiting" || ride.status === "active")) {
      if (isLiveViewHidden) {
        if (window.switchTab) window.switchTab('live');
        const riderSheet = document.getElementById("riderSheet");
        riderSheet?.classList.remove("hidden", "expanded");
        riderSheet?.classList.add("minimized");
      }
    } else if (!hasPendingStops) {
      // no stops left, go back to dashboard and just wait
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

    // build the passenger cards with paid/unpaid status
    let passengersListHtml = "";
    Object.entries(ride.passengers || {}).forEach(([pId, p]) => {
      const isPaid = p.paid === true;
      const statusClass = isPaid ? "status-paid" : "status-unpaid";
      const statusText = isPaid ? "Paid" : "Unpaid";
      const dropoffStop = (ride.stopQueue || []).find(s => s.passengerId === pId && s.type === "dropoff");
      const dropoffLabel = dropoffStop ? dropoffStop.locationLabel : "Destination";
      
      passengersListHtml += `
        <div class="passenger-list-item">
          <div class="passenger-info">
            <span class="passenger-name">${p.name || "Passenger"}</span>
            <span class="passenger-dest">${dropoffLabel}</span>
          </div>
          <button class="pay-status-btn ${statusClass}">
            ${isPaid ? '<i class="fas fa-check-circle"></i> ' : ''}${statusText}
          </button>
        </div>
      `;
    });

    // show seat and passenger stats
    const statsHtml = `
      <div style="display:flex; justify-content:space-around; padding:15px; background:var(--color-bg-secondary); border-radius:12px; margin:10px 0; border: 1px solid var(--color-border);">
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:var(--color-text-secondary);">Seats</div>
          <div style="font-weight:bold;">${ride.seats.occupied}/${ride.seats.total}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:var(--color-text-secondary);">Passengers</div>
          <div style="font-weight:bold;">${Object.keys(ride.passengers).length}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:0.8em; color:var(--color-text-secondary);">Next Stop</div>
          <div style="font-weight:bold;">${nextStop ? nextStop.passengerName : "None"}</div>
        </div>
      </div>
      <div class="passenger-status-list" style="margin-top: 15px;">
        <h4 style="font-size: 11px; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: 8px; font-weight: 700; letter-spacing: 0.5px;">Onboard Passengers</h4>
        ${passengersListHtml || '<p style="font-size: 13px; color: var(--color-text-secondary); text-align: center; padding: 10px;">No passengers matched</p>'}
      </div>
    `;
    
    const detailsContainer = document.getElementById("riderRideDetails");
    if (detailsContainer) detailsContainer.innerHTML = statsHtml;

    // also push stats into the bottom sheet
    const sheetDetails = document.getElementById("riderSheetDetails");
    if (sheetDetails) sheetDetails.innerHTML = statsHtml;

    updateRideDetails("rider", [
      { label: "Seats", value: `${ride.seats.occupied}/${ride.seats.total}` },
      { label: "Passengers", value: Object.keys(ride.passengers).length },
      { label: "Next Stop", value: nextStop ? nextStop.passengerName : "None" }
    ]);

    if (window.updateRideUI) window.updateRideUI(ride);
  }, (err) => console.warn("Active ride listener unavailable:", err.code || err.message));
}

async function notifyQueuedStudentsNearby(completedLocation) {
  const queueSnap = await getDocs(
    query(collection(db, "waitingQueue"), orderBy("joinedAt"))
  );

  for (const docSnap of queueSnap.docs) {
    const student = docSnap.data();
    const distance = getDistance(completedLocation, student.pickup);
    if (distance < 500) {
      // poke their queue doc so the onSnapshot fires and they see the update
      await updateDoc(docSnap.ref, { notified: true });
      break; // FIFO — only tell the first eligible student
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
        if (ride.isGoingOffline === true || ride.acceptingNewPassengers === false) return false;
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
  // emergency manual complete in case something gets stuck
  if (!state.currentRideId) return;
  await updateDoc(doc(db, "rides", state.currentRideId), { status: "completed" });
  state.currentRideId = null;
  document.getElementById("riderSheet")?.classList.add("hidden");
  if (window.switchTab) window.switchTab('home');
  showToast("Ride completed manually");
}

export async function toggleOnlineStatus() {
  const btn = document.getElementById("statusToggleBtn");
  const isOnline = btn.innerText === "Go Offline" || btn.innerText === "Completing Trips...";
  
  if (isOnline) {
    // going offline
    if (state.currentRideId && btn.innerText !== "Completing Trips...") {
      try {
        const rideSnap = await getDoc(doc(db, "rides", state.currentRideId));
        if (rideSnap.exists()) {
          const ride = rideSnap.data();
          const hasPendingStops = (ride.stopQueue || []).some(s => s.status === "pending");
          
          if (hasPendingStops) {
            // still have passengers — do graceful offline instead
            await updateDoc(doc(db, "rides", state.currentRideId), {
              isGoingOffline: true,
              acceptingNewPassengers: false
            });
            btn.innerText = "Completing Trips...";
            btn.className = "btn btn-primary yellow";
            document.getElementById("riderSub").innerText = "Finishing current trips (Going offline)";
            showToast("Going offline after dropping off passengers", "info");
            return; // stay online for GPS until trips done
          }
        }
      } catch (err) {
        console.warn("Graceful offline verification failed, forcing offline:", err);
      }
    }

    // force or normal offline
    if (state.currentRideId) {
      await updateDoc(doc(db, "rides", state.currentRideId), { status: "completed" });
      state.currentRideId = null;
      state.riderDocId = null;
    }
    if (state.riderWatchId) {
      navigator.geolocation.clearWatch(state.riderWatchId);
      state.riderWatchId = null;
    }
    btn.innerText = "Go Online";
    btn.className = "btn btn-primary yellow";
    document.getElementById("riderTitle").innerText = "Offline";
    document.getElementById("riderSub").innerText = "Go live to start receiving requests";
    showToast("You are now offline", "info");
  } else {
    // going online
    window.becomeAvailable();
    btn.innerText = "Go Offline";
    btn.className = "btn btn-primary green";
    // becomeAvailable handles the rest of the UI
  }
}

// bind these so HTML can call them
window.markStopComplete = markStopComplete;
window.toggleOnlineStatus = toggleOnlineStatus;
