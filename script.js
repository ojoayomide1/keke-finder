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

// 🔥 Firebase config (keep yours)
const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let map = null;
window.markers = [];
window.requestMarkers = [];
window.userMarker = null;
window.rideLine = null;
window.riderDocId = null;   // Important: reset on role change

// 🗺️ INIT MAP - Stronger fix for black screen
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

  // Multiple invalidate attempts + resize trigger (very effective)
  const forceRender = () => {
    if (map) {
      map.invalidateSize(true);
      map.invalidateSize(true);
    }
  };

  setTimeout(forceRender, 100);
  setTimeout(forceRender, 300);
  setTimeout(forceRender, 600);

  // Extra safety: trigger window resize event
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 400);

  startListeners();
};

// 🔘 ROLE SELECT
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

// 🔙 BACK
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

  // Clear markers
  window.markers = [];
  window.requestMarkers = [];
  window.userMarker = null;
  window.rideLine = null;
  window.riderDocId = null;
};

// 🚖 RIDER - Go Live
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("Geolocation not supported on this device");
    return;
  }

  const riderMsg = document.getElementById("riderMsg");
  riderMsg.innerText = "🟢 Going Live...";

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    console.log("Rider live position:", lat, lng);

    try {
      if (!window.riderDocId) {
        const docRef = await addDoc(collection(db, "kekes"), {
          name,
          lat,
          lng,
          time: Date.now()
        });
        window.riderDocId = docRef.id;
      } else {
        await updateDoc(doc(db, "kekes", window.riderDocId), {
          lat,
          lng,
          time: Date.now()
        });
      }

      if (map) map.setView([lat, lng], 16);
      riderMsg.innerText = `🚖 Live • ${name}`;
    } catch (e) {
      console.error("Firebase error:", e);
      riderMsg.innerText = "Error updating location";
    }
  }, (err) => {
    console.error("Geolocation error:", err);
    alert("Could not get location. Check GPS permission.");
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
};

// 🎯 STUDENT - Request Keke
window.requestKeke = function () {
  const studentMsg = document.getElementById("studentMsg");
  studentMsg.innerText = "📍 Getting location...";

  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

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

      // Remove old user marker
      if (window.userMarker) map.removeLayer(window.userMarker);

      window.userMarker = L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup("📍 You are here")
        .openPopup();

      studentMsg.innerText = "✅ Request sent! Waiting for riders...";
    } catch (e) {
      console.error(e);
      studentMsg.innerText = "Error sending request";
    }
  }, (err) => {
    console.error("Location error:", err);
    alert("Could not get your location. Please allow GPS permission.");
    studentMsg.innerText = "Location error";
  }, {
    enableHighAccuracy: true,
    timeout: 10000
  });
};

// 🔥 START ALL LISTENERS
function startListeners() {
  // Clear previous listeners if any (but onSnapshot is fine)

  // 🚖 KEKES (Riders)
  const kekeQuery = query(collection(db, "kekes"), orderBy("time", "desc"));

  onSnapshot(kekeQuery, (snapshot) => {
    window.markers.forEach(m => { if (m && map) map.removeLayer(m); });
    window.markers = [];

    snapshot.forEach(docSnap => {
      const k = docSnap.data();
      if (!k.lat || !k.lng) return;

      const marker = L.marker([k.lat, k.lng])
        .addTo(map)
        .bindPopup(`🚖 ${k.name || 'Keke'}`);

      window.markers.push(marker);
    });
  });

  // 📍 REQUESTS
  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(requestQuery, (snapshot) => {
    window.requestMarkers.forEach(m => { if (m && map) map.removeLayer(m); });
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat || !r.lng) return;

      // Red circle for requests
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 12,
        fillColor: "#ef4444",
        color: "#991b1b",
        weight: 3,
        fillOpacity: 0.9
      }).addTo(map);

      // Click to accept (only for rider view)
      marker.on("click", async () => {
        if (r.status !== "waiting") return;
        if (!confirm("Accept this ride?")) return;

        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            await updateDoc(doc(db, "requests", docSnap.id), {
              status: "accepted",
              riderLat: pos.coords.latitude,
              riderLng: pos.coords.longitude
            });
          } catch (e) {
            console.error(e);
          }
        });
      });

      window.requestMarkers.push(marker);

      // Draw line + distance if accepted
      if (r.status === "accepted" && r.riderLat) {
        if (window.rideLine && map) map.removeLayer(window.rideLine);

        window.rideLine = L.polyline([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ], { color: "#22c55e", weight: 6, opacity: 0.9 }).addTo(map);

        const dist = map.distance([r.riderLat, r.riderLng], [r.lat, r.lng]);
        const msgEl = document.getElementById("studentMsg") || document.getElementById("riderMsg");
        if (msgEl) msgEl.innerText = `🚗 ${Math.round(dist)} meters away`;
      }
    });
  });
}

// Optional: Add this to your HTML body onload if you want
// window.onload = () => console.log("Keke Finder loaded");
