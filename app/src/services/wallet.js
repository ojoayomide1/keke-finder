/**
 * wallet.js
 *
 * All wallet-related service logic for the student role.
 * Mirrors js/wallet.js from the main branch, rewritten for React Native:
 *  - No DOM manipulation
 *  - Pure functions / callbacks / returned data
 *  - Paystack top-up uses expo-linking to open the Paystack Checkout URL
 *    (the webhook on the Cloudflare Worker credits the wallet automatically)
 *
 * Exports:
 *   formatNaira(kobo)                              — format kobo → ₦ string
 *   listenToWallet(uid, onBalance, onTransactions) — subscribe to balance + tx history
 *   initiateTopUp(params)                          — open Paystack checkout in browser
 *   checkDebtBeforeRide(uid)                       — throws if outstanding debt
 *   clearDebtAfterTopUp(uid)                       — run transaction to clear debt
 *   fetchProfileStats(uid)                         — one-shot stats for Profile screen
 */

import * as Linking from "expo-linking";

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "../config/firebase";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

export const MIN_TOPUP_NAIRA          = 500;
export const LOW_BALANCE_THRESHOLD    = 50_000; // kobo — ₦500
export const TOPUP_PRESET_AMOUNTS     = [500, 1_000, 2_000, 3_000, 5_000]; // naira

// The same live key used in the main branch
const PAYSTACK_PUBLIC_KEY =
  "pk_live_cd5305502fcec15b34ded0dcfc9d56f84b85482a";

// ─── FORMATTING ──────────────────────────────────────────────────────────────

/**
 * Convert kobo to a formatted Naira string, e.g. 150000 → "₦1,500"
 */
export function formatNaira(kobo = 0) {
  return new Intl.NumberFormat("en-NG", {
    style:                 "currency",
    currency:              "NGN",
    maximumFractionDigits: 0,
  }).format((Number(kobo) || 0) / 100);
}

// ─── TIMESTAMP HELPERS ───────────────────────────────────────────────────────

export function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate)   return ts.toDate();
  if (ts.seconds)  return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTxTime(ts) {
  const date = tsToDate(ts);
  if (!date) return "Just now";
  return date.toLocaleString([], {
    month:  "short",
    day:    "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTxTime(ts) {
  const date = tsToDate(ts);
  if (!date) return "Just now";
  const diff = Date.now() - date.getTime();
  const m = 60_000, h = 3_600_000, d = 86_400_000;

  if (diff < m)        return "Just now";
  if (diff < h)        return `${Math.floor(diff / m)}m ago`;
  if (diff < d)        return `${Math.floor(diff / h)}h ago`;
  if (diff < d * 2)    return "Yesterday";
  if (diff < d * 7)    return `${Math.floor(diff / d)} days ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── TRANSACTION CLASSIFIERS ─────────────────────────────────────────────────

export function isCreditTx(tx) {
  return ["topup", "refund", "earning"].includes(tx.type);
}

export function isRideTx(tx) {
  return ["deduction", "ride", "fare"].includes(tx.type);
}

export function txTypeLabel(tx) {
  if (tx.type === "topup")  return "Top Up";
  if (isRideTx(tx))         return "Ride";
  if (tx.type === "refund")  return "Refund";
  return tx.type ?? "Transaction";
}

// ─── WALLET LISTENER ─────────────────────────────────────────────────────────

/**
 * Subscribe to a student's wallet balance and transaction history simultaneously.
 *
 * @param {string}   uid
 * @param {Function} onBalance      (balanceKobo: number, debtAmount: number) => void
 * @param {Function} onTransactions (txs: Array) => void
 * @param {Function} [onTopUp]      called when a new top-up is detected (after wallet credit)
 *
 * @returns {() => void} cleanup — call to unsubscribe both listeners
 */
export function listenToWallet(uid, onBalance, onTransactions, onTopUp) {
  let lastTopUpTimestamp = null;

  const unsubWallet = onSnapshot(
    doc(db, "users", uid),
    async (snap) => {
      if (!snap.exists()) return;
      const data          = snap.data();
      const balance       = data.wallet?.balance    ?? 0;
      const debt          = data.debt?.amount       ?? 0;
      const topUpSeconds  = data.wallet?.lastTopUp?.seconds ?? null;

      onBalance(balance, debt);

      // Detect a new top-up by comparing the lastTopUp timestamp
      if (topUpSeconds && lastTopUpTimestamp && topUpSeconds !== lastTopUpTimestamp) {
        await clearDebtAfterTopUp(uid).catch(() => {});
        onTopUp?.();
      }
      if (topUpSeconds) lastTopUpTimestamp = topUpSeconds;
    },
    (err) => console.warn("[wallet] Balance listener error:", err.code ?? err.message)
  );

  const unsubTx = onSnapshot(
    query(
      collection(db, "walletTransactions"),
      where("userId", "==", uid),
      limit(50)
    ),
    (snap) => {
      const txs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Sort in memory to avoid composite index requirement
      txs.sort((a, b) => {
        const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
      });
      onTransactions(txs);
    },
    (err) => {
      console.warn("[wallet] Transaction listener error:", err.code ?? err.message);
      onTransactions([]);
    }
  );

  return () => {
    unsubWallet();
    unsubTx();
  };
}

// ─── TOP-UP ──────────────────────────────────────────────────────────────────

/**
 * Open the Paystack inline checkout page in the device browser.
 * The Cloudflare Worker webhook handles the actual wallet credit — we just
 * redirect the user and the wallet listener will detect the new top-up.
 *
 * @param {{ uid: string, email: string, amountNaira: number }} params
 * @throws {Error} if amount is below minimum or uid/email is missing
 */
export async function initiateTopUp({ uid, email, amountNaira }) {
  if (!uid || !email) throw new Error("Login required to top up");
  if (amountNaira < MIN_TOPUP_NAIRA) {
    throw new Error(`Minimum top-up is ${formatNaira(MIN_TOPUP_NAIRA * 100)}`);
  }

  // Build a Paystack Checkout URL with metadata so the webhook knows the student
  const params = new URLSearchParams({
    key:      PAYSTACK_PUBLIC_KEY,
    email,
    amount:   String(amountNaira * 100), // Paystack expects kobo
    currency: "NGN",
    ref:      `opr_${uid}_${Date.now()}`,
    metadata: JSON.stringify({
      studentId:     uid,
      custom_fields: [
        {
          display_name:  "Student ID",
          variable_name: "student_id",
          value:         uid,
        },
      ],
    }),
  });

  const checkoutUrl = `https://checkout.paystack.com/pay?${params.toString()}`;
  const supported   = await Linking.canOpenURL(checkoutUrl);
  if (!supported) throw new Error("Cannot open payment page. Please try again.");
  await Linking.openURL(checkoutUrl);
}

// ─── DEBT LOGIC ──────────────────────────────────────────────────────────────

/**
 * Check if the student has an outstanding debt before allowing a ride request.
 * Throws "DEBT_OUTSTANDING:<amount>" if debt > 0.
 *
 * @param {string} uid
 */
export async function checkDebtBeforeRide(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.data();
  if (user?.debt?.amount > 0) {
    throw new Error(`DEBT_OUTSTANDING:${user.debt.amount}`);
  }
}

/**
 * After a top-up, clear the student's outstanding debt if the new balance covers it.
 * Runs inside a Firestore transaction to avoid races.
 *
 * @param {string} uid
 */
export async function clearDebtAfterTopUp(uid) {
  const userRef = doc(db, "users", uid);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(userRef);
    const user = snap.data();
    if (!user?.debt?.amount || user.debt.amount <= 0) return;
    if ((user.wallet?.balance || 0) < user.debt.amount)  return;

    transaction.update(userRef, {
      "wallet.balance":  user.wallet.balance - user.debt.amount,
      "debt.amount":     0,
      "debt.rideId":     null,
      "debt.incurredAt": null,
    });
  });
}

// ─── PROFILE STATS ───────────────────────────────────────────────────────────

/**
 * Fetch one-shot ride + spending stats for the Profile screen.
 * Mirrors renderStudentProfileStats() from the main branch.
 *
 * @param {string} uid
 * @returns {{ totalRides, totalSpent, topPickup, topDropoff }}
 */
export async function fetchProfileStats(uid) {
  try {
    const [requestSnap, txSnap] = await Promise.all([
      getDocs(
        query(collection(db, "rideRequests"), where("studentId", "==", uid))
      ),
      getDocs(
        query(collection(db, "walletTransactions"), where("userId", "==", uid))
      ),
    ]);

    const requests   = requestSnap.docs.map((d) => d.data());
    const completed  = requests.filter(
      (r) => r.status === "completed" || r.status === "matched"
    );

    const deductions = txSnap.docs
      .map((d) => d.data())
      .filter((tx) => tx.type === "deduction" || isRideTx(tx));

    const totalSpent = deductions.reduce(
      (sum, tx) => sum + (Number(tx.amount) || 0),
      0
    );

    const stopLabel = (val) => {
      if (!val) return null;
      if (typeof val === "string") return val;
      return val.label || val.name || val.locationLabel || null;
    };

    const mostFrequent = (values) => {
      const counts = new Map();
      values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };

    return {
      totalRides:  completed.length || deductions.length,
      totalSpent,
      topPickup:   mostFrequent(requests.map((r) => stopLabel(r.pickup))),
      topDropoff:  mostFrequent(requests.map((r) => stopLabel(r.dropoff))),
    };
  } catch (err) {
    console.warn("[wallet] fetchProfileStats error:", err.code ?? err.message);
    return { totalRides: 0, totalSpent: 0, topPickup: null, topDropoff: null };
  }
}
