import { state } from "./state.js";
import { db, collection, query, orderBy, onSnapshot, addDoc, deleteDoc, updateDoc, doc, getDoc, getDocs, where, serverTimestamp, runTransaction } from "../firebase.js";
import { CAMPUS_MAP_DATA } from "../campus-data.js";
import { showToast, updateBottomSheet, updateRideDetails } from "./ui.js";
import { initMap } from "./map-manager.js";
import { calculateDetourScore, getDistance, getQueuePosition, estimateWaitTime, insertStopsIntoQueue, calculateFare } from "./ride-helpers.js";

const MAX_DETOUR_ACTIVE = 300; // metres
const MAX_DETOUR_IDLE = 800; // metres

export async function runMatching(requestId, request) {
  // Try active keke first
  const activeSnap = await getDocs(
    query(collection(db, "rides"), where("status", "==", "active"))
  );

  let bestRide = null;
  let bestScore = Infinity;

  activeSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.seats.available <= 0) return; // Client-side filter

    const ride = { id: docSnap.id, ...data };
    const score = calculateDetourScore(ride, request);
    if (score < bestScore && score < MAX_DETOUR_ACTIVE) {
      bestScore = score;
      bestRide = ride;
    }
  });

  if (bestRide) {
    await claimSeat(bestRide.id, requestId, request);
    return;
  }

  // Try idle keke
  const idleSnap = await getDocs(
    query(collection(db, "rides"), where("status", "==", "waiting"))
  );

  idleSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.seats.available <= 0) return; // Client-side filter

    const ride = { id: docSnap.id, ...data };
    const score = getDistance(ride.currentLocation, request.pickup);
    if (score < bestScore && score < MAX_DETOUR_IDLE) {
      bestScore = score;
      bestRide = ride;
    }
  });

  if (bestRide) {
    await claimSeat(bestRide.id, requestId, request);
    return;
  }

  // No keke available — add to waiting queue
  const queueRef = await addDoc(collection(db, "waitingQueue"), {
    studentId: request.studentId,
    studentName: request.studentName,
    requestId: requestId,
    pickup: request.pickup,
    dropoff: request.dropoff,
    joinedAt: serverTimestamp(),
    position: await getQueuePosition(),
    estimatedWait: await estimateWaitTime(),
    notified: false
  });

  await updateDoc(doc(db, "rideRequests", requestId), {
    status: "queued",
    queueDocId: queueRef.id
  });
}

async function claimSeat(rideId, requestId, request) {
  const rideRef = doc(db, "rides", rideId);
  const requestRef = doc(db, "rideRequests", requestId);

  try {
    await runTransaction(db, async (transaction) => {
      console.log("Starting transaction for ride:", rideId);
      const rideSnap = await transaction.get(rideRef);
      if (!rideSnap.exists()) {
        console.error("Ride document does not exist:", rideId);
        throw new Error("RIDE_NOT_FOUND");
      }
      const ride = rideSnap.data();
      console.log("Current ride state:", ride);

      // Re-check inside transaction — seats may have filled since we queried
      if (ride.seats.available <= 0) {
        console.warn("Seat gone during transaction for ride:", rideId);
        throw new Error("SEAT_GONE");
      }

      const updatedQueue = insertStopsIntoQueue(ride.stopQueue, request);
      console.log("Updated queue:", updatedQueue);

      transaction.update(rideRef, {
        stopQueue: updatedQueue,
        [`passengers.${request.studentId}`]: {
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
    });
    console.log("Transaction successfully committed for ride:", rideId);
  } catch (err) {
    if (err.message === "SEAT_GONE") {
      console.log("Re-running matching due to SEAT_GONE");
      await runMatching(requestId, request);
    } else {
      console.error("Transaction failed critically:", err);
      throw err; // Re-throw to be caught by requestKeke
    }
  }
}

export function populateLocations() {
  const pickup = document.getElementById("pickupSelect");
  const dropoff = document.getElementById("dropoffSelect");
  if (!pickup || !dropoff) return;
  const options = CAMPUS_MAP_DATA.locations.map(loc => `<option value="${loc.id}">${loc.name}</option>`).join("");
  pickup.innerHTML = `<option value="">Select Pickup Location</option>` + options;
  dropoff.innerHTML = `<option value="">Select Drop-off Location</option>` + options;
}

export function updateStudentProfileUI() {
  if (!state.currentUser) return;
  const name = state.currentUser.displayName || "Guest Student";
  const email = state.currentUser.email || "Guest User";
  const dashName = document.getElementById("studentDashName");
  const sideName = document.getElementById("sidebarName");
  const sideEmail = document.getElementById("sidebarEmail");
  const profName = document.getElementById("profileName");
  const profEmail = document.getElementById("profileEmail");
  const avatar = document.querySelector(".profile-avatar");
  if (dashName) dashName.innerText = name;
  if (sideName) sideName.innerText = name;
  if (sideEmail) sideEmail.innerText = email;
  if (profName) profName.innerText = name;
  if (profEmail) profEmail.innerText = email;
  if (avatar && name) avatar.innerText = name.charAt(0).toUpperCase();
}

export async function fetchRideHistory() {
  const list = document.getElementById("activityList");
  if (!list || !state.currentUser || state.currentUser.isGuest) return;
  const q = query(collection(db, "rideRequests"), orderBy("requestedAt", "desc"));
  onSnapshot(q, (snapshot) => {
  const history = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    // Only show if not deleted by student
    if (data.studentId === state.currentUser.uid && !data.deletedByStudent) {
      history.push({ id: doc.id, ...data });
    }
  });
  if (history.length === 0) {
    list.innerHTML = '<p class="empty-state">No recent activity</p>';
    return;
  }
  list.innerHTML = history.map(h => {
    const isActive = ["searching", "matched", "queued"].includes(h.status);
    return `
      <div class="activity-item">
        <div class="activity-info">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <h4>Ride to ${h.dropoff?.label || 'Campus'}</h4>
            <button class="iconBtn" style="color:#ef4444; font-size:14px; width:auto;" onclick="deleteRideRecord('${h.id}')">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
          <p>${h.requestedAt ? new Date(h.requestedAt.seconds * 1000).toLocaleString() : 'Just now'}</p>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <span class="status-pill ${h.status}" style="font-size:10px;">${h.status}</span>
          <button class="iconBtn" style="font-size:11px; width:auto; padding:5px 8px; border-radius:6px; background:#f3f4f6;" onclick="viewRideDetails('${h.id}')">Details</button>
          <button class="iconBtn" style="font-size:11px; width:auto; padding:5px 8px; border-radius:6px; background:${isActive ? '#22c55e' : '#e5e7eb'}; color:${isActive ? 'white' : '#9ca3af'};" 
            ${isActive ? `onclick="visitRide('${h.id}')"` : 'disabled'}>Visit</button>
        </div>
      </div>
    `;
  }).join("");
  });}

// These will be bound to window in app.js
export async function requestKeke() {
  if (state.currentRideId) return showToast("You already have an active request", "error");
  const btn = document.getElementById("requestBtn");
  btn.disabled = true;
  btn.innerText = "Checking...";
  try {
    const pickupId = document.getElementById("pickupSelect").value;
    const dropoffId = document.getElementById("dropoffSelect").value;
    if (!pickupId || !dropoffId) {
      showToast("Select pickup and drop-off", "error");
      return;
    }
    if (pickupId === dropoffId) {
      showToast("Pickup and drop-off cannot be same", "error");
      return;
    }
    const pickupLoc = CAMPUS_MAP_DATA.locations.find(l => l.id === pickupId);
    const dropoffLoc = CAMPUS_MAP_DATA.locations.find(l => l.id === dropoffId);
    btn.innerText = "Looking for your keke...";

    const requestData = {
      studentId: state.currentUser?.uid || (state.currentUser?.isGuest ? "guest" : "unknown"),
      studentName: state.currentUser?.displayName || "Guest",
      pickup: {
        lat: pickupLoc.lat,
        lng: pickupLoc.lng,
        label: pickupLoc.name
      },
      dropoff: {
        lat: dropoffLoc.lat,
        lng: dropoffLoc.lng,
        label: dropoffLoc.name
      },
      rideType: "pool",
      status: "searching",
      matchedRideId: null,
      requestedAt: serverTimestamp()
    };

    const ref = await addDoc(collection(db, "rideRequests"), requestData);
    state.currentRequestId = ref.id;
    
    // Switch to Live Tab via app.js global
    if (window.switchTab) window.switchTab('live');
    
    // IMMEDIATELY SHOW THE SHEET AND INITIAL STATE
    const studentSheet = document.getElementById("studentSheet");
    if (studentSheet) {
      studentSheet.classList.remove("hidden");
      document.getElementById("studentControls")?.setAttribute("style", "display:flex");
    }
    updateBottomSheet("Searching", "Looking for your keke...");
    updateRideDetails("student", [
      { label: "Status", value: "Searching" },
      { label: "From", value: pickupLoc.name },
      { label: "To", value: dropoffLoc.name }
    ]);

    listenToRequest(ref.id);
    
    // Client-only matching: create the request first, then claim a seat transactionally.
    await runMatching(ref.id, requestData);
    
    showToast("Looking for your keke...");
  } catch (err) {
    console.error(err);
    showToast("Failed to request ride", "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Request a ride";
  }
}

export function listenToRequest(requestId) {
  return onSnapshot(doc(db, "rideRequests", requestId), (snapshot) => {
    const request = snapshot.data();
    if (!request) return;

    if (request.status === "matched") {
      showToast("Ride matched!", "success");
      state.currentRideId = request.matchedRideId;
      listenToRide(request.matchedRideId, state.currentUser?.uid);
    }

    if (request.status === "queued") {
      updateBottomSheet("In Queue", `Position: #${request.queuePosition || '?'}`);
      if (request.queueDocId) {
        listenToQueuePosition(request.queueDocId);
      }
    }

    if (request.status === "cancelled") {
      state.currentRideId = null;
      state.currentRequestId = null;
      document.getElementById("studentSheet")?.classList.add("hidden");
      if (window.switchTab) window.switchTab('home');
    }
  });
}

export function listenToRide(matchedRideId, currentUserId) {
  return onSnapshot(doc(db, "rides", matchedRideId), (snapshot) => {
    const ride = snapshot.data();
    if (!ride) return;

    if (ride.status === "completed") {
      const myInfo = ride.passengers[currentUserId];
      // If I was a passenger and it's completed, it means I've arrived
      if (myInfo) {
        showToast("You have arrived at your destination!", "success");
        state.currentRideId = null;
        state.currentRequestId = null;
        document.getElementById("studentSheet").classList.add("hidden");
        if (window.switchTab) window.switchTab('home');
        return;
      }
    }

    const pendingStops = ride.stopQueue.filter(s => s.status === "pending");
    const myPickup     = pendingStops.find(
      s => s.passengerId === currentUserId && s.type === "pickup"
    );

    const stopsAway = myPickup
      ? pendingStops.filter((s, idx) => idx < pendingStops.indexOf(myPickup)).length
      : 0;

    const myInfo = ride.passengers[currentUserId];

    updateRideDetails("student", [
      { label: "Status", value: myInfo?.pickupStatus === "completed" ? "On Trip" : "Coming to you" },
      { label: "Stops Away", value: stopsAway },
      { label: "Seats", value: `${ride.seats.occupied}/${ride.seats.total}` },
      { label: "Fare", value: `₦${myInfo?.fare || 0}` }
    ]);

    updateBottomSheet(
      myInfo?.pickupStatus === "completed" ? "On Trip" : "Keke is on the way!",
      myInfo?.pickupStatus === "completed" ? `Heading to ${ride.stopQueue.find(s => s.passengerId === currentUserId && s.type === "dropoff")?.locationLabel}` : `${stopsAway} stops away`
    );
    
    // Update map etc. (could be handled in app.js or here)
    if (window.updateRideUI) window.updateRideUI(ride);
  });
}

export function listenToQueuePosition(queueDocId) {
  return onSnapshot(doc(db, "waitingQueue", queueDocId), (snapshot) => {
    const queue = snapshot.data();
    if (!queue) return;
    updateBottomSheet("In Queue", `Position: #${queue.position} (Est: ${queue.estimatedWait})`);
  });
}

export async function cancelRide() {
  if (!state.currentRequestId && !state.currentRideId) return;

  try {
    let request = null;

    if (state.currentRideId) {
      const rideSnap = await getDoc(doc(db, "rides", state.currentRideId));
      const ride = rideSnap.exists() ? rideSnap.data() : null;
      const passenger = ride?.passengers?.[state.currentUser.uid];

      if (passenger?.pickupStatus === "completed") {
        showToast("You cannot cancel after pickup", "error");
        return;
      }
    }

    if (state.currentRequestId) {
      const requestRef = doc(db, "rideRequests", state.currentRequestId);
      const requestSnap = await getDoc(requestRef);
      request = requestSnap.exists() ? requestSnap.data() : null;

      await updateDoc(requestRef, { 
        status: "cancelled",
        cancelledAt: serverTimestamp() 
      });

      if (request?.queueDocId) {
        await deleteDoc(doc(db, "waitingQueue", request.queueDocId));
      }
    }

    if (state.currentRideId) {
      const rideRef = doc(db, "rides", state.currentRideId);
      const rideSnap = await getDoc(rideRef);
      
      if (rideSnap.exists()) {
        const ride = rideSnap.data();
        const updatedQueue = ride.stopQueue.filter(s => s.passengerId !== state.currentUser.uid);
        
        const updates = {
          stopQueue: updatedQueue,
          [`passengers.${state.currentUser.uid}.pickupStatus`]: "cancelled",
          "seats.occupied": Math.max(0, (ride.seats.occupied || 1) - 1),
          "seats.available": Math.min(ride.seats.total, (ride.seats.available || 0) + 1),
          updatedAt: serverTimestamp()
        };
        
        await updateDoc(rideRef, updates);
      }
    }

    state.currentRequestId = null;
    state.currentRideId = null;
    
    document.getElementById("studentSheet").classList.add("hidden");
    if (window.switchTab) window.switchTab('home');
    showToast("Ride cancelled successfully");
  } catch (err) {
    console.error("Cancel failed:", err);
    showToast("Failed to cancel ride", "error");
  }
}

export async function deleteRideRecord(requestId) {
  if (!confirm("Are you sure you want to delete this ride from your history?")) return;
  
  try {
    await updateDoc(doc(db, "rideRequests", requestId), {
      deletedByStudent: true // Soft delete so rider keeps record, or use deleteDoc if preferred
    });
    showToast("Record removed");
  } catch (err) {
    console.error(err);
    showToast("Failed to remove record", "error");
  }
}

// Bind to window for HTML access
window.deleteRideRecord = deleteRideRecord;
