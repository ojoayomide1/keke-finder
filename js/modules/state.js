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
  // Cache: key = "lat,lng,type,passengerId" → Leaflet marker; used to avoid
  // destroying and re-creating stop markers on every Firestore snapshot.
  stopMarkersCache: new Map(),
  riderMarker: null,
  tileLayer: null,
  routeLayer: null,
  userMarker: null,
  latestRide: null,
  // Last keke location that triggered a route + marker redraw in updateRideUI.
  // A new redraw is skipped when the keke has moved less than RIDE_UI_MIN_MOVE_M.
  lastRenderedLocation: null,
  unsubscribeRequests: null,
  unsubscribeQueueListener: null,
  campusActivityUnsubscribeRides: null,
  campusActivityUnsubscribeQueue: null,
  activeMarkerAnimations: new Map(),
  vehicleType: null // 'keke' or 'shuttle'
};

// Explicitly attach to window for global debugging
window.state = state;
