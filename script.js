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

// 🔥 Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ================= GLOBAL =================
let map = null;
let listenersStarted = false;

window.requestMarkers = [];
window.riderMarker = null;
window.rideLine = null;
window.userMarker = null;
window.riderDocId = null;
window.currentRideId = null;

// ================= MAP =================
window.initMap = function (mapId) {
  if (map) {
    map.remove();
    map = null;
  }

  // ✅ FIXED MAP INIT (ONLY ONCE)
  map = L.map(mapId, {
    tap: false
  }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 300);

  if (!listenersStarted) {
    startListeners();
    listenersStarted = true;
  }
};

// ================= UI =================
window.selectRole = function (role) {
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 150);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 150);
  }
};

window.goBack = function () {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");

  if (map) {
    map.remove();
    map = null;
  }
};

// ================= RIDER =================
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Waiting for requests...");

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      if (!window.riderDocId) {
        const ref = await addDoc(collection(db, "kekes"), {
          name, lat, lng, time: Date.now()
        });
        window.riderDocId = ref.id;
      } else {
        await updateDoc(doc(db, "kekes", window.riderDocId), {
          lat, lng, time: Date.now()
        });
      }

      if (window.currentRideId) {
        await updateDoc(doc(db, "requests", window.currentRideId), {
          riderLat: lat,
          riderLng: lng
        });
      }

      map.setView([lat, lng], 16);

    } catch (e) {
      console.error(e);
    }
  });
};

// ================= STUDENT =================
window.requestKeke = function () {
  updateBottomSheet("📍 Getting location...", "Please wait");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    const ref = await addDoc(collection(db, "requests"), {
      lat: latitude,
      lng: longitude,
      status: "waiting",
      time: Date.now()
    });

    window.currentRideId = ref.id;

    map.setView([latitude, longitude], 16);

    if (window.userMarker) map.removeLayer(window.userMarker);

    window.userMarker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup("📍 You")
      .openPopup();

    updateUI({ status: "waiting" }, 0);
  });
};

// ================= STATUS =================
window.setArriving = async function () {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "arriving"
  });
};

window.completeRide = async function () {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "completed"
  });
};

// ================= UI =================
function updateBottomSheet(title, sub) {
  document.getElementById("rideTitle").innerText = title;
  document.getElementById("rideSub").innerText = sub;
}

function updateUI(r, dist) {
  const controls = document.getElementById("rideControls");

  if (r.status === "waiting") {
    updateBottomSheet("🔍 Searching...", "Connecting...");
    controls.classList.add("hidden");
  }

  else if (r.status === "accepted") {
    updateBottomSheet("🚗 Rider coming", `${Math.round(dist)}m away`);
    controls.classList.remove("hidden");
  }

  else if (r.status === "arriving") {
    updateBottomSheet("📍 Rider arriving", "Get ready");
  }

  else if (r.status === "completed") {
    updateBottomSheet("✅ Completed", "Thanks!");
    controls.classList.add("hidden");
  }
}

// ================= LISTENERS =================
function startListeners() {

  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    if (!map) return;

    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();

      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        fillColor: "red",
        color: "darkred"
      }).addTo(map);

      marker.on("click", async () => {
        if (r.status !== "waiting") return;

        const ok = confirm("Accept ride?");
        if (!ok) return;

        navigator.geolocation.getCurrentPosition(async (pos) => {
          await updateDoc(doc(db, "requests", docSnap.id), {
            status: "accepted",
            riderLat: pos.coords.latitude,
            riderLng: pos.coords.longitude
          });

          window.currentRideId = docSnap.id;
        });
      });

      window.requestMarkers.push(marker);

      // tracking
      if (r.riderLat && r.riderLng) {

        if (window.rideLine) map.removeLayer(window.rideLine);

        window.rideLine = L.polyline([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ], { color: "green" }).addTo(map);

        if (!window.riderMarker) {
          window.riderMarker = L.marker([r.riderLat, r.riderLng]).addTo(map);
        } else {
          window.riderMarker.setLatLng([r.riderLat, r.riderLng]);
        }

        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        updateUI(r, dist);
      }
    });
  });
}

// ================= 🔥 DRAG FIX =================
function initBottomSheetDrag() {
  document.querySelectorAll(".bottomSheet").forEach(sheet => {
    const handle = sheet.querySelector(".handle");

    let startY = 0;
    let currentY = 0;
    let offsetY = 0;
    let dragging = false;

    handle.addEventListener("touchstart", e => {
      dragging = true;
      startY = e.touches[0].clientY - offsetY;
    });

    handle.addEventListener("touchmove", e => {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      offsetY = currentY - startY;

      if (offsetY < -250) offsetY = -250;
      if (offsetY > 0) offsetY = 0;

      sheet.style.transform = `translateY(${offsetY}px)`;
    });

    handle.addEventListener("touchend", () => {
      dragging = false;
      offsetY = offsetY < -120 ? -250 : 0;
      sheet.style.transform = `translateY(${offsetY}px)`;
    });
  });
}

window.addEventListener("load", initBottomSheetDrag);
