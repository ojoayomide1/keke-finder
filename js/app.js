import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  where,
  db
} from "./firebase.js";
import { initAuth } from "./auth.js";
import { renderCampusMapData } from "./campus-map.js";
import { CAMPUS_MAP_DATA } from "./campus-data.js";

// ================= GLOBAL STATE =================
let map = null;
let currentRole = null;
let currentUser = null;
let currentRideId = null;
let riderDocId = null;
let currentRiderName = "";
let riderWatchId = null;
let lastRiderLoc = null;

let requestMarkers = [];
let riderMarker = null;
let routeControl = null;
let userMarker = null;
let unsubscribeRequests = null;

let hasFocused = false;

// ================= UI HELPERS (TOP-LEVEL) =================
function updateBottomSheet(title, sub, target = "student") {
  const sheet = document.getElementById(`${target}Sheet`);
  if (!sheet) return;
  const h3 = sheet.querySelector("h3");
  const p = sheet.querySelector("p");
  if (h3) h3.innerText = title;
  if (p) p.innerText = sub;
}

function updateRideDetails(target, details) {
  const container = document.getElementById(`${target}RideDetails`);
  if (!container) return;
  container.innerHTML = details.map(d => `
    <div class="ride-detail"><span>${d.label}</span><strong>${d.value}</strong></div>
  `).join("");
}

function toggleControls(show, target = "student") {
  const el = document.getElementById(`${target}Controls`);
  if (el) el.style.display = show ? "flex" : "none";
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type} show`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => { 
    toast.classList.remove("show"); 
    setTimeout(() => toast.remove(), 300); 
  }, 2500);
}

function setButtonVisible(id, visible) {
  const btn = document.getElementById(id);
  if (btn) btn.classList.toggle("hidden", !visible);
}

// ================= UTILS =================
function getDistance(lat1, lon1, lat2, lng2) {
  if (!lat1 || !lon1 || !lat2 || !lng2) return 0;
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}

// ================= MAP LOGIC =================
function initMap(mapId) {
  if (map) {
    map.remove();
    map = null;
  }

  // Reset marker/route references so they are re-created on the new map
  riderMarker = null;
  userMarker = null;
  routeControl = null;
  requestMarkers = [];

  map = L.map(mapId, { tap: false }).setView([9.2880, 7.4130], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  renderCampusMapData(map);
  setTimeout(() => map.invalidateSize(), 500);
}

// ================= SCREEN TRANSITIONS =================
function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  if (unsubscribeRequests) unsubscribeRequests();
  if (map) map.remove();
  unsubscribeRequests = null;
  map = null;
}

async function transitionToDashboard(user) {
  document.getElementById("loginScreen").classList.add("hidden");
  
  if (user.role === "student") {
    currentRole = "student";
    document.getElementById("studentUI").classList.remove("hidden");
    populateLocations();
    updateStudentProfileUI();
    switchStudentView('dashboard');
    checkForActiveRide("student");
  } else {
    currentRole = "rider";
    document.getElementById("riderUI").classList.remove("hidden");
    updateRiderDashboardUI();
    checkForActiveRide("rider");
  }
}

async function checkForActiveRide(role) {
  const q = query(
    collection(db, "requests"), 
    where(role === "student" ? "studentId" : "riderId", "==", currentUser?.uid || (currentUser?.isGuest ? "guest" : "unknown")),
    where("status", "in", ["waiting", "accepted", "arriving", "picked_up"])
  );
  
  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    const activeRide = querySnapshot.docs[0];
    currentRideId = activeRide.id;
    
    if (role === "rider") {
      document.getElementById("riderActiveRideSection").classList.remove("hidden");
      document.getElementById("riderActiveRideSub").innerText = `Active ride from ${activeRide.data().pickupName}`;
    }
  } else {
    if (role === "rider") {
      const el = document.getElementById("riderActiveRideSection");
      if (el) el.classList.add("hidden");
    }
  }
}

// ================= STUDENT LOGIC =================
function populateLocations() {
  const pickup = document.getElementById("pickupSelect");
  const dropoff = document.getElementById("dropoffSelect");
  if (!pickup || !dropoff) return;
  
  const options = CAMPUS_MAP_DATA.locations.map(loc => 
    `<option value="${loc.id}">${loc.name}</option>`
  ).join("");
  
  pickup.innerHTML = `<option value="">Select Pickup Location</option>` + options;
  dropoff.innerHTML = `<option value="">Select Drop-off Location</option>` + options;
}

window.toggleSidebar = () => {
  const sidebar = document.getElementById("studentSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar || !overlay) return;
  const isHidden = sidebar.classList.contains("hidden");

  sidebar.classList.toggle("hidden", !isHidden);
  overlay.classList.toggle("hidden", !isHidden);
};

window.switchStudentView = (view) => {
  const overlays = ["activityView", "profileView", "activityDetailView"];
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
  } else if (view === "detail") {
    const vEl = document.getElementById("activityDetailView");
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
  document.getElementById("studentSheet").classList.add("hidden");
};

async function fetchRideHistory() {
  const list = document.getElementById("activityList");
  if (!list || !currentUser || currentUser.isGuest) return;

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

window.visitRide = async (rideId) => {
  currentRideId = rideId;
  const docRef = doc(db, "requests", rideId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    const r = docSnap.data();
    // Switch to map view
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("studentMap").classList.remove("hidden");
    document.getElementById("mapBackBtn").classList.remove("hidden");
    document.getElementById("studentSheet").classList.remove("hidden");
    
    initMap("studentMap");
    startListeners();
    updateRideUI(r);
    
    // Update sheet initial state
    updateBottomSheet(r.status === "waiting" ? "Ride Requested" : "Trip Active", r.status);
    updateRideDetails("student", [
      { label: "Status", value: r.status },
      { label: "From", value: r.pickupName },
      { label: "To", value: r.dropoffName }
    ]);
    
    // Close activity view
    switchStudentView('dashboard');
    document.getElementById("studentDashboard").classList.add("hidden"); 
  }
};

window.viewRideDetails = async (rideId) => {
  const content = document.getElementById("rideDetailContent");
  if (!content) return;
  content.innerHTML = '<p class="empty-state">Loading details...</p>';
  switchStudentView('detail');

  try {
    const docRef = doc(db, "requests", rideId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const r = docSnap.data();
      content.innerHTML = `
        <div class="profile-card">
          <h3>Ride Info</h3>
          <div class="settings-list" style="text-align:left;">
            <div class="settings-item"><span>Status</span><strong>${r.status}</strong></div>
            <div class="settings-item"><span>From</span><strong>${r.pickupName}</strong></div>
            <div class="settings-item"><span>To</span><strong>${r.dropoffName}</strong></div>
            <div class="settings-item"><span>Rider</span><strong>${r.riderName || 'N/A'}</strong></div>
            <div class="settings-item"><span>Time</span><strong>${new Date(r.time).toLocaleString()}</strong></div>
          </div>
        </div>
      `;
    }
  } catch (err) {
    content.innerHTML = '<p class="empty-state">Failed to load details</p>';
  }
};

function updateStudentProfileUI() {
  if (!currentUser) return;
  const name = currentUser.displayName || "Guest Student";
  const email = currentUser.email || "Guest User";

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

// ================= RIDER LOGIC =================
function updateRiderDashboardUI() {
  if (!currentUser) return;
  const el = document.getElementById("riderDashName");
  if (el) el.innerText = currentUser.displayName;
}

window.hideRiderMap = () => {
  document.getElementById("riderDashboard").classList.remove("hidden");
  document.getElementById("riderMap").classList.add("hidden");
  document.getElementById("riderMapBackBtn").classList.add("hidden");
  document.getElementById("riderSheet").classList.add("hidden");
};

window.restoreActiveRideUI = async () => {
  if (!currentRideId) return;
  
  const docRef = doc(db, "requests", currentRideId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    document.getElementById("riderDashboard").classList.add("hidden");
    document.getElementById("riderMap").classList.remove("hidden");
    document.getElementById("riderSheet").classList.remove("hidden");
    document.getElementById("riderMapBackBtn").classList.remove("hidden");
    
    initMap("riderMap");
    startListeners();
    updateRideUI(docSnap.data());
    showToast("Trip map restored");
  }
};

// ================= RIDE ACTIONS =================
window.requestKeke = async () => {
  if (currentRideId) return showToast("You already have an active request", "error");

  const btn = document.getElementById("requestBtn");
  btn.disabled = true;
  btn.innerText = "Checking...";

  try {
    const pickupId = document.getElementById("pickupSelect").value;
    const dropoffId = document.getElementById("dropoffSelect").value;

    if (!pickupId || !dropoffId) {
      showToast("Select pickup and drop-off", "error");
      btn.disabled = false;
      btn.innerText = "Request Ride";
      return;
    }
    if (pickupId === dropoffId) {
      showToast("Pickup and drop-off cannot be same", "error");
      btn.disabled = false;
      btn.innerText = "Request Ride";
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
      studentId: currentUser?.uid || (currentUser?.isGuest ? "guest" : "unknown"),
      studentName: currentUser?.displayName || "Guest",
      time: Date.now()
    };

    const ref = await addDoc(collection(db, "requests"), rideData);
    currentRideId = ref.id;

    // Show Map
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("studentMap").classList.remove("hidden");
    document.getElementById("mapBackBtn").classList.remove("hidden");
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

window.acceptRide = async (rideId) => {
  if (currentRideId) return showToast("Finish current ride first", "error");

  // Instant UI Feedback
  document.getElementById("riderDashboard").classList.add("hidden");
  document.getElementById("riderMap").classList.remove("hidden");
  document.getElementById("riderSheet").classList.remove("hidden");
  document.getElementById("riderMapBackBtn").classList.remove("hidden");
  updateBottomSheet("Accepting...", "Syncing with student...", "rider");
  
  initMap("riderMap");
  currentRideId = rideId;

  const performAccept = async (lat, lng) => {
    try {
      await updateDoc(doc(db, "requests", rideId), {
        status: "accepted",
        riderId: currentUser.uid,
        riderName: currentUser.displayName,
        riderLat: lat,
        riderLng: lng
      });
      showToast("Ride accepted");
      startListeners();
    } catch (err) {
      showToast("Failed to accept ride", "error");
      hideRiderMap();
    }
  };

  if (lastRiderLoc) {
    performAccept(lastRiderLoc.lat, lastRiderLoc.lng);
  } else {
    showToast("Fetching location...", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => performAccept(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        showToast("Location required to accept", "error");
        hideRiderMap();
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
};

window.becomeAvailable = () => {
  if (riderWatchId) return;
  
  setButtonVisible("goLiveBtn", false);
  document.getElementById("riderTitle").innerText = "Online";
  document.getElementById("riderSub").innerText = "Warming up GPS...";
  document.getElementById("availableRidesSection").classList.remove("hidden");
  showToast("Warming up GPS...", "info");

  initMap("riderMap");

  riderWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy > 60) return;

    const distMoved = lastRiderLoc ? getDistance(lastRiderLoc.lat, lastRiderLoc.lng, latitude, longitude) : 999;
    if (distMoved < 5) return;

    lastRiderLoc = { lat: latitude, lng: longitude };
    document.getElementById("riderSub").innerText = "Looking for nearby students";

    if (map && !currentRideId) {
      if (!riderMarker) {
        riderMarker = L.circleMarker([latitude, longitude], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(map);
      } else {
        riderMarker.setLatLng([latitude, longitude]);
      }
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
  }, { 
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
  
  startListeners();
};

window.setArriving = async () => {
  if (currentRideId) await updateDoc(doc(db, "requests", currentRideId), { status: "arriving" });
};

window.startRide = async () => {
  if (currentRideId) await updateDoc(doc(db, "requests", currentRideId), { status: "picked_up" });
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

function updateRideUI(r) {
  if (!map) return;
  
  const activeCard = document.getElementById("riderActiveRideSection");
  if (currentRole === "rider" && activeCard) {
    if (["accepted", "arriving", "picked_up"].includes(r.status)) {
      activeCard.classList.remove("hidden");
      const sub = document.getElementById("riderActiveRideSub");
      if (sub) sub.innerText = `Active trip to ${r.status === 'picked_up' ? r.dropoffName : r.pickupName}`;
    } else {
      activeCard.classList.add("hidden");
    }
  }

  const distToPickup = r.riderLat ? map.distance([r.riderLat, r.riderLng], [r.pickupLat, r.pickupLng]) : 0;
  const distToDropoff = r.riderLat ? map.distance([r.riderLat, r.riderLng], [r.dropoffLat, r.dropoffLng]) : 0;
  
  if (r.riderLat) {
    if (!riderMarker) {
      riderMarker = L.circleMarker([r.riderLat, r.riderLng], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(map);
    } else {
      riderMarker.setLatLng([r.riderLat, r.riderLng]);
    }
  }

  if (currentRole === "rider") {
    if (!userMarker) {
      userMarker = L.circleMarker([r.pickupLat, r.pickupLng], { radius: 6, color: '#ef4444', fillOpacity: 1 }).addTo(map);
      userMarker.bindPopup("Pickup: " + r.pickupName);
    }
    if (r.status === "picked_up") {
      userMarker.setLatLng([r.dropoffLat, r.dropoffLng]);
      userMarker.setPopupContent("Drop-off: " + r.dropoffName);
    }
  }

  if (currentRole === "student") {
    if (r.status === "accepted") updateBottomSheet("Rider Coming", `${Math.round(distToPickup)}m away`);
    else if (r.status === "arriving") updateBottomSheet("Rider Arriving", "Get ready");
    else if (r.status === "picked_up") updateBottomSheet("On Trip", `Heading to ${r.dropoffName}`);
    else if (r.status === "completed") {
      updateBottomSheet("Completed", "Ride finished");
      setTimeout(() => {
        document.getElementById("studentSheet").classList.add("hidden");
        hideMap();
      }, 3000);
    }
  } else {
    if (r.status === "accepted") {
      updateBottomSheet("Heading to Pickup", `${Math.round(distToPickup)}m away`, "rider");
      toggleControls(true, "rider");
      updateRiderControls("arriving");
    } else if (r.status === "arriving") {
      updateBottomSheet("Arrived at Pickup", "Wait for student", "rider");
      updateRiderControls("picked_up");
    } else if (r.status === "picked_up") {
      updateBottomSheet("Heading to Drop-off", `${Math.round(distToDropoff)}m away`, "rider");
      updateRiderControls("completed");
    } else if (r.status === "completed") {
      updateBottomSheet("Job Done", "Payment received", "rider");
      setTimeout(() => {
        document.getElementById("riderSheet").classList.add("hidden");
        hideRiderMap();
      }, 3000);
    }
  }
  
  if (r.riderLat) {
    const targetLat = (r.status === "picked_up") ? r.dropoffLat : r.pickupLat;
    const targetLng = (r.status === "picked_up") ? r.dropoffLng : r.pickupLng;

    if (!routeControl) {
      routeControl = L.Routing.control({
        waypoints: [L.latLng(r.riderLat, r.riderLng), L.latLng(targetLat, targetLng)],
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
      }).addTo(map);
    } else {
      routeControl.setWaypoints([L.latLng(r.riderLat, r.riderLng), L.latLng(targetLat, targetLng)]);
    }
  }
}

function updateRiderControls(nextState) {
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
