import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ================= FIREBASE =================
const firebaseConfig = {
  apiKey: "AIza...", 
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.appspot.com",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ================= GLOBAL =================
let map = null;
let currentRole = null;
let currentRideId = null;
let riderDocId = null;

let requestMarkers = [];
let riderMarker = null;
let routeControl = null;
let userMarker = null;

// ================= MAP =================
function initMap(mapId) {
  if (map) map.remove();

  // Veritas University is closer to these coordinates
map = L.map(mapId, { tap: false }).setView([9.0023, 7.4305], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 500);
}

// ================= LOGIN / CONTINUE =================
window.continueAs = (role) => {
  currentRole = role;
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");
};

window.login = () => {
  alert("Login feature coming soon...\n\nFor now, use 'Continue as Student' or 'Continue as Rider'");
};

window.showSignup = () => {
  alert("Signup feature coming soon");
};

// ================= ROLE SELECT =================
window.selectRole = (role) => {
  currentRole = role;
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 200);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 200);
  }
};

window.goBackToRole = () => {
  // Hide current UI
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  // Show role select again
  document.getElementById("roleSelect").classList.remove("hidden");
  
  if (map) map.remove();
};

// ================= UI HELPERS =================
function getActiveSheet() {
  return currentRole === "student" ? 
         document.getElementById("studentSheet") : 
         document.getElementById("riderSheet");
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

// ================= STUDENT =================
window.requestKeke = async () => {
  const fab = document.querySelector("#studentUI .fab");
  fab.disabled = true;
  fab.innerText = "⏳ Finding...";
  
  updateBottomSheet("📍 Getting location...", "Please wait");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    const ref = await addDoc(collection(db, "requests"), {
      lat: latitude,
      lng: longitude,
      status: "waiting",
      time: Date.now()
    });

    currentRideId = ref.id;
    map.setView([latitude, longitude], 16);
    userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup("📍 You");

    updateBottomSheet("🔍 Searching for rider...", "Waiting for acceptance");
    
    fab.disabled = false;
    fab.innerText = "🚖 Request Ride";
  }, (err) => {
    updateBottomSheet("❌ GPS Error", "Enable location access");
    fab.disabled = false;
    fab.innerText = "🚖 Request Ride";
  }, { enableHighAccuracy: true, timeout: 10000 });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const name = prompt("Enter your rider name:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Looking for nearby requests...");

  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    if (map && currentRole === "rider") {
      map.setView([latitude, longitude], 14);
    }

    if (!riderDocId) {
      const ref = await addDoc(collection(db, "kekes"), {
        name,
        lat: latitude,
        lng: longitude
      });
      riderDocId = ref.id;
    } else {
      await updateDoc(doc(db, "kekes", riderDocId), { lat: latitude, lng: longitude });
    }
  }, null, { enableHighAccuracy: true });
};

// ================= STATUS =================
window.setArriving = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "arriving" });
  updateBottomSheet("📍 Arriving", "Rider is near");
};

window.completeRide = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "completed" });
  updateBottomSheet("✅ Ride Completed", "Thank you!");
};

// ================= MAIN LISTENER =================
function startListeners() {
  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    if (!map) return;

    requestMarkers.forEach(m => map.removeLayer(m));
    requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      const rideId = docSnap.id;

      const marker = L.circleMarker([r.lat, r.lng], {color: '#ef4444'}).addTo(map);
      requestMarkers.push(marker);

      marker.on("click", async () => {
        if (r.status !== "waiting" || currentRole !== "rider") return;
        if (confirm("Accept this ride?")) {
          navigator.geolocation.getCurrentPosition(async (pos) => {
            await updateDoc(doc(db, "requests", rideId), {
              status: "accepted",
              riderLat: pos.coords.latitude,
              riderLng: pos.coords.longitude
            });
            currentRideId = rideId;
          });
        }
      });

      // Real-time update for current ride
      if (rideId === currentRideId) {
        if (r.riderLat && r.riderLng) {
          if (routeControl) map.removeControl(routeControl);

          routeControl = L.Routing.control({
            waypoints: [
              L.latLng(r.riderLat, r.riderLng),
              L.latLng(r.lat, r.lng)
            ],
            routeWhileDragging: false,
            addWaypoints: false,
            draggableWaypoints: false,
            createMarker: () => null,
            lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
          }).addTo(map);

          if (!riderMarker) {
            riderMarker = L.marker([r.riderLat, r.riderLng]).addTo(map).bindPopup("🚖 Rider");
          } else {
            riderMarker.setLatLng([r.riderLat, r.riderLng]);
          }

          const dist = map.distance([r.riderLat, r.riderLng], [r.lat, r.lng]);
          updateUI(r, dist);

          map.fitBounds([[r.riderLat, r.riderLng], [r.lat, r.lng]], { padding: [80, 80] });
        }
      }
    });
  });
}

// ================= UI LOGIC =================
function updateUI(r, dist) {
  if (!currentRole) return;

  if (currentRole === "student") {
    if (r.status === "accepted") {
      updateBottomSheet("🚗 Rider coming", `${Math.round(dist)}m away`);
      toggleControls(true);
    } else if (r.status === "arriving") {
      updateBottomSheet("📍 Rider Arriving", "Get ready!");
    } else if (r.status === "completed") {
      updateBottomSheet("✅ Ride Completed", "Thank you!");
      toggleControls(false);
    }
  } else if (currentRole === "rider") {
    if (r.status === "accepted") {
      updateBottomSheet("🚗 Heading to student", `${Math.round(dist)}m away`);
      toggleControls(true);
    } else if (r.status === "arriving") {
      updateBottomSheet("📍 Arriving at student", "Almost there");
    } else if (r.status === "completed") {
      updateBottomSheet("✅ Ride Completed", "Good job!");
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
  startListeners();           // Important: Start listener on load
  console.log("✅ Keke Finder Loaded Successfully");
});
