import { create } from "zustand";

/**
 * Global app state — mirrors the shape of the old state.js from the web app.
 * Split into slices for clarity: auth, ride, map, ui.
 */
const useStore = create((set, get) => ({
  // ─── AUTH ────────────────────────────────────────────────────────────────
  currentUser: null,       // Firebase user object + Firestore role/data merged
  currentRole: null,       // "student" | "rider" | null

  setCurrentUser: (user) => set({
    currentUser: user,
    currentRole: user?.role ?? null
  }),

  clearCurrentUser: () => set({
    currentUser: null,
    currentRole: null
  }),

  // ─── RIDE ────────────────────────────────────────────────────────────────
  currentRideId: null,     // Firestore doc ID of the active ride
  currentRequestId: null,  // Firestore doc ID of the pending request
  latestRide: null,        // Full ride document from Firestore

  setCurrentRideId: (id) => set({ currentRideId: id }),
  setCurrentRequestId: (id) => set({ currentRequestId: id }),
  setLatestRide: (ride) => set({ latestRide: ride }),

  clearRideState: () => set({
    currentRideId: null,
    currentRequestId: null,
    latestRide: null
  }),

  // ─── RIDER SESSION ───────────────────────────────────────────────────────
  riderDocId: null,
  currentRiderName: "",
  vehicleType: null,       // "keke" | "shuttle"
  lastRiderLoc: null,      // { lat, lng }
  lastStudentLoc: null,    // { lat, lng }

  setRiderSession: (data) => set({
    riderDocId: data.riderDocId ?? null,
    currentRiderName: data.currentRiderName ?? "",
    vehicleType: data.vehicleType ?? null
  }),

  setLastRiderLoc: (loc) => set({ lastRiderLoc: loc }),
  setLastStudentLoc: (loc) => set({ lastStudentLoc: loc }),

  clearRiderSession: () => set({
    riderDocId: null,
    currentRiderName: "",
    vehicleType: null,
    lastRiderLoc: null,
    lastStudentLoc: null
  }),

  // ─── MAP ─────────────────────────────────────────────────────────────────
  // On React Native maps are controlled via refs, not stored in state.
  // We store derived data that screens need to react to.
  pathfinderDestinationId: null,
  pathfinderHasFitRoute: false,

  setPathfinderDestination: (id) => set({ pathfinderDestinationId: id }),
  setPathfinderHasFitRoute: (val) => set({ pathfinderHasFitRoute: val }),

  // ─── UI ──────────────────────────────────────────────────────────────────
  toastMessage: null,      // { text, type: "success"|"error"|"info" }
  isLoading: false,

  showToast: (text, type = "info") => {
    set({ toastMessage: { text, type } });
    // Auto-clear after 3 seconds
    setTimeout(() => set({ toastMessage: null }), 3000);
  },

  setLoading: (val) => set({ isLoading: val }),
}));

export default useStore;
