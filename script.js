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

console.log("Firebase connected");

const map = L.map('map').setView([9.0579, 7.4951], 15); // Abuja default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);



// 🚖 RIDER: go online with GPS
window.becomeAvailable = function () {
  let name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;

    await addDoc(collection(db, "kekes"), {
      name: name,
      lat: lat,
      lng: lng,
      time: Date.now()
    });

    document.getElementById("riderMsg").innerText =
      "You are now live 📍";
  },
  () => {
    alert("Location permission denied");
  });
};


// 🎯 STUDENT: request keke
window.requestKeke = function () {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;

    map.setView([lat, lng], 17);

    // Add "You" marker
    if (window.userMarker) {
      map.removeLayer(window.userMarker);
    }

    window.userMarker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup("You are here 📍")
      .openPopup();

    document.getElementById("studentMsg").innerText =
      "Showing nearby kekes...";
  });
};


// 🔥 REAL-TIME LISTENER
const q = query(collection(db, "kekes"), orderBy("time", "desc"));

onSnapshot(q, (snapshot) => {
  let list = document.getElementById("kekeList");
  list.innerHTML = "";

// Clear old markers
if (window.markers) {
  window.markers.forEach(marker => map.removeLayer(marker));
}
window.markers = [];

snapshot.forEach((doc) => {
  let keke = doc.data();

  // List display
  let li = document.createElement("li");
  li.innerText = `${keke.name}`;
  list.appendChild(li);

  // Map marker
  if (keke.lat && keke.lng) {
    let marker = L.circleMarker([keke.lat, keke.lng], {
  radius: 10,
  fillColor: "green",
  color: "black",
  weight: 1,
  fillOpacity: 0.9
})
  .addTo(map)
  .bindPopup(`🚖 ${keke.name}`);

  map.fitBounds(window.markers.map(m => m.getLatLng()), {
  padding: [50, 50]
});

  snapshot.forEach((doc) => {
    let keke = doc.data();

    let li = document.createElement("li");
    li.innerText = `${keke.name} - (${keke.lat.toFixed(4)}, ${keke.lng.toFixed(4)})`;
    list.appendChild(li);
  });
