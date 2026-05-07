import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// ================= FIREBASE =================
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
const auth = getAuth(app);

// ================= GLOBAL =================
let map = null;
let currentRole = null;
let currentUser = null;
let isSignupMode = false;
let currentRideId = null;
let riderDocId = null;

let requestMarkers = [];
let riderMarker = null;
let routeControl = null;
let userMarker = null;
let unsubscribeRequests = null;

let hasFocused = false;

// Turn this on only when you want to collect campus coordinates.
const CAMPUS_EDITOR_MODE = true;
const campusDraft = {
  locations: [],
  paths: [],
  zones: []
};
let activePathDraft = [];
let activeZoneDraft = [];
let campusDraftLayers = [];
let activeShapeLayer = null;

// ================= MAP =================
function initMap(mapId) {
  if (map) map.remove();

  map = L.map(mapId, { tap: false }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  initCampusEditor();
  setTimeout(() => map.invalidateSize(), 500);
}

// ================= CAMPUS EDITOR =================
function getCampusEditorElements() {
  return {
    panel: document.getElementById("campusEditor"),
    nameInput: document.getElementById("campusPointName"),
    typeInput: document.getElementById("campusPointType"),
    hint: document.getElementById("campusEditorHint"),
    output: document.getElementById("campusEditorOutput"),
    copyBtn: document.getElementById("copyCampusJsonBtn"),
    saveShapeBtn: document.getElementById("saveCampusShapeBtn"),
    clearBtn: document.getElementById("clearCampusDraftBtn")
  };
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unnamed";
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function formatCampusDraft() {
  return JSON.stringify(campusDraft, null, 2);
}

function updateCampusEditorOutput() {
  const { output, hint } = getCampusEditorElements();
  if (!output) return;

  output.value = formatCampusDraft();

  if (hint) {
    hint.innerText = [
      `${campusDraft.locations.length} location(s)`,
      `${campusDraft.paths.length} path(s)`,
      `${campusDraft.zones.length} zone(s)`
    ].join(" • ");
  }
}

function addCampusDraftLayer(layer) {
  campusDraftLayers.push(layer);
  layer.addTo(map);
}

function clearActiveShapeLayer() {
  if (activeShapeLayer) {
    map.removeLayer(activeShapeLayer);
    activeShapeLayer = null;
  }
}

function drawActiveShape(type, points) {
  clearActiveShapeLayer();

  if (points.length === 0) return;

  if (points.length === 1) {
    activeShapeLayer = L.circleMarker(points[0], {
      radius: 6,
      color: type === "path" ? "#2563eb" : "#f59e0b"
    }).addTo(map);
    return;
  }

  activeShapeLayer = type === "path"
    ? L.polyline(points, { color: "#2563eb", weight: 5, dashArray: "8 8" }).addTo(map)
    : L.polygon(points, {
        color: "#f59e0b",
        fillColor: "#f59e0b",
        fillOpacity: 0.12,
        weight: 3,
        dashArray: "8 8"
      }).addTo(map);
}

function clearCampusDraft() {
  campusDraft.locations = [];
  campusDraft.paths = [];
  campusDraft.zones = [];
  activePathDraft = [];
  activeZoneDraft = [];

  clearActiveShapeLayer();
  campusDraftLayers.forEach(layer => map.removeLayer(layer));
  campusDraftLayers = [];
  updateCampusEditorOutput();
}

function saveCampusLine(type, name, points) {
  const minimumPoints = type === "zone" ? 3 : 2;
  if (points.length < minimumPoints) return;

  const entry = {
    id: slugify(name),
    name,
    points: [...points]
  };

  if (type === "path") {
    campusDraft.paths.push(entry);
    addCampusDraftLayer(L.polyline(points, { color: "#2563eb", weight: 5 }));
  } else {
    campusDraft.zones.push(entry);
    addCampusDraftLayer(L.polygon(points, {
      color: "#f59e0b",
      fillColor: "#f59e0b",
      fillOpacity: 0.18,
      weight: 3
    }));
  }
}

function saveActiveCampusShape() {
  const { nameInput, typeInput } = getCampusEditorElements();
  if (!nameInput || !typeInput) return;

  const type = typeInput.value;
  const name = nameInput.value.trim() || "Unnamed";

  if (type === "path") {
    saveCampusLine("path", name, activePathDraft);
    activePathDraft = [];
  }

  if (type === "zone") {
    saveCampusLine("zone", name, activeZoneDraft);
    activeZoneDraft = [];
  }

  clearActiveShapeLayer();
  updateCampusEditorOutput();
}

function captureCampusPoint(event) {
  const { nameInput, typeInput } = getCampusEditorElements();
  if (!nameInput || !typeInput) return;

  const name = nameInput.value.trim() || "Unnamed";
  const point = [
    roundCoord(event.latlng.lat),
    roundCoord(event.latlng.lng)
  ];

  if (typeInput.value === "location") {
    const location = {
      id: slugify(name),
      name,
      category: "landmark",
      lat: point[0],
      lng: point[1]
    };

    campusDraft.locations.push(location);
    addCampusDraftLayer(
      L.marker(point).bindPopup(`${name}<br>${point[0]}, ${point[1]}`)
    );
  }

  if (typeInput.value === "path") {
    activePathDraft.push(point);
    drawActiveShape("path", activePathDraft);
  }

  if (typeInput.value === "zone") {
    activeZoneDraft.push(point);
    drawActiveShape("zone", activeZoneDraft);
  }

  updateCampusEditorOutput();
}

function initCampusEditor() {
  const elements = getCampusEditorElements();
  if (!elements.panel || !map) return;

  elements.panel.classList.toggle("hidden", !CAMPUS_EDITOR_MODE || currentRole !== "student");
  if (!CAMPUS_EDITOR_MODE || currentRole !== "student") return;

  updateCampusEditorOutput();
  map.on("click", captureCampusPoint);

  elements.clearBtn.onclick = clearCampusDraft;
  elements.saveShapeBtn.onclick = saveActiveCampusShape;
  elements.copyBtn.onclick = async () => {
    const json = formatCampusDraft();

    try {
      await navigator.clipboard.writeText(json);
      elements.copyBtn.innerText = "Copied";
      setTimeout(() => {
        elements.copyBtn.innerText = "Copy JSON";
      }, 1200);
    } catch {
      elements.output.select();
    }
  };
}

// ================= AUTH =================
function getAuthValue(id) {
  return document.getElementById(id).value.trim();
}

function setAuthMessage(message, type = "error") {
  const authMessage = document.getElementById("authMessage");
  authMessage.innerText = message;
  authMessage.classList.toggle("success", type === "success");
}

function setAuthLoading(isLoading) {
  const submitBtn = document.getElementById("authSubmitBtn");
  const toggleBtn = document.getElementById("authToggleBtn");
  submitBtn.disabled = isLoading;
  toggleBtn.disabled = isLoading;
  submitBtn.innerText = isLoading
    ? (isSignupMode ? "Creating account..." : "Logging in...")
    : (isSignupMode ? "Create Account" : "Login");
}

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

function updateSignedInUI(user) {
  const userBadge = document.getElementById("userBadge");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!user) {
    userBadge.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    userBadge.innerText = "";
    return;
  }

  userBadge.innerText = user.displayName || user.email;
  userBadge.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account. Try logging in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use at least 6 characters for your password."
  };

  return messages[error.code] || error.message || "Something went wrong. Try again.";
}

async function createAccount() {
  const name = getAuthValue("displayName");
  const email = getAuthValue("email");
  const password = getAuthValue("password");

  if (!name) {
    setAuthMessage("Enter your full name.");
    return;
  }

  setAuthLoading(true);

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    try {
      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email,
        createdAt: serverTimestamp()
      });
    } catch (profileError) {
      console.warn("Profile save failed:", profileError);
    }

    setAuthMessage("Account created. Choose your role.", "success");
    showRoleSelect();
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

async function signIn() {
  const email = getAuthValue("email");
  const password = getAuthValue("password");

  setAuthLoading(true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setAuthMessage("");
    showRoleSelect();
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

window.continueAs = (role) => {
  currentRole = role;
  currentUser = null;
  showRoleSelect();
};

window.login = () => {
  if (isSignupMode) {
    createAccount();
  } else {
    signIn();
  }
};

window.showSignup = () => {
  isSignupMode = !isSignupMode;
  const displayName = document.getElementById("displayName");
  const password = document.getElementById("password");
  const submitBtn = document.getElementById("authSubmitBtn");
  const toggleBtn = document.getElementById("authToggleBtn");

  displayName.classList.toggle("hidden", !isSignupMode);
  password.autocomplete = isSignupMode ? "new-password" : "current-password";
  submitBtn.innerText = isSignupMode ? "Create Account" : "Login";
  toggleBtn.innerText = isSignupMode ? "Back to Login" : "Create New Account";
  setAuthMessage("");
};

window.logout = async () => {
  await signOut(auth);
  currentUser = null;
  currentRole = null;
  updateSignedInUI(null);
  showLoginScreen();
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  updateSignedInUI(user);

  if (user && !currentRole) {
    showRoleSelect();
  }
});

// ================= ROLE =================
window.selectRole = (role) => {
  currentRole = role;
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => {
      initMap("studentMap");
      startListeners();
    }, 200);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
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

// ================= STUDENT =================
window.requestKeke = async () => {
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

    updateBottomSheet(" Searching...", "Waiting for rider");

    fab.disabled = false;
    fab.innerText = " Request Ride";
  });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const defaultName = currentUser?.displayName || currentUser?.email || "";
  const name = defaultName || prompt("Enter your rider name:");
  if (!name) return;

  updateBottomSheet(" You're Online", "Looking for rides...");

  navigator.geolocation.watchPosition(async (pos) => {
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
  }, null, { enableHighAccuracy: true });
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
              riderLat: pos.coords.latitude,
              riderLng: pos.coords.longitude
            });

            currentRideId = rideId;
            hasFocused = false;
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
  ["displayName", "email", "password"].forEach((id) => {
    document.getElementById(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") window.login();
    });
  });
  console.log(" App Loaded");
});
