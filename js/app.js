import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  where,
  db,
  addDoc
} from "./firebase.js";
import { initAuth } from "./auth.js";
import { state } from "./modules/state.js";
import { 
  showToast, 
  updateBottomSheet, 
  updateRideDetails, 
  toggleControls, 
  setButtonVisible,
  showLoginScreen 
} from "./modules/ui.js";
import { 
  initMap, 
  animateMarker, 
  getDistance 
} from "./modules/map-manager.js";
import { 
  populateLocations, 
  updateStudentProfileUI, 
  fetchRideHistory,
  requestKeke as _requestKeke,
  cancelRide as _cancelRide
} from "./modules/student.js";
import { 
  updateRiderDashboardUI, 
  updateAvailableRidesList, 
  updateRiderControls,
  completeRide as _completeRide
} from "./modules/rider.js";

// ================= GLOBAL BINDINGS =================
// These are needed because index.html uses onclick handlers
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
    if (state.currentUser?.isGuest) return showToast("Signup to view activity", "error");
    const vEl = document.getElementById("activityView");
    if (vEl) vEl.classList.remove("hidden");
    if (dash) dash.classList.add("hidden");
    fetchRideHistory();
  } else if (view === "profile") {
    if (state.currentUser?.isGuest) return showToast("Signup to view profile", "error");
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

window.hideRiderMap = () => {
  document.getElementById("riderDashboard").classList.remove("hidden");
  document.getElementById("riderMap").classList.add("hidden");
  document.getElementById("riderMapBackBtn").classList.add("hidden");
  document.getElementById("riderSheet").classList.add("hidden");
};

window.requestKeke = async () => {
  await _requestKeke();
  startListeners();
};
window.cancelRide = async () => {
  await _cancelRide();
  state.currentRideId = null;
};
window.completeRide = async () => {
  await _completeRide();
  state.currentRideId = null;
};

window.visitRide = async (rideId) => {
  state.currentRideId = rideId;
  const docRef = doc(db, "requests", rideId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const r = docSnap.data();
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("studentMap").classList.remove("hidden");
    document.getElementById("mapBackBtn").classList.remove("hidden");
    document.getElementById("studentSheet").classList.remove("hidden");
    initMap("studentMap");
    startListeners();
    updateRideUI(r);
    updateBottomSheet(r.status === "waiting" ? "Ride Requested" : "Trip Active", r.status);
    updateRideDetails("student", [
      { label: "Status", value: r.status },
      { label: "From", value: r.pickupName },
      { label: "To", value: r.dropoffName }
    ]);
    window.switchStudentView('dashboard');
    document.getElementById("studentDashboard").classList.add("hidden"); 
  }
};

window.viewRideDetails = async (rideId) => {
  const content = document.getElementById("rideDetailContent");
  if (!content) return;
  content.innerHTML = '<p class="empty-state">Loading details...</p>';
  window.switchStudentView('detail');
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

window.restoreActiveRideUI = async () => {
  if (!state.currentRideId) return;
  const docRef = doc(db, "requests", state.currentRideId);
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

window.acceptRide = async (rideId) => {
  if (state.currentRideId) return showToast("Finish current ride first", "error");
  document.getElementById("riderDashboard").classList.add("hidden");
  document.getElementById("riderMap").classList.remove("hidden");
  document.getElementById("riderSheet").classList.remove("hidden");
  document.getElementById("riderMapBackBtn").classList.remove("hidden");
  updateBottomSheet("Accepting...", "Syncing with student...", "rider");
  initMap("riderMap");
  state.currentRideId = rideId;
  
  const performAccept = async (lat, lng) => {
    try {
      await updateDoc(doc(db, "requests", rideId), {
        status: "accepted",
        riderId: state.currentUser.uid,
        riderName: state.currentUser.displayName,
        riderLat: lat,
        riderLng: lng
      });
      showToast("Ride accepted");
      startListeners();
    } catch (err) {
      showToast("Failed to accept ride", "error");
      window.hideRiderMap();
    }
  };
  
  if (state.lastRiderLoc) {
    performAccept(state.lastRiderLoc.lat, state.lastRiderLoc.lng);
  } else {
    showToast("Fetching location...", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.accuracy > 100) {
          showToast("GPS accuracy too low. Try again.", "error");
          window.hideRiderMap();
          return;
        }
        performAccept(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        showToast("Location required to accept", "error");
        window.hideRiderMap();
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
};

window.becomeAvailable = () => {
  if (state.riderWatchId) return;
  setButtonVisible("goLiveBtn", false);
  document.getElementById("riderTitle").innerText = "Online";
  document.getElementById("riderSub").innerText = "Activating GPS...";
  document.getElementById("availableRidesSection").classList.remove("hidden");
  showToast("Activating GPS...", "info");
  initMap("riderMap");
  
  state.riderWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    
    if (accuracy > 60) {
      document.getElementById("riderSub").innerText = "Weak GPS (Searching...)";
      return;
    }
    
    document.getElementById("riderSub").innerText = "Looking for nearby students";
    
    const distMoved = state.lastRiderLoc ? getDistance(state.lastRiderLoc.lat, state.lastRiderLoc.lng, latitude, longitude) : 999;
    if (distMoved < 10) return; 
    
    state.lastRiderLoc = { lat: latitude, lng: longitude };
    
    if (state.map && !state.currentRideId) {
      if (!state.riderMarker) {
        state.riderMarker = L.circleMarker([latitude, longitude], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(state.map);
      } else {
        animateMarker(state.riderMarker, latitude, longitude, 800);
      }
      state.map.panTo([latitude, longitude], { animate: true });
    }
    
    if (!state.riderDocId) {
      state.riderDocId = "creating...";
      const ref = await addDoc(collection(db, "kekes"), {
        name: state.currentUser.displayName,
        riderId: state.currentUser.uid,
        lat: latitude,
        lng: longitude
      });
      state.riderDocId = ref.id;
    } else if (state.riderDocId !== "creating...") {
      await updateDoc(doc(db, "kekes", state.riderDocId), { lat: latitude, lng: longitude });
    }
    
    if (state.currentRideId) {
      await updateDoc(doc(db, "requests", state.currentRideId), { riderLat: latitude, riderLng: longitude });
    }
  }, (err) => {
    showToast("Location access required", "error");
  }, { 
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
  startListeners();
};

window.setArriving = async () => {
  if (state.currentRideId) await updateDoc(doc(db, "requests", state.currentRideId), { status: "arriving" });
};

window.startRide = async () => {
  if (state.currentRideId) await updateDoc(doc(db, "requests", state.currentRideId), { status: "picked_up" });
};

// ================= ORCHESTRATION =================

async function transitionToDashboard(user) {
  document.getElementById("loginScreen").classList.add("hidden");
  if (user.role === "student") {
    state.currentRole = "student";
    document.getElementById("studentUI").classList.remove("hidden");
    populateLocations();
    updateStudentProfileUI();
    window.switchStudentView('dashboard');
    await checkForActiveRide("student");
    if (state.currentRideId) startListeners();
  } else {
    state.currentRole = "rider";
    document.getElementById("riderUI").classList.remove("hidden");
    updateRiderDashboardUI();
    await checkForActiveRide("rider");
    if (state.currentRideId) startListeners();
  }
}

async function checkForActiveRide(role) {
  const q = query(
    collection(db, "requests"), 
    where(role === "student" ? "studentId" : "riderId", "==", state.currentUser?.uid || (state.currentUser?.isGuest ? "guest" : "unknown")),
    where("status", "in", ["waiting", "accepted", "arriving", "picked_up"])
  );
  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    const activeRide = querySnapshot.docs[0];
    state.currentRideId = activeRide.id;
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

function startListeners() {
  if (state.unsubscribeRequests) state.unsubscribeRequests();
  
  const q = query(collection(db, "requests"), orderBy("time", "desc"));
  let lastData = null;

  state.unsubscribeRequests = onSnapshot(q, (snapshot) => {
    const availableRides = [];
    if (state.map) {
      state.requestMarkers.forEach(m => state.map.removeLayer(m));
      state.requestMarkers = [];
    }
    
    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      const rideId = docSnap.id;
      
      if (r.status === "waiting" && state.currentRole === "rider") {
        availableRides.push({ id: rideId, ...r });
        if (state.map) {
          const marker = L.circleMarker([r.pickupLat, r.pickupLng], { color: '#ef4444' }).addTo(state.map);
          marker.bindPopup(`<b>Ride from ${r.pickupName}</b><br><button onclick="acceptRide('${rideId}')">Accept</button>`);
          state.requestMarkers.push(marker);
        }
      }
      
      if (rideId === state.currentRideId) {
        const currentDataStr = JSON.stringify({ 
          status: r.status, 
          riderLat: r.riderLat, 
          riderLng: r.riderLng,
          pickupLat: r.pickupLat,
          pickupLng: r.pickupLng
        });
        
        if (currentDataStr !== lastData) {
          lastData = currentDataStr;
          updateRideUI(r);
        }
      }
    });
    
    if (state.currentRole === "rider") {
      updateAvailableRidesList(availableRides);
    }
  });
}

function updateRideUI(r) {
  if (!state.map) return;
  const activeCard = document.getElementById("riderActiveRideSection");
  if (state.currentRole === "rider" && activeCard) {
    if (["accepted", "arriving", "picked_up"].includes(r.status)) {
      activeCard.classList.remove("hidden");
      const sub = document.getElementById("riderActiveRideSub");
      if (sub) sub.innerText = `Active trip to ${r.status === 'picked_up' ? r.dropoffName : r.pickupName}`;
    } else {
      activeCard.classList.add("hidden");
    }
  }
  
  const distToPickup = r.riderLat ? state.map.distance([r.riderLat, r.riderLng], [r.pickupLat, r.pickupLng]) : 0;
  const distToDropoff = r.riderLat ? state.map.distance([r.riderLat, r.riderLng], [r.dropoffLat, r.dropoffLng]) : 0;
  
  if (r.riderLat) {
    if (!state.riderMarker) {
      state.riderMarker = L.circleMarker([r.riderLat, r.riderLng], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(state.map);
    } else {
      animateMarker(state.riderMarker, r.riderLat, r.riderLng, 1000);
    }
    if (state.currentRole === "rider") {
      state.map.panTo([r.riderLat, r.riderLng], { animate: true, duration: 1.0 });
    }
  }
  
  if (state.currentRole === "rider") {
    if (!state.userMarker) {
      state.userMarker = L.circleMarker([r.pickupLat, r.pickupLng], { radius: 6, color: '#ef4444', fillOpacity: 1 }).addTo(state.map);
      state.userMarker.bindPopup("Pickup: " + r.pickupName);
    }
    if (r.status === "picked_up") {
      animateMarker(state.userMarker, r.dropoffLat, r.dropoffLng, 1000);
      state.userMarker.setPopupContent("Drop-off: " + r.dropoffName);
    }
  }
  
  if (state.currentRole === "student") {
    if (r.status === "accepted") updateBottomSheet("Rider Coming", `${Math.round(distToPickup)}m away`);
    else if (r.status === "arriving") updateBottomSheet("Rider Arriving", "Get ready");
    else if (r.status === "picked_up") updateBottomSheet("On Trip", `Heading to ${r.dropoffName}`);
    else if (r.status === "completed") {
      updateBottomSheet("Completed", "Ride finished");
      setTimeout(() => {
        document.getElementById("studentSheet").classList.add("hidden");
        window.hideMap();
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
        window.hideRiderMap();
      }, 3000);
    }
  }
  
  if (r.riderLat) {
    const targetLat = (r.status === "picked_up") ? r.dropoffLat : r.pickupLat;
    const targetLng = (r.status === "picked_up") ? r.dropoffLng : r.pickupLng;
    if (!state.routeControl) {
      state.routeControl = L.Routing.control({
        waypoints: [L.latLng(r.riderLat, r.riderLng), L.latLng(targetLat, targetLng)],
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
      }).addTo(state.map);
    } else {
      state.routeControl.setWaypoints([L.latLng(r.riderLat, r.riderLng), L.latLng(targetLat, targetLng)]);
    }
  }
}

// ================= INIT =================
window.addEventListener("load", () => {
  initAuth({
    onUserChanged: (user) => {
      state.currentUser = user;
      if (user) {
        transitionToDashboard(user);
      } else {
        if (state.unsubscribeRequests) state.unsubscribeRequests();
        if (state.map) state.map.remove();
        state.unsubscribeRequests = null;
        state.map = null;
        showLoginScreen();
      }
    },
    showLoginScreen
  });
});
