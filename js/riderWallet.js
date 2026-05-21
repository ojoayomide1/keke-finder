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

export function listenToRiderWallet() {
  if (!state.currentUser?.uid || state.currentUser?.role !== "rider") return;
  if (riderWalletUnsubscribe) riderWalletUnsubscribe();
  if (riderTransactionsUnsubscribe) riderTransactionsUnsubscribe();

  riderWalletUnsubscribe = onSnapshot(doc(db, "users", state.currentUser.uid), (snapshot) => {
    if (!snapshot.exists()) return;
    state.currentUser = { ...state.currentUser, ...snapshot.data() };
    renderRiderWallet();
  });

  riderTransactionsUnsubscribe = onSnapshot(
    query(
      collection(db, "walletTransactions"),
      where("userId", "==", state.currentUser.uid),
      where("type", "in", ["earning", "withdrawal"]),
      orderBy("createdAt", "desc"),
      limit(10)
    ),
    (snapshot) => renderRiderEarnings(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export function renderRiderWallet() {
  const earnings = state.currentUser?.earnings || { balance: 0, totalEarned: 0 };
  const balanceEl = document.getElementById("riderEarningsBalance");
  const totalEl = document.getElementById("riderTotalEarned");
  const availableEl = document.getElementById("withdrawAvailable");
  if (balanceEl) balanceEl.innerText = formatNaira(earnings.balance);
  if (totalEl) totalEl.innerText = formatNaira(earnings.totalEarned);
  if (availableEl) availableEl.innerText = `Available: ${formatNaira(earnings.balance)}`;
}

function formatTime(timestamp) {
  if (!timestamp?.seconds) return "Just now";
  return new Date(timestamp.seconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
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
    <div class="wallet-row">
      <div>
        <strong>${tx.description || tx.type}</strong>
        <span>${formatTime(tx.createdAt)}</span>
      </div>
      <b class="${tx.type === "earning" ? "credit" : "debit"}">${tx.type === "earning" ? "+" : "-"}${formatNaira(tx.amount)}</b>
    </div>
  `).join("");
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

window.openWithdrawalScreen = openWithdrawalScreen;
window.submitWithdrawalRequest = submitWithdrawalRequest;
