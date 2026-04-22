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


// 🗺️ MAP SETUP
const map = L.map('map').setView([9.0579, 7.4951], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);


// GLOBALS
window.markers = [];
window.userMarker = null;


// 🔘 ROLE SELECTION
window.selectRole = function (role) {
  document.getElementById("roleSelect").style.display = "none";

  if (role === "student") {
    document.getElementById("studentUI").style.display = "block";
  } else {
    document.getElementById("riderUI").style.display = "block";
  }
};


// 🔙 BACK BUTTON
window.goBack = function () {
  document.getElementById("studentUI").style.display = "none";
  document.getElementById("riderUI").style.display = "none";
  document.getElementById("roleSelect").style.display = "block";
};


// 🚖 RIDER: GO ONLINE
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.watchPosition(
  async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    await addDoc(collection(db, "kekes"), {
      name: name,
      lat: lat,
      lng: lng,
      time: Date.now()
    });

    map.setView([lat, lng], 16);

    L.marker([lat, lng])
      .addTo(map)
      .bindPopup("🚖 You are moving")
      .openPopup();
  },
  (error) => {
    alert("Location error");
  },
  {
    enableHighAccuracy: true,
    maximumAge: 0
  }
);

      // Move map to rider
      map.setView([lat, lng], 16);

      // Show rider marker
      L.marker([lat, lng])
        .addTo(map)
        .bindPopup("🚖 You are live")
        .openPopup();

      document.getElementById("riderMsg").innerText =
        "✅ You are now live on the map!";
    } catch (err) {
      console.error(err);
      alert("Error going online");
    }
  }, () => {
    alert("Location permission denied");
  });
};


// 🎯 STUDENT: FIND KEKE
window.requestKeke = function () {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    map.setView([lat, lng], 16);

    // Remove old user marker
    if (window.userMarker) {
      map.removeLayer(window.userMarker);
    }

    window.userMarker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup("📍 You are here")
      .openPopup();

    document.getElementById("studentMsg").innerText =
      "🔍 Searching for nearby kekes...";
  });
};


// 🔥 REAL-TIME LISTENER
const q = query(collection(db, "kekes"), orderBy("time", "desc"));

onSnapshot(q, (snapshot) => {
  const list = document.getElementById("kekeList");

  if (!list) return; // prevent crash

  list.innerHTML = "";

  // Remove old markers
  window.markers.forEach(marker => map.removeLayer(marker));
  window.markers = [];

  snapshot.forEach((doc) => {
    const keke = doc.data();

    if (!keke.lat || !keke.lng) return;

    // Add to list
    const li = document.createElement("li");
    li.innerHTML = `🚖 <strong>${keke.name}</strong> <small>(${keke.lat.toFixed(4)}, ${keke.lng.toFixed(4)})</small>`;
    list.appendChild(li);

    // Add marker
    const marker = L.circleMarker([keke.lat, keke.lng], {
      radius: 10,
      fillColor: "#22c55e",
      color: "#166534",
      weight: 2,
      fillOpacity: 0.9
    })
      .addTo(map)
      .bindPopup(`🚖 ${keke.name}`);

    window.markers.push(marker);
  });

}, (error) => {
  console.error("Firestore error:", error);
});
