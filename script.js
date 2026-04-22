const ACTIVE_TIME = 2 * 60 * 1000; // 2 minutes
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log("Firebase connected ✅");

const map = L.map('map').setView([9.0579, 7.4951], 13); // Abuja default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Global arrays for cleanup
window.markers = [];
window.userMarker = null;

// 🚖 RIDER: Go online
window.becomeAvailable = async function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("Geolocation not supported by your browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    try {
      await addDoc(collection(db, "kekes"), {
        name: name.trim(),
        lat: lat,
        lng: lng,
        time: Date.now()
      });

      document.getElementById("riderMsg").innerText = "✅ You are now live on the map!";
    } catch (err) {
      console.error("Error adding keke:", err);
      alert("Failed to go online. Check console.");
    }
  }, () => {
    alert("Location permission denied or error occurred.");
  });
};

// 🎯 STUDENT: Request keke (show my location + nearby)
window.requestKeke = function () {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;

    map.setView([userLat, userLng], 16);

    if (window.userMarker) map.removeLayer(window.userMarker);

    window.userMarker = L.marker([userLat, userLng])
      .addTo(map)
      .bindPopup("📍 You are here")
      .openPopup();

    // 🔥 Find nearest keke
    let nearest = null;
    let minDistance = Infinity;

    window.markers.forEach((marker) => {
      const kekeLatLng = marker.getLatLng();
      const dist = getDistance(userLat, userLng, kekeLatLng.lat, kekeLatLng.lng);

      if (dist < minDistance) {
        minDistance = dist;
        nearest = marker;
      }
    });

    if (nearest) {
      nearest.openPopup();
      document.getElementById("studentMsg").innerText =
        `🚖 Nearest keke is ${minDistance.toFixed(2)} km away`;
    } else {
      document.getElementById("studentMsg").innerText =
        "No keke available 😢";
    }

  });
};

// 🔥 REAL-TIME LISTENER (only one listener)
const q = query(collection(db, "kekes"), orderBy("time", "desc"));

onSnapshot(q, (snapshot) => {
  const list = document.getElementById("kekeList");
  list.innerHTML = "";

  // Clear old markers
  if (window.markers) {
    window.markers.forEach(marker => map.removeLayer(marker));
  }
  window.markers = [];

  const bounds = L.latLngBounds(); // For auto-fitting

 snapshot.forEach((doc) => {
  const keke = doc.data();

  // ❌ Skip old kekes
  if (Date.now() - keke.time > ACTIVE_TIME) return;
   setInterval(async () => {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(async (position) => {
    await addDoc(collection(db, "kekes"), {
      name: name,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      time: Date.now()
    });
  });
}, 60000); // update every 60 seconds

    // Add to list (cleaner display)
    const li = document.createElement("li");
    li.innerHTML = `🚖 <strong>${keke.name}</strong> <small>(${keke.lat.toFixed(4)}, ${keke.lng.toFixed(4)})</small>`;
    list.appendChild(li);

    // Add circle marker on map
    const marker = L.circleMarker([keke.lat, keke.lng], {
      radius: 11,
      fillColor: "#22c55e",
      color: "#166534",
      weight: 2,
      fillOpacity: 0.85
    })
      .addTo(map)
      .bindPopup(`🚖 ${keke.name}`);

    window.markers.push(marker);
    bounds.extend([keke.lat, keke.lng]);
  });

  // Only fit bounds if we have at least one keke
  if (window.markers.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}, (error) => {
  console.error("Firestore listener error:", error);
});
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
