import {
  db,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "./firebase.js";
import { state } from "./modules/state.js";
import { showToast } from "./modules/ui.js";
import { formatNaira } from "./wallet.js";

let riderWalletUnsubscribe = null;
let riderTransactionsUnsubscribe = null;
let riderWithdrawalsUnsubscribe = null;
let riderTransactions = [];
let riderWithdrawals = [];
let riderHistoryTab = "earnings";
let displayedRiderBalance = 0;
let riderBalanceAnimationFrame = null;
let riderPullRefreshBound = false;

export function listenToRiderWallet() {
  if (!state.currentUser?.uid || state.currentUser?.role !== "rider") return;
  if (riderWalletUnsubscribe) riderWalletUnsubscribe();
  if (riderTransactionsUnsubscribe) riderTransactionsUnsubscribe();
  if (riderWithdrawalsUnsubscribe) riderWithdrawalsUnsubscribe();

  riderWalletUnsubscribe = onSnapshot(doc(db, "users", state.currentUser.uid), (snapshot) => {
    if (!snapshot.exists()) return;
    state.currentUser = { ...state.currentUser, ...snapshot.data() };
    renderRiderWallet();
  }, (err) => {
    console.warn("Rider wallet listener unavailable:", err.code || err.message);
  });

  riderTransactionsUnsubscribe = onSnapshot(
    query(
      collection(db, "walletTransactions"),
      where("userId", "==", state.currentUser.uid),
      where("type", "in", ["earning", "withdrawal"]),
      orderBy("createdAt", "desc"),
      limit(50)
    ),
    (snapshot) => {
      riderTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderRiderEarningsExperience();
    },
    (err) => {
      console.warn("Rider transaction listener unavailable:", err.code || err.message);
      riderTransactions = [];
      renderRiderEarningsExperience();
    }
  );

  riderWithdrawalsUnsubscribe = onSnapshot(
    query(
      collection(db, "withdrawalRequests"),
      where("riderId", "==", state.currentUser.uid),
      orderBy("requestedAt", "desc"),
      limit(25)
    ),
    (snapshot) => {
      riderWithdrawals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderRiderEarningsExperience();
    },
    (err) => {
      console.warn("Rider withdrawal listener unavailable:", err.code || err.message);
      riderWithdrawals = [];
      renderRiderEarningsExperience();
    }
  );
}

export function renderRiderWallet() {
  const earnings = state.currentUser?.earnings || { balance: 0, totalEarned: 0 };
  const totalEl = document.getElementById("riderTotalEarned");
  const availableEl = document.getElementById("withdrawAvailable");

  animateRiderBalance(earnings.balance);
  if (totalEl) totalEl.innerText = formatNaira(earnings.totalEarned);
  if (availableEl) availableEl.innerText = `Available: ${formatNaira(earnings.balance)}`;
  renderRiderEarningsExperience();
}

function timestampToDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFullTime(timestamp) {
  const date = timestampToDate(timestamp);
  if (!date) return "Just now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRelativeTime(timestamp) {
  const date = timestampToDate(timestamp);
  if (!date) return "Just now";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day * 2) return "Yesterday";
  if (diffMs < day * 7) {
    const days = Math.floor(diffMs / day);
    return `${days} days ago`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function animateRiderBalance(targetBalance) {
  const balanceEl = document.getElementById("riderEarningsBalance");
  const headerBalanceEl = document.getElementById("header-balance-rider");
  const startBalance = displayedRiderBalance || 0;
  const endBalance = Number(targetBalance) || 0;
  const duration = 700;
  const startTime = performance.now();

  if (riderBalanceAnimationFrame) cancelAnimationFrame(riderBalanceAnimationFrame);

  // Add pop animation
  if (balanceEl) balanceEl.classList.add("balance-animate");

  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startBalance + (endBalance - startBalance) * eased);
    if (balanceEl) balanceEl.innerText = formatNaira(current);
    if (headerBalanceEl) headerBalanceEl.textContent = current;

    if (progress < 1) {
      riderBalanceAnimationFrame = requestAnimationFrame(tick);
    } else {
      displayedRiderBalance = endBalance;
      riderBalanceAnimationFrame = null;
      if (balanceEl) balanceEl.classList.remove("balance-animate");
      // Update balance chip glow
      window.updateBalanceChipGlow?.("rider");
    }
  };

  riderBalanceAnimationFrame = requestAnimationFrame(tick);
}

function getWeekStart() {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return weekStart;
}

function getWeeklyEarningTransactions() {
  const weekStart = getWeekStart();
  return riderTransactions.filter(tx => tx.type === "earning" && timestampToDate(tx.createdAt) >= weekStart);
}

function getRideCount(transactions) {
  const rideIds = new Set(transactions.map(tx => tx.rideId).filter(Boolean));
  return rideIds.size || transactions.length;
}

function renderRiderEarningsSummary() {
  const weeklyEarnedEl = document.getElementById("riderWeeklyEarned");
  const ridesEl = document.getElementById("riderWeeklyRides");
  const weeklyTransactions = getWeeklyEarningTransactions();
  const weeklyEarned = weeklyTransactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const ridesCompleted = getRideCount(weeklyTransactions);

  if (weeklyEarnedEl) weeklyEarnedEl.innerText = formatNaira(weeklyEarned);
  if (ridesEl) ridesEl.innerText = String(ridesCompleted);
}

function renderRiderHistoryTabs() {
  document.querySelectorAll(".rider-history-tabs .wallet-filter-tab").forEach(tab => {
    const isActive = tab.dataset.riderHistoryTab === riderHistoryTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  const title = document.getElementById("riderEarningsSectionTitle");
  if (title) title.innerText = riderHistoryTab === "withdrawals" ? "Withdrawal History" : "Earnings History";
}

export function renderRiderEarningsExperience() {
  renderRiderEarningsSummary();
  renderRiderHistoryTabs();
  if (riderHistoryTab === "withdrawals") {
    renderRiderWithdrawals(riderWithdrawals);
    return;
  }
  renderRiderEarnings(riderTransactions.filter(tx => tx.type === "earning"));
  initRiderPullToRefresh();
}

function initRiderPullToRefresh() {
  if (riderPullRefreshBound) return;
  const list = document.getElementById("riderEarningsList");
  if (!list) return;
  riderPullRefreshBound = true;

  const indicator = document.createElement("div");
  indicator.className = "pull-refresh-indicator";
  indicator.innerHTML = '<span class="pull-spinner"></span><span>Pull to refresh</span>';
  list.parentNode.insertBefore(indicator, list);

  let startY = 0;
  let pulling = false;

  list.addEventListener("touchstart", (event) => {
    if (window.scrollY > 0) return;
    startY = event.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  list.addEventListener("touchmove", (event) => {
    if (!pulling) return;
    const deltaY = event.touches[0].clientY - startY;
    if (deltaY > 35) indicator.classList.add("visible");
  }, { passive: true });

  list.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;
    if (indicator.classList.contains("visible")) {
      renderRiderEarningsExperience();
      setTimeout(() => indicator.classList.remove("visible"), 500);
    }
  });
}
function renderRiderEarnings(transactions) {
  const list = document.getElementById("riderEarningsList");
  if (!list) return;
  if (!transactions.length) {
    list.innerHTML = '<p class="empty-state">No earnings yet</p>';
    return;
  }
  list.innerHTML = transactions.map(tx => `
    <button type="button" class="wallet-row" onclick="toggleRiderHistoryCard(this)" aria-expanded="false">
      <div class="wallet-transaction-main">
        <span class="wallet-transaction-icon credit-icon"><i class="fas fa-money-bill-trend-up"></i></span>
        <div class="wallet-transaction-copy">
          <strong>${escapeHtml(tx.description || "Ride earning")}</strong>
          <span>${escapeHtml(formatRelativeTime(tx.createdAt))}</span>
        </div>
        <b class="wallet-transaction-amount credit">+${formatNaira(tx.amount)}</b>
      </div>
      <div class="wallet-transaction-detail">
        <div><span>Amount</span><strong>+${formatNaira(tx.amount)}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(formatFullTime(tx.createdAt))}</strong></div>
        <div><span>New balance</span><strong>${formatNaira(tx.balanceAfter)}</strong></div>
      </div>
    </button>
  `).join("");
}

function getWithdrawalStatusClass(status) {
  if (status === "paid" || status === "processed" || status === "completed") return "status-processed";
  if (status === "rejected") return "status-rejected";
  return "status-pending";
}

function getWithdrawalStatusLabel(status) {
  if (status === "paid") return "processed";
  return status || "pending";
}

function renderRiderWithdrawals(withdrawals) {
  const list = document.getElementById("riderEarningsList");
  if (!list) return;
  if (!withdrawals.length) {
    list.innerHTML = '<p class="empty-state">No withdrawal requests yet</p>';
    return;
  }
  list.innerHTML = withdrawals.map(w => {
    const status = getWithdrawalStatusLabel(w.status);
    return `
      <button type="button" class="wallet-row" onclick="toggleRiderHistoryCard(this)" aria-expanded="false">
        <div class="wallet-transaction-main">
          <span class="wallet-transaction-icon debit-icon"><i class="fas fa-building-columns"></i></span>
          <div class="wallet-transaction-copy">
            <strong>Withdrawal request</strong>
            <span>${escapeHtml(formatRelativeTime(w.requestedAt))}</span>
          </div>
          <b class="wallet-transaction-amount debit">-${formatNaira(w.amount)}</b>
        </div>
        <div class="wallet-status-pill ${getWithdrawalStatusClass(status)}">${escapeHtml(status)}</div>
        <div class="wallet-transaction-detail">
          <div><span>Requested</span><strong>${escapeHtml(formatFullTime(w.requestedAt))}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(status)}</strong></div>
          <div><span>Bank</span><strong>${escapeHtml(w.bankName || "Not provided")}</strong></div>
          <div><span>Account</span><strong>${escapeHtml(w.accountNumber || "Not provided")}</strong></div>
          <div><span>Account name</span><strong>${escapeHtml(w.accountName || "Not provided")}</strong></div>
          <div><span>Processed</span><strong>${escapeHtml(formatFullTime(w.paidAt))}</strong></div>
          ${w.rejectedReason ? `<div><span>Reason</span><strong>${escapeHtml(w.rejectedReason)}</strong></div>` : ""}
        </div>
      </button>
    `;
  }).join("");
}

export function setRiderEarningsTab(tab) {
  riderHistoryTab = tab === "withdrawals" ? "withdrawals" : "earnings";
  renderRiderEarningsExperience();
}

export function toggleRiderHistoryCard(row) {
  const expanded = row.classList.toggle("expanded");
  row.setAttribute("aria-expanded", String(expanded));
}

export function openWithdrawalScreen() {
  renderRiderWallet();
  if (window.switchTab) window.switchTab("withdraw");
}

export async function submitWithdrawalRequest() {
  const amountNaira = Number(document.getElementById("withdrawAmount")?.value || 0);
  const bankDetails = {
    bankName: document.getElementById("withdrawBankName")?.value.trim(),
    accountNumber: document.getElementById("withdrawAccountNumber")?.value.trim(),
    accountName: document.getElementById("withdrawAccountName")?.value.trim()
  };

  if (!amountNaira || amountNaira <= 0) return showToast("Enter withdrawal amount", "error");
  if (!bankDetails.bankName || !bankDetails.accountNumber || !bankDetails.accountName) {
    return showToast("Enter complete bank details", "error");
  }

  try {
    await requestWithdrawal(state.currentUser.uid, amountNaira, bankDetails);
    showToast("Withdrawal requested", "success");
    if (window.switchTab) window.switchTab("earnings");
  } catch (err) {
    showToast(err.message || "Withdrawal failed", "error");
  }
}

export async function requestWithdrawal(riderId, amountNaira, bankDetails) {
  const amountKobo = Math.round(amountNaira * 100);
  const riderRef = doc(db, "users", riderId);

  await runTransaction(db, async (transaction) => {
    const riderSnap = await transaction.get(riderRef);
    const rider = riderSnap.data();
    const balance = rider?.earnings?.balance || 0;

    if (balance < amountKobo) throw new Error("Insufficient earnings balance");

    transaction.update(riderRef, {
      "earnings.balance": balance - amountKobo
    });

    transaction.set(doc(collection(db, "withdrawalRequests")), {
      riderId,
      riderName: rider.name || rider.displayName || "Rider",
      amount: amountKobo,
      bankName: bankDetails.bankName,
      accountNumber: bankDetails.accountNumber,
      accountName: bankDetails.accountName,
      status: "pending",
      requestedAt: serverTimestamp(),
      paidAt: null,
      rejectedReason: null
    });
  });
}

window.setRiderEarningsTab = setRiderEarningsTab;
window.toggleRiderHistoryCard = toggleRiderHistoryCard;
window.openWithdrawalScreen = openWithdrawalScreen;
window.submitWithdrawalRequest = submitWithdrawalRequest;
