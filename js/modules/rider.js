import { state } from "./state.js";
import { db, collection, addDoc, updateDoc, doc, getDoc, getDocs, serverTimestamp, onSnapshot, query, orderBy } from "../firebase.js";
import { showToast, setButtonVisible, updateBottomSheet, updateRideDetails } from "./ui.js";
import { initMap, animateMarker } from "./map-manager.js";
import { getDistance } from "./ride-helpers.js";

let previousStatus = null;

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

  container.innerHTML = `
    <div style="margin-bottom:10px; font-weight:bold;">Next: ${label}</div>
    <div style="font-size:0.9em; margin-bottom:15px; color:#666;">${nextStop.locationLabel}</div>
    <button onclick="markStopComplete('${ride.id}', '${nextStop.stopId}', ${JSON.stringify(nextStop).replace(/"/g, '&quot;')})" class="${btnClass}">
      Arrived at ${nextStop.type === 'pickup' ? 'Pickup' : 'Drop-off'}
    </button>
  `;
}

export async function markStopComplete(rideId, stopId, stop) {
  try {
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
      // If first pickup, mark ride as active
      if (ride.status === "waiting") updates.status = "active";
    }

    if (stop.type === "dropoff") {
      updates[`passengers.${stop.passengerId}.dropoffStatus`] = "completed";
      // Deduct fare logic here (could be an update to student's balance or just a log)
      console.log(`Deducting fare for ${stop.passengerId}: ${ride.passengers[stop.passengerId].fare}`);
    }

    // Close the ride if all stops are done
    const allDone = updatedQueue.every(s => s.status === "completed");
    if (allDone) updates.status = "completed";

    await updateDoc(rideRef, updates);
    showToast(`${stop.type === 'pickup' ? 'Pickup' : 'Drop-off'} completed`);
  } catch (err) {
    console.error(err);
    showToast("Failed to update stop", "error");
  }
}

export function listenToActiveRide(rideId) {
  return onSnapshot(doc(db, "rides", rideId), async (snapshot) => {
    const ride = snapshot.data();
    if (!ride) return;

    if (ride.status === "completed") {
        showToast("All stops completed!");
        state.currentRideId = null;
        document.getElementById("riderSheet").classList.add("hidden");
        if (window.hideRiderMap) window.hideRiderMap();
        
        // Detect when ride just completed (Client-Side Patch)
        if (previousStatus !== "completed") {
          await notifyQueuedStudentsNearby(ride.currentLocation);
        }
        previousStatus = "completed";
        return;
    }

    // AUTO-TRANSITION TO MAP UI ONLY IF THERE ARE PENDING STOPS
    const hasPendingStops = ride.stopQueue.some(s => s.status === "pending");
    const riderMap = document.getElementById("riderMap");
    const riderSheet = document.getElementById("riderSheet");
    const riderDash = document.getElementById("riderDashboard");

    if (hasPendingStops && (ride.status === "waiting" || ride.status === "active")) {
      if (riderMap && riderMap.classList.contains("hidden")) {
        riderDash.classList.add("hidden");
        riderMap.classList.remove("hidden");
        riderSheet.classList.remove("hidden");
        document.getElementById("riderMapBackBtn")?.classList.remove("hidden");
        
        setTimeout(() => {
          initMap("riderMap");
          if (window.updateRideUI) window.updateRideUI(ride);
        }, 100);
      }
    } else if (!hasPendingStops) {
      // If no stops, stay on/return to dashboard but show online status
      if (riderMap && !riderMap.classList.contains("hidden")) {
        riderDash.classList.remove("hidden");
        riderMap.classList.add("hidden");
        riderSheet.classList.add("hidden");
        document.getElementById("riderMapBackBtn")?.classList.add("hidden");
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

export async function completeRide() {
  // Manual override to complete ride if needed
  if (!state.currentRideId) return;
  await updateDoc(doc(db, "rides", state.currentRideId), { status: "completed" });
  state.currentRideId = null;
  document.getElementById("riderSheet").classList.add("hidden");
  showToast("Ride completed manually");
}

// Global binding for the markStopComplete called from HTML
window.markStopComplete = markStopComplete;
