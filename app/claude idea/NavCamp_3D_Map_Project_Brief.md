# NavCamp — 3D Campus Map Upgrade Brief

## Project context

NavCamp is a campus navigation project for Veritas University Abuja. It already has a working 2D campus map built from geographic/map data prepared in QGIS.

The QGIS map includes features such as:
- Buildings
- Roads and paths
- Gates and entrances
- Stops and other points/markers
- Parking areas
- Other campus features that have been selected as necessary for the app

A custom export script has already been used to extract selected QGIS features and convert them into data/code used by the existing Expo PWA. The current 2D map is functional.

**Do not assume a particular file format, map library, routing implementation, coordinate reference system, or app architecture. Inspect the repository and existing export output to determine these.**

## The vision

Explore upgrading NavCamp from its existing 2D map to a custom, interactive, responsive **3D campus map** generated primarily through code.

The goal is not merely to embed a third-party 3D map viewer or render a pre-made 3D city. The map's geometry should be generated from NavCamp's own QGIS-derived campus data wherever practical.

The intended result is a useful navigation product, not just a pretty 3D scene. It should aim to support:
- 3D buildings generated from existing building footprints
- 3D ground, campus roads and walking paths
- Gates, entrances, stops, parking and landmarks represented as interactive features
- Building/feature selection and information panels
- Searchable destinations
- Walking routes displayed clearly on top of the 3D map
- Camera controls suitable for mouse, touch and mobile screens
- Responsive layouts and acceptable performance on ordinary phones
- A way to retain or fall back to the existing 2D map if that is the safest product choice
- Future enhancements such as current-location display, camera-follow navigation, turn instructions, building-height improvements and richer models

This is a target vision, not a claim that all features are currently available or that all must be delivered in one release. Assess feasibility and phase the work.

## Important constraints

1. **Preserve the existing working app.** Do not casually replace, break or rewrite the current 2D map, routing, search, data export, authentication, or other unrelated functionality.
2. **Inspect before planning implementation.** Read the repository, package manifests, map components, routing code, export script, sample generated data, and relevant documentation before proposing a design.
3. **Base decisions on the actual code.** Identify the existing framework, Expo SDK and React versions, current map-rendering library, data format, CRS, coordinate order, and route model.
4. **Do not invent missing data.** If building heights, footpath connectivity, entrances, or feature attributes are absent or unreliable, identify the gap and propose how to address it.
5. **Keep geographic alignment accurate.** 3D buildings, roads, gates, entrances and markers must line up with the current map and with each other.
6. **Avoid unnecessary dependencies.** Compare alternatives and choose the smallest reliable stack that fits the current app. Do not add libraries simply because they are popular.
7. **Mobile matters.** NavCamp is an Expo PWA, so web compatibility, touch controls, loading time, memory use, rendering performance and fallback behaviour are important. Check actual project compatibility before recommending packages.
8. **Do not require Blender by default.** Prefer procedural generation from QGIS-derived geometry for the initial version. Blender or externally authored models may remain optional for selected high-detail assets if later justified.
9. **No destructive changes during the audit.** Do not edit, delete, regenerate or migrate project files until the audit and proposed plan have been presented and approved.
10. **Keep the scope campus-focused.** This is a map of Veritas University Abuja, not a general-purpose global 3D mapping platform.

## Technologies to evaluate, not blindly install

Evaluate these in the context of the existing repository:

### 3D rendering
- **Three.js** as the underlying browser 3D engine.
- **React Three Fiber** if it fits the project's React architecture and versions. It provides a React-oriented way to construct Three.js scenes.
- **React Three Drei** for useful React Three Fiber helpers such as camera controls, labels and other scene utilities, if compatible and genuinely useful.
- Direct Three.js may be preferable if adding React Three Fiber would create unnecessary complexity. Explain the trade-off.

### GIS and geometry conversion
- Existing QGIS export pipeline and its current output format should be assessed first.
- **GeoJSON** may be suitable as an interchange format if the current data can safely be exported or converted to it.
- **Proj4js** may help transform coordinates when necessary. First identify the actual source CRS and choose an appropriate local/projected coordinate system for geometry and distance calculations. Do not blindly treat longitude/latitude degrees as Three.js world units.
- **Three.js ExtrudeGeometry** can extrude building footprints into 3D forms.
- A polygon triangulation library such as **Earcut** may be useful for complex footprints or custom geometry generation.
- Consider geometry clipping, polygon holes, multipolygons, invalid geometries, winding order, and shared boundaries where relevant.

### Navigation and routing
- Audit the current route implementation before proposing a replacement.
- If a usable pedestrian graph already exists, preserve and adapt it where practical.
- If routing needs to be built or repaired, consider a graph of connected walkable segments with nodes for intersections, path endpoints, gates and entrances; use an appropriate algorithm such as A* or Dijkstra.
- A route should be computed from actual connected walkable geometry, not simply drawn as a straight line between two selected points.
- Define how destination features connect to the pedestrian network and how disconnected paths, inaccessible areas and invalid connections are handled.
- Keep routing data separate from render-only 3D meshes so visual changes do not break route calculations.

These are candidates for evaluation, not a predetermined stack. Recommend alternatives when the existing project or requirements make them better.

## Desired map behaviour

### 1. Campus geometry
- Generate building forms from the existing building footprints where data supports this.
- Where heights are missing, propose a transparent fallback, such as configurable default heights or optional per-building height attributes. Do not present estimated heights as surveyed truth.
- Generate usable road and path surfaces from existing lines or polygons, accounting for widths, joins, intersections and overlaps.
- Preserve important feature IDs, names, categories and properties so 3D objects remain linked to the source data.
- Render gates, entrances, stops, parking and landmarks using suitable markers, models or ground features.
- Treat terrain, trees, facades, roof detail and other decorative elements as optional enhancements after geometry, alignment and navigation work correctly.

### 2. Interaction
- Select or tap buildings, gates, stops, parking areas and other supported features.
- Display meaningful feature names/details and allow a selected feature to become a destination.
- Support destination search using the app's existing searchable data where possible.
- Make camera controls intuitive: rotate/orbit, pan where appropriate, zoom, and reset to a useful campus overview.
- Avoid making camera gestures conflict with ordinary mobile UI controls.
- Keep text, labels, markers and route highlights readable at useful zoom levels.

### 3. Navigation
- Let users choose an origin and destination using existing app behaviour where possible.
- Display a calculated route that follows the real walkable network.
- Render the route visibly above the ground surface to avoid z-fighting.
- Show available route information such as distance and directions only when supported by the underlying graph.
- If current location is supported, handle browser permission denial, unavailable GPS and location accuracy honestly.
- Camera-follow mode and step-by-step navigation may be later phases rather than prerequisites.
- Clearly distinguish routing logic from 3D presentation. A 3D scene by itself does not create a routable map.

### 4. Responsive and performance requirements
- Work on the Expo PWA's supported browsers and screen sizes.
- Verify compatibility with the project's actual Expo, React and bundler setup before choosing 3D packages.
- Provide touch-friendly controls and a sensible default camera.
- Minimize unnecessary draw calls and duplicated geometry; consider instancing repeated objects and merging static geometry when appropriate.
- Avoid rebuilding all geometry on every UI interaction.
- Consider progressive loading, memoization, disposal of GPU resources, and reduced-detail rendering for weaker devices.
- Check behaviour when WebGL is unavailable or a device struggles. Consider preserving the 2D map as a fallback or alternative mode.
- Measure performance with the actual campus dataset and at least one representative mobile device; do not assume it will be fast without testing.

## Required audit and planning process

### Phase A — Read-only repository audit

Before changing code, inspect the relevant project and report:

1. The app structure and framework, including Expo SDK, React version and web/build setup.
2. The current map library and map component(s).
3. The QGIS export script, its inputs, generated files and how those files are consumed.
4. The exported schema: feature types, IDs, properties, coordinate order, coordinate reference system and any transformations already performed.
5. How buildings, roads, gates, entrances, stops, parking and other features are represented.
6. The current route data model and route-calculation logic, if any.
7. How destination search and feature selection currently work.
8. Any existing state-management, styling, testing and deployment conventions relevant to the change.
9. Risks, unknowns, data gaps and compatibility issues that could affect a 3D upgrade.

Do not claim to have inspected files that were not actually opened. Clearly label confirmed findings, assumptions and unanswered questions.

### Phase B — Propose the architecture

Based on the audit, recommend a specific architecture for this codebase. Explain:

- Whether to use direct Three.js, React Three Fiber, or another suitable option.
- Which packages are genuinely needed and why.
- How QGIS output should flow into the 3D geometry-generation process.
- How coordinates will be transformed into consistent local world coordinates.
- How geometry will be generated, cached and updated.
- How the 3D map will reuse existing feature data, search, state and routing.
- How routing and visual geometry will stay independent but aligned.
- How to preserve the current 2D experience and introduce 3D safely.
- What should be done in the app, in the QGIS export script, and in any optional preprocessing script.
- Expected performance risks and how they will be tested.

Consider at least two viable approaches if there is a meaningful architectural choice. Give a reasoned recommendation rather than leaving every decision open.

### Phase C — Phased implementation plan

Provide a file-specific plan based on files that actually exist in the repository. For each stage, identify the intended changes, dependencies, validation steps and risks.

A sensible sequence to evaluate is:

1. A small proof of concept using real exported campus data: a few buildings, roads and one gate.
2. Coordinate/alignment validation against the existing 2D map.
3. Campus-wide procedural building and road/path geometry.
4. Feature selection, labels and destination search.
5. Route rendering using the existing or improved routing system.
6. Mobile controls, responsiveness, performance optimization and fallback.
7. Optional visual polish, terrain, trees, facades and other details.

Change this sequence if the audit shows a better one. Define clear acceptance criteria for each phase.

### Phase D — Wait for approval

At the end of the audit, present:
- A concise summary of the current implementation.
- The recommended architecture and why it fits this repository.
- A phased plan with concrete file-level changes.
- Dependencies to add, remove or avoid, with compatibility reasons.
- Key unknowns and any specific information needed from me.
- Tests and acceptance criteria.

**Stop before implementation and wait for my approval.** Do not install packages, alter project files, regenerate map data, change routing, or begin a migration until I approve the proposed plan.

## Definition of success

The project should only be considered successful when:

- The 3D geometry aligns with the real QGIS-derived campus layout.
- Buildings and campus features remain associated with their correct data and identifiers.
- The map can be navigated using responsive mouse and touch controls.
- Users can select and search supported destinations.
- Routes follow connected, valid walking paths rather than crossing buildings or inaccessible areas.
- Existing working functionality has been preserved or deliberately migrated with approval.
- The experience has been tested on a real mobile browser with the actual campus dataset.
- There is a documented fallback or recovery approach if 3D performance or compatibility is poor.

## Final instruction

First understand NavCamp as it exists today. Then propose the best realistic way to turn its existing QGIS-based 2D campus map into a custom 3D, interactive, routable map using code. Do not force the project into a predetermined technology stack, and do not start coding until the audit and plan are approved.
