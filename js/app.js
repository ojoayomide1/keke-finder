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

  map = L.map(mapId, { tap: false }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  renderCampusMapData(map);
  setTimeout(() => map.invalidateSize(), 500);
}

// ================= SCREENS =================
function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("roleSelect").classList.add("hidden");
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  if (unsubscribeRequests) unsubscribeRequests();
  if (map) map.remove();
  unsubscribeRequests = null;
  map = null;
}

function showRoleSelect() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");
}
// ================= ROLE =================
window.selectRole = (role) => {
  currentRole = role;
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setButtonVisible("requestBtn", !currentRideId);
    document.getElementById("studentControls").style.display = currentRideId ? "flex" : "none";
    setTimeout(() => {
      initMap("studentMap");
      startListeners();
    }, 200);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setButtonVisible("goLiveBtn", !riderWatchId);
    setTimeout(() => {
      initMap("riderMap");
      startListeners();
    }, 200);
  }
};

window.goBackToRole = () => {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");

  if (unsubscribeRequests) unsubscribeRequests();
  if (map) map.remove();

  unsubscribeRequests = null;
  map = null;
  currentRideId = null;
  riderDocId = null;
  riderMarker = null;
  routeControl = null;
  requestMarkers = [];
  userMarker = null;
  hasFocused = false;
  clearRideDetails();
};

// ================= UI =================
function getActiveSheet() {
  return currentRole === "student"
    ? document.getElementById("studentSheet")
    : document.getElementById("riderSheet");
}

function updateBottomSheet(title, sub) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  sheet.querySelector("h3").innerText = title;
  sheet.querySelector("p").innerText = sub;
}

function toggleControls(show) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const controls = sheet.querySelector(".controls");
  if (controls) controls.style.display = show ? "flex" : "none";
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type} show`;
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setButtonVisible(id, isVisible) {
  const button = document.getElementById(id);
  if (!button) return;
  button.classList.toggle("hidden", !isVisible);
  button.disabled = !isVisible;
}

function updateRideDetails(target, details) {
  const container = document.getElementById(`${target}RideDetails`);
  if (!container) return;

  container.innerHTML = details
    .filter(detail => detail.value)
    .map(detail => `
      <div class="ride-detail">
        <span>${escapeHtml(detail.label)}</span>
        <strong>${escapeHtml(detail.value)}</strong>
      </div>
    `)
    .join("");
}

function clearRideDetails() {
  updateRideDetails("student", []);
  updateRideDetails("rider", []);
}

// ================= STUDENT =================
window.requestKeke = async () => {
  if (currentRideId) return;

  const fab = document.querySelector("#studentUI .fab");
  fab.disabled = true;
  fab.innerText = " Finding...";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    const ref = await addDoc(collection(db, "requests"), {
      lat: latitude,
      lng: longitude,
      status: "waiting",
      studentId: currentUser?.uid || null,
      studentName: currentUser?.displayName || currentUser?.email || "Guest student",
      time: Date.now()
    });

    currentRideId = ref.id;

    map.setView([latitude, longitude], 16);

    userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup(" You");

    setButtonVisible("requestBtn", false);
    toggleControls(true);
    updateBottomSheet("Ride requested", "Waiting for a rider to accept");
    updateRideDetails("student", [
      { label: "Status", value: "Waiting" },
      { label: "Pickup", value: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` }
    ]);
    showToast("Ride requested");

    fab.disabled = false;
    fab.innerText = " Request Ride";
  }, () => {
    fab.disabled = false;
    fab.innerText = " Request Ride";
    showToast("Location permission is needed to request a ride.", "error");
  });
};

window.cancelRide = async () => {
  if (!currentRideId) return;

  await updateDoc(doc(db, "requests", currentRideId), {
    status: "cancelled"
  });

  currentRideId = null;
  hasFocused = false;
  toggleControls(false);
  setButtonVisible("requestBtn", true);
  updateBottomSheet("Request cancelled", "No active ride");
  updateRideDetails("student", []);
  showToast("Ride request cancelled");
};

// ================= RIDER =================
window.becomeAvailable = () => {
  if (riderWatchId) return;

  const defaultName = currentUser?.displayName || currentUser?.email || "";
  const name = defaultName || prompt("Enter your rider name:");
  if (!name) return;

  currentRiderName = name;
  setButtonVisible("goLiveBtn", false);
  updateBottomSheet("You're live", "Looking for ride requests");
  updateRideDetails("rider", [
    { label: "Rider", value: name },
    { label: "Status", value: "Online" }
  ]);
  showToast("You are live");

  riderWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    //  Only follow BEFORE accepting ride
    if (map && currentRole === "rider" && !currentRideId) {
      map.setView([latitude, longitude], 14);
    }

    if (!riderDocId) {
      const ref = await addDoc(collection(db, "kekes"), {
        name,
        riderId: currentUser?.uid || null,
        lat: latitude,
        lng: longitude
      });
      riderDocId = ref.id;
    } else {
      await updateDoc(doc(db, "kekes", riderDocId), {
        lat: latitude,
        lng: longitude
      });
    }

    // update ride live
    if (currentRideId) {
      await updateDoc(doc(db, "requests", currentRideId), {
        riderLat: latitude,
        riderLng: longitude
      });
    }
  }, () => {
    riderWatchId = null;
    setButtonVisible("goLiveBtn", true);
    updateBottomSheet("Offline", "Location permission is needed to go live");
    updateRideDetails("rider", []);
    showToast("Location permission is needed to go live.", "error");
  }, { enableHighAccuracy: true });
};

// ================= STATUS =================
window.setArriving = async () => {
  if (!currentRideId) return;

  await updateDoc(doc(db, "requests", currentRideId), {
    status: "arriving"
  });
};

window.completeRide = async () => {
  if (!currentRideId) return;

  await updateDoc(doc(db, "requests", currentRideId), {
    status: "completed"
  });

  currentRideId = null;
  toggleControls(false);
  updateRideDetails("rider", [
    { label: "Rider", value: currentRiderName },
    { label: "Status", value: "Online" }
  ]);
};

// ================= LISTENER =================
function startListeners() {
  if (unsubscribeRequests) unsubscribeRequests();

  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  unsubscribeRequests = onSnapshot(q, (snapshot) => {
    if (!map) return;

    requestMarkers.forEach(m => map.removeLayer(m));
    requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      const rideId = docSnap.id;

      const marker = L.circleMarker([r.lat, r.lng], { color: '#ef4444' }).addTo(map);
      requestMarkers.push(marker);

      marker.on("click", async () => {
        if (r.status !== "waiting" || currentRole !== "rider") return;

        if (confirm("Accept ride?")) {
          navigator.geolocation.getCurrentPosition(async (pos) => {
            await updateDoc(doc(db, "requests", rideId), {
              status: "accepted",
              riderName: currentRiderName || currentUser?.displayName || currentUser?.email || "Rider",
              riderLat: pos.coords.latitude,
              riderLng: pos.coords.longitude
            });

            currentRideId = rideId;
            hasFocused = false;
            updateBottomSheet("Ride accepted", `Heading to ${r.studentName || "student"}`);
            updateRideDetails("rider", [
              { label: "Student", value: r.studentName || "Guest student" },
              { label: "Status", value: "Accepted" }
            ]);
            showToast("Ride accepted");
          });
        }
      });

      if (rideId === currentRideId && r.riderLat && r.riderLng) {

        if (routeControl) map.removeControl(routeControl);

        routeControl = L.Routing.control({
          waypoints: [
            L.latLng(r.riderLat, r.riderLng),
            L.latLng(r.lat, r.lng)
          ],
          addWaypoints: false,
          draggableWaypoints: false,
          createMarker: () => null,
          lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
        }).addTo(map);

        if (!riderMarker) {
          riderMarker = L.marker([r.riderLat, r.riderLng]).addTo(map);
        } else {
          riderMarker.setLatLng([r.riderLat, r.riderLng]);
        }

        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        updateUI(r, dist);

        if (!hasFocused) {
          const bounds = L.latLngBounds([
            [r.riderLat, r.riderLng],
            [r.lat, r.lng]
          ]);
          map.fitBounds(bounds, { padding: [80, 80] });
          hasFocused = true;
        }
      }
    });
  });
}

// ================= UI =================
function updateUI(r, dist) {
  if (!currentRole) return;

  if (currentRole === "student") {
    if (r.status === "accepted") {
      updateBottomSheet(" Rider coming", `${Math.round(dist)}m away`);
    } else if (r.status === "arriving") {
      updateBottomSheet(" Rider arriving", "Get ready");
    } else if (r.status === "completed") {
      updateBottomSheet(" Completed", "Thanks!");
    }
  } else {
    if (r.status === "accepted") {
      updateBottomSheet(" Heading to student", `${Math.round(dist)}m away`);
      toggleControls(true);
    } else if (r.status === "arriving") {
      updateBottomSheet(" Arrived", "Waiting...");
    } else if (r.status === "completed") {
      updateBottomSheet(" Done", "Good job");
      toggleControls(false);
    }
  }
}

// ================= DRAG =================
function initBottomSheetDrag() {
  document.querySelectorAll(".bottomSheet").forEach(sheet => {
    const dragZone = sheet.querySelector(".dragZone");
    if (!dragZone) return;

    let startY = 0, offset = 0, dragging = false;

    const start = (y) => { dragging = true; startY = y - offset; };
    const move = (y) => {
      if (!dragging) return;
      offset = Math.max(-300, Math.min(0, y - startY));
      sheet.style.transform = `translateY(${offset}px)`;
    };
    const end = () => {
      dragging = false;
      offset = offset < -150 ? -300 : 0;
      sheet.style.transform = `translateY(${offset}px)`;
    };

    dragZone.addEventListener("touchstart", e => start(e.touches[0].clientY));
    dragZone.addEventListener("touchmove", e => move(e.touches[0].clientY));
    dragZone.addEventListener("touchend", end);
  });
}

window.addEventListener("load", () => {
  initBottomSheetDrag();
  initAuth({
    getCurrentRole: () => currentRole,
    setCurrentRole: (role) => {
      currentRole = role;
    },
    onUserChanged: (user) => {
      currentUser = user;
    },
    showLoginScreen,
    showRoleSelect
  });
  console.log(" App Loaded");
});



