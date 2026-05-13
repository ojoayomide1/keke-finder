import { state } from "./state.js";
import { db, collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, getDoc } from "../firebase.js";
import { CAMPUS_MAP_DATA } from "../campus-data.js";
import { showToast, updateBottomSheet, updateRideDetails } from "./ui.js";
import { initMap } from "./map-manager.js";

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
  const q = query(collection(db, "requests"), orderBy("time", "desc"));
  onSnapshot(q, (snapshot) => {
    const history = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.studentId === state.currentUser.uid) {
        history.push({ id: doc.id, ...data });
      }
    });
    if (history.length === 0) {
      list.innerHTML = '<p class="empty-state">No recent activity</p>';
      return;
    }
    list.innerHTML = history.map(h => {
      const isActive = ["waiting", "accepted", "arriving", "picked_up"].includes(h.status);
      return `
        <div class="activity-item">
          <div class="activity-info">
            <h4>Ride to ${h.dropoffName || 'Campus'}</h4>
            <p>${new Date(h.time).toLocaleString()}</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="status-pill ${h.status}" style="font-size:10px;">${h.status}</span>
            <button class="iconBtn" style="font-size:11px; width:auto; padding:5px 8px; border-radius:6px; background:#f3f4f6;" onclick="viewRideDetails('${h.id}')">Details</button>
            <button class="iconBtn" style="font-size:11px; width:auto; padding:5px 8px; border-radius:6px; background:${isActive ? '#22c55e' : '#e5e7eb'}; color:${isActive ? 'white' : '#9ca3af'};" 
              ${isActive ? `onclick="visitRide('${h.id}')"` : 'disabled'}>Visit</button>
          </div>
        </div>
      `;
    }).join("");
  });
}

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
    btn.innerText = "Finding Keke...";
    const rideData = {
      pickupId,
      pickupName: pickupLoc.name,
      pickupLat: pickupLoc.lat,
      pickupLng: pickupLoc.lng,
      dropoffId,
      dropoffName: dropoffLoc.name,
      dropoffLat: dropoffLoc.lat,
      dropoffLng: dropoffLoc.lng,
      status: "waiting",
      studentId: state.currentUser?.uid || (state.currentUser?.isGuest ? "guest" : "unknown"),
      studentName: state.currentUser?.displayName || "Guest",
      time: Date.now()
    };
    const ref = await addDoc(collection(db, "requests"), rideData);
    state.currentRideId = ref.id;
    
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("studentMap").classList.remove("hidden");
    document.getElementById("mapBackBtn").classList.remove("hidden");
    document.getElementById("studentSheet").classList.remove("hidden");
    
    initMap("studentMap");
    // startListeners will be called from app.js
    
    updateBottomSheet("Live Trip", "Waiting for rider to accept");
    updateRideDetails("student", [
      { label: "Status", value: "Waiting" },
      { label: "From", value: pickupLoc.name },
      { label: "To", value: dropoffLoc.name }
    ]);
    showToast("Ride requested successfully");
  } catch (err) {
    showToast("Failed to request ride", "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Request Ride";
  }
}

export async function cancelRide() {
  if (!state.currentRideId) return;
  await updateDoc(doc(db, "requests", state.currentRideId), { status: "cancelled" });
  state.currentRideId = null;
  document.getElementById("studentSheet").classList.add("hidden");
  // hideMap will be called from app.js
  showToast("Ride cancelled");
}
