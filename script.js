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

// Firebase config
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

let map = null;
window.markers = [];
window.requestMarkers = [];
window.userMarker = null;
window.rideLine = null;
window.riderDocId = null;

// INIT MAP
window.initMap = function (mapId) {
  if (map) {
    map.remove();
    map = null;
  }

  const container = document.getElementById(mapId);
  if (!container) {
    console.error(`Map container #${mapId} not found`);
    return;
  }

  map = L.map(mapId, { zoomControl: true }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Force render multiple times
  const forceSize = () => { if (map) map.invalidateSize(true); };
  setTimeout(forceSize, 100);
  setTimeout(forceSize, 300);
  setTimeout(forceSize, 600);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 500);

  startListeners();
};

// ROLE SELECT
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

// GO BACK
window.goBack = function () {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");

  if (map) {
    map.remove();
    map = null;
  }
  window.markers = [];
  window.requestMarkers = [];
  window.userMarker = null;
  window.rideLine = null;
  window.riderDocId = null;
};

// RIDER - Become Available
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  const riderMsg = document.getElementById("riderMsg");
  riderMsg.innerText = "🟢 Going Live...";

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      if (!window.riderDocId) {
        const docRef = await addDoc(collection(db, "kekes"), { name, lat, lng, time: Date.now() });
        window.riderDocId = docRef.id;
      } else {
        await updateDoc(doc(db, "kekes", window.riderDocId), { lat, lng, time: Date.now() });
      }
      if (map) map.setView([lat, lng], 16);
      riderMsg.innerText = `🚖 Live • ${name}`;
    } catch (e) {
      console.error(e);
      riderMsg.innerText = "Update error";
    }
  }, (err) => {
    console.error(err);
    alert("Location error - allow GPS");
  }, { enableHighAccuracy: true });
};

// STUDENT - Request Keke
window.requestKeke = function () {
  const studentMsg = document.getElementById("studentMsg");
  studentMsg.innerText = "📍 Getting location...";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    try {
      await addDoc(collection(db, "requests"), {
        lat: latitude,
        lng: longitude,
        status: "waiting",
        time: Date.now()
      });

      if (map) map.setView([latitude, longitude], 16);

      if (window.userMarker) map.removeLayer(window.userMarker);
      window.userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup("📍 You").openPopup();

      studentMsg.innerText = "✅ Request sent! Waiting for riders...";
    } catch (e) {
      console.error(e);
      studentMsg.innerText = "Request error";
    }
  }, () => {
    alert("Could not get location");
    studentMsg.innerText = "Location failed";
  }, { enableHighAccuracy: true });
};

// START LISTENERS
function startListeners() {
  const kekeQuery = query(collection(db, "kekes"), orderBy("time", "desc"));
  onSnapshot(kekeQuery, (snapshot) => {
    window.markers.forEach(m => m && map && map.removeLayer(m));
    window.markers = [];

    snapshot.forEach(docSnap => {
      const k = docSnap.data();
      if (!k.lat || !k.lng) return;
      const marker = L.marker([k.lat, k.lng]).addTo(map).bindPopup(`🚖 ${k.name || 'Keke'}`);
      window.markers.push(marker);
    });
  });

  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));
  onSnapshot(requestQuery, (snapshot) => {
    window.requestMarkers.forEach(m => m && map && map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat || !r.lng) return;

      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 12, fillColor: "#ef4444", color: "#991b1b", weight: 3, fillOpacity: 0.9
      }).addTo(map);

      marker.on("click", async () => {
        if (r.status !== "waiting" || !confirm("Accept ride?")) return;
        navigator.geolocation.getCurrentPosition(async (pos) => {
          await updateDoc(doc(db, "requests", docSnap.id), {
            status: "accepted",
            riderLat: pos.coords.latitude,
            riderLng: pos.coords.longitude
          });
        });
      });

      window.requestMarkers.push(marker);
    });
  });
}
