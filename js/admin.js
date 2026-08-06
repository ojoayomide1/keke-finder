import {
  auth,
  db,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  signOut,
  updateDoc,
  where,
  writeBatch
} from "./firebase.js";
import {
  campusDataToJson,
  getCampusMapData,
  loadCampusDataFromFirestore,
  saveCampusDataToFirestore
} from "./campus-data.js";
import { getDistanceMeters } from "./modules/campus-router.js";
import { formatNaira } from "./wallet.js";
import { initAdminMapEditor, stopAdminMapEditor } from "./admin-editor.js";

let transactionUnsubscribe = null;
let campusRenderTimer = null;

const CONNECT_TOLERANCE_M = 10;
const STOP_ROUTE_DISTANCE_M = 180;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function formatTime(timestamp) {
  if (!timestamp?.seconds) return "Just now";
  return new Date(timestamp.seconds * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function requireAdmin() {
  const user = auth.currentUser;
  if (!user) {
    window.location.href = "/index.html";
    return false;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.data()?.isAdmin) {
    window.location.href = "/index.html";
    return false;
  }
  return true;
}

function listenToOverview() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  onSnapshot(query(collection(db, "rides"), where("createdAt", ">=", start)), (snapshot) => {
    setText("totalRidesToday", snapshot.size);
  });

  onSnapshot(query(collection(db, "rides"), where("status", "==", "active")), (snapshot) => {
    setText("activeRidesNow", snapshot.size);
    renderActiveRidesList(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  });

  onSnapshot(query(collection(db, "withdrawalRequests"), where("status", "==", "pending")), (snapshot) => {
    setText("pendingWithdrawals", snapshot.size);
    setText("withdrawal-badge", snapshot.size);
    const badge = document.getElementById("withdrawal-badge");
    if (badge) badge.style.display = snapshot.size > 0 ? "block" : "none";
  });

  onSnapshot(doc(db, "adminWallet", "main"), (snapshot) => {
    const data = snapshot.data() || {};
    setText("adminWalletBalance", formatNaira(data.balance || data.wallet?.balance || 0));
  });

  listenToAuthorizedRiders();
  initSidebarNav();

  // On desktop, sidebar starts open and is marked persistent (no overlay, no close)
  // On mobile it stays closed until the hamburger is tapped.
  if (window.innerWidth > 768) {
    const sidebar = document.querySelector(".admin-sidebar");
    sidebar?.classList.add("open", "persistent");
  }
}
let meMapInstance = null;

function initSidebarNav() {
  const navItems = document.querySelectorAll(".admin-nav-item");
  const sections = document.querySelectorAll(".admin-section");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetSection = item.dataset.section;
      
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      sections.forEach(section => {
        if (section.id === `section-${targetSection}`) {
          section.classList.remove("hidden");
        } else {
          section.classList.add("hidden");
        }
      });
      closeAdminMenu();

      // Hide the mobile header inside the map editor — it has its own topbar
      const mobileHeader = document.getElementById("adminMobileHeader");
      if (mobileHeader) {
        mobileHeader.classList.toggle("map-editor-active", targetSection === "map-editor");
      }

      // On desktop: remove "persistent" when entering map editor so sidebar
      // becomes a dismissable drawer (map editor is full-screen, sidebar overlays it).
      // Restore "persistent" when leaving map editor.
      if (window.innerWidth > 768) {
        const sidebar = document.querySelector(".admin-sidebar");
        if (targetSection === "map-editor") {
          sidebar?.classList.remove("persistent", "open");
        } else {
          sidebar?.classList.add("open", "persistent");
        }
      }

      if (targetSection === "map-editor") {
        initAdminMap();
      } else {
        stopAdminMapTracking();
      }
    });
  });
}

function initAdminMap() {
  if (meMapInstance) {
    setTimeout(() => meMapInstance.invalidateSize(), 100);
    return;
  }

  const mapElement = document.getElementById("meMap");
  if (!mapElement) return;

  // Initialize map centered at Veritas University coordinates
  meMapInstance = L.map("meMap", { tap: false, zoomControl: true }).setView([9.2880, 7.4130], 16);
  
  // Use standard CartoDB dark tile layer
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20
  }).addTo(meMapInstance);

  // Initialize the admin-editor module controls
  initAdminMapEditor(meMapInstance);

  setTimeout(() => meMapInstance.invalidateSize(), 150);
}

function stopAdminMapTracking() {
  stopAdminMapEditor();
}

function openAdminMenu() {
  const sidebar = document.querySelector(".admin-sidebar");
  sidebar?.classList.add("open");
  // Only show the overlay backdrop when not in persistent (always-visible) mode
  if (!sidebar?.classList.contains("persistent")) {
    document.getElementById("adminSidebarOverlay")?.classList.remove("hidden");
  }
}

function closeAdminMenu() {
  // On desktop (>768px), only close if not in persistent mode
  if (window.innerWidth > 768 && document.querySelector(".admin-sidebar")?.classList.contains("persistent")) {
    return;
  }
  document.querySelector(".admin-sidebar")?.classList.remove("open");
  document.getElementById("adminSidebarOverlay")?.classList.add("hidden");
}

// Dismiss sidebar with Escape key on any screen size
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAdminMenu();
});

function listenToAuthorizedRiders() {
  onSnapshot(query(collection(db, "authorized_riders"), orderBy("updatedAt", "desc")), (snapshot) => {
    renderAuthorizedRiders(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderAuthorizedRiders(riders) {
  const list = document.getElementById("authorizedRidersList");
  if (!list) return;
  if (!riders.length) {
    list.innerHTML = '<p class="empty-state">No authorized riders</p>';
    return;
  }

  list.innerHTML = riders.map(r => `
    <article class="admin-card">
      <dl>
        <dt>Plate</dt><dd><strong>${r.id}</strong></dd>
        <dt>Name</dt><dd>${r.name}</dd>
        <dt>Phone</dt><dd>${r.phone}</dd>
      </dl>
      <div class="admin-actions">
        <button class="danger" onclick="removeRider('${r.id}')">Remove</button>
      </div>
    </article>
  `).join("");
}

async function handleAddRider(e) {
  e.preventDefault();
  const plate = document.getElementById("newRiderPlate").value.trim().toUpperCase();
  const name = document.getElementById("newRiderName").value.trim();
  const phone = document.getElementById("newRiderPhone").value.trim();

  if (!plate || !name || !phone) return;

  try {
    await setDoc(doc(db, "authorized_riders", plate), {
      name,
      phone,
      updatedAt: serverTimestamp()
    });
    document.getElementById("addRiderForm").reset();
  } catch (err) {
    console.error("Error adding rider:", err);
    alert("Failed to add rider. Check console.");
  }
}

async function removeRider(plate) {
  if (!confirm(`Are you sure you want to remove authorized rider ${plate}?`)) return;
  try {
    await deleteDoc(doc(db, "authorized_riders", plate));
  } catch (err) {
    console.error("Error removing rider:", err);
    alert("Failed to remove rider.");
  }
}

function listenToWithdrawals() {
  return onSnapshot(
    query(
      collection(db, "withdrawalRequests"),
      where("status", "==", "pending"),
      orderBy("requestedAt")
    ),
    (snapshot) => renderWithdrawalList(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

function renderWithdrawalList(withdrawals) {
  const list = document.getElementById("withdrawalList");
  if (!list) return;
  if (!withdrawals.length) {
    list.innerHTML = '<p class="empty-state">No pending withdrawals</p>';
    return;
  }

  list.innerHTML = withdrawals.map(w => `
    <article class="admin-card">
      <dl>
        <dt>Rider</dt><dd>${w.riderName || w.riderId}</dd>
        <dt>Amount</dt><dd>${formatNaira(w.amount)}</dd>
        <dt>Bank</dt><dd>${w.bankName} - ${w.accountNumber}</dd>
        <dt>Account</dt><dd>${w.accountName}</dd>
        <dt>Time</dt><dd>${formatTime(w.requestedAt)}</dd>
      </dl>
      <div class="admin-actions">
        <button class="green" onclick="markWithdrawalPaid('${w.id}', '${w.riderId}', ${w.amount})">Mark as Paid</button>
        <button class="danger" onclick="rejectWithdrawalPrompt('${w.id}', '${w.riderId}', ${w.amount})">Reject</button>
      </div>
    </article>
  `).join("");
}

async function markWithdrawalPaid(requestId, riderId, amountKobo) {
  await updateDoc(doc(db, "withdrawalRequests", requestId), {
    status: "paid",
    paidAt: serverTimestamp()
  });

  await addDoc(collection(db, "walletTransactions"), {
    userId: riderId,
    type: "withdrawal",
    amount: amountKobo,
    description: "Withdrawal paid by admin",
    status: "success",
    createdAt: serverTimestamp()
  });
}

async function rejectWithdrawal(requestId, riderId, reason, amountKobo) {
  const batch = writeBatch(db);
  const riderSnap = await getDoc(doc(db, "users", riderId));
  const balance = riderSnap.data()?.earnings?.balance || 0;

  batch.update(doc(db, "withdrawalRequests", requestId), {
    status: "rejected",
    rejectedReason: reason || "Rejected by admin"
  });

  batch.update(doc(db, "users", riderId), {
    "earnings.balance": balance + amountKobo
  });

  await batch.commit();
}

function rejectWithdrawalPrompt(requestId, riderId, amountKobo) {
  const reason = prompt("Why is this withdrawal being rejected?");
  if (reason === null) return;
  rejectWithdrawal(requestId, riderId, reason, amountKobo);
}

function renderActiveRidesList(rides) {
  const list = document.getElementById("activeRidesList");
  if (!list) return;
  if (!rides.length) {
    list.innerHTML = '<p class="empty-state">No active rides</p>';
    return;
  }

  list.innerHTML = rides.map(ride => {
    const nextStop = (ride.stopQueue || []).find(s => s.status === "pending");
    return `
      <article class="admin-card">
        <dl>
          <dt>Rider</dt><dd>${ride.riderName || ride.riderId}</dd>
          <dt>Passengers</dt><dd>${Object.keys(ride.passengers || {}).length}</dd>
          <dt>Current stop</dt><dd>${nextStop ? `${nextStop.type}: ${nextStop.locationLabel}` : "None"}</dd>
          <dt>Seats available</dt><dd>${ride.seats?.available ?? 0}</dd>
        </dl>
      </article>
    `;
  }).join("");
}

function listenToTransactions(type = "") {
  if (transactionUnsubscribe) transactionUnsubscribe();
  const constraints = type
    ? [where("type", "==", type), orderBy("createdAt", "desc"), limit(50)]
    : [orderBy("createdAt", "desc"), limit(50)];
  transactionUnsubscribe = onSnapshot(
    query(collection(db, "walletTransactions"), ...constraints),
    (snapshot) => renderTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

function renderTransactions(transactions) {
  const list = document.getElementById("transactionList");
  if (!list) return;
  if (!transactions.length) {
    list.innerHTML = '<p class="empty-state">No transactions found</p>';
    return;
  }

  list.innerHTML = transactions.map(tx => `
    <div class="admin-row">
      <strong>${tx.type}</strong>
      <div>
        <b>${tx.description || "Wallet transaction"}</b><br>
        <span>${tx.userId}</span>
      </div>
      <strong>${formatNaira(tx.amount)}</strong>
      <span>${formatTime(tx.createdAt)}</span>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePoint(point) {
  if (Array.isArray(point)) {
    return [Number(point[0]), Number(point[1])];
  }
  if (point && typeof point === "object") {
    return [Number(point.lat), Number(point.lng)];
  }
  return [NaN, NaN];
}

function hasValidCoords(item) {
  return Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng));
}

function pointKey(point) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

function getAdminCampusData() {
  const editor = document.getElementById("campusDataEditor");
  if (!editor?.value.trim()) {
    return { data: getCampusMapData(), error: null };
  }

  try {
    return { data: JSON.parse(editor.value), error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

function sectionArray(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function buildCampusAdminGraph(data) {
  const nodes = new Map();
  let segmentCount = 0;

  const ensureNode = (point) => {
    const key = pointKey(point);
    if (!nodes.has(key)) nodes.set(key, { point, edges: new Set() });
    return key;
  };

  sectionArray(data, "paths").forEach(path => {
    const points = Array.isArray(path?.points)
      ? path.points.map(normalizePoint).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : [];

    for (let i = 1; i < points.length; i += 1) {
      const fromKey = ensureNode(points[i - 1]);
      const toKey = ensureNode(points[i]);
      nodes.get(fromKey).edges.add(toKey);
      nodes.get(toKey).edges.add(fromKey);
      segmentCount += 1;
    }
  });

  const entries = Array.from(nodes.entries());
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (getDistanceMeters(entries[i][1].point, entries[j][1].point) <= CONNECT_TOLERANCE_M) {
        entries[i][1].edges.add(entries[j][0]);
        entries[j][1].edges.add(entries[i][0]);
      }
    }
  }

  return { nodes, segmentCount };
}

function countGraphComponents(graph) {
  const visited = new Set();
  let components = 0;

  graph.nodes.forEach((_, key) => {
    if (visited.has(key)) return;
    components += 1;
    const stack = [key];
    visited.add(key);
    while (stack.length) {
      const current = stack.pop();
      graph.nodes.get(current)?.edges.forEach(next => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }
  });

  return components;
}

function distanceToNearestRoute(graph, item) {
  if (!hasValidCoords(item)) return Infinity;
  const point = [Number(item.lat), Number(item.lng)];
  let nearest = Infinity;
  graph.nodes.forEach(node => {
    const distance = getDistanceMeters(point, node.point);
    if (distance < nearest) nearest = distance;
  });
  return nearest;
}

function findDuplicateIds(data) {
  const ids = new Map();
  ["locations", "rideStops", "paths", "buildings", "indoorLocations"].forEach(section => {
    sectionArray(data, section).forEach(item => {
      if (!item?.id) return;
      const current = ids.get(item.id) || [];
      current.push(section);
      ids.set(item.id, current);
    });
  });

  return Array.from(ids.entries())
    .filter(([, sections]) => sections.length > 1)
    .map(([id, sections]) => `${id} (${sections.join(", ")})`);
}

function validateCampusData(data) {
  const issues = [];
  const graph = buildCampusAdminGraph(data);
  const components = countGraphComponents(graph);
  const locations = sectionArray(data, "locations");
  const rideStops = sectionArray(data, "rideStops");
  const paths = sectionArray(data, "paths");
  const buildings = sectionArray(data, "buildings");
  const indoorLocations = sectionArray(data, "indoorLocations");
  const locationIds = new Set(locations.map(item => item.id).filter(Boolean));
  const servedIds = new Set(rideStops.flatMap(stop => Array.isArray(stop.serves) ? stop.serves : []));

  const duplicateIds = findDuplicateIds(data);
  if (duplicateIds.length) {
    issues.push({ level: "error", title: "Duplicate IDs", detail: duplicateIds.slice(0, 6).join(", ") });
  }

  const missingLocationCoords = locations.filter(item => !hasValidCoords(item));
  if (missingLocationCoords.length) {
    issues.push({ level: "warning", title: "Campus markers missing coordinates", detail: `${missingLocationCoords.length} marker(s)` });
  }

  const missingStopCoords = rideStops.filter(item => !hasValidCoords(item));
  if (missingStopCoords.length) {
    issues.push({ level: "error", title: "Ride stops missing coordinates", detail: `${missingStopCoords.length} stop(s)` });
  }

  const shortPaths = paths.filter(path => !Array.isArray(path?.points) || path.points.length < 2);
  if (shortPaths.length) {
    issues.push({ level: "warning", title: "Roads with fewer than two points", detail: `${shortPaths.length} path(s)` });
  }

  if (graph.segmentCount === 0) {
    issues.push({ level: "warning", title: "No routable road network", detail: "Routes will fall back to straight lines." });
  } else if (components > 1) {
    issues.push({ level: "warning", title: "Disconnected route network", detail: `${components} separate route groups found.` });
  }

  const stopsFarFromRoutes = rideStops.filter(stop => hasValidCoords(stop) && distanceToNearestRoute(graph, stop) > STOP_ROUTE_DISTANCE_M);
  if (stopsFarFromRoutes.length && graph.nodes.size > 0) {
    issues.push({ level: "warning", title: "Ride stops far from roads", detail: stopsFarFromRoutes.slice(0, 6).map(stop => stop.name || stop.id).join(", ") });
  }

  const unknownServes = rideStops.flatMap(stop => (Array.isArray(stop.serves) ? stop.serves : [])
    .filter(id => !locationIds.has(id))
    .map(id => `${stop.id || stop.name}: ${id}`));
  if (unknownServes.length) {
    issues.push({ level: "error", title: "Stops serving unknown locations", detail: unknownServes.slice(0, 6).join(", ") });
  }

  const unservedLocations = locations.filter(item => item.id && hasValidCoords(item) && !servedIds.has(item.id));
  if (unservedLocations.length) {
    issues.push({ level: "warning", title: "Mapped landmarks not served by a stop", detail: unservedLocations.slice(0, 6).map(item => item.name || item.id).join(", ") });
  }

  const orphanIndoor = indoorLocations.filter(item => item.buildingId && !locationIds.has(item.buildingId));
  if (orphanIndoor.length) {
    issues.push({ level: "warning", title: "Indoor records with unknown building IDs", detail: orphanIndoor.slice(0, 6).map(item => item.name || item.id).join(", ") });
  }

  return issues.length ? issues : [{ level: "ok", title: "Campus data looks valid", detail: "No blocking issues found." }];
}

function renderCampusValidation(data, parseError = null) {
  const list = document.getElementById("campusValidationList");
  if (!list) return;

  if (parseError) {
    list.innerHTML = `<div class="campus-validation-item error"><strong>Invalid JSON</strong><br><span>${escapeHtml(parseError.message)}</span></div>`;
    return;
  }

  list.innerHTML = validateCampusData(data).map(issue => `
    <div class="campus-validation-item ${issue.level}">
      <strong>${escapeHtml(issue.title)}</strong><br>
      <span>${escapeHtml(issue.detail)}</span>
    </div>
  `).join("");
}

function renderCampusSections(data) {
  const list = document.getElementById("campusSectionList");
  if (!list) return;

  const sections = [
    ["Locations", sectionArray(data, "locations"), item => `${item.name || item.id || "Unnamed"}${hasValidCoords(item) ? "" : " - no coordinates"}`],
    ["Pickup/drop-off stops", sectionArray(data, "rideStops"), item => `${item.name || item.id || "Unnamed"} - serves ${(item.serves || []).length}`],
    ["Route paths", sectionArray(data, "paths"), item => `${item.name || item.id || "Unnamed"} - ${(item.points || []).length} points`],
    ["Building shapes", sectionArray(data, "buildings"), item => `${item.name || item.id || "Unnamed"} - ${(item.points || []).length} points`],
    ["Indoor records", sectionArray(data, "indoorLocations"), item => `${item.name || item.id || "Unnamed"} - ${item.buildingId || "no building"}`]
  ];

  list.innerHTML = sections.map(([label, items, describe]) => {
    const preview = items.slice(0, 3).map(describe).join(" / ") || "No records";
    const extra = items.length > 3 ? ` +${items.length - 3} more` : "";
    return `
      <div class="campus-section-item">
        <strong>${escapeHtml(label)}</strong>
        <strong>${items.length}</strong>
        <span class="campus-section-meta">${escapeHtml(preview + extra)}</span>
      </div>
    `;
  }).join("");
}

function renderCampusAdminSummary(data = getCampusMapData(), parseError = null) {
  const summary = document.getElementById("campusAdminSummary");
  if (!summary) return;
  const counts = [
    ["Campus markers", sectionArray(data, "locations").length],
    ["Ride stops", sectionArray(data, "rideStops").length],
    ["Roads / paths", sectionArray(data, "paths").length],
    ["Building shapes", sectionArray(data, "buildings").length],
    ["Indoor records", sectionArray(data, "indoorLocations").length]
  ];
  summary.innerHTML = counts.map(([label, count]) => `
    <div class="campus-admin-count">
      <span>${label}</span>
      <strong>${count}</strong>
    </div>
  `).join("");
  renderCampusValidation(data, parseError);
  renderCampusSections(data);
}

function renderCampusAdminFromEditor() {
  const { data, error } = getAdminCampusData();
  renderCampusAdminSummary(data || {}, error);
}

function scheduleCampusAdminRender() {
  clearTimeout(campusRenderTimer);
  campusRenderTimer = setTimeout(renderCampusAdminFromEditor, 250);
}

async function loadCampusEditorData() {
  await loadCampusDataFromFirestore();
  const editor = document.getElementById("campusDataEditor");
  if (editor) editor.value = campusDataToJson();
  renderCampusAdminFromEditor();
}

async function saveCampusEditorData() {
  const editor = document.getElementById("campusDataEditor");
  const saveBtn = document.getElementById("saveCampusDataBtn");
  if (!editor) return;

  let parsed;
  try {
    parsed = JSON.parse(editor.value);
  } catch (err) {
    alert(`Invalid JSON: ${err.message}`);
    return;
  }

  try {
    if (saveBtn) saveBtn.innerText = "Saving...";
    await saveCampusDataToFirestore(parsed);
    editor.value = campusDataToJson();
    renderCampusAdminFromEditor();
    alert("Campus data saved.");
  } catch (err) {
    console.error("Failed to save campus data:", err);
    alert("Failed to save campus data. Check console.");
  } finally {
    if (saveBtn) saveBtn.innerText = "Save campus data";
  }
}

function bindCampusAdminTools() {
  document.getElementById("reloadCampusDataBtn")?.addEventListener("click", loadCampusEditorData);
  document.getElementById("saveCampusDataBtn")?.addEventListener("click", saveCampusEditorData);
  document.getElementById("validateCampusDataBtn")?.addEventListener("click", renderCampusAdminFromEditor);
  document.getElementById("campusDataEditor")?.addEventListener("input", scheduleCampusAdminRender);
  document.getElementById("formatCampusDataBtn")?.addEventListener("click", () => {
    const editor = document.getElementById("campusDataEditor");
    if (!editor) return;
    try {
      editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
      renderCampusAdminFromEditor();
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  });
  loadCampusEditorData();
}

async function adminLogout() {
  await signOut(auth);
  window.location.href = "/index.html";
}

window.markWithdrawalPaid = markWithdrawalPaid;
window.rejectWithdrawalPrompt = rejectWithdrawalPrompt;
window.listenToTransactions = listenToTransactions;
window.adminLogout = adminLogout;
window.removeRider = removeRider;
window.openAdminMenu = openAdminMenu;
window.closeAdminMenu = closeAdminMenu;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/index.html";
    return;
  }
  if (!(await requireAdmin())) return;
  listenToOverview();
  listenToWithdrawals();
  listenToTransactions();
  bindCampusAdminTools();

  const addRiderForm = document.getElementById("addRiderForm");
  if (addRiderForm) {
    addRiderForm.addEventListener("submit", handleAddRider);
  }
});
