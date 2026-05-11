import { state } from "./state.js";
import { db, collection, addDoc, updateDoc, doc } from "../firebase.js";
import { showToast, setButtonVisible } from "./ui.js";
import { initMap, animateMarker } from "./map-manager.js";

export function updateRiderDashboardUI() {
  if (!state.currentUser) return;
  const el = document.getElementById("riderDashName");
  if (el) el.innerText = state.currentUser.displayName;
}

export function updateAvailableRidesList(rides) {
  const list = document.getElementById("availableRidesList");
  if (!list) return;
  if (rides.length === 0) {
    list.innerHTML = '<p class="empty-state">No requests yet. Stay tuned!</p>';
    return;
  }
  list.innerHTML = rides.map(r => `
    <div class="ride-item">
      <div class="ride-info">
        <h4>From: ${r.pickupName}</h4>
        <p>To: ${r.dropoffName}</p>
        <p>Student: ${r.studentName}</p>
      </div>
      <button class="accept-btn" onclick="acceptRide('${r.id}')">Accept</button>
    </div>
  `).join("");
}

export function updateRiderControls(nextState) {
  const container = document.getElementById("riderControls");
  if (!container) return;
  if (nextState === "arriving") {
    container.innerHTML = `<button onclick="setArriving()" class="yellow">I've Arrived</button>`;
  } else if (nextState === "picked_up") {
    container.innerHTML = `<button onclick="startRide()" class="green">Student Picked Up</button>`;
  } else if (nextState === "completed") {
    container.innerHTML = `<button onclick="completeRide()" class="green">Complete Ride</button>`;
  }
}

export async function completeRide() {
  if (!state.currentRideId) return;
  await updateDoc(doc(db, "requests", state.currentRideId), { status: "completed" });
  state.currentRideId = null;
  document.getElementById("riderSheet").classList.add("hidden");
  // hideRiderMap will be called from app.js
  showToast("Ride completed");
}
