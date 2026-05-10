import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  db
} from "./firebase.js";
import { initAuth } from "./auth.js";
import { renderCampusMapData } from "./campus-map.js";
import { CAMPUS_MAP_DATA } from "./campus-data.js";

// ================= GLOBAL =================
let map = null;
let currentRole = null;
let currentUser = null;
let currentRideId = null;
let riderDocId = null;
let currentRiderName = "";
let riderWatchId = null;

let requestMarkers = [];
let riderMarker = null;
let routeControl = null;
let userMarker = null;
let unsubscribeRequests = null;

let hasFocused = false;

// ================= MAP =================
function initMap(mapId) {
  if (map) map.remove();

  map = L.map(mapId, { tap: false }).setView([9.2880, 7.4130], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  renderCampusMapData(map);
  setTimeout(() => map.invalidateSize(), 500);
}

// ================= SCREENS =================
function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  if (unsubscribeRequests) unsubscribeRequests();
  if (map) map.remove();
  unsubscribeRequests = null;
  map = null;
}

function transitionToDashboard(user) {
  document.getElementById("loginScreen").classList.add("hidden");
  
  if (user.role === "student") {
    currentRole = "student";
    document.getElementById("studentUI").classList.remove("hidden");
    populateLocations();
    updateStudentProfileUI();
    switchStudentView('dashboard');
  } else {
    currentRole = "rider";
    document.getElementById("riderUI").classList.remove("hidden");
    updateRiderDashboardUI();
  }
}

// ================= STUDENT DASHBOARD =================
function populateLocations() {
  const pickup = document.getElementById("pickupSelect");
  const dropoff = document.getElementById("dropoffSelect");
  
  const options = CAMPUS_MAP_DATA.locations.map(loc => 
    `<option value="${loc.id}">${loc.name}</option>`
  ).join("");
  
  pickup.innerHTML = `<option value="">Select Pickup Location</option>` + options;
  dropoff.innerHTML = `<option value="">Select Drop-off Location</option>` + options;
}

window.toggleSidebar = () => {
  const sidebar = document.getElementById("studentSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const isHidden = sidebar.classList.contains("hidden");

  sidebar.classList.toggle("hidden", !isHidden);
  overlay.classList.toggle("hidden", !isHidden);
};

window.switchStudentView = (view) => {
  const overlays = ["activityView", "profileView"];
  overlays.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.add("hidden");
  });
  
  const dash = document.getElementById("studentDashboard");
  if (dash) dash.classList.remove("hidden");

  if (view === "activity") {
    if (currentUser?.isGuest) return showToast("Signup to view activity", "error");
    const vEl = document.getElementById("activityView");
    if (vEl) vEl.classList.remove("hidden");
    if (dash) dash.classList.add("hidden");
    fetchRideHistory();
  } else if (view === "profile") {
    if (currentUser?.isGuest) return showToast("Signup to view profile", "error");
    const vEl = document.getElementById("profileView");
    if (vEl) vEl.classList.remove("hidden");
    if (dash) dash.classList.add("hidden");
  }

  document.querySelectorAll(".nav-item").forEach(item => {
    if (item && item.innerText) {
      item.classList.toggle("active", item.innerText.toLowerCase().includes(view));
    }
  });

  const sidebar = document.getElementById("studentSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar) sidebar.classList.add("hidden");
  if (overlay) overlay.classList.add("hidden");
};

window.showMap = () => {
  document.getElementById("studentDashboard").classList.add("hidden");
  document.getElementById("studentMap").classList.remove("hidden");
  document.getElementById("mapBackBtn").classList.remove("hidden");
  initMap("studentMap");
};

window.hideMap = () => {
  document.getElementById("studentDashboard").classList.remove("hidden");
  document.getElementById("studentMap").classList.add("hidden");
  document.getElementById("mapBackBtn").classList.add("hidden");
};

async function fetchRideHistory() {
  const list = document.getElementById("activityList");
  if (!currentUser || currentUser.isGuest) return;

  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    const history = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.studentId === currentUser.uid) {
        history.push({ id: doc.id, ...data });
      }
    });

    if (history.length === 0) {
      list.innerHTML = '<p class="empty-state">No recent activity</p>';
      return;
    }

    list.innerHTML = history.map(h => `
      <div class="activity-item">
        <div class="activity-info">
          <h4>Ride to Campus</h4>
          <p>${new Date(h.time).toLocaleString()}</p>
        </div>
        <span class="status-pill ${h.status}">${h.status}</span>
      </div>
    `).join("");
  });
}

function updateStudentProfileUI() {
  if (!currentUser) return;
  const name = currentUser.displayName || "Guest Student";
  const email = currentUser.email || "Guest User";

  document.getElementById("studentDashName").innerText = name;
  document.getElementById("sidebarName").innerText = name;
  document.getElementById("sidebarEmail").innerText = email;
  document.getElementById("profileName").innerText = name;
  document.getElementById("profileEmail").innerText = email;
  document.querySelector(".profile-avatar").innerText = name.charAt(0).toUpperCase();
}

// ================= RIDER DASHBOARD =================
function updateRiderDashboardUI() {
  if (!currentUser) return;
  document.getElementById("riderDashName").innerText = currentUser.displayName;
}

window.hideRiderMap = () => {
  document.getElementById("riderDashboard").classList.remove("hidden");
  document.getElementById("riderMap").classList.add("hidden");
  document.getElementById("riderMapBackBtn").classList.add("hidden");
};

// ================= RIDE LOGIC =================
window.requestKeke = async () => {
  if (currentRideId) return;

  const pickupId = document.getElementById("pickupSelect").value;
  const dropoffId = document.getElementById("dropoffSelect").value;

  if (!pickupId || !dropoffId) return showToast("Select pickup and drop-off", "error");
  if (pickupId === dropoffId) return showToast("Pickup and drop-off cannot be same", "error");

  const pickupLoc = CAMPUS_MAP_DATA.locations.find(l => l.id === pickupId);
  const dropoffLoc = CAMPUS_MAP_DATA.locations.find(l => l.id === dropoffId);

  const btn = document.getElementById("requestBtn");
  btn.disabled = true;
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
    studentId: currentUser?.uid || "guest",
    studentName: currentUser?.displayName || "Guest",
    time: Date.now()
  };

  try {
    const ref = await addDoc(collection(db, "requests"), rideData);
    currentRideId = ref.id;

    // Show Map with Route
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("studentMap").classList.remove("hidden");
    document.getElementById("studentSheet").classList.remove("hidden");
    initMap("studentMap");
    startListeners();

    updateBottomSheet("Ride Requested", "Waiting for rider to accept");
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
};

window.cancelRide = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "cancelled" });
  currentRideId = null;
  document.getElementById("studentSheet").classList.add("hidden");
  hideMap();
  showToast("Ride cancelled");
};

// ================= RIDER ACTIONS =================
window.becomeAvailable = () => {
  if (riderWatchId) return;
  
  setButtonVisible("goLiveBtn", false);
  document.getElementById("riderTitle").innerText = "Online";
  document.getElementById("riderSub").innerText = "Looking for nearby students";
  document.getElementById("availableRidesSection").classList.remove("hidden");
  showToast("You are now live");

  // Ensure map is ready in background
  initMap("riderMap");

  riderWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    
    // Update local map view if not in active ride
    if (map && !currentRideId) {
      map.setView([latitude, longitude], 15);
    }

    if (!riderDocId) {
      const ref = await addDoc(collection(db, "kekes"), {
        name: currentUser.displayName,
        riderId: currentUser.uid,
        lat: latitude,
        lng: longitude
      });
      riderDocId = ref.id;
    } else {
      await updateDoc(doc(db, "kekes", riderDocId), { lat: latitude, lng: longitude });
    }

    if (currentRideId) {
      await updateDoc(doc(db, "requests", currentRideId), { riderLat: latitude, riderLng: longitude });
    }
  }, (err) => {
    showToast("Location access required to go live", "error");
  }, { enableHighAccuracy: true });
  
  startListeners();
};

window.setArriving = async () => {
  if (currentRideId) await updateDoc(doc(db, "requests", currentRideId), { status: "arriving" });
};

window.completeRide = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "completed" });
  currentRideId = null;
  document.getElementById("riderSheet").classList.add("hidden");
  hideRiderMap();
  showToast("Ride completed");
};

// ================= LISTENERS =================
function startListeners() {
  if (unsubscribeRequests) unsubscribeRequests();
  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  unsubscribeRequests = onSnapshot(q, (snapshot) => {
    const availableRides = [];
    
    if (map) {
      requestMarkers.forEach(m => map.removeLayer(m));
      requestMarkers = [];
    }

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      const rideId = docSnap.id;

      if (r.status === "waiting" && currentRole === "rider") {
        availableRides.push({ id: rideId, ...r });
        
        if (map) {
          const marker = L.circleMarker([r.pickupLat, r.pickupLng], { color: '#ef4444' }).addTo(map);
          marker.bindPopup(`<b>Ride from ${r.pickupName}</b><br><button onclick="acceptRide('${rideId}')">Accept</button>`);
          requestMarkers.push(marker);
        }
      }

      if (rideId === currentRideId) {
        updateRideUI(r);
      }
    });

    if (currentRole === "rider") {
      updateAvailableRidesList(availableRides);
    }
  });
}

function updateAvailableRidesList(rides) {
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

window.acceptRide = async (rideId) => {
  if (currentRideId) return showToast("Finish current ride first", "error");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    await updateDoc(doc(db, "requests", rideId), {
      status: "accepted",
      riderName: currentUser.displayName,
      riderLat: pos.coords.latitude,
      riderLng: pos.coords.longitude
    });
    currentRideId = rideId;
    
    // Switch to map view
    document.getElementById("riderDashboard").classList.add("hidden");
    document.getElementById("riderMap").classList.remove("hidden");
    document.getElementById("riderSheet").classList.remove("hidden");
    document.getElementById("riderMapBackBtn").classList.remove("hidden");
    
    initMap("riderMap");
    showToast("Ride accepted");
  });
};

function updateRideUI(r) {
  if (!map) return;
  const dist = r.riderLat ? map.distance([r.riderLat, r.riderLng], [r.pickupLat, r.pickupLng]) : 0;
  
  if (currentRole === "student") {
    if (r.status === "accepted") updateBottomSheet("Rider Coming", `${Math.round(dist)}m away`);
    else if (r.status === "arriving") updateBottomSheet("Rider Arriving", "Get ready");
    else if (r.status === "completed") {
      updateBottomSheet("Completed", "Ride finished");
      setTimeout(() => {
        document.getElementById("studentSheet").classList.add("hidden");
        hideMap();
      }, 3000);
    }
  } else {
    if (r.status === "accepted") {
      updateBottomSheet("Heading to Pickup", `${Math.round(dist)}m away`, "rider");
      toggleControls(true, "rider");
    } else if (r.status === "arriving") {
      updateBottomSheet("Arrived at Pickup", "Wait for student", "rider");
    } else if (r.status === "completed") {
      updateBottomSheet("Job Done", "Payment received", "rider");
      setTimeout(() => {
        document.getElementById("riderSheet").classList.add("hidden");
        hideRiderMap();
      }, 3000);
    }
  }
  
  if (r.riderLat) {
    if (routeControl) map.removeControl(routeControl);
    routeControl = L.Routing.control({
      waypoints: [L.latLng(r.riderLat, r.riderLng), L.latLng(r.pickupLat, r.pickupLng)],
      createMarker: () => null,
      addWaypoints: false,
      draggableWaypoints: false,
      lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
    }).addTo(map);
  }
}

// ================= UI HELPERS =================
function updateBottomSheet(title, sub, target = "student") {
  const sheet = document.getElementById(`${target}Sheet`);
  sheet.querySelector("h3").innerText = title;
  sheet.querySelector("p").innerText = sub;
}

function updateRideDetails(target, details) {
  const container = document.getElementById(`${target}RideDetails`);
  container.innerHTML = details.map(d => `
    <div class="ride-detail"><span>${d.label}</span><strong>${d.value}</strong></div>
  `).join("");
}

function toggleControls(show, target = "student") {
  document.getElementById(`${target}Controls`).style.display = show ? "flex" : "none";
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type} show`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 2500);
}

function setButtonVisible(id, visible) {
  const btn = document.getElementById(id);
  if (btn) btn.classList.toggle("hidden", !visible);
}

// ================= INIT =================
window.addEventListener("load", () => {
  initAuth({
    onUserChanged: (user) => {
      currentUser = user;
      if (user) transitionToDashboard(user);
      else showLoginScreen();
    },
    showLoginScreen
  });
});
