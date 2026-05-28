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
import { formatNaira } from "./wallet.js";

let transactionUnsubscribe = null;

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
}

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
    });
  });
}

function openAdminMenu() {
  document.querySelector(".admin-sidebar")?.classList.add("open");
  document.getElementById("adminSidebarOverlay")?.classList.remove("hidden");
}

function closeAdminMenu() {
  document.querySelector(".admin-sidebar")?.classList.remove("open");
  document.getElementById("adminSidebarOverlay")?.classList.add("hidden");
}

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

function renderCampusAdminSummary() {
  const summary = document.getElementById("campusAdminSummary");
  if (!summary) return;
  const data = getCampusMapData();
  const counts = [
    ["Campus markers", data.locations.length],
    ["Ride stops", data.rideStops.length],
    ["Roads / paths", data.paths.length],
    ["Building shapes", data.buildings.length],
    ["Indoor records", data.indoorLocations.length]
  ];
  summary.innerHTML = counts.map(([label, count]) => `
    <div class="campus-admin-count">
      <span>${label}</span>
      <strong>${count}</strong>
    </div>
  `).join("");
}

async function loadCampusEditorData() {
  await loadCampusDataFromFirestore();
  const editor = document.getElementById("campusDataEditor");
  if (editor) editor.value = campusDataToJson();
  renderCampusAdminSummary();
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
    renderCampusAdminSummary();
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
  document.getElementById("formatCampusDataBtn")?.addEventListener("click", () => {
    const editor = document.getElementById("campusDataEditor");
    if (!editor) return;
    try {
      editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
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
