export const state = {
  map: null,
  currentRole: null,
  currentUser: null,
  currentRideId: null,
  currentRequestId: null,
  riderDocId: null,
  currentRiderName: "",
  riderWatchId: null,
  lastRiderLoc: null,
  requestMarkers: [],
  riderMarker: null,
  routeControl: null,
  userMarker: null,
  unsubscribeRequests: null,
  unsubscribeQueueListener: null,
  activeMarkerAnimations: new Map(),
  vehicleType: null // 'keke' or 'shuttle'
};

window.state = state;
