import { state } from "./state.js";
import { db, collection, query, orderBy, onSnapshot, addDoc, deleteDoc, updateDoc, doc, getDoc, getDocs, where, serverTimestamp, runTransaction } from "../firebase.js";
import { getRideStops } from "../campus-data.js";
import { showToast, updateBottomSheet, updateRideDetails, showConfirmDialog } from "./ui.js";
import { initMap } from "./map-manager.js";
import { calculateDetourScore, getDistance, getQueuePosition, estimateWaitTime, insertStopsIntoQueue, calculateFare } from "./ride-helpers.js";
import { checkDebtBeforeRide, formatNaira } from "../wallet.js";
import { addWalletTransaction, writeAdminWalletTotals } from "./rider.js";

const MAX_DETOUR_ACTIVE = 300; // metres
const MAX_DETOUR_IDLE = 800; // metres

export async function runMatching(requestId, request) {
  // check active kekes first before idle ones
  const activeSnap = await getDocs(
    query(collection(db, "rides"), where("status", "==", "active"))
  );

  let bestRide = null;
  let bestScore = Infinity;

  activeSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.seats.available <= 0) return; // extra check on client side just in case

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
    if (data.seats.available <= 0) return; // extra check on client side just in case

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

  // no keke found, throw them into the waiting queue
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

      // re-check seats inside the transaction, someone else might have taken it
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
  const stops = getRideStops();
  if (!stops.length) {
    const emptyOption = `<option value="">Admin needs to set ride stop coordinates</option>`;
    pickup.innerHTML = emptyOption;
    dropoff.innerHTML = emptyOption;
    return;
  }
  const options = stops.map(loc => `<option value="${loc.id}">${loc.name}</option>`).join("");
  pickup.innerHTML = `<option value="">Select Pickup Location</option>` + options;
  dropoff.innerHTML = `<option value="">Select Drop-off Location</option>` + options;
}

function setProfileText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function getProfileInitials(name, fallback = "ST") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");
}

function getNameGradient(name) {
  const source = String(name || "OpRides");
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = source.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 72%, 46%), hsl(${(hue + 52) % 360}, 78%, 58%))`;
}

function stopLabel(value) {
  if (!value) return "Unknown stop";
  if (typeof value === "string") return value;
  return value.label || value.name || value.locationLabel || "Unknown stop";
}

function mostFrequent(values) {
  const counts = new Map();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No rides yet";
}

async function renderStudentProfileStats() {
  if (!state.currentUser?.uid || state.currentUser.isGuest) return;
  try {
    const [requestSnap, transactionSnap] = await Promise.all([
      getDocs(query(collection(db, "rideRequests"), where("studentId", "==", state.currentUser.uid))),
      getDocs(query(collection(db, "walletTransactions"), where("userId", "==", state.currentUser.uid)))
    ]);

    const requests = requestSnap.docs.map(docSnap => docSnap.data());
    const completedRequests = requests.filter(request => request.status === "completed" || request.status === "matched");
    const deductions = transactionSnap.docs
      .map(docSnap => docSnap.data())
      .filter(tx => tx.type === "deduction" || /ride/i.test(tx.description || ""));
    const totalSpent = deductions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

    setProfileText("studentTotalRides", String(completedRequests.length || deductions.length || 0));
    setProfileText("studentTotalSpent", formatNaira(totalSpent));
    setProfileText("studentTopPickup", mostFrequent(requests.map(request => stopLabel(request.pickup))));
    setProfileText("studentTopDropoff", mostFrequent(requests.map(request => stopLabel(request.dropoff))));
  } catch (err) {
    console.warn("Student profile stats unavailable:", err.code || err.message);
    setProfileText("studentTotalRides", "--");
    setProfileText("studentTotalSpent", "--");
  }
}

export function updateStudentProfileUI() {
  if (!state.currentUser) return;
  const name = state.currentUser.displayName || state.currentUser.name || "Guest Student";
  const email = state.currentUser.email || "Student account";
  const dashName = document.getElementById("studentDashName");
  const sideName = document.getElementById("sidebarName");
  const sideEmail = document.getElementById("sidebarEmail");
  const profName = document.getElementById("profileName");
  const profEmail = document.getElementById("profileEmail");
  const avatar = document.getElementById("profileAvatar") || document.querySelector("#profileView .profile-avatar");
  if (dashName) dashName.innerText = name;
  if (sideName) sideName.innerText = name;
  if (sideEmail) sideEmail.innerText = email;
  if (profName) profName.innerText = name;
  if (profEmail) profEmail.innerText = email;
  if (avatar) {
    avatar.innerText = getProfileInitials(name, "ST");
    avatar.style.background = getNameGradient(name);
  }

  setProfileText("profileMatricNo", state.currentUser.matricNo || "Not provided");
  setProfileText("profilePhone", state.currentUser.phone || state.currentUser.phoneNumber || "Not provided");
  setProfileText("profileEmailReadonly", email);
  renderStudentProfileStats();

  const adminLink = document.getElementById("adminLinkStudent");
  if (adminLink) {
    adminLink.classList.toggle("hidden", !state.currentUser.isAdmin);
  }
}

export async function fetchRideHistory() {
  const list = document.getElementById("activityList");
  if (!list || !state.currentUser) return;

  // show skeleton cards while the real data is loading
  list.innerHTML = Array(3).fill(`
    <div class="activity-item-skeleton" style="padding: 16px 20px; border-bottom: 1px solid var(--color-border);">
      <div class="skeleton" style="height: 16px; width: 60%; border-radius: 4px; margin-bottom: 8px;"></div>
      <div class="skeleton" style="height: 12px; width: 40%; border-radius: 4px; margin-bottom: 14px;"></div>
      <div style="display: flex; gap: 8px;">
        <div class="skeleton" style="height: 24px; width: 64px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 24px; width: 50px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 24px; width: 50px; border-radius: 6px;"></div>
      </div>
    </div>
  `).join("");

  const q = query(
    collection(db, "rideRequests"),
    where("studentId", "==", state.currentUser.uid),
    orderBy("requestedAt", "desc")
  );
  onSnapshot(q, (snapshot) => {
  const history = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    // skip ones the student soft-deleted from their history
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
  }, (err) => {
    console.warn("Ride history listener unavailable:", err.code || err.message);
    list.innerHTML = '<p class="empty-state">Ride history is unavailable right now</p>';
  });}

// these functions get bound to window from app.js
export async function requestKeke() {
  if (state.currentRideId) return showToast("You already have an active request", "error");
  const btn = document.getElementById("requestBtn");
  btn.disabled = true;
  btn.innerText = "Checking...";
  try {
    if (!state.currentUser?.uid) {
      showToast("Login required to request rides", "error");
      return;
    }
    await checkDebtBeforeRide(state.currentUser.uid);
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
    const rideStops = getRideStops();
    const pickupLoc = rideStops.find(l => l.id === pickupId);
    const dropoffLoc = rideStops.find(l => l.id === dropoffId);
    if (!pickupLoc || !dropoffLoc) {
      showToast("That stop still needs coordinates from admin", "error");
      return;
    }
    btn.innerText = "Looking for your keke...";

    const requestData = {
      studentId: state.currentUser.uid,
      studentName: state.currentUser?.displayName || "Student",
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
    
    // jump to the live tab immediately
    if (window.switchTab) window.switchTab('live');
    
    // show the bottom sheet right away so user knows something is happening
    const studentSheet = document.getElementById("studentSheet");
    if (studentSheet) {
      studentSheet.classList.remove("hidden", "expanded");
      studentSheet.classList.add("minimized");
      document.getElementById("studentControls")?.setAttribute("style", "display:flex");
    }
    updateBottomSheet("Searching", "Looking for your keke...");
    updateRideDetails("student", [
      { label: "Status", value: "Searching" },
      { label: "From", value: pickupLoc.name },
      { label: "To", value: dropoffLoc.name }
    ]);

    listenToRequest(ref.id);
    
    // matching happens client-side — create request first then claim a seat
    await runMatching(ref.id, requestData);
    
    showToast("Looking for your keke...");
  } catch (err) {
    console.error(err);
    if (err.message?.startsWith("DEBT_OUTSTANDING:")) {
      const amount = Number(err.message.split(":")[1] || 0);
      showToast(`Outstanding balance ${formatNaira(amount)}. Top up to continue.`, "error");
      if (window.openTopUpScreen) window.openTopUpScreen();
    } else {
      showToast("Failed to request ride", "error");
    }
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
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification("OpRides Match Found!", {
          body: "Your keke has been matched! Open the app to view details."
        });
      }
      state.currentRideId = request.matchedRideId;
      window.updateLiveNotifDot?.("student");
      listenToRide(request.matchedRideId, state.currentUser?.uid);
    }

    if (request.status === "queued") {
      updateBottomSheet("In Queue", `Position: #${request.queuePosition || '?'}`);
      if (request.queueDocId) {
        listenToQueuePosition(request.queueDocId);
      }
    }

    if (request.status === "cancelled") {
      showToast("Ride request cancelled", "info");
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification("Ride Cancelled", {
          body: "Your ride request has been cancelled."
        });
      }
      state.currentRideId = null;
      state.currentRequestId = null;
      window.updateLiveNotifDot?.("student");
      document.getElementById("studentSheet")?.classList.add("hidden");
      if (window.switchTab) window.switchTab('home');
    }
  }, (err) => console.warn("Ride request listener unavailable:", err.code || err.message));
}

export function listenToRide(matchedRideId, currentUserId) {
  return onSnapshot(doc(db, "rides", matchedRideId), (snapshot) => {
    const ride = snapshot.data();
    if (!ride) return;

    if (ride.status === "completed") {
      const myInfo = ride.passengers[currentUserId];
      // if i was on this ride and it's done, means i've arrived
      if (myInfo) {
        showToast("You have arrived at your destination!", "success");
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification("Trip Completed!", {
            body: "You have arrived safely. Thank you for riding with OpRides!"
          });
        }
        state.currentRideId = null;
        state.currentRequestId = null;
        window.updateLiveNotifDot?.("student");
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

    // send a notification when the keke is within 50m of the student
    if (myInfo?.pickupStatus !== "completed" && ride.currentLocation && myPickup?.location) {
      const dist = getDistance(ride.currentLocation.lat, ride.currentLocation.lng, myPickup.location.lat, myPickup.location.lng);
      if (dist <= 50) {
        if (!state.notifiedArriving) {
          state.notifiedArriving = true;
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification("Your Keke is Arriving!", {
              body: "Your driver is within 50 meters of your pickup stop. Be ready to board!"
            });
          }
        }
      } else {
        state.notifiedArriving = false;
      }
    }

    updateRideDetails("student", [
      { label: "Status", value: myInfo?.pickupStatus === "completed" ? "On Trip" : "Coming to you" },
      { label: "Stops Away", value: stopsAway },
      { label: "Seats", value: `${ride.seats.occupied}/${ride.seats.total}` },
      { label: "Fare", value: `₦${myInfo?.fare || 0}` }
    ]);

    updateBottomSheet(
      myInfo?.pickupStatus === "completed" ? "On Trip" : "Keke is on the way!",
      myInfo?.pickupStatus === "completed" ? `Heading to ${(ride.stopQueue || []).find(s => s.passengerId === currentUserId && s.type === "dropoff")?.locationLabel || 'Destination'}` : `${stopsAway} stops away`
    );

    // swap between Pay Now and Cancel button depending on ride state
    const studentControls = document.getElementById("studentControls");
    if (studentControls) {
      if (myInfo?.pickupStatus === "completed") {
        if (myInfo?.paid) {
          studentControls.innerHTML = `
            <button type="button" class="green no-clickable" style="width: 100%; pointer-events: none;" disabled>
              <i class="fas fa-check-circle"></i> Paid ₦${(myInfo.fare || 15000) / 100}
            </button>
          `;
        } else {
          studentControls.innerHTML = `
            <button type="button" id="payNowBtn" onclick="payForActiveRide()" class="green" style="width: 100%; font-weight: 700;">
              <i class="fas fa-wallet"></i> Pay Now ₦${(myInfo.fare || 15000) / 100}
            </button>
          `;
        }
        studentControls.style.display = "flex";
      } else {
        studentControls.innerHTML = `
          <button type="button" onclick="cancelRide()" class="danger" style="width: 100%;">Cancel Request</button>
        `;
        studentControls.style.display = "flex";
      }
    }
    
    // update the map from here or from app.js
    if (window.updateRideUI) window.updateRideUI(ride);
  }, (err) => console.warn("Student ride listener unavailable:", err.code || err.message));
}

export function listenToQueuePosition(queueDocId) {
  return onSnapshot(doc(db, "waitingQueue", queueDocId), (snapshot) => {
    const queue = snapshot.data();
    if (!queue) return;
    updateBottomSheet("In Queue", `Position: #${queue.position} (Est: ${queue.estimatedWait})`);
  }, (err) => console.warn("Queue position listener unavailable:", err.code || err.message));
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
  const confirmed = await showConfirmDialog({
    title: "Delete Ride Record",
    message: "Are you sure you want to delete this ride from your history?",
    danger: true
  });
  if (!confirmed) return;
  
  try {
    await updateDoc(doc(db, "rideRequests", requestId), {
      deletedByStudent: true // soft delete — rider still sees it on their end
    });
    showToast("Record removed");
  } catch (err) {
    console.error(err);
    showToast("Failed to remove record", "error");
  }
}

// bind so HTML can call it directly
window.deleteRideRecord = deleteRideRecord;

export async function payForActiveRide() {
  if (!state.currentRideId || !state.currentUser) return;
  const studentId = state.currentUser.uid;
  const rideId = state.currentRideId;

  const rideRef = doc(db, "rides", rideId);
  const studentRef = doc(db, "users", studentId);
  const adminRef = doc(db, "adminWallet", "main");

  try {
    showToast("Processing payment...");
    await runTransaction(db, async (transaction) => {
      const rideSnap = await transaction.get(rideRef);
      const studentSnap = await transaction.get(studentRef);
      if (!rideSnap.exists()) throw new Error("Ride not found");
      if (!studentSnap.exists()) throw new Error("Student not found");

      const ride = rideSnap.data();
      const student = studentSnap.data();
      
      const passenger = ride.passengers?.[studentId];
      if (!passenger) throw new Error("Passenger not matched to this ride");
      if (passenger.paid) throw new Error("Already paid");

      const currentBalance = student.wallet?.balance || 0;
      const fare = passenger.fare || 15000; 
      const riderShare = Math.floor(fare * 13000 / 15000); 
      const adminShare = fare - riderShare;

      if (currentBalance < fare) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      // deduct from student wallet
      const studentNewBalance = currentBalance - fare;
      transaction.update(studentRef, {
        "wallet.balance": studentNewBalance,
        "wallet.lastDeduction": serverTimestamp()
      });

      // rider gets their cut
      const riderRef = doc(db, "users", ride.riderId);
      const riderSnap = await transaction.get(riderRef);
      if (riderSnap.exists()) {
        const rider = riderSnap.data();
        const riderBalance = rider.earnings?.balance || 0;
        const riderTotalEarned = rider.earnings?.totalEarned || 0;
        transaction.update(riderRef, {
          "earnings.balance": riderBalance + riderShare,
          "earnings.totalEarned": riderTotalEarned + riderShare
        });
        addWalletTransaction(transaction, ride.riderId, "earning", riderShare, riderBalance, riderBalance + riderShare, "Ride fare received (prepaid)", rideId);
      }

      // admin commission goes here
      const adminSnap = await transaction.get(adminRef);
      const admin = adminSnap.exists() ? adminSnap.data() : { balance: 0, totalEarned: 0 };
      const adminBalance = admin.balance || admin.wallet?.balance || 0;
      const adminTotalEarned = admin.totalEarned || admin.wallet?.totalEarned || 0;
      writeAdminWalletTotals(transaction, adminRef, adminBalance + adminShare, adminTotalEarned + adminShare);

      // mark the student as paid on the ride doc
      transaction.update(rideRef, {
        [`passengers.${studentId}.paid`]: true
      });

      // log everything in wallet transactions
      addWalletTransaction(transaction, studentId, "deduction", fare, currentBalance, studentNewBalance, "Ride fare (prepaid)", rideId);
      addWalletTransaction(transaction, "admin", "commission", adminShare, adminBalance, adminBalance + adminShare, "Commission from ride (prepaid)", rideId);
    });

    showToast("Payment successful!", "success");
  } catch (err) {
    console.error(err);
    if (err.message === "INSUFFICIENT_BALANCE") {
      showToast("Insufficient balance. Please top up to pay.", "error");
    } else {
      showToast("Failed to process payment: " + err.message, "error");
    }
  }
}

window.payForActiveRide = payForActiveRide;
