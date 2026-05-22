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

export function formatNaira(kobo = 0) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format((Number(kobo) || 0) / 100);
}

function formatTransactionTime(timestamp) {
  if (!timestamp?.seconds) return "Just now";
  return new Date(timestamp.seconds * 1000).toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
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
  });

  transactionUnsubscribe = onSnapshot(
    query(
      collection(db, "walletTransactions"),
      where("userId", "==", state.currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(10)
    ),
    (snapshot) => renderStudentTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export function renderStudentWallet() {
  const balanceEl = document.getElementById("walletBalance");
  const debtEl = document.getElementById("walletDebt");
  const wallet = getWallet();
  if (balanceEl) balanceEl.innerText = formatNaira(wallet.balance);
  if (debtEl) {
    const amount = state.currentUser?.debt?.amount || 0;
    debtEl.classList.toggle("hidden", amount <= 0);
    debtEl.innerText = amount > 0 ? `Outstanding balance: ${formatNaira(amount)}` : "";
  }
}

function renderStudentTransactions(transactions) {
  const list = document.getElementById("walletTransactionsList");
  if (!list) return;
  if (!transactions.length) {
    list.innerHTML = '<p class="empty-state">No wallet transactions yet</p>';
    return;
  }
  list.innerHTML = transactions.map(tx => {
    const isCredit = ["topup", "refund"].includes(tx.type);
    return `
      <div class="wallet-row">
        <div>
          <strong>${tx.description || tx.type}</strong>
          <span>${formatTransactionTime(tx.createdAt)}</span>
        </div>
        <b class="${isCredit ? "credit" : "debit"}">${isCredit ? "+" : "-"}${formatNaira(tx.amount)}</b>
      </div>
    `;
  }).join("");
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
  try {
    await initiateTopUp(state.currentUser.uid, selectedTopUpAmount);
  } catch (err) {
    showToast(err.message || "Unable to start top-up", "error");
  }
}

export async function initiateTopUp(studentId, amountNaira) {
  if (!studentId || state.currentUser?.isGuest) throw new Error("Login required to top up");
  if (amountNaira < MIN_TOPUP_NAIRA) throw new Error(`Minimum top-up is ${formatNaira(MIN_TOPUP_NAIRA * 100)}`);

  // Ephemeral: Always request a new account for the specific amount/transaction
  const virtualAccount = await createEphemeralVirtualAccount(studentId, amountNaira);
  showTransferDetails(virtualAccount, amountNaira);
}

async function createEphemeralVirtualAccount(studentId, amountNaira) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Login required to create transfer account");

  const response = await fetch(VIRTUAL_ACCOUNT_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      studentId,
      amount: amountNaira * 100 // Convert to kobo for Paystack
    })
  });

  if (!response.ok) {
    let message = "Could not create temporary transfer account";
    try {
      const data = await response.json();
      message = data.error || data.paystack?.message || message;
    } catch (err) {}
    throw new Error(message);
  }

  const data = await response.json();
  return data.virtualAccount;
}

function showTransferDetails(virtualAccount, amountNaira) {
  const amountEl = document.getElementById("transferAmount");
  const bankEl = document.getElementById("transferBank");
  const numberEl = document.getElementById("transferAccountNumber");
  const nameEl = document.getElementById("transferAccountName");

  if (amountEl) amountEl.innerText = formatNaira(amountNaira * 100);
  if (bankEl) bankEl.innerText = virtualAccount?.bankName || "Wema Bank";
  if (numberEl) numberEl.innerText = virtualAccount?.accountNumber || "Not available";
  if (nameEl) nameEl.innerText = virtualAccount?.accountName || "OpRides";
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

window.openTopUpScreen = openTopUpScreen;
window.selectTopUpAmount = selectTopUpAmount;
window.selectCustomTopUpAmount = selectCustomTopUpAmount;
window.continueTopUp = continueTopUp;
window.showTopUpWaitingScreen = showTopUpWaitingScreen;
