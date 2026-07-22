import {
  auth,
  db,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where
} from "./firebase.js";
import { state } from "./modules/state.js";
import { showToast } from "./modules/ui.js";

const MIN_TOPUP_NAIRA = 500;
const LOW_BALANCE_THRESHOLD_KOBO = 50000;
const TOPUP_AMOUNTS_NAIRA = [500, 1000, 2000, 3000, 5000];
const VIRTUAL_ACCOUNT_ENDPOINT = "https://oprides-webhook.ojopraise423.workers.dev/paystack/create-virtual-account";

let walletUnsubscribe = null;
let transactionUnsubscribe = null;
let lastSeenTopUp = null;
let selectedTopUpAmount = 1000;
let studentTransactions = [];
let walletTransactionFilter = "all";
let displayedWalletBalance = 0;
let balanceAnimationFrame = null;
let pullRefreshBound = false;

export function formatNaira(kobo = 0) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format((Number(kobo) || 0) / 100);
}

function timestampToDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTransactionTime(timestamp) {
  const date = timestampToDate(timestamp);
  if (!date) return "Just now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRelativeTransactionTime(timestamp) {
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

function isCreditTransaction(tx) {
  return ["topup", "refund", "earning"].includes(tx.type);
}

function isRideTransaction(tx) {
  return ["deduction", "ride", "fare"].includes(tx.type);
}

function getTransactionIcon(tx) {
  if (["topup", "refund"].includes(tx.type)) return "fa-arrow-down";
  if (isRideTransaction(tx)) return "fa-route";
  if (tx.type === "earning") return "fa-money-bill-trend-up";
  return "fa-wallet";
}

function animateWalletBalance(targetBalance) {
  const balanceEl = document.getElementById("walletBalance");
  const headerBalanceEl = document.getElementById("header-balance-student");
  const startBalance = displayedWalletBalance || 0;
  const endBalance = Number(targetBalance) || 0;
  const duration = 700;
  const startTime = performance.now();

  if (balanceAnimationFrame) cancelAnimationFrame(balanceAnimationFrame);

  // Add pop animation
  if (balanceEl) balanceEl.classList.add("balance-animate");

  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startBalance + (endBalance - startBalance) * eased);
    if (balanceEl) balanceEl.innerText = formatNaira(current);
    if (headerBalanceEl) headerBalanceEl.textContent = current;

    if (progress < 1) {
      balanceAnimationFrame = requestAnimationFrame(tick);
    } else {
      displayedWalletBalance = endBalance;
      balanceAnimationFrame = null;
      if (balanceEl) balanceEl.classList.remove("balance-animate");
      // Update balance chip glow
      window.updateBalanceChipGlow?.("student");
    }
  };

  balanceAnimationFrame = requestAnimationFrame(tick);
}

function getWallet() {
  return state.currentUser?.wallet || {
    balance: 0,
    currency: "NGN",
    lastTopUp: null,
    lastDeduction: null
  };
}

export function listenToStudentWallet() {
  if (!state.currentUser?.uid || state.currentUser?.isGuest || state.currentUser?.role !== "student") return;
  if (walletUnsubscribe) walletUnsubscribe();
  if (transactionUnsubscribe) transactionUnsubscribe();

  walletUnsubscribe = onSnapshot(doc(db, "users", state.currentUser.uid), async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const previousBalance = state.currentUser?.wallet?.balance || 0;
    state.currentUser = { ...state.currentUser, ...data };
    renderStudentWallet();

    const lastTopUp = data.wallet?.lastTopUp?.seconds || data.wallet?.lastTopUp?.toMillis?.() || null;
    if (lastTopUp && lastSeenTopUp && lastTopUp !== lastSeenTopUp) {
      await clearDebtAfterTopUp(state.currentUser.uid);
      if ((data.wallet?.balance || 0) > previousBalance) {
        showToast("Wallet credited", "success");
      }
    }
    if (lastTopUp) lastSeenTopUp = lastTopUp;
  }, (err) => {
    console.warn("Student wallet listener unavailable:", err.code || err.message);
  });

  transactionUnsubscribe = onSnapshot(
    query(
      collection(db, "walletTransactions"),
      where("userId", "==", state.currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(50)
    ),
    (snapshot) => {
      studentTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStudentTransactionExperience();
    },
    (err) => {
      console.warn("Student transaction listener unavailable:", err.code || err.message);
      studentTransactions = [];
      renderStudentTransactionExperience();
    }
  );
}

export function renderStudentWallet() {
  const debtEl = document.getElementById("walletDebt");
  const panelEl = document.getElementById("walletBalancePanel");
  const wallet = getWallet();
  animateWalletBalance(wallet.balance);

  if (panelEl) {
    const isLow = (Number(wallet.balance) || 0) < LOW_BALANCE_THRESHOLD_KOBO;
    panelEl.classList.toggle("wallet-balance-low", isLow);
    panelEl.classList.toggle("wallet-balance-healthy", !isLow);
  }

  if (debtEl) {
    const amount = state.currentUser?.debt?.amount || 0;
    debtEl.classList.toggle("hidden", amount <= 0);
    debtEl.innerText = amount > 0 ? `Outstanding balance: ${formatNaira(amount)}` : "";
  }
}

function getFilteredStudentTransactions() {
  if (walletTransactionFilter === "topups") {
    return studentTransactions.filter(tx => ["topup", "refund"].includes(tx.type));
  }
  if (walletTransactionFilter === "rides") {
    return studentTransactions.filter(isRideTransaction);
  }
  return studentTransactions;
}

function renderSpendingSummary(transactions) {
  const weeklySpendEl = document.getElementById("walletWeeklySpend");
  const averageRideEl = document.getElementById("walletAverageRide");
  if (!weeklySpendEl && !averageRideEl) return;

  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const rideTransactions = transactions.filter(isRideTransaction);
  const weeklyRides = rideTransactions.filter(tx => {
    const date = timestampToDate(tx.createdAt);
    return date && date >= weekStart;
  });
  const weeklySpend = weeklyRides.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const totalRideSpend = rideTransactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const averageRide = rideTransactions.length ? Math.round(totalRideSpend / rideTransactions.length) : 0;

  if (weeklySpendEl) weeklySpendEl.innerText = `You spent ${formatNaira(weeklySpend)} on ${weeklyRides.length} ride${weeklyRides.length === 1 ? "" : "s"}`;
  if (averageRideEl) averageRideEl.innerText = formatNaira(averageRide);
}

function renderTransactionFilters() {
  document.querySelectorAll(".wallet-filter-tab").forEach(tab => {
    const isActive = tab.dataset.walletFilter === walletTransactionFilter;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
}

function renderStudentTransactionExperience() {
  renderSpendingSummary(studentTransactions);
  renderTransactionFilters();
  renderStudentTransactions(getFilteredStudentTransactions());
  initWalletPullToRefresh();
}

function initWalletPullToRefresh() {
  if (pullRefreshBound) return;
  const list = document.getElementById("walletTransactionsList");
  if (!list) return;
  pullRefreshBound = true;

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
      renderStudentTransactionExperience();
      setTimeout(() => indicator.classList.remove("visible"), 500);
    }
  });
}
function renderStudentTransactions(transactions) {
  const list = document.getElementById("walletTransactionsList");
  if (!list) return;
  if (!transactions.length) {
    const label = walletTransactionFilter === "all" ? "wallet transactions" : walletTransactionFilter === "topups" ? "top ups" : "ride payments";
    list.innerHTML = `<p class="empty-state">No ${label} yet</p>`;
    return;
  }
  list.innerHTML = transactions.map(tx => {
    const isCredit = isCreditTransaction(tx);
    const amountClass = isCredit ? "credit" : "debit";
    const sign = isCredit ? "+" : "-";
    const typeLabel = tx.type === "topup" ? "Top Up" : isRideTransaction(tx) ? "Ride" : tx.type || "Transaction";
    return `
      <button type="button" class="wallet-row" onclick="toggleWalletTransaction(this)" aria-expanded="false">
        <div class="wallet-transaction-main">
          <span class="wallet-transaction-icon ${isCredit ? "credit-icon" : "debit-icon"}"><i class="fas ${getTransactionIcon(tx)}"></i></span>
          <div class="wallet-transaction-copy">
            <strong>${escapeHtml(tx.description || typeLabel)}</strong>
            <span>${escapeHtml(formatRelativeTransactionTime(tx.createdAt))}</span>
          </div>
          <b class="wallet-transaction-amount ${amountClass}">${sign}${formatNaira(tx.amount)}</b>
        </div>
        <div class="wallet-transaction-detail">
          <div><span>Type</span><strong>${escapeHtml(typeLabel)}</strong></div>
          <div><span>Date</span><strong>${escapeHtml(formatTransactionTime(tx.createdAt))}</strong></div>
          <div><span>Balance before</span><strong>${formatNaira(tx.balanceBefore)}</strong></div>
          <div><span>Balance after</span><strong>${formatNaira(tx.balanceAfter)}</strong></div>
          <div><span>Reference</span><strong>${escapeHtml(tx.reference || tx.rideId || tx.id)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(tx.status || "completed")}</strong></div>
        </div>
      </button>
    `;
  }).join("");
}

export function setWalletTransactionFilter(filter) {
  walletTransactionFilter = ["all", "topups", "rides"].includes(filter) ? filter : "all";
  renderStudentTransactionExperience();
}

export function scrollToWalletTransactions() {
  document.getElementById("walletTransactionsHeader")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function toggleWalletTransaction(row) {
  const expanded = row.classList.toggle("expanded");
  row.setAttribute("aria-expanded", String(expanded));
}

export function openTopUpScreen() {
  renderTopUpOptions();
  if (window.switchTab) window.switchTab("topup");
}

function renderTopUpOptions() {
  const grid = document.getElementById("topUpAmounts");
  if (!grid) return;
  grid.innerHTML = TOPUP_AMOUNTS_NAIRA.map(amount => `
    <button type="button" class="amount-chip ${selectedTopUpAmount === amount ? "active" : ""}" onclick="selectTopUpAmount(${amount})">
      ${formatNaira(amount * 100)}
    </button>
  `).join("") + `
    <input id="customTopUpAmount" class="input-field amount-input" inputmode="numeric" placeholder="Custom" oninput="selectCustomTopUpAmount(this.value)">
  `;
}

export function selectTopUpAmount(amountNaira) {
  selectedTopUpAmount = Number(amountNaira) || MIN_TOPUP_NAIRA;
  renderTopUpOptions();
}

export function selectCustomTopUpAmount(value) {
  selectedTopUpAmount = Number(value) || 0;
}

export async function continueTopUp() {
  const input = document.getElementById("topUpAmountInput");
  const amount = Number(input?.value) || 0;
  
  try {
    await initiateTopUp(state.currentUser.uid, amount);
  } catch (err) {
    showToast(err.message || "Unable to start top-up", "error");
  }
}

const PAYSTACK_PUBLIC_KEY = "pk_live_cd5305502fcec15b34ded0dcfc9d56f84b85482a"; // Replace with your real key

export async function initiateTopUp(studentId, amountNaira) {
  if (!studentId || state.currentUser?.isGuest) throw new Error("Login required to top up");
  if (amountNaira < MIN_TOPUP_NAIRA) throw new Error(`Minimum top-up is ${formatNaira(MIN_TOPUP_NAIRA * 100)}`);

  // Initialize Paystack Checkout
  const paystack = new PaystackPop();
  paystack.newTransaction({
    key: PAYSTACK_PUBLIC_KEY,
    amount: amountNaira * 100, // Amount in kobo
    email: state.currentUser.email,
    currency: "NGN",
    metadata: {
      studentId: studentId,
      custom_fields: [{
        display_name: "Student ID",
        variable_name: "student_id",
        value: studentId
      }]
    },
    onSuccess: (transaction) => {
      showToast("Payment successful! Updating wallet...", "success");
      // The webhook will handle the final wallet update
    },
    onCancel: () => {
      showToast("Payment cancelled", "info");
    }
  });
}

function showTransferDetails(virtualAccount, amountNaira) {
  const amountEl = document.getElementById("transferAmount");
  const bankEl = document.getElementById("transferBank");
  const numberEl = document.getElementById("transferAccountNumber");
  const nameEl = document.getElementById("transferAccountName");
  const expiryEl = document.getElementById("transferAccountExpiry");

  if (amountEl) amountEl.innerText = formatNaira(amountNaira * 100);
  if (bankEl) bankEl.innerText = virtualAccount?.bankName || "Wema Bank";
  if (numberEl) numberEl.innerText = virtualAccount?.accountNumber || "Not available";
  if (nameEl) nameEl.innerText = virtualAccount?.accountName || "OpRides";
  if (expiryEl) {
    const expiry = new Date(virtualAccount.expiry);
    expiryEl.innerText = expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (window.switchTab) window.switchTab("transfer");
}

export function showTopUpWaitingScreen() {
  if (window.switchTab) window.switchTab("topup-waiting");
}

export async function checkDebtBeforeRide(studentId) {
  const userSnap = await getDoc(doc(db, "users", studentId));
  const user = userSnap.data();
  if (user?.debt?.amount > 0) {
    throw new Error(`DEBT_OUTSTANDING:${user.debt.amount}`);
  }
}

export async function clearDebtAfterTopUp(studentId) {
  const userRef = doc(db, "users", studentId);
  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const user = userSnap.data();
    if (!user?.debt?.amount || user.debt.amount <= 0) return;
    if ((user.wallet?.balance || 0) < user.debt.amount) return;

    transaction.update(userRef, {
      "wallet.balance": user.wallet.balance - user.debt.amount,
      "debt.amount": 0,
      "debt.rideId": null,
      "debt.incurredAt": null
    });
  });
}

export function checkLowBalance(balanceKobo) {
  if (balanceKobo >= LOW_BALANCE_THRESHOLD_KOBO) return;
  showToast(`Low wallet balance: ${formatNaira(balanceKobo)} left`, "error");
}

window.setWalletTransactionFilter = setWalletTransactionFilter;
window.scrollToWalletTransactions = scrollToWalletTransactions;
window.toggleWalletTransaction = toggleWalletTransaction;
window.openTopUpScreen = openTopUpScreen;
window.selectTopUpAmount = selectTopUpAmount;
window.selectCustomTopUpAmount = selectCustomTopUpAmount;
window.continueTopUp = continueTopUp;
window.showTopUpWaitingScreen = showTopUpWaitingScreen;
