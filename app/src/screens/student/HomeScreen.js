/**
 * StudentHomeScreen.js
 *
 * The main student-facing screen. Mirrors the student dashboard from main
 * branch but redesigned for React Native / mobile UX.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header  (greeting + wallet) │
 *  │  MapView  (campus map)       │
 *  │  BottomSheet                 │
 *  │   ├─ TAB: Home  (request)    │
 *  │   ├─ TAB: Live  (tracking)   │
 *  │   └─ TAB: History            │
 *  └──────────────────────────────┘
 *
 * State machine for the "Live" tab
 * ──────────────────────────────────
 *  idle  →  searching  →  queued
 *                      ↓
 *                   matched  →  onTrip  →  arrived
 *                      ↑
 *                  cancelled
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";

import useStore from "../../store";
import { db, doc, onSnapshot } from "../../config/firebase";
import {
  loadCampusDataFromFirestore,
  listenToCampusData,
  getRideStops,
  getCampusLocationsForMap,
  getCampusCategoryMeta,
  getCampusPaths,
  getCampusBuildings,
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

// ─── COLOURS / TOKENS ────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  red:       "#ef4444",
  redMute:   "rgba(239,68,68,0.12)",
  orange:    "#FF5E1A",
  text:      "#FFFFFF",
  sub:       "#888",
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
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join("") || "ST";
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
  if (diff < h)  return `${Math.floor(diff / m)}m ago`;
  if (diff < d)  return `${Math.floor(diff / h)}h ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusColor(status) {
  return C.pill[status] ?? C.sub;
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

/** Small coloured pill for ride status */
function StatusPill({ status }) {
  return (
    <View style={[styles.pill, { backgroundColor: statusColor(status) + "22", borderColor: statusColor(status) }]}>
      <Text style={[styles.pillText, { color: statusColor(status) }]}>
        {status?.toUpperCase() ?? "UNKNOWN"}
      </Text>
    </View>
  );
}

/** Tab bar inside the bottom sheet */
function SheetTabs({ active, onChange, hasLive }) {
  const tabs = [
    { id: "home",    label: "Home" },
    { id: "live",    label: "Live" },
    { id: "history", label: "History" },
  ];
  return (
    <View style={styles.sheetTabs}>
      {tabs.map(t => (
        <TouchableOpacity
          key={t.id}
          style={[styles.sheetTab, active === t.id && styles.sheetTabActive]}
          onPress={() => onChange(t.id)}
        >
          <Text style={[styles.sheetTabText, active === t.id && styles.sheetTabTextActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Pickup / Drop-off location picker */
function StopPicker({ label, value, stops, onSelect }) {
  const [open, setOpen] = useState(false);

  const selected = stops.find(s => s.id === value);

  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <TouchableOpacity
        style={styles.pickerBtn}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}
      >
        <Text style={[styles.pickerBtnText, !selected && { color: C.sub }]}>
          {selected ? selected.name : `Select ${label}`}
        </Text>
        <Text style={{ color: C.sub, fontSize: 12 }}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.pickerDropdown}>
          {stops.length === 0 ? (
            <Text style={styles.pickerEmpty}>No stops available yet</Text>
          ) : (
            stops.map(stop => (
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
          )}
        </View>
      )}
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function StudentHomeScreen() {
  const { currentUser, currentRequestId, currentRideId, latestRide,
          setCurrentRequestId, setCurrentRideId, setLatestRide,
          walletBalance,
          clearRideState, showToast } = useStore();

  // ── map state
  const mapRef          = useRef(null);
  const [mapReady, setMapReady]         = useState(false);
  const [rideStops, setRideStops]       = useState([]);
  const [locations, setLocations]       = useState([]);
  const [campusPaths, setCampusPaths]   = useState([]);
  const [campusBuildings, setCampusBuildings] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [riderMarker, setRiderMarker]   = useState(null);
  // Real-time rider GPS location from rideLocations/{riderId}
  const [riderLocation, setRiderLocation] = useState(null); // { lat, lng }

  // ── sheet + tab state
  const [activeTab, setActiveTab] = useState("home");
  const sheetAnim = useRef(new Animated.Value(0)).current; // 0 = compact, 1 = expanded

  // ── request form
  const [pickupId,  setPickupId]  = useState(null);
  const [dropoffId, setDropoffId] = useState(null);
  const [requesting, setRequesting] = useState(false);

  // ── live ride state
  const [ridePhase, setRidePhase]     = useState("idle");
  //  idle | searching | queued | matched | onTrip | arrived
  const [liveSummary, setLiveSummary] = useState(null);
  const [queueInfo,   setQueueInfo]   = useState(null);
  const [payingNow,   setPayingNow]   = useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const notifiedArrivingRef = useRef(false);

  // ── history
  const [history, setHistory] = useState([]);

  // ── listener cleanup refs
  const unsubRequestRef = useRef(null);
  const unsubRideRef    = useRef(null);
  const unsubQueueRef   = useRef(null);
  const unsubHistoryRef = useRef(null);
  const unsubCampusRef  = useRef(null);
  const unsubRiderLocationRef = useRef(null);

  // ─── INIT ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Load campus data
    loadCampusDataFromFirestore().then(() => {
      setRideStops(getRideStops());
      setLocations(getCampusLocationsForMap());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });

    unsubCampusRef.current = listenToCampusData(() => {
      setRideStops(getRideStops());
      setLocations(getCampusLocationsForMap());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });

    // Location permission + user marker
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();

    // Ride history
    if (currentUser?.uid) {
      unsubHistoryRef.current = listenToRideHistory(currentUser.uid, setHistory);
    }

    return () => {
      unsubCampusRef.current?.();
      unsubHistoryRef.current?.();
      unsubRequestRef.current?.();
      unsubRideRef.current?.();
      unsubQueueRef.current?.();
      unsubRiderLocationRef.current?.();
    };
  }, []);

  // ─── RIDER LOCATION LISTENER ───────────────────────────────────────────────
  // When matched or onTrip, subscribe to real-time rider GPS from Firestore.
  // The riderId comes from latestRide.riderId written by the rider's GPS watcher.
  useEffect(() => {
    const riderId = latestRide?.riderId;
    const isActive = ridePhase === "matched" || ridePhase === "onTrip";

    // Tear down any existing listener first
    unsubRiderLocationRef.current?.();
    unsubRiderLocationRef.current = null;

    if (!riderId || !isActive) {
      // Clear stale location when ride ends or no rider yet
      setRiderLocation(null);
      return;
    }

    unsubRiderLocationRef.current = onSnapshot(
      doc(db, "rideLocations", riderId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setRiderLocation({ lat: data.lat, lng: data.lng });
        } else {
          setRiderLocation(null);
        }
      },
      (err) => {
        console.warn("[StudentHome] riderLocation listener error:", err);
      }
    );

    return () => {
      unsubRiderLocationRef.current?.();
      unsubRiderLocationRef.current = null;
    };
  }, [latestRide?.riderId, ridePhase]);

  // ─── LISTEN TO REQUEST ─────────────────────────────────────────────────────

  const attachRequestListener = useCallback((requestId) => {
    unsubRequestRef.current?.();
    unsubRequestRef.current = listenToRequest(requestId, (request) => {
      if (!request) return;

      if (request.status === "matched" && request.matchedRideId) {
        setCurrentRideId(request.matchedRideId);
        setRidePhase("matched");
        attachRideListener(request.matchedRideId);
        showToast("Ride matched! Your keke is on the way.", "success");
        sendLocalNotification(
          "Ride Matched!",
          "Your keke is on the way. Track it live on the map.",
          { type: "matched", rideId: request.matchedRideId }
        );
      }

      if (request.status === "queued") {
        setRidePhase("queued");
        if (request.queueDocId) attachQueueListener(request.queueDocId);
      }

      if (request.status === "cancelled") {
        setRidePhase("idle");
        clearRideState();
        setActiveTab("home");
        showToast("Ride request cancelled.", "info");
        notifiedArrivingRef.current = false;
      }
    });
  }, []);

  // ─── LISTEN TO RIDE ────────────────────────────────────────────────────────

  const attachRideListener = useCallback((rideId) => {
    unsubRideRef.current?.();
    unsubRideRef.current = listenToRide(rideId, currentUser.uid, (summary) => {
      if (!summary) return;

      setLatestRide(summary);
      setLiveSummary(summary);
      setRiderMarker(summary.currentLocation ?? null);

      if (summary.pickupStatus === "completed" && ridePhase !== "onTrip") {
        setRidePhase("onTrip");
        notifiedArrivingRef.current = false;
        sendLocalNotification(
          "Picked Up!",
          "You're on your way. Enjoy the ride!",
          { type: "onTrip" }
        );
      }

      if (summary.isCompleted && summary.passenger) {
        setRidePhase("arrived");
        clearRideState();
        showToast("You have arrived! Thanks for riding OpRides.", "success");
      }

      // "Arriving" alert when keke is within 50m of pickup
      if (
        summary.pickupStatus !== "completed" &&
        summary.distanceToPickup !== null &&
        summary.distanceToPickup <= 50 &&
        !notifiedArrivingRef.current
      ) {
        notifiedArrivingRef.current = true;
        showToast("Your keke is arriving! Get ready to board.", "info");
      }
      if (summary.distanceToPickup !== null && summary.distanceToPickup > 50) {
        notifiedArrivingRef.current = false;
      }
    });
  }, [currentUser?.uid, ridePhase]);

  // ─── LISTEN TO QUEUE ───────────────────────────────────────────────────────

  const attachQueueListener = useCallback((queueDocId) => {
    unsubQueueRef.current?.();
    unsubQueueRef.current = listenToQueue(queueDocId, (info) => {
      setQueueInfo(info);
    });
  }, []);

  // ─── REQUEST RIDE ──────────────────────────────────────────────────────────

  async function handleRequestRide() {
    if (requesting || ridePhase !== "idle") return;
    setRequesting(true);

    try {
      const { requestId } = await requestRide({
        studentId:     currentUser.uid,
        studentName:   currentUser.name ?? currentUser.displayName ?? "Student",
        pickupId,
        dropoffId,
        walletBalance,
        debt: currentUser.debt,
      });

      setCurrentRequestId(requestId);
      setRidePhase("searching");
      setActiveTab("live");
      attachRequestListener(requestId);
      showToast("Looking for your keke...", "info");
    } catch (err) {
      if (err.message?.startsWith("DEBT_OUTSTANDING:")) {
        const amount = Number(err.message.split(":")[1] || 0);
        showToast(`Outstanding balance of ${formatNaira(amount)}. Top up to continue.`, "error");
      } else if (err.message === "SAME_STOP") {
        showToast("Pickup and drop-off cannot be the same stop.", "error");
      } else if (err.message === "STOP_NOT_FOUND") {
        showToast("That stop still needs coordinates from the admin.", "error");
      } else {
        showToast("Failed to request ride. Please try again.", "error");
        console.error("[StudentHome] requestRide error:", err);
      }
    } finally {
      setRequesting(false);
    }
  }

  // ─── CANCEL RIDE ───────────────────────────────────────────────────────────

  async function handleCancel() {
    if (cancelling) return;

    Alert.alert(
      "Cancel Ride",
      "Are you sure you want to cancel your current request?",
      [
        { text: "Keep Ride", style: "cancel" },
        {
          text: "Cancel Ride",
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
              clearRideState();
              setRidePhase("idle");
              setLiveSummary(null);
              setQueueInfo(null);
              setActiveTab("home");
              notifiedArrivingRef.current = false;
              showToast("Ride cancelled.", "info");
            } catch (err) {
              if (err.message === "ALREADY_PICKED_UP") {
                showToast("You cannot cancel after you have been picked up.", "error");
              } else {
                showToast("Failed to cancel ride.", "error");
                console.error("[StudentHome] cancelRide error:", err);
              }
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  // ─── PAY FOR RIDE ──────────────────────────────────────────────────────────

  async function handlePay() {
    if (payingNow || !currentRideId) return;
    setPayingNow(true);
    try {
      await payForRide({ rideId: currentRideId, studentId: currentUser.uid });
      showToast("Payment successful!", "success");
    } catch (err) {
      if (err.message === "INSUFFICIENT_BALANCE") {
        showToast("Insufficient wallet balance. Please top up.", "error");
      } else if (err.message === "ALREADY_PAID") {
        showToast("You have already paid for this ride.", "info");
      } else {
        showToast("Payment failed. Please try again.", "error");
        console.error("[StudentHome] payForRide error:", err);
      }
    } finally {
      setPayingNow(false);
    }
  }

  // ─── DELETE HISTORY ITEM ───────────────────────────────────────────────────

  function handleDeleteHistory(requestId) {
    Alert.alert(
      "Delete Record",
      "Remove this ride from your history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRideRecord(requestId);
              showToast("Record removed.", "info");
            } catch {
              showToast("Could not remove record.", "error");
            }
          },
        },
      ]
    );
  }

  // ─── SHEET EXPAND / COLLAPSE ───────────────────────────────────────────────

  function expandSheet() {
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: false }).start();
  }
  function collapseSheet() {
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: false }).start();
  }

  const sheetHeight = sheetAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [180, 560],
  });

  // ─── DRAG GESTURE ──────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dy) > 10;
      },
      onPanResponderGrant: () => {
        // Remember start position
        sheetAnim.setOffset(sheetAnim._value);
        sheetAnim.setValue(0);
      },
      onPanResponderMove: (evt, gestureState) => {
        // Convert pixel movement to 0-1 range
        const dragProgress = -gestureState.dy / 380; // 380px is the expand range (560-180)
        sheetAnim.setValue(dragProgress);
      },
      onPanResponderRelease: (evt, gestureState) => {
        sheetAnim.flattenOffset();
        
        const velocity = gestureState.vy;
        const currentValue = sheetAnim._value;
        
        // Decide whether to snap to expanded or collapsed based on velocity and position
        let toValue;
        if (velocity > 0.5) {
          // Fast downward swipe - collapse
          toValue = 0;
        } else if (velocity < -0.5) {
          // Fast upward swipe - expand  
          toValue = 1;
        } else {
          // Slow drag - snap to nearest
          toValue = currentValue > 0.5 ? 1 : 0;
        }
        
        Animated.spring(sheetAnim, {
          toValue,
          useNativeDriver: false,
          tension: 200,
          friction: 8,
        }).start();
      },
    })
  ).current;

  // ─── RENDER HELPERS ────────────────────────────────────────────────────────

  /** Map region based on first ride stop or a fallback campus centre */
  const mapRegion = React.useMemo(() => {
    const firstStop = rideStops[0];
    if (firstStop) {
      return { latitude: firstStop.lat, longitude: firstStop.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 };
    }
    // Fallback: rough centre — admin will populate real coords
    return { latitude: 6.9, longitude: 4.95, latitudeDelta: 0.01, longitudeDelta: 0.01 };
  }, [rideStops]);

  // ─── TAB: HOME ─────────────────────────────────────────────────────────────

  function renderHomeTab() {
    const canRequest = ridePhase === "idle" && pickupId && dropoffId && pickupId !== dropoffId;

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.tabContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onScrollBeginDrag={expandSheet}
      >
        <Text style={styles.sectionTitle}>Request a Ride</Text>

        <StopPicker
          label="Pickup"
          value={pickupId}
          stops={rideStops}
          onSelect={setPickupId}
        />
        <StopPicker
          label="Drop-off"
          value={dropoffId}
          stops={rideStops}
          onSelect={setDropoffId}
        />

        {rideStops.length === 0 && (
          <Text style={styles.noStopsNote}>
            No ride stops available yet. The admin needs to set coordinates first.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (!canRequest || requesting) && styles.primaryBtnDisabled,
          ]}
          onPress={handleRequestRide}
          disabled={!canRequest || requesting}
          activeOpacity={0.8}
        >
          {requesting
            ? <ActivityIndicator color="#0F0F13" />
            : <Text style={styles.primaryBtnText}>Request Keke</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ─── TAB: LIVE ──────────────────────────────────────────────────────────────

  function renderLiveTab() {
    // ── IDLE
    if (ridePhase === "idle") {
      return (
        <View style={[styles.tabContent, styles.centreContent]}>
          <Text style={styles.liveIdleIcon}>🛺</Text>
          <Text style={styles.liveIdleTitle}>No active ride</Text>
          <Text style={styles.liveIdleSub}>
            Go to Home to request a keke.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 20 }]}
            onPress={() => setActiveTab("home")}
          >
            <Text style={styles.primaryBtnText}>Request a Ride</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── ARRIVED
    if (ridePhase === "arrived") {
      return (
        <View style={[styles.tabContent, styles.centreContent]}>
          <Text style={styles.liveIdleTitle}>You've Arrived!</Text>
          <Text style={styles.liveIdleSub}>Thanks for riding with OpRides.</Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 20 }]}
            onPress={() => { setRidePhase("idle"); setActiveTab("home"); }}
          >
            <Text style={styles.primaryBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── SEARCHING
    if (ridePhase === "searching") {
      return (
        <View style={[styles.tabContent, styles.centreContent]}>
          <ActivityIndicator size="large" color={C.green} style={{ marginBottom: 16 }} />
          <Text style={styles.liveIdleTitle}>Finding your keke...</Text>
          <Text style={styles.liveIdleSub}>We're matching you to the closest available rider.</Text>
          <TouchableOpacity
            style={[styles.dangerBtn, { marginTop: 24 }]}
            onPress={handleCancel}
            disabled={cancelling}
          >
            {cancelling
              ? <ActivityIndicator color={C.red} />
              : <Text style={styles.dangerBtnText}>Cancel Request</Text>
            }
          </TouchableOpacity>
        </View>
      );
    }

    // ── QUEUED
    if (ridePhase === "queued") {
      return (
        <View style={[styles.tabContent, styles.centreContent]}>
          <Text style={styles.liveIdleTitle}>In Queue</Text>
          {queueInfo ? (
            <View style={styles.queueCard}>
              <Text style={styles.queuePos}>Position #{queueInfo.position}</Text>
              <Text style={styles.queueEta}>Est. wait: {queueInfo.estimatedWait}</Text>
            </View>
          ) : (
            <Text style={styles.liveIdleSub}>Waiting for position info...</Text>
          )}
          <TouchableOpacity
            style={[styles.dangerBtn, { marginTop: 24 }]}
            onPress={handleCancel}
            disabled={cancelling}
          >
            {cancelling
              ? <ActivityIndicator color={C.red} />
              : <Text style={styles.dangerBtnText}>Leave Queue</Text>
            }
          </TouchableOpacity>
        </View>
      );
    }

    // ── MATCHED / ON TRIP
    const summary = liveSummary;
    if (!summary) return <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />;

    const onTrip       = ridePhase === "onTrip";
    const alreadyPaid  = summary.paid;
    const fare         = summary.fare;

    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent} nestedScrollEnabled>
        {/* Status Banner */}
        <View style={[styles.liveBanner, { borderColor: onTrip ? C.green : C.pill.matched }]}>
          <Text style={[styles.liveBannerTitle, { color: onTrip ? C.green : C.pill.matched }]}>
            {onTrip ? "🚀 On Trip" : "🛺 Keke is on the way!"}
          </Text>
          <Text style={styles.liveBannerSub}>
            {onTrip
              ? `Heading to ${summary.dropoffLabel ?? "Destination"}`
              : `${summary.stopsAway} stop${summary.stopsAway !== 1 ? "s" : ""} away`
            }
          </Text>
        </View>

        {/* Ride Details */}
        <View style={styles.liveDetails}>
          <LiveRow label="Rider"  value={summary.riderName  ?? "—"} />
          <LiveRow label="Seats"  value={`${summary.seats?.occupied ?? 0}/${summary.seats?.total ?? 0}`} />
          <LiveRow label="Fare"   value={formatNaira(fare)} />
          <LiveRow label="Status" value={
            <StatusPill status={alreadyPaid ? "completed" : (onTrip ? "matched" : "matched")} />
          } />
          {summary.distanceToPickup !== null && !onTrip && (
            <LiveRow
              label="Distance"
              value={
                summary.distanceToPickup <= 50
                  ? "🔔 Arriving now!"
                  : `${Math.round(summary.distanceToPickup)}m away`
              }
            />
          )}
        </View>

        {/* Actions */}
        <View style={styles.liveActions}>
          {onTrip ? (
            alreadyPaid ? (
              <View style={[styles.primaryBtn, styles.primaryBtnDisabled]}>
                <Text style={styles.primaryBtnText}>✅ Paid {formatNaira(fare)}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, payingNow && styles.primaryBtnDisabled]}
                onPress={handlePay}
                disabled={payingNow}
                activeOpacity={0.8}
              >
                {payingNow
                  ? <ActivityIndicator color="#0F0F13" />
                  : <Text style={styles.primaryBtnText}>Pay Now {formatNaira(fare)}</Text>
                }
              </TouchableOpacity>
            )
          ) : (
            <TouchableOpacity
              style={[styles.dangerBtn, cancelling && { opacity: 0.6 }]}
              onPress={handleCancel}
              disabled={cancelling}
              activeOpacity={0.8}
            >
              {cancelling
                ? <ActivityIndicator color={C.red} />
                : <Text style={styles.dangerBtnText}>Cancel Ride</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  // ─── TAB: HISTORY ──────────────────────────────────────────────────────────

  function renderHistoryTab() {
    if (history.length === 0) {
      return (
        <View style={[styles.tabContent, styles.centreContent]}>
          <Text style={styles.liveIdleTitle}>No rides yet</Text>
          <Text style={styles.liveIdleSub}>Your completed rides will appear here.</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={history}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        nestedScrollEnabled
        renderItem={({ item }) => {
          const isActive = ["searching", "matched", "queued"].includes(item.status);
          return (
            <View style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyDest} numberOfLines={1}>
                    → {item.dropoff?.label ?? "Unknown destination"}
                  </Text>
                  <Text style={styles.historyTime}>{formatRelative(item.requestedAt)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteHistory(item.id)}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
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
                      setActiveTab("live");
                    }}
                  >
                    <Text style={styles.visitBtnText}>View Live</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
      />
    );
  }

  // ─── MAIN RENDER ───────────────────────────────────────────────────────────

  const name = currentUser?.name ?? currentUser?.displayName ?? "Student";

  return (
    <View style={styles.root}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(name)}</Text>
          </View>
          <View>
            <Text style={styles.greeting}>Hello, {name.split(" ")[0]} 👋</Text>
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

      {/* ── MAP ────────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={mapRegion}
          mapType="none"
          showsUserLocation
          showsMyLocationButton={false}
          onMapReady={() => setMapReady(true)}
        >
          {/* Campus location markers */}
          {locations.map(loc => {
            const meta = getCampusCategoryMeta(loc.category);
            return (
              <Marker
                key={loc.id}
                coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                title={loc.name}
                tracksViewChanges={false}
              >
                <View style={[styles.customMarker, { backgroundColor: meta.color }]}>
                  <Text style={styles.customMarkerText} numberOfLines={1}>
                    {loc.name.length > 12 ? loc.name.slice(0, 12) + "…" : loc.name}
                  </Text>
                </View>
              </Marker>
            );
          })}

          {/* Ride stop markers */}
          {rideStops.map(stop => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.lat, longitude: stop.lng }}
              title={stop.name}
              tracksViewChanges={false}
            >
              <View style={styles.stopMarker}>
                <View style={styles.stopMarkerDot} />
                <Text style={styles.stopMarkerText} numberOfLines={1}>
                  {stop.name.length > 14 ? stop.name.slice(0, 14) + "…" : stop.name}
                </Text>
              </View>
            </Marker>
          ))}

          {/* Live rider marker */}
          {riderMarker && (
            <Marker
              coordinate={{ latitude: riderMarker.lat, longitude: riderMarker.lng }}
              title="Your Keke"
              pinColor={C.orange}
            />
          )}

          {/* Real-time rider GPS marker (from rideLocations collection) */}
          {riderLocation && (
            <Marker
              coordinate={{ latitude: riderLocation.lat, longitude: riderLocation.lng }}
              title="Your Rider"
              pinColor="blue"
            />
          )}

          {/* Campus roads/paths */}
          {campusPaths.map((path, i) => (
            <Polyline
              key={`path-${i}`}
              coordinates={path.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
              strokeColor="#2a2a35"
              strokeWidth={3}
            />
          ))}

          {/* Campus buildings - close the polygon by repeating first point */}
          {campusBuildings.map((building, i) => {
            const coords = building.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
            const closed = coords.length > 0 ? [...coords, coords[0]] : coords;
            return (
              <Polyline
                key={`building-${i}`}
                coordinates={closed}
                strokeColor="#3a3a45"
                strokeWidth={1.5}
              />
            );
          })}
        </MapView>

        {/* Recenter button */}
        {userLocation && (
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={() => {
              mapRef.current?.animateToRegion({
                latitude:       userLocation.lat,
                longitude:      userLocation.lng,
                latitudeDelta:  0.004,
                longitudeDelta: 0.004,
              }, 600);
            }}
          >
            <Text style={styles.recenterIcon}>⊕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── BOTTOM SHEET ───────────────────────────────────────────── */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.sheet, { height: sheetHeight }]}
      >
        {/* Tappable header area (handle + tabs) for expand/collapse */}
        <TouchableOpacity
          style={styles.headerArea}
          onPress={() => {
            if (sheetAnim._value > 0.5) collapseSheet();
            else expandSheet();
          }}
          activeOpacity={1}
        >
          {/* Drag handle */}
          <View style={styles.handle} />
          <SheetTabs
            active={activeTab}
            onChange={(t) => { setActiveTab(t); expandSheet(); }}
            hasLive={ridePhase !== "idle"}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          {activeTab === "home"    && renderHomeTab()}
          {activeTab === "live"    && renderLiveTab()}
          {activeTab === "history" && renderHistoryTab()}
        </View>
      </Animated.View>

      {/* ── TOAST ─────────────────────────────────────────────────── */}
      <ToastOverlay />
    </View>
  );
}

// ─── TOAST OVERLAY ───────────────────────────────────────────────────────────

function ToastOverlay() {
  const { toastMessage } = useStore();
  if (!toastMessage) return null;

  const bgMap = { success: "#10b981", error: C.red, info: "#6366f1" };
  const bg    = bgMap[toastMessage.type] ?? "#333";

  return (
    <View style={[styles.toast, { backgroundColor: bg }]} pointerEvents="none">
      <Text style={styles.toastText}>{toastMessage.text}</Text>
    </View>
  );
}

// ─── LIVE ROW ─────────────────────────────────────────────────────────────────

function LiveRow({ label, value }) {
  return (
    <View style={styles.liveRow}>
      <Text style={styles.liveRowLabel}>{label}</Text>
      {typeof value === "string" || typeof value === "number"
        ? <Text style={styles.liveRowValue}>{value}</Text>
        : value
      }
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // ── Header
  header: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "space-between",
    paddingHorizontal: 20,
    paddingTop:       Platform.OS === "ios" ? 56 : 44,
    paddingBottom:    12,
    backgroundColor:  C.bg,
    zIndex:           10,
  },
  headerLeft:   { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
  avatarText:   { color: "#0F0F13", fontWeight: "800", fontSize: 15 },
  greeting:     { color: C.text, fontWeight: "600", fontSize: 15 },
  walletText:   { color: C.sub, fontSize: 12, marginTop: 1 },
  wordmark:     { flexDirection: "row" },
  wordmarkOp:   { color: C.text, fontWeight: "800", fontSize: 22 },
  wordmarkRides:{ color: C.green, fontWeight: "800", fontSize: 22 },

  // ── Map
  mapContainer: { flex: 1, backgroundColor: "#0F0F13" },

  // Custom map markers
  customMarker: {
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:      8,
    maxWidth:          120,
  },
  customMarkerText: {
    color:      "#FFFFFF",
    fontSize:   11,
    fontWeight: "700",
  },
  stopMarker: {
    alignItems: "center",
    gap:        3,
  },
  stopMarkerDot: {
    width:           12,
    height:          12,
    borderRadius:    6,
    backgroundColor: "#00C48C",
    borderWidth:     2,
    borderColor:     "#FFFFFF",
  },
  stopMarkerText: {
    color:           "#FFFFFF",
    fontSize:        10,
    fontWeight:      "700",
    backgroundColor: "rgba(0,196,140,0.85)",
    paddingHorizontal: 5,
    paddingVertical:   2,
    borderRadius:    6,
  },
  recenterBtn: {
    position:        "absolute",
    bottom:          12,
    right:           12,
    backgroundColor: C.surface,
    width:           40,
    height:          40,
    borderRadius:    20,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     1,
    borderColor:     C.border,
  },
  recenterIcon: { color: C.green, fontSize: 22, lineHeight: 26 },

  // ── Sheet
  sheet: {
    backgroundColor:    C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth:     1,
    borderColor:        C.border,
    overflow:           "hidden",
  },
  headerArea: { alignItems: "center", paddingVertical: 16 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },

  // ── Sheet Tabs
  sheetTabs:        { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 4 },
  sheetTab:         { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  sheetTabActive:   { backgroundColor: C.greenMute, borderColor: C.green },
  sheetTabText:     { color: C.sub, fontWeight: "600", fontSize: 13 },
  sheetTabTextActive: { color: C.green },

  // ── Shared tab layout
  tabContent:   { padding: 16, paddingBottom: 40 },
  centreContent:{ alignItems: "center", justifyContent: "center", paddingTop: 24 },
  sectionTitle: { color: C.text, fontWeight: "700", fontSize: 16, marginBottom: 14 },

  // ── Pickers
  pickerWrap:   { marginBottom: 12 },
  pickerLabel:  { color: C.sub, fontSize: 12, marginBottom: 4, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  pickerBtn: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    backgroundColor: C.bg,
    borderRadius:   12,
    borderWidth:    1,
    borderColor:    C.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerBtnText: { color: C.text, fontSize: 14, flex: 1 },
  pickerDropdown: {
    backgroundColor: C.bg,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
    marginTop:       4,
    overflow:        "hidden",
  },
  pickerOption:       { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerOptionActive: { backgroundColor: C.greenMute },
  pickerOptionText:   { color: C.text, fontSize: 14 },
  pickerEmpty:        { color: C.sub, padding: 14, fontSize: 13 },

  noStopsNote: { color: C.sub, fontSize: 12, textAlign: "center", marginVertical: 8 },

  // ── Buttons
  primaryBtn: {
    backgroundColor: C.green,
    borderRadius:    14,
    paddingVertical: 15,
    alignItems:      "center",
    marginTop:       8,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { color: "#0F0F13", fontWeight: "700", fontSize: 15 },

  dangerBtn: {
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      "center",
    marginTop:       8,
    borderWidth:     1,
    borderColor:     C.red,
    backgroundColor: C.redMute,
  },
  dangerBtnText: { color: C.red, fontWeight: "700", fontSize: 15 },

  // logout moved to ProfileScreen

  // ── Live tab
  liveIdleIcon:  { fontSize: 48, textAlign: "center", marginBottom: 12 },
  liveIdleTitle: { color: C.text, fontWeight: "700", fontSize: 18, textAlign: "center", marginBottom: 6 },
  liveIdleSub:   { color: C.sub, textAlign: "center", fontSize: 13, paddingHorizontal: 24 },

  liveBanner: {
    borderRadius:  14,
    borderWidth:   1,
    padding:       16,
    marginBottom:  16,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  liveBannerTitle: { fontWeight: "700", fontSize: 17, marginBottom: 4 },
  liveBannerSub:   { color: C.sub, fontSize: 13 },

  liveDetails:   { gap: 2, marginBottom: 16 },
  liveRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  liveRowLabel:  { color: C.sub, fontSize: 13 },
  liveRowValue:  { color: C.text, fontSize: 13, fontWeight: "600" },
  liveActions:   { gap: 10 },

  queueCard:  { marginTop: 12, backgroundColor: C.bg, borderRadius: 14, padding: 20, alignItems: "center", borderWidth: 1, borderColor: C.border },
  queuePos:   { color: C.text, fontWeight: "700", fontSize: 22, marginBottom: 4 },
  queueEta:   { color: C.sub, fontSize: 13 },

  // ── History
  historyCard:   { backgroundColor: C.bg, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  historyHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  historyDest:   { color: C.text, fontWeight: "600", fontSize: 14 },
  historyTime:   { color: C.sub, fontSize: 12, marginTop: 2 },
  historyFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  visitBtn:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.greenMute, borderWidth: 1, borderColor: C.green },
  visitBtnText:  { color: C.green, fontSize: 12, fontWeight: "600" },

  // ── Status pill
  pill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },

  // ── Toast
  toast: {
    position:     "absolute",
    bottom:       80,
    left:         20,
    right:        20,
    borderRadius: 12,
    padding:      14,
    alignItems:   "center",
    zIndex:       999,
  },
  toastText: { color: "#fff", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
