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

// 🔥 Firebase config
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

// GLOBAL STATE
let map = null;
let listenersStarted = false;

window.markers = [];
window.requestMarkers = [];
window.userMarker = null;
window.rideLine = null;
window.riderDocId = null;
window.currentRideId = null;

// ================= MAP =================
window.initMap = function (mapId) {
  if (map) {
    map.remove();
    map = null;
  }

  map = L.map(mapId).setView([9.0579, 7.4951], 13);

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

  const riderMsg = document.getElementById("riderMsg");
  riderMsg.innerText = "🟢 Going live...";

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      // Save/update rider location
      if (!window.riderDocId) {
        const ref = await addDoc(collection(db, "kekes"), {
          name,
          lat,
          lng,
          time: Date.now()
        });
        window.riderDocId = ref.id;
      } else {
        await updateDoc(doc(db, "kekes", window.riderDocId), {
          lat,
          lng,
          time: Date.now()
        });
      }

      // 🔥 ALSO update active ride (THIS FIXES DISTANCE)
      if (window.currentRideId) {
        await updateDoc(doc(db, "requests", window.currentRideId), {
          riderLat: lat,
          riderLng: lng
        });
      }

      if (map) map.setView([lat, lng], 16);

      riderMsg.innerText = `🚖 Live • ${name}`;
    } catch (e) {
      console.error(e);
    }

  }, () => {
    alert("Location error - allow GPS");
  }, { enableHighAccuracy: true });
};

// ================= STUDENT =================
window.requestKeke = function () {
  const studentMsg = document.getElementById("studentMsg");
  studentMsg.innerText = "📍 Getting location...";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    try {
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

      studentMsg.innerText = "🔍 Searching for rider...";
    } catch (e) {
      console.error(e);
      studentMsg.innerText = "Request failed";
    }
  }, () => {
    alert("Location error");
  }, { enableHighAccuracy: true });
};

// ================= STATUS BUTTONS =================
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

// ================= LISTENERS =================
function startListeners() {

  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(requestQuery, (snapshot) => {
    if (!map) return;

    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat || !r.lng) return;

      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        fillColor: "red",
        color: "darkred",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map);

      // ACCEPT
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

      // 🚀 LIVE TRACKING
      if (r.status === "accepted" && r.riderLat && r.riderLng) {
if (r.status === "accepted" && r.riderLat && r.riderLng) {

  // Clear old line
  if (window.rideLine) map.removeLayer(window.rideLine);

  // Draw line
  window.rideLine = L.polyline([
    [r.riderLat, r.riderLng],
    [r.lat, r.lng]
  ], { color: "green", weight: 5 }).addTo(map);

  // 🔥 ADD RIDER MARKER (YOU WERE MISSING THIS)
  const riderMarker = L.marker([r.riderLat, r.riderLng])
    .addTo(map)
    .bindPopup("🚖 Rider");

  window.markers.push(riderMarker);

  // Distance
  const dist = map.distance(
    [r.riderLat, r.riderLng],
    [r.lat, r.lng]
  );

  const msg = document.getElementById("studentMsg") || document.getElementById("riderMsg");

  if (msg) {
    if (r.status === "accepted") {
      msg.innerText = `🚗 ${Math.round(dist)}m away`;
    }
    if (r.status === "arriving") {
      msg.innerText = "📍 Rider is arriving...";
    }
    if (r.status === "completed") {
      msg.innerText = "✅ Ride completed";
    }
  }

  // Fit map nicely
  const bounds = L.latLngBounds([
    [r.riderLat, r.riderLng],
    [r.lat, r.lng]
  ]);
  map.fitBounds(bounds, { padding: [50, 50] });
}
