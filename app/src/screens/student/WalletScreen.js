/**
 * WalletScreen.js
 *
 * Student wallet — mirrors the walletView / topUpView from the main branch,
 * redesigned for React Native / mobile UX.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header                      │
 *  │  Balance card (animated)     │
 *  │  Debt banner (if any)        │
 *  │  Weekly spend summary        │
 *  │  Top-up button               │
 *  │  Filter tabs  All/Top-ups/Rides│
 *  │  Transaction list            │
 *  │    └─ expandable rows        │
 *  └──────────────────────────────┘
 *
 *  Top-up modal (bottom sheet):
 *    Preset amounts + custom input → opens Paystack in browser
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import useStore from "../../store";
import {
  listenToWallet,
  initiateTopUp,
  formatNaira,
  formatTxTime,
  formatRelativeTxTime,
  isCreditTx,
  isRideTx,
  txTypeLabel,
  MIN_TOPUP_NAIRA,
  TOPUP_PRESET_AMOUNTS,
  LOW_BALANCE_THRESHOLD,
} from "../../services/wallet";

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  red:       "#ef4444",
  redMute:   "rgba(239,68,68,0.12)",
  orange:    "#f59e0b",
  text:      "#FFFFFF",
  sub:       "#888",
  card:      "#151519",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function weeklySpend(transactions) {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const rideOnly = transactions.filter(isRideTx);
  const thisWeek = rideOnly.filter((tx) => {
    const ts = tx.createdAt;
    if (!ts) return false;
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : null;
    return d && d >= weekStart;
  });

  const total = thisWeek.reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  return { total, count: thisWeek.length };
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

/** Animated balance counter */
function BalanceDisplay({ target, isLow }) {
  const anim     = useRef(new Animated.Value(target)).current;
  const prevRef  = useRef(target);
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    const from = prevRef.current;
    const to   = target;
    prevRef.current = to;

    // We can't do a true JS counter with Animated.Value → text, so we drive a
    // JS interval for the numeric tick (same feel as the main branch animation).
    const duration = 700;
    const steps    = 30;
    const stepMs   = duration / steps;
    const delta    = (to - from) / steps;
    let current    = from;
    let i          = 0;
    const id       = setInterval(() => {
      i++;
      current += delta;
      setDisplay(Math.round(i < steps ? current : to));
      if (i >= steps) clearInterval(id);
    }, stepMs);

    return () => clearInterval(id);
  }, [target]);

  return (
    <Text style={[styles.balanceAmount, isLow && { color: C.orange }]}>
      {formatNaira(display)}
    </Text>
  );
}

/** Single transaction row with expand/collapse */
function TxRow({ tx }) {
  const [expanded, setExpanded] = useState(false);
  const isCredit = isCreditTx(tx);
  const label    = txTypeLabel(tx);

  return (
    <TouchableOpacity
      style={styles.txRow}
      onPress={() => setExpanded((v) => !v)}
      activeOpacity={0.75}
    >
      {/* Main row */}
      <View style={styles.txMain}>
        <View style={[styles.txIcon, isCredit ? styles.txIconCredit : styles.txIconDebit]}>
          <Text style={styles.txIconText}>{isCredit ? "↓" : "↑"}</Text>
        </View>
        <View style={styles.txCopy}>
          <Text style={styles.txDesc} numberOfLines={1}>
            {tx.description || label}
          </Text>
          <Text style={styles.txTime}>{formatRelativeTxTime(tx.createdAt)}</Text>
        </View>
        <Text style={[styles.txAmount, isCredit ? styles.txCredit : styles.txDebit]}>
          {isCredit ? "+" : "−"}{formatNaira(tx.amount)}
        </Text>
      </View>

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.txDetail}>
          <TxDetailRow label="Type"           value={label} />
          <TxDetailRow label="Date"           value={formatTxTime(tx.createdAt)} />
          <TxDetailRow label="Balance before" value={formatNaira(tx.balanceBefore)} />
          <TxDetailRow label="Balance after"  value={formatNaira(tx.balanceAfter)} />
          <TxDetailRow label="Reference"      value={tx.reference || tx.rideId || tx.id || "—"} />
          <TxDetailRow label="Status"         value={tx.status || "completed"} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function TxDetailRow({ label, value }) {
  return (
    <View style={styles.txDetailRow}>
      <Text style={styles.txDetailLabel}>{label}</Text>
      <Text style={styles.txDetailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Filter tab bar */
function FilterTabs({ active, onChange }) {
  const tabs = [
    { id: "all",    label: "All" },
    { id: "topups", label: "Top-ups" },
    { id: "rides",  label: "Rides" },
  ];
  return (
    <View style={styles.filterBar}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.id}
          style={[styles.filterTab, active === t.id && styles.filterTabActive]}
          onPress={() => onChange(t.id)}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterTabText, active === t.id && styles.filterTabTextActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Top-up bottom modal */
function TopUpModal({ visible, onClose, onConfirm, loading, email }) {
  const [selected, setSelected] = useState(1_000);
  const [custom,   setCustom]   = useState("");

  const effectiveAmount = custom ? Number(custom) || 0 : selected;
  const isValid         = effectiveAmount >= MIN_TOPUP_NAIRA;

  function handleConfirm() {
    if (!isValid) return;
    onConfirm(effectiveAmount);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <Text style={styles.modalTitle}>Top Up Wallet</Text>
        <Text style={styles.modalSub}>Select or enter an amount in Naira</Text>

        {/* Preset chips */}
        <View style={styles.chipRow}>
          {TOPUP_PRESET_AMOUNTS.map((amt) => (
            <TouchableOpacity
              key={amt}
              style={[styles.chip, selected === amt && !custom && styles.chipActive]}
              onPress={() => { setSelected(amt); setCustom(""); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, selected === amt && !custom && styles.chipTextActive]}>
                ₦{amt.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom input */}
        <TextInput
          style={styles.customInput}
          placeholder="Custom amount (₦)"
          placeholderTextColor={C.sub}
          keyboardType="numeric"
          value={custom}
          onChangeText={(v) => { setCustom(v); setSelected(0); }}
          returnKeyType="done"
        />

        {!isValid && effectiveAmount > 0 && (
          <Text style={styles.minNote}>
            Minimum top-up is {formatNaira(MIN_TOPUP_NAIRA * 100)}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, (!isValid || loading) && styles.primaryBtnDisabled]}
          onPress={handleConfirm}
          disabled={!isValid || loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#0F0F13" />
            : <Text style={styles.primaryBtnText}>
                Pay {isValid ? formatNaira(effectiveAmount * 100) : "—"} via Paystack
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function WalletScreen() {
  const { currentUser, setWalletBalance, setTransactions, showToast } = useStore();

  const [balance,      setBalance]      = useState(currentUser?.wallet?.balance ?? 0);
  const [debt,         setDebt]         = useState(currentUser?.debt?.amount    ?? 0);
  const [transactions, setTxState]      = useState([]);
  const [filter,       setFilter]       = useState("all");
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);

  const unsubRef = useRef(null);

  // ── Subscribe to wallet on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.uid) return;

    unsubRef.current = listenToWallet(
      currentUser.uid,
      // onBalance
      (bal, debtAmt) => {
        setBalance(bal);
        setDebt(debtAmt);
        setWalletBalance(bal); // keep store in sync for the header
      },
      // onTransactions
      (txs) => {
        setTxState(txs);
        setTransactions(txs); // keep store in sync
      },
      // onTopUp
      () => showToast("Wallet credited! 🎉", "success")
    );

    return () => unsubRef.current?.();
  }, [currentUser?.uid]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const isLow = balance < LOW_BALANCE_THRESHOLD;

  const filteredTx = transactions.filter((tx) => {
    if (filter === "topups") return ["topup", "refund"].includes(tx.type);
    if (filter === "rides")  return isRideTx(tx);
    return true;
  });

  const weekly = weeklySpend(transactions);

  // ── Top-up ───────────────────────────────────────────────────────────────────
  async function handleTopUp(amountNaira) {
    setTopUpLoading(true);
    try {
      await initiateTopUp({
        uid:         currentUser.uid,
        email:       currentUser.email,
        amountNaira,
      });
      setTopUpVisible(false);
      showToast("Paystack checkout opened. Come back once you've paid.", "info");
    } catch (err) {
      showToast(err.message || "Failed to open payment page.", "error");
    } finally {
      setTopUpLoading(false);
    }
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  const emptyLabel =
    filter === "topups" ? "top-ups"
    : filter === "rides" ? "ride payments"
    : "transactions";

  return (
    <View style={styles.root}>
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkOp}>OP</Text>
          <Text style={styles.wordmarkRides}>rides</Text>
        </View>
      </View>

      <FlatList
        data={filteredTx}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💳</Text>
            <Text style={styles.emptyTitle}>No {emptyLabel} yet</Text>
          </View>
        }
        ListHeaderComponent={
          <>
            {/* ── BALANCE CARD ──────────────────────────────────── */}
            <View style={[styles.balanceCard, isLow && styles.balanceCardLow]}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <BalanceDisplay target={balance} isLow={isLow} />
              {isLow && (
                <View style={styles.lowBadge}>
                  <Text style={styles.lowBadgeText}>⚠ Low balance</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.topUpBtn}
                onPress={() => setTopUpVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.topUpBtnText}>+ Top Up</Text>
              </TouchableOpacity>
            </View>

            {/* ── DEBT BANNER ───────────────────────────────────── */}
            {debt > 0 && (
              <View style={styles.debtBanner}>
                <Text style={styles.debtText}>
                  ⚠ Outstanding balance: {formatNaira(debt)}
                </Text>
                <Text style={styles.debtSub}>
                  Top up to clear this before your next ride.
                </Text>
                <TouchableOpacity
                  style={styles.debtBtn}
                  onPress={() => setTopUpVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.debtBtnText}>Clear Now</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── WEEKLY SPEND ──────────────────────────────────── */}
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>This week</Text>
                <Text style={styles.summaryValue}>{formatNaira(weekly.total)}</Text>
                <Text style={styles.summaryMeta}>
                  {weekly.count} ride{weekly.count !== 1 ? "s" : ""}
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total balance</Text>
                <Text style={[styles.summaryValue, { color: isLow ? C.orange : C.green }]}>
                  {formatNaira(balance)}
                </Text>
                <Text style={styles.summaryMeta}>
                  {isLow ? "Top up soon" : "Looking good"}
                </Text>
              </View>
            </View>

            {/* ── SECTION HEADER + FILTERS ──────────────────────── */}
            <Text style={styles.sectionTitle}>Transaction History</Text>
            <FilterTabs active={filter} onChange={setFilter} />
          </>
        }
        renderItem={({ item }) => <TxRow tx={item} />}
      />

      {/* ── TOP-UP MODAL ────────────────────────────────────────── */}
      <TopUpModal
        visible={topUpVisible}
        onClose={() => setTopUpVisible(false)}
        onConfirm={handleTopUp}
        loading={topUpLoading}
        email={currentUser?.email}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.bg },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // ── Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 20,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     16,
    backgroundColor:   C.bg,
  },
  headerTitle:    { color: C.text, fontWeight: "800", fontSize: 24 },
  wordmark:       { flexDirection: "row" },
  wordmarkOp:     { color: C.text, fontWeight: "800", fontSize: 20 },
  wordmarkRides:  { color: C.green, fontWeight: "800", fontSize: 20 },

  // ── Balance card
  balanceCard: {
    backgroundColor: C.surface,
    borderRadius:    20,
    padding:         24,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
    alignItems:      "center",
  },
  balanceCardLow: {
    borderColor: C.orange,
    backgroundColor: "rgba(245,158,11,0.06)",
  },
  balanceLabel:  { color: C.sub, fontSize: 13, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  balanceAmount: { color: C.green, fontSize: 40, fontWeight: "800", marginBottom: 8 },
  lowBadge:      { backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 },
  lowBadgeText:  { color: C.orange, fontSize: 12, fontWeight: "600" },

  topUpBtn:     { backgroundColor: C.green, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32, marginTop: 8 },
  topUpBtnText: { color: "#0F0F13", fontWeight: "700", fontSize: 15 },

  // ── Debt banner
  debtBanner: {
    backgroundColor: C.redMute,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     C.red,
    padding:         16,
    marginBottom:    16,
  },
  debtText:    { color: C.red, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  debtSub:     { color: C.sub, fontSize: 12, marginBottom: 12 },
  debtBtn:     { alignSelf: "flex-start", backgroundColor: C.red, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  debtBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  // ── Summary row
  summaryRow:  { flexDirection: "row", gap: 10, marginBottom: 24 },
  summaryCard: {
    flex:            1,
    backgroundColor: C.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     C.border,
    padding:         14,
  },
  summaryLabel: { color: C.sub, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  summaryValue: { color: C.text, fontWeight: "700", fontSize: 16, marginBottom: 2 },
  summaryMeta:  { color: C.sub, fontSize: 11 },

  // ── Section title
  sectionTitle: { color: C.text, fontWeight: "700", fontSize: 16, marginBottom: 12 },

  // ── Filter tabs
  filterBar:          { flexDirection: "row", gap: 8, marginBottom: 12 },
  filterTab:          { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  filterTabActive:    { backgroundColor: C.greenMute, borderColor: C.green },
  filterTabText:      { color: C.sub, fontSize: 13, fontWeight: "600" },
  filterTabTextActive:{ color: C.green },

  // ── Transaction rows
  txRow: {
    backgroundColor: C.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     C.border,
    marginBottom:    8,
    overflow:        "hidden",
  },
  txMain: {
    flexDirection:  "row",
    alignItems:     "center",
    padding:        14,
    gap:            12,
  },
  txIcon:        { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txIconCredit:  { backgroundColor: C.greenMute },
  txIconDebit:   { backgroundColor: C.redMute },
  txIconText:    { fontSize: 16, fontWeight: "700" },
  txCopy:        { flex: 1 },
  txDesc:        { color: C.text, fontSize: 13, fontWeight: "600", marginBottom: 2 },
  txTime:        { color: C.sub, fontSize: 11 },
  txAmount:      { fontSize: 14, fontWeight: "700" },
  txCredit:      { color: C.green },
  txDebit:       { color: C.red },

  txDetail: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    padding:        14,
    gap:            6,
  },
  txDetailRow:   { flexDirection: "row", justifyContent: "space-between" },
  txDetailLabel: { color: C.sub, fontSize: 12 },
  txDetailValue: { color: C.text, fontSize: 12, fontWeight: "600", maxWidth: "60%" },

  // ── Empty state
  emptyState: { alignItems: "center", paddingTop: 40 },
  emptyIcon:  { fontSize: 40, marginBottom: 10 },
  emptyTitle: { color: C.sub, fontSize: 15, fontWeight: "600" },

  // ── Primary / cancel buttons (shared)
  primaryBtn:         { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { color: "#0F0F13", fontWeight: "700", fontSize: 15 },
  cancelBtn:          { paddingVertical: 13, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: C.border, marginTop: 8 },
  cancelBtnText:      { color: C.sub, fontWeight: "600" },

  // ── Top-up modal sheet
  modalBackdrop: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalSheet: {
    backgroundColor:      C.surface,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    borderTopWidth:       1,
    borderColor:          C.border,
    padding:              24,
    paddingBottom:        Platform.OS === "ios" ? 40 : 24,
  },
  modalHandle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: C.border,
    alignSelf:       "center",
    marginBottom:    20,
  },
  modalTitle: { color: C.text, fontWeight: "800", fontSize: 20, marginBottom: 4 },
  modalSub:   { color: C.sub, fontSize: 13, marginBottom: 20 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    paddingVertical:   9,
    paddingHorizontal: 16,
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       C.border,
    backgroundColor:   C.bg,
  },
  chipActive:     { backgroundColor: C.greenMute, borderColor: C.green },
  chipText:       { color: C.sub, fontWeight: "600", fontSize: 14 },
  chipTextActive: { color: C.green },

  customInput: {
    backgroundColor: C.bg,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
    color:           C.text,
    paddingHorizontal: 14,
    paddingVertical:   13,
    fontSize:        15,
    marginBottom:    8,
  },
  minNote: { color: C.orange, fontSize: 12, marginBottom: 8 },
});
