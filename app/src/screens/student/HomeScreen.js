/**
 * HomeScreen.js — Student Home (full page, no bottom sheet)
 *
 * Sections (switch based on ridePhase):
 *  idle       → Request form
 *  searching  → Searching spinner + cancel
 *  queued     → Queue position + cancel
 *  matched    → Ride info + cancel  (auto-switches to Map tab)
 *  onTrip     → On trip info + pay
 *  arrived    → Completion card
 *
 * History always visible at the bottom when idle.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import useStore from "../../store";
import {
  loadCampusDataFromFirestore,
  listenToCampusData,
  listenToCampusActivity,
  getRideStops,
} from "../../services/campus-data";
import {
  requestRide,
  cancelRide,
  payForRide,
  listenToRequest,
  listenToRide,
  listenToQueue,
  listenToRideHistory,
  deleteRideRecord,
} from "../../services/student";
import { formatNaira } from "../../services/ride-helpers";
import { sendLocalNotification } from "../../services/notifications";

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const C = {
  bg:      "#0F0F13",
  surface: "#1A1A22",
  border:  "#2a2a35",
  green:   "#00C48C",
  red:     "#ef4444",
  text:    "#FFFFFF",
  sub:     "#888",
  pill: {
    searching: "#f59e0b",
    matched:   "#00C48C",
    queued:    "#6366f1",
    cancelled: "#ef4444",
    completed: "#10b981",
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getInitials(name = "") {
  return name.trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map(p => p[0].toUpperCase()).join("") || "ST";
}

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}

function formatRelative(ts) {
  const date = tsToDate(ts);
  if (!date) return "Just now";
  const diff = Date.now() - date.getTime();
  const m = 60000, h = 3600000, d = 86400000;
  if (diff < m) return "Just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusColor(status) { return C.pill[status] ?? C.sub; }

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function StatusPill({ status }) {
  return (
    <View style={[styles.pill, { backgroundColor: statusColor(status) + "22", borderColor: statusColor(status) }]}>
      <Text style={[styles.pillText, { color: statusColor(status) }]}>
        {status?.toUpperCase() ?? "UNKNOWN"}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValue}>{typeof value === "string" ? <Text style={styles.infoValueText}>{value}</Text> : value}</View>
    </View>
  );
}

function StopPicker({ label, value, stops, onSelect }) {
  const [open, setOpen] = useState(false);
  const selected = stops.find(s => s.id === value);
  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <Text style={[styles.pickerBtnText, !selected && { color: C.sub }]}>
          {selected ? selected.name : `Select ${label}`}
        </Text>
        <Text style={{ color: C.sub, fontSize: 12 }}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.pickerDropdown}>
          {stops.length === 0
            ? <Text style={styles.pickerEmpty}>No stops available yet</Text>
            : stops.map(stop => (
                <TouchableOpacity
                  key={stop.id}
                  style={[styles.pickerOption, value === stop.id && styles.pickerOptionActive]}
                  onPress={() => { onSelect(stop.id); setOpen(false); }}
                >
                  <Text style={[styles.pickerOptionText, value === stop.id && { color: C.green }]}>
                    {stop.name}
                  </Text>
                </TouchableOpacity>
              ))
          }
        </View>
      )}
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function StudentHomeScreen({ navigation }) {
  const {
    currentUser, walletBalance,
    currentRequestId, currentRideId, latestRide,
    setCurrentRequestId, setCurrentRideId, setLatestRide,
    clearRideState, showToast,
  } = useStore();

  const [rideStops,  setRideStops]  = useState([]);
  const [pickupId,   setPickupId]   = useState(null);
  const [dropoffId,  setDropoffId]  = useState(null);
  const [requesting, setRequesting] = useState(false);

  const [ridePhase,   setRidePhase]   = useState("idle");
  const [liveSummary, setLiveSummary] = useState(null);
  const [queueInfo,   setQueueInfo]   = useState(null);
  const [payingNow,   setPayingNow]   = useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const [history,     setHistory]     = useState([]);
  const [campusActivity, setCampusActivity] = useState({ ridersOnline: 0, studentsInQueue: 0 });

  const notifiedArrivingRef = useRef(false);
  const unsubRequestRef     = useRef(null);
  const unsubRideRef        = useRef(null);
  const unsubQueueRef       = useRef(null);
  const unsubHistoryRef     = useRef(null);
  const unsubCampusRef      = useRef(null);
  const unsubActivityRef    = useRef(null);

  // ── Load campus data ────────────────────────────────────────────────────
  useEffect(() => {
    loadCampusDataFromFirestore().then(() => setRideStops(getRideStops()));
    unsubCampusRef.current = listenToCampusData(() => setRideStops(getRideStops()));
    unsubActivityRef.current = listenToCampusActivity(setCampusActivity);
    if (currentUser?.uid) {
      unsubHistoryRef.current = listenToRideHistory(currentUser.uid, setHistory);
    }
    return () => {
      unsubCampusRef.current?.();
      unsubActivityRef.current?.();
      unsubHistoryRef.current?.();
      unsubRequestRef.current?.();
      unsubRideRef.current?.();
      unsubQueueRef.current?.();
    };
  }, []);

  // ── Listeners ───────────────────────────────────────────────────────────
  const attachRideListener = useCallback((rideId) => {
    unsubRideRef.current?.();
    unsubRideRef.current = listenToRide(rideId, currentUser.uid, (summary) => {
      if (!summary) return;
      setLatestRide(summary);
      setLiveSummary(summary);

      if (summary.pickupStatus === "completed" && ridePhase !== "onTrip") {
        setRidePhase("onTrip");
        notifiedArrivingRef.current = false;
        sendLocalNotification("Picked Up!", "You're on your way.");
      }

      if (summary.isCompleted) {
        setRidePhase("arrived");
        clearRideState();
        showToast("You have arrived! Thanks for riding NavCamp.", "success");
      }

      if (
        summary.pickupStatus !== "completed" &&
        summary.distanceToPickup !== null &&
        summary.distanceToPickup <= 50 &&
        !notifiedArrivingRef.current
      ) {
        notifiedArrivingRef.current = true;
        showToast("Your keke is arriving!", "info");
      }
    });
  }, [currentUser?.uid, ridePhase]);

  const attachRequestListener = useCallback((requestId) => {
    unsubRequestRef.current?.();
    unsubRequestRef.current = listenToRequest(requestId, (request) => {
      if (!request) return;

      if (request.status === "matched" && request.matchedRideId) {
        setCurrentRideId(request.matchedRideId);
        setRidePhase("matched");
        attachRideListener(request.matchedRideId);
        showToast("Ride matched! Your keke is on the way.", "success");
        sendLocalNotification("Ride Matched!", "Your keke is on the way.", { rideId: request.matchedRideId });
        // Auto-switch to Map tab
        navigation.navigate("Map");
      }

      if (request.status === "queued") {
        setRidePhase("queued");
        if (request.queueDocId) attachQueueListener(request.queueDocId);
      }

      if (request.status === "cancelled") {
        setRidePhase("idle");
        clearRideState();
        showToast("Ride request cancelled.", "info");
        notifiedArrivingRef.current = false;
      }
    });
  }, [attachRideListener]);

  const attachQueueListener = useCallback((queueDocId) => {
    unsubQueueRef.current?.();
    unsubQueueRef.current = listenToQueue(queueDocId, setQueueInfo);
  }, []);

  // ── Request ride ────────────────────────────────────────────────────────
  async function handleRequestRide() {
    if (requesting || ridePhase !== "idle") return;
    setRequesting(true);
    try {
      const { requestId } = await requestRide({
        studentId:    currentUser.uid,
        studentName:  currentUser.name ?? currentUser.displayName ?? "Student",
        pickupId,
        dropoffId,
        walletBalance,
        debt: currentUser.debt,
      });
      setCurrentRequestId(requestId);
      setRidePhase("searching");
      attachRequestListener(requestId);
      showToast("Looking for your keke...", "info");
    } catch (err) {
      if (err.message?.startsWith("DEBT_OUTSTANDING:")) {
        const amount = Number(err.message.split(":")[1] || 0);
        showToast(`Outstanding balance of ${formatNaira(amount)}. Top up to continue.`, "error");
      } else if (err.message === "SAME_STOP") {
        showToast("Pickup and drop-off cannot be the same stop.", "error");
      } else {
        showToast("Failed to request ride. Try again.", "error");
      }
    } finally {
      setRequesting(false);
    }
  }

  // ── Cancel ride ─────────────────────────────────────────────────────────
  function handleCancel() {
    if (cancelling) return;
    Alert.alert("Cancel Ride", "Are you sure?", [
      { text: "Keep Ride", style: "cancel" },
      {
        text: "Cancel",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelRide({
              requestId: currentRequestId,
              rideId:    currentRideId,
              studentId: currentUser.uid,
            });
            unsubRequestRef.current?.();
            unsubRideRef.current?.();
            unsubQueueRef.current?.();
            setRidePhase("idle");
            clearRideState();
            setLiveSummary(null);
            setQueueInfo(null);
            notifiedArrivingRef.current = false;
            showToast("Ride cancelled.", "info");
          } catch (err) {
            if (err.message === "ALREADY_PICKED_UP") {
              showToast("Cannot cancel after pickup.", "error");
            } else {
              showToast("Cancel failed. Try again.", "error");
            }
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  }

  // ── Pay for ride ────────────────────────────────────────────────────────
  async function handlePay() {
    if (payingNow) return;
    setPayingNow(true);
    try {
      await payForRide({ rideId: currentRideId, studentId: currentUser.uid });
      showToast("Payment successful!", "success");
    } catch (err) {
      if (err.message === "INSUFFICIENT_BALANCE") {
        showToast("Insufficient wallet balance. Top up and try again.", "error");
      } else {
        showToast(err.message || "Payment failed.", "error");
      }
    } finally {
      setPayingNow(false);
    }
  }

  // ── Delete history ──────────────────────────────────────────────────────
  function handleDeleteHistory(requestId) {
    Alert.alert("Delete Record", "Remove this ride from your history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteRideRecord(requestId);
            showToast("Record removed.", "info");
          } catch {
            showToast("Failed to remove record.", "error");
          }
        },
      },
    ]);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  const name = currentUser?.name ?? currentUser?.displayName ?? "Student";
  const canRequest = ridePhase === "idle" && pickupId && dropoffId && pickupId !== dropoffId;

  return (
    <View style={styles.root}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(name)}</Text>
          </View>
          <View>
            <Text style={styles.greeting}>Hello, {name.split(" ")[0]}</Text>
            <Text style={styles.walletText}>
              Wallet: <Text style={{ color: C.green }}>{formatNaira(walletBalance)}</Text>
            </Text>
          </View>
        </View>
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkOp}>OP</Text>
          <Text style={styles.wordmarkRides}>rides</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ── Campus Activity (idle only) ─────────────────────────────── */}
        {ridePhase === "idle" && (
          <View style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <View style={styles.pulseDot} />
              <Text style={styles.activityTitle}>Campus Live</Text>
            </View>
            <View style={styles.activityGrid}>
              <View style={styles.activityItem}>
                <Text style={styles.activityValue}>{campusActivity.ridersOnline}</Text>
                <Text style={styles.activityLabel}>Riders Online</Text>
              </View>
              <View style={styles.activityDivider} />
              <View style={styles.activityItem}>
                <Text style={[styles.activityValue, campusActivity.studentsInQueue > 0 && { color: "#f59e0b" }]}>
                  {campusActivity.studentsInQueue}
                </Text>
                <Text style={styles.activityLabel}>In Queue</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── IDLE: Request form ───────────────────────────────────── */}
        {ridePhase === "idle" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Request a Ride</Text>
            <StopPicker label="Pickup"   value={pickupId}  stops={rideStops} onSelect={setPickupId} />
            <StopPicker label="Drop-off" value={dropoffId} stops={rideStops} onSelect={setDropoffId} />
            {rideStops.length === 0 && (
              <Text style={styles.note}>No stops available yet. Admin needs to add coordinates.</Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, (!canRequest || requesting) && styles.primaryBtnDisabled]}
              onPress={handleRequestRide}
              disabled={!canRequest || requesting}
            >
              {requesting
                ? <ActivityIndicator color="#0F0F13" />
                : <Text style={styles.primaryBtnText}>Request Keke</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* ── SEARCHING ───────────────────────────────────────────── */}
        {ridePhase === "searching" && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color={C.green} style={{ marginBottom: 16 }} />
            <Text style={styles.cardTitle}>Finding your keke...</Text>
            <Text style={styles.cardSub}>Matching you to the nearest available rider.</Text>
            <TouchableOpacity
              style={[styles.dangerBtn, { marginTop: 20 }]}
              onPress={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <ActivityIndicator color={C.red} /> : <Text style={styles.dangerBtnText}>Cancel Request</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── QUEUED ──────────────────────────────────────────────── */}
        {ridePhase === "queued" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>In Queue</Text>
            {queueInfo ? (
              <View style={styles.queueCard}>
                <Text style={styles.queuePos}>Position #{queueInfo.position}</Text>
                <Text style={styles.queueEta}>Est. wait: {queueInfo.estimatedWait}</Text>
              </View>
            ) : (
              <Text style={styles.cardSub}>Waiting for position info...</Text>
            )}
            <TouchableOpacity
              style={[styles.dangerBtn, { marginTop: 20 }]}
              onPress={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <ActivityIndicator color={C.red} /> : <Text style={styles.dangerBtnText}>Leave Queue</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── MATCHED ─────────────────────────────────────────────── */}
        {(ridePhase === "matched" || ridePhase === "onTrip") && liveSummary && (
          <View style={styles.card}>
            <View style={styles.liveBanner}>
              <Text style={styles.liveBannerTitle}>
                {ridePhase === "onTrip" ? "On Trip" : "Keke is on the way!"}
              </Text>
              <Text style={styles.liveBannerSub}>
                {ridePhase === "onTrip"
                  ? `Heading to ${liveSummary.dropoffLabel ?? "destination"}`
                  : `${liveSummary.stopsAway} stop${liveSummary.stopsAway !== 1 ? "s" : ""} away`
                }
              </Text>
            </View>

            <InfoRow label="Rider"  value={liveSummary.riderName ?? "—"} />
            <InfoRow label="Fare"   value={formatNaira(liveSummary.fare)} />
            <InfoRow label="Status" value={<StatusPill status={liveSummary.paid ? "completed" : "matched"} />} />
            {liveSummary.distanceToPickup !== null && ridePhase !== "onTrip" && (
              <InfoRow
                label="Distance"
                value={liveSummary.distanceToPickup <= 50 ? "Arriving now!" : `${Math.round(liveSummary.distanceToPickup)}m away`}
              />
            )}

            <TouchableOpacity
              style={styles.mapBtn}
              onPress={() => navigation.navigate("Map")}
            >
              <Text style={styles.mapBtnText}>View on Map</Text>
            </TouchableOpacity>

            {ridePhase === "onTrip" ? (
              liveSummary.paid ? (
                <View style={[styles.primaryBtn, styles.primaryBtnDisabled]}>
                  <Text style={styles.primaryBtnText}>Paid {formatNaira(liveSummary.fare)}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, payingNow && styles.primaryBtnDisabled]}
                  onPress={handlePay}
                  disabled={payingNow}
                >
                  {payingNow ? <ActivityIndicator color="#0F0F13" /> : <Text style={styles.primaryBtnText}>Pay Now {formatNaira(liveSummary.fare)}</Text>}
                </TouchableOpacity>
              )
            ) : (
              <TouchableOpacity
                style={[styles.dangerBtn, cancelling && { opacity: 0.6 }]}
                onPress={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? <ActivityIndicator color={C.red} /> : <Text style={styles.dangerBtnText}>Cancel Ride</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── ARRIVED ─────────────────────────────────────────────── */}
        {ridePhase === "arrived" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>You've Arrived!</Text>
            <Text style={styles.cardSub}>Thanks for riding with NavCamp.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 20 }]}
              onPress={() => setRidePhase("idle")}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── History ─────────────────────────────────────────────── */}
        {ridePhase === "idle" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ride History</Text>
            {history.length === 0 ? (
              <Text style={styles.emptyText}>No rides yet.</Text>
            ) : (
              history.map(item => {
                const isActive = ["searching", "matched", "queued"].includes(item.status);
                return (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyDest} numberOfLines={1}>
                          To: {item.dropoff?.label ?? "Unknown"}
                        </Text>
                        <Text style={styles.historyTime}>{formatRelative(item.requestedAt)}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleDeleteHistory(item.id)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <Text style={{ color: C.red, fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.historyFooter}>
                      <StatusPill status={item.status} />
                      {isActive && (
                        <TouchableOpacity
                          style={styles.visitBtn}
                          onPress={() => {
                            setCurrentRequestId(item.id);
                            setRidePhase(item.status === "matched" ? "matched" : item.status);
                            if (item.matchedRideId) {
                              setCurrentRideId(item.matchedRideId);
                              attachRideListener(item.matchedRideId);
                            }
                            attachRequestListener(item.id);
                            navigation.navigate("Map");
                          }}
                        >
                          <Text style={styles.visitBtnText}>View Live</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 20,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     16,
    backgroundColor:   C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerLeft:   { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: "#00C48C22", alignItems: "center", justifyContent: "center" },
  avatarText:   { color: C.green, fontWeight: "700", fontSize: 14 },
  greeting:     { color: C.text, fontSize: 16, fontWeight: "600" },
  walletText:   { color: C.sub, fontSize: 12, marginTop: 1 },
  wordmark:     { flexDirection: "row" },
  wordmarkOp:   { color: C.text,  fontWeight: "800", fontSize: 20 },
  wordmarkRides:{ color: C.green, fontWeight: "800", fontSize: 20 },

  card: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         16,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: "700", marginBottom: 4 },
  cardSub:   { color: C.sub,  fontSize: 14, marginBottom: 8 },

  note: { color: C.sub, fontSize: 12, marginTop: 8, textAlign: "center" },

  pickerWrap: { marginBottom: 12 },
  pickerLabel:{ color: C.sub, fontSize: 12, marginBottom: 4, fontWeight: "600" },
  pickerBtn:  {
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "center",
    backgroundColor:   C.bg,
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       C.border,
    paddingHorizontal: 12,
    paddingVertical:   11,
  },
  pickerBtnText:      { color: C.text, fontSize: 14, flex: 1 },
  pickerDropdown:     { backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginTop: 4, maxHeight: 200, overflow: "hidden" },
  pickerOption:       { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerOptionActive: { backgroundColor: "rgba(0,196,140,0.08)" },
  pickerOptionText:   { color: C.text, fontSize: 13 },
  pickerEmpty:        { color: C.sub, padding: 12, textAlign: "center" },

  primaryBtn:         { backgroundColor: C.green, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: "#0F0F13", fontWeight: "700", fontSize: 15 },

  dangerBtn:     { borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: C.red, backgroundColor: "rgba(239,68,68,0.08)" },
  dangerBtnText: { color: C.red, fontWeight: "600", fontSize: 15 },

  mapBtn:     { borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: C.green, marginBottom: 8, marginTop: 8 },
  mapBtnText: { color: C.green, fontWeight: "600", fontSize: 14 },

  liveBanner:     { backgroundColor: "rgba(0,196,140,0.08)", borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.green },
  liveBannerTitle:{ color: C.green, fontWeight: "700", fontSize: 16, marginBottom: 2 },
  liveBannerSub:  { color: C.sub, fontSize: 13 },

  infoRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel:    { color: C.sub, fontSize: 13 },
  infoValue:    { flex: 1, alignItems: "flex-end" },
  infoValueText:{ color: C.text, fontSize: 13, fontWeight: "600", textAlign: "right" },

  pill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 10, fontWeight: "700" },

  queueCard: { backgroundColor: C.bg, borderRadius: 12, padding: 16, marginTop: 8, alignItems: "center", borderWidth: 1, borderColor: C.border },
  queuePos:  { color: C.green, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  queueEta:  { color: C.sub,   fontSize: 13 },

  section:      { marginBottom: 16 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 12 },
  emptyText:    { color: C.sub, textAlign: "center", paddingVertical: 20 },

  historyCard:   { backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  historyRow:    { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  historyDest:   { color: C.text, fontSize: 14, fontWeight: "600" },
  historyTime:   { color: C.sub, fontSize: 12, marginTop: 2 },
  historyFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  visitBtn:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: C.green },
  visitBtnText:  { color: C.green, fontSize: 12, fontWeight: "600" },

  // Campus activity card
  activityCard: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         14,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems:    "center",
    marginBottom:  12,
    gap:           8,
  },
  pulseDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: C.green,
  },
  activityTitle: { color: C.text, fontWeight: "700", fontSize: 14 },
  activityGrid: {
    flexDirection:  "row",
    alignItems:     "center",
  },
  activityItem: {
    flex:        1,
    alignItems:  "center",
    paddingVertical: 8,
  },
  activityValue: {
    color:      C.green,
    fontSize:   26,
    fontWeight: "800",
    marginBottom: 2,
  },
  activityLabel: { color: C.sub, fontSize: 12 },
  activityDivider: {
    width:           1,
    height:          40,
    backgroundColor: C.border,
  },
});
