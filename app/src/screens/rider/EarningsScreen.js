/**
 * RiderEarningsScreen.js
 *
 * Detailed rider earnings tracking, transaction history, and withdrawal system.
 * Ports functionality from main branch riderWallet.js for mobile UX.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header                      │
 *  │  Balance Card                │
 *  │   ├─ Current balance         │
 *  │   ├─ Weekly earnings         │
 *  │   └─ Total rides             │
 *  │  Withdraw Button             │
 *  │  History Tabs (Earnings/Withdrawals) │
 *  │  Transaction List            │
 *  └──────────────────────────────┘
 */

import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import useStore from "../../store";
import {
  listenToRiderEarnings,
  listenToRiderTransactions,
  listenToRiderWithdrawals,
  requestWithdrawal,
  formatNaira,
} from "../../services/rider";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  orange:    "#FF5E1A",
  orangeMute: "rgba(255,94,26,0.12)",
  green:     "#00C48C",
  text:      "#FFFFFF",
  sub:       "#888",
  error:     "#fca5a5",
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function BalanceCard({ balance, weeklyEarnings, totalRides, loading }) {
  if (loading) {
    return (
      <View style={styles.balanceCard}>
        <ActivityIndicator color={C.orange} />
      </View>
    );
  }

  return (
    <View style={styles.balanceCard}>
      <View style={styles.balanceHeader}>
        <Text style={styles.balanceLabel}>Available Balance</Text>
        <Text style={styles.balanceAmount}>{formatNaira(balance)}</Text>
      </View>
      
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{formatNaira(weeklyEarnings)}</Text>
          <Text style={styles.statLabel}>This Week</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalRides}</Text>
          <Text style={styles.statLabel}>Total Rides</Text>
        </View>
      </View>
    </View>
  );
}

function TransactionItem({ transaction }) {
  const isEarning = transaction.type === "earning";
  const isWithdrawal = transaction.type === "withdrawal";
  
  return (
    <View style={styles.transactionItem}>
      <View style={styles.transactionMain}>
        <View style={[styles.transactionIcon, isEarning ? styles.earningIcon : styles.withdrawalIcon]}>
          <Text style={styles.iconText}>
            {isEarning ? "💰" : isWithdrawal ? "🏦" : "📊"}
          </Text>
        </View>
        <View style={styles.transactionInfo}>
          <Text style={styles.transactionTitle}>
            {transaction.description || (isEarning ? "Ride earning" : "Withdrawal")}
          </Text>
          <Text style={styles.transactionDate}>
            {formatDate(transaction.createdAt)}
          </Text>
        </View>
        <Text style={[styles.transactionAmount, isEarning ? styles.creditAmount : styles.debitAmount]}>
          {isEarning ? "+" : "-"}{formatNaira(transaction.amount)}
        </Text>
      </View>
    </View>
  );
}

function WithdrawalItem({ withdrawal }) {
  const getStatusColor = (status) => {
    switch (status) {
      case "completed": return C.green;
      case "rejected": return C.error;
      default: return C.orange;
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case "completed": return "Paid";
      case "rejected": return "Rejected";
      default: return "Pending";
    }
  };

  return (
    <View style={styles.withdrawalItem}>
      <View style={styles.withdrawalHeader}>
        <Text style={styles.withdrawalAmount}>{formatNaira(withdrawal.amount)}</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(withdrawal.status) + "20" }]}>
          <Text style={[styles.statusText, { color: getStatusColor(withdrawal.status) }]}>
            {getStatusLabel(withdrawal.status)}
          </Text>
        </View>
      </View>
      <Text style={styles.withdrawalBank}>
        {withdrawal.bankName} • {withdrawal.accountNumber}
      </Text>
      <Text style={styles.withdrawalDate}>
        Requested {formatDate(withdrawal.requestedAt)}
      </Text>
      {withdrawal.rejectedReason && (
        <Text style={styles.rejectionReason}>
          Reason: {withdrawal.rejectedReason}
        </Text>
      )}
    </View>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function RiderEarningsScreen() {
  const { currentUser, showToast, riderEarnings } = useStore();
  
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [activeTab, setActiveTab] = useState("earnings"); // "earnings" | "withdrawals"
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Withdrawal modal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Refs for cleanup
  const transactionsUnsubscribe = useRef(null);
  const withdrawalsUnsubscribe = useRef(null);

  const riderId = currentUser?.uid;

  // ── Initialize listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!riderId) return;

    // Listen to transactions
    transactionsUnsubscribe.current = listenToRiderTransactions(riderId, setTransactions);
    
    // Listen to withdrawals
    withdrawalsUnsubscribe.current = listenToRiderWithdrawals(riderId, setWithdrawals);
    
    setLoading(false);

    // Cleanup
    return () => {
      transactionsUnsubscribe.current?.();
      withdrawalsUnsubscribe.current?.();
    };
  }, [riderId]);

  // ── Refresh handler ───────────────────────────────────────────────────────
  async function handleRefresh() {
    setRefreshing(true);
    // Refresh is handled by listeners automatically
    setTimeout(() => setRefreshing(false), 1000);
  }

  // ── Withdrawal handlers ───────────────────────────────────────────────────
  function openWithdrawModal() {
    if (riderEarnings.balance <= 0) {
      showToast("No balance available for withdrawal", "error");
      return;
    }
    setShowWithdrawModal(true);
  }

  function closeWithdrawModal() {
    setShowWithdrawModal(false);
    setWithdrawAmount("");
    setBankName("");
    setAccountNumber("");
    setAccountName("");
  }

  async function handleWithdrawSubmit() {
    const amountNaira = Number(withdrawAmount);
    
    if (!amountNaira || amountNaira <= 0) {
      showToast("Enter withdrawal amount", "error");
      return;
    }
    
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
      showToast("Enter complete bank details", "error");
      return;
    }

    const amountKobo = Math.round(amountNaira * 100);
    if (amountKobo > riderEarnings.balance) {
      showToast("Insufficient balance", "error");
      return;
    }

    setSubmitting(true);
    try {
      await requestWithdrawal(riderId, amountNaira, {
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
      });
      
      showToast("Withdrawal requested successfully", "success");
      closeWithdrawModal();
      setActiveTab("withdrawals");
    } catch (error) {
      showToast(error.message || "Withdrawal request failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function formatDate(timestamp) {
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-NG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return formatDate(timestamp);
  }

  const earningsTransactions = transactions.filter(tx => tx.type === "earning");
  const currentData = activeTab === "earnings" ? earningsTransactions : withdrawals;

  return (
    <View style={styles.root}>
      <ScrollView 
        style={styles.scroll} 
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.orange}
            colors={[C.orange]}
          />
        }
      >
        
        {/* ── Header ──────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>Earnings</Text>
          <Text style={styles.subtitle}>Track your income and withdrawals</Text>
        </View>

        {/* ── Balance Card ────────────────────────────────────── */}
        <BalanceCard
          balance={riderEarnings.balance}
          weeklyEarnings={riderEarnings.todayEarnings} // Using today as proxy for week
          totalRides={riderEarnings.totalRides}
          loading={loading}
        />

        {/* ── Withdraw Button ─────────────────────────────────── */}
        <TouchableOpacity 
          style={styles.withdrawBtn} 
          onPress={openWithdrawModal}
          disabled={riderEarnings.balance <= 0}
        >
          <Text style={styles.withdrawBtnText}>Request Withdrawal</Text>
        </TouchableOpacity>

        {/* ── History Tabs ────────────────────────────────────── */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "earnings" && styles.tabActive]}
            onPress={() => setActiveTab("earnings")}
          >
            <Text style={[styles.tabText, activeTab === "earnings" && styles.tabTextActive]}>
              Earnings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "withdrawals" && styles.tabActive]}
            onPress={() => setActiveTab("withdrawals")}
          >
            <Text style={[styles.tabText, activeTab === "withdrawals" && styles.tabTextActive]}>
              Withdrawals
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Transaction/Withdrawal List ─────────────────────── */}
        <View style={styles.listContainer}>
          {currentData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                No {activeTab === "earnings" ? "earnings" : "withdrawals"} yet
              </Text>
              <Text style={styles.emptySub}>
                {activeTab === "earnings" 
                  ? "Start accepting rides to earn money" 
                  : "Request a withdrawal to see it here"
                }
              </Text>
            </View>
          ) : (
            <FlatList
              data={currentData}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => 
                activeTab === "earnings" ? (
                  <TransactionItem transaction={item} />
                ) : (
                  <WithdrawalItem withdrawal={item} />
                )
              }
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

      </ScrollView>

      {/* ── Withdrawal Modal ─────────────────────────────────── */}
      <Modal
        visible={showWithdrawModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeWithdrawModal}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Request Withdrawal</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.availableBalance}>
              Available: {formatNaira(riderEarnings.balance)}
            </Text>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Amount (₦)</Text>
              <TextInput
                style={styles.input}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholder="0.00"
                placeholderTextColor={C.sub}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Bank Name</Text>
              <TextInput
                style={styles.input}
                value={bankName}
                onChangeText={setBankName}
                placeholder="e.g. First Bank"
                placeholderTextColor={C.sub}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Account Number</Text>
              <TextInput
                style={styles.input}
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="1234567890"
                placeholderTextColor={C.sub}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Account Name</Text>
              <TextInput
                style={styles.input}
                value={accountName}
                onChangeText={setAccountName}
                placeholder="Account holder name"
                placeholderTextColor={C.sub}
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleWithdrawSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#0F0F13" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 60 },

  header: { marginBottom: 24 },
  title:    { color: C.text, fontSize: 28, fontWeight: "700", marginBottom: 4 },
  subtitle: { color: C.sub, fontSize: 15 },

  balanceCard: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         20,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  balanceHeader: { alignItems: "center", marginBottom: 20 },
  balanceLabel:  { color: C.sub, fontSize: 14, marginBottom: 8 },
  balanceAmount: { color: C.orange, fontSize: 32, fontWeight: "800" },

  statsGrid: { flexDirection: "row", gap: 16 },
  statItem: {
    flex:           1,
    alignItems:     "center",
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderRadius:   12,
    borderWidth:    1,
    borderColor:    C.border,
  },
  statValue: { color: C.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  statLabel: { color: C.sub, fontSize: 12 },

  withdrawBtn: {
    backgroundColor: C.orange,
    borderRadius:    14,
    paddingVertical: 16,
    alignItems:      "center",
    marginBottom:    24,
  },
  withdrawBtnText: { color: "#0F0F13", fontWeight: "700", fontSize: 16 },

  tabs: {
    flexDirection:   "row",
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         4,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  tab:           { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 9 },
  tabActive:     { backgroundColor: C.orange },
  tabText:       { color: C.sub, fontWeight: "600" },
  tabTextActive: { color: "#0F0F13" },

  listContainer: { paddingBottom: 100 },

  // Transaction item styles
  transactionItem: { marginBottom: 12 },
  transactionMain: { 
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  transactionIcon: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    alignItems: "center", 
    justifyContent: "center",
    marginRight: 12,
  },
  earningIcon:    { backgroundColor: C.green + "20" },
  withdrawalIcon: { backgroundColor: C.orange + "20" },
  iconText:       { fontSize: 18 },
  transactionInfo: { flex: 1 },
  transactionTitle: { color: C.text, fontSize: 15, fontWeight: "600", marginBottom: 2 },
  transactionDate:  { color: C.sub, fontSize: 13 },
  transactionAmount: { fontSize: 16, fontWeight: "700" },
  creditAmount:  { color: C.green },
  debitAmount:   { color: C.orange },

  // Withdrawal item styles
  withdrawalItem: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  withdrawalHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center",
    marginBottom: 8,
  },
  withdrawalAmount: { color: C.text, fontSize: 18, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText:  { fontSize: 12, fontWeight: "600" },
  withdrawalBank: { color: C.text, fontSize: 14, marginBottom: 4 },
  withdrawalDate: { color: C.sub, fontSize: 13 },
  rejectionReason: { color: C.error, fontSize: 13, marginTop: 8 },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 40 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySub:   { color: C.sub, fontSize: 14, textAlign: "center" },

  // Modal styles
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalCancel: { color: C.orange, fontSize: 16 },
  modalTitle:  { color: C.text, fontSize: 18, fontWeight: "600" },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },

  availableBalance: { 
    color: C.orange, 
    fontSize: 16, 
    fontWeight: "600", 
    textAlign: "center",
    marginBottom: 24,
  },

  formGroup: { marginBottom: 20 },
  label: { color: C.text, fontSize: 16, fontWeight: "600", marginBottom: 8 },
  input: {
    backgroundColor:   C.surface,
    borderRadius:      12,
    paddingHorizontal: 16,
    paddingVertical:   14,
    color:             C.text,
    fontSize:          16,
    borderWidth:       1,
    borderColor:       C.border,
  },

  submitBtn: {
    backgroundColor: C.orange,
    borderRadius:    14,
    paddingVertical: 16,
    alignItems:      "center",
    marginTop:       20,
    marginBottom:    40,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText:     { color: "#0F0F13", fontWeight: "700", fontSize: 16 },
});