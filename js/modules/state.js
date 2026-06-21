export const state = {
  map: null,
  currentRole: null,
  currentUser: null,
  currentRideId: null,
  currentRequestId: null,
  riderDocId: null,
  currentRiderName: "",
  riderWatchId: null,
  pathfinderWatchId: null,
  lastRiderLoc: null,
  lastStudentLoc: null,
  pathfinderDestinationId: null,
  pathfinderHasFitRoute: false,
  requestMarkers: [],
  riderMarker: null,
  tileLayer: null,
  routeLayer: null,
  userMarker: null,
  latestRide: null,
  unsubscribeRequests: null,
  unsubscribeQueueListener: null,
  activeMarkerAnimations: new Map(),
  vehicleType: null // 'keke' or 'shuttle'
};

// Explicitly attach to window for global debugging
window.state = state;
