# NavCamp — Product Overview

**NavCamp** is a campus navigation and transport app built specifically for
Veritas University Abuja. It helps students find their way around campus and
book on-demand keke rides between stops — all from their phone.

**Authors:** Ojo Ayomide Praise · Onuba Daniel Chukwuebuka

---

## The Problem

Veritas University is a large campus. New students spend weeks not knowing
where anything is. There are no official maps, no campus transport system,
and no way to know if a keke is available or how long the wait will be.
Students rely on asking around, guessing, or just walking until they find what
they need.

NavCamp fixes that.

---

## What Students Get

### Pathfinder
Search any campus location — a faculty, hostel, block, restaurant, sports
facility, gate — and get a walking route directly on an interactive campus map.
The route follows real walkways and roads, not a straight line through buildings.

- Search by name or browse by category
- Set a custom starting point or use current location
- Route auto-opens on the map with distance and estimated walk time
- Works offline after first load (map data is bundled into the app)

### Campus Map
A full interactive map of Veritas with:
- All buildings, roads, walkways, and entrances
- Colour-coded markers for every category of location
- Live keke pickup points

### Keke Rides *(launching after MVP)*
On-demand shared keke rides between fixed campus stops. Students request a
ride, get matched to the nearest available keke, and pay from their in-app
wallet. Fares are fixed at ₦150 per ride.

### Wallet
An in-app wallet funded via Paystack bank transfer. Used to pay for keke rides.
Balance is shown in real time. Full transaction history is available in-app.

---

## What Riders Get

Keke riders on campus register on the platform and use the rider version of the
app to:
- Go online and start accepting ride requests
- See incoming student requests on a live map
- Manage multiple passengers on a single trip (shared ride pooling)
- Track earnings and request withdrawals

---

## MVP Scope

The initial launch of NavCamp focuses on **Pathfinder and the campus map**.
Keke rides are built and ready but locked until enough riders are onboarded
and the operational side is set up.

This means:
- Students can navigate campus immediately from day one
- No dependency on rider availability at launch
- Wallet and profile features are available to set up in advance of rides

---

## Admin Control Panel

A separate web-based control panel (accessible only to the NavCamp team) gives
operators full visibility and control over the platform:

- Live dashboard: active users, ride counts, wallet volume
- User management: view all students and riders, suspend accounts
- Ride monitor: live feed of active rides and full ride history
- Keke control: enable/disable ride requests globally, manage stops, set fares
- Wallet panel: transaction log, manual credit/debit, commission balance
- Map overrides: temporarily close a road or mark a route unavailable
- Announcements: push campus-wide notifications and in-app banners
- Indoor editor: manage indoor location data for buildings

---

## Technology

NavCamp is a mobile-first app (Android) with a web version. It is built on
modern, proven technology:

- **Firebase** — Google's cloud platform handles user accounts, real-time
  data sync, and database. Used by millions of apps globally.
- **Paystack** — Nigeria's leading payment infrastructure. Handles all wallet
  top-ups securely.
- **Expo / React Native** — cross-platform framework that allows one codebase
  to run on Android, iOS, and web.
- **Leaflet** — open-source map rendering library used for the campus map on web.

All map data for Veritas University is sourced from QGIS (professional
geographic information software) and is maintained by the NavCamp team.

---

## Expansion Plan

NavCamp is built for Veritas University first. The architecture is designed
to support multiple campuses — each with its own map data, rider pool, and
stop configuration. Expansion to other Nigerian universities is planned once
NavCamp is stable and proven at Veritas, subject to university partnerships
and agreements.

---

## About the Team

**Ojo Ayomide Praise** — co-founder, lead developer. Responsible for the full
technical architecture, app development, backend, and map data pipeline.

**Onuba Daniel Chukwuebuka** — co-founder. Responsible for product, operations,
and growth.

NavCamp was built at Veritas University Abuja by students who experienced the
problem firsthand.
