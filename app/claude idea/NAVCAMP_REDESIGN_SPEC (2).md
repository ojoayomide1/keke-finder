# NavCamp redesign and Pathfinder spec

Audience: the coding agent implementing this. Read the whole file before changing code. Work in the phases listed in section 10 and stop after each phase so the result can be checked.

## 1. Goals

1. Make NavCamp feel calm, clean, and professional, ready to demo at a Google DevFest.
2. Fix the Pathfinder screen, which is overloaded. Replace the long list of rows with a single "Search or ask" bar, quick categories, and recents.
3. Make indoor locations (JSON) searchable and navigable, with an optional AI assistant ("NavBot") that answers natural-language questions.
4. Fix the logic and contrast bugs listed in section 7.
5. Keep a Pathfinder-only MVP path (section 9) in case the demo should focus on navigation.

Do not rewrite working backend logic. Change the UI layer, shared components, and the specific logic fixes below. Where the existing code or data differs from this spec, adapt to the code and report the difference instead of guessing.

## 2. Design system

One brand for both roles. The Rider role is distinguished by a small role chip, not by a different colour theme (remove the orange tab and button styling).

### Colour tokens (define once as CSS variables, use everywhere)

| Token | Value | Use |
|---|---|---|
| `--brand` | `#1E7B4C` | primary buttons, active tab, links |
| `--brand-soft` | `#E6F2EB` | selected chips, tinted backgrounds |
| `--bg` | `#F7F8FA` | page background |
| `--surface` | `#FFFFFF` | cards |
| `--surface-2` | `#F1F3F5` | inputs, tiles |
| `--text` | `#14171A` | primary text |
| `--text-2` | `#5B6470` | secondary text |
| `--text-3` | `#6B7480` | placeholders, captions (about 4.7:1 on white) |
| `--border` | `#E3E7EB` | hairlines |
| `--danger` | `#C23B3B` | log out, errors |
| `--info` | `#2F6FD0` | "my location" dot |

**Light theme only.** The app is used outdoors in daylight, so it must stay bright and high-contrast. Do not implement dark mode and do not use `prefers-color-scheme`. Force light rendering so a phone set to dark mode does not flip the app: add `<meta name="color-scheme" content="light">` and `:root { color-scheme: light; }`.

Outdoor readability rules:
- All text meets WCAG AA contrast (4.5:1 for body text and captions). Never put white text on a light surface, and never use pale grey on a white or off-white surface.
- Body text is at least 14px, captions at least 12px, tap targets at least 44px.
- Matte surfaces only: no glossy gradients or low-contrast tints that wash out in sunlight.

### Typography

- Font: Inter (or DM Sans). Load with `display=swap`.
- Weights: 400, 500, 600 only. Remove 700/800 everywhere.
- Sizes: page title 22/600, section title 16/600, body 14/400, secondary 13/400, caption 12/400.
- Sentence case for all labels ("Request keke", not "Request Keke").

### Shape and spacing

- 4px spacing scale (4, 8, 12, 16, 20, 24).
- Radius: 12px for cards and inputs, 999px for chips, 14px for large search bars.
- Borders: 1px hairline `--border`. No heavy shadows. At most one soft shadow on bottom sheets.
- Primary button: filled brand, white text, 44px minimum height. Only one primary button per screen.

### Icons

Replace all emoji icons (tab bar, wallet, map, support, profile) with one line-icon set (Lucide or Tabler, 20px, 1.75 stroke). Suggested: `car` (Ride), `compass` (Explore), `wallet`, `user`, `map-pin`, `search`, `sparkles` (AI), `walk`, `stairs`, `door-enter`, `receipt`, `life-buoy`.

## 3. Global fixes

- Bottom tab bar: add `padding-bottom` to every scroll container equal to tab bar height plus `env(safe-area-inset-bottom)`. Several screens currently clip content under the tab bar (wallet card icon, profile cards).
- Add a web app manifest (`display: standalone`, theme colour `--brand`, icons 192/512) and a service worker for caching static assets, so the app can be installed and runs without the browser address bar during the demo.
- Standard empty states: icon, one-line explanation, optional action. No bare "No rides yet" text.
- Loading: skeleton placeholders instead of blank screens or spinners over empty cards.
- Every list and button must have visible `:active` and `:focus-visible` states.
- Student tabs (five): Ride, Explore, Map, Wallet, Profile. Keep **Map as its own tab**. Explore is for searching and asking; Map is the full-screen map. Rename "Home" to "Ride" and "Pathfinder" to "Explore". Do not merge Map into Explore.
- Rider tabs: Home, Earnings, Map, Profile (unchanged apart from styling).

## 4. Pathfinder / Explore spec

### 4.1 Remove

- The Outdoor/Indoor toggle.
- The always-visible list of every location with From and Go buttons.
- The dashed "Starting from your current location" box. It is replaced by the "From" pill (below).

### 4.2 Screen layout (top to bottom)

Explore contains **no map**. Maps live only in the Map tab. This keeps Explore light and avoids two copies of the map code.

1. Title block: small "Explore" label, "Where to?" heading.
2. Search bar (rounded, 14px radius) with a sparkles icon and placeholder `Search or ask, e.g. Dean's office`. Optional microphone icon (use the Web Speech API if available, otherwise hide it).
3. "From: My location" pill under the bar. Tapping it opens a picker (search + list of places) to change the starting point. Default is current location via the Geolocation API; if permission is denied, ask the user to pick a starting point.
4. Horizontal scrolling category chips: Hostels, Lecture halls, Offices, Food, Clinic, and others derived from the data. Tapping a chip opens the category list (see 4.4).
5. "Recent" section: last 3 destinations (store in `localStorage`), each row: icon, name, subtitle (category and walk time), chevron.
6. "Browse" 2-column grid of category tiles with an icon, name, and count.

Tapping any place row (recents, search results, category list) opens the Place sheet (4.5). The row itself is the target, so there are no per-row Go/From buttons. "From" is changed only through the pill.

### 4.3 Unified search (offline first)

Create a pure module `search.ts` (no UI code) with `search(query, filters?) => Place[]`.

- Index outdoor and indoor locations in one list of `Place` records (section 4.7).
- Use Fuse.js or equivalent fuzzy search. Fields: `name`, `aliases`, `people.name`, `people.role`, `courses.code`, `courses.title`, `building`, `room`, `category`.
- Rank exact and prefix matches first, then fuzzy matches. Return at most 8 results.
- Results appear live under the search bar as the user types. Each result shows an icon, name, and a subtitle in the form `Building · floor · room` for indoor places or `Category · N min walk` for outdoor places.
- Keyboard: Enter selects the first result.
- Empty state: "No match. Try a lecturer's name, a course code, or a room number." plus a button "Ask NavBot".

### 4.4 Category list

Header with category name and count, a back arrow, then a vertical list of rows with the same row style as search results. For large categories (for example 14 hostels), group by sub-type (Boys hostels, Girls hostels) with sticky small section headers instead of one long undivided list.

### 4.5 Place sheet (bottom sheet)

Opens when a place is selected. Contents:

- Icon, name, subtitle (`Building · floor · room`), optional people line ("Dean: Prof. X").
- Walking time and distance from the current "From" point.
- Primary button: **Navigate**. Secondary: **Floor plan** (only if the JSON provides one for that floor).
- Tertiary text button: **Set as starting point**.

### 4.6 Route mode (on the Map tab)

Explore never embeds a map. Pressing **Navigate** in the Place sheet switches to the **Map** tab in route mode. The back arrow returns to Explore with the previous query intact.

- The Map tab draws the route as a dashed brand-colour line, a blue dot for the start, and a brand-colour pin for the destination. Today this is the existing 2D map; later it may be the 3D map (see section 12).
- A collapsible bottom sheet (peek and half-height) shows the destination name, total time and distance.
- Steps list with icons:
  - Outdoor steps (walk icon) to the building entrance, from the existing outdoor navigation logic.
  - Door step ("Enter [Building] through the main entrance"), using the building's `entrance` coordinates.
  - Indoor steps: "Go up to the Nth floor" (stairs icon), then the place's `hint` text ("Room 204 is on your left").
- Buttons: **Start** (primary) and **Need a keke?** (secondary). The secondary button navigates to the Ride tab with the drop-off pre-filled to this destination (or its nearest building).
- If there is no indoor data for a place, show only the outdoor steps.

### 4.7 Data model

Normalize whatever the existing JSON contains into this shape at load time (a `loadPlaces()` function). Fields marked optional may be missing. Never invent data. Log a warning in development listing records with missing required fields.

```ts
type Place = {
  id: string;                    // stable, e.g. "admin-2-204"
  name: string;                  // "Dean of Student Affairs"
  category: string;              // "office" | "hostel" | "lecture_hall" | "food" | ...
  subCategory?: string;          // "Boys hostel"
  scope: "outdoor" | "indoor";
  buildingId?: string;           // required for indoor
  buildingName?: string;
  floor?: number;
  room?: string;
  coords?: { lat: number; lng: number };       // outdoor places and building centres
  entrance?: { lat: number; lng: number };     // per building, needed for routing to the door
  aliases?: string[];            // "DSA", "Student Affairs"
  people?: { name: string; role?: string }[];
  courses?: { code: string; title: string }[];
  hours?: string;
  hint?: string;                 // "Third door on the left"
  floorPlanUrl?: string;
};
```

If buildings lack `entrance` coordinates, add them to the JSON (one entry per building) and report which are missing.

## 5. NavBot (AI assistant) spec

NavBot supplements search. It is not a separate screen the user must find: it is reached from the search bar, from the "No match" state, and when the query looks like a question (starts with who/where/what/how, ends with `?`, or contains more than 4 words).

### 5.0 Architecture decision: no server

The project uses Firebase and has **no server or VPS**. NavBot therefore calls Gemini directly from the app through the **Firebase AI Logic client SDK** (`firebase/ai`) with the **Gemini Developer API free tier**.

- Do **not** create Cloud Functions, an Express server, or any `/api/navbot` endpoint. (Cloud Functions needs the pay-as-you-go Blaze plan; the free Gemini tier requires the project to stay on the free Spark plan, not linked to Cloud Billing.)
- Do **not** put a Gemini API key anywhere in the code, `.env` files, or the repo. Firebase AI Logic manages access; the app authenticates through the existing Firebase config.
- Firebase AI Logic names, imports, and model names change often. Before coding, read the current Firebase AI Logic web docs and use the exact current API. If anything below differs from the docs, follow the docs and report the difference.
- Check the `firebase` package version in `package.json`. If it is too old to include `firebase/ai`, upgrade only that package, confirm the existing auth and database code still works, and report the change.
- Keep the whole feature behind one function, `askNavBot(question, places, history?)`, so a server-side version could replace it later without UI changes.

### 5.1 Principle

The model never invents locations. It only returns IDs of places that exist in the JSON. The client renders the answer from the JSON using those IDs. If the model returns an unknown ID, discard it.

### 5.2 Setup done by the project owner (not the agent)

The agent must not try to do these. Assume they are done, read the values from environment variables, and tell the owner exactly which values are needed.

1. Confirm the Firebase project is on the free **Spark** plan and not linked to Cloud Billing.
2. In the Firebase console, enable **AI Services > AI Logic** and choose the **Gemini Developer API**.
3. Create a reCAPTCHA (v3) site key for the app's domain and `localhost`, and register the app in **App Check** with it.
4. Provide the **reCAPTCHA site key** as `EXPO_PUBLIC_RECAPTCHA_SITE_KEY`.
5. Provide the **model name** as `EXPO_PUBLIC_NAVBOT_MODEL` (a current Flash or Flash-Lite model). Never hardcode the model name in the source.
6. Add the App Check **debug token** shown in the browser console during development to the console's debug tokens list.

### 5.3 Request flow (all client-side)

1. User submits a question in the Explore search bar or the chat view.
2. Client runs local `search()` first. If there is a single confident match, show it and skip the AI call.
3. Otherwise check the guards in 5.7 (signed in, cooldown, cache). Then call `askNavBot()`.
4. `askNavBot()` builds a prompt from the system instruction (5.6), the slimmed places data (5.5), and the question, and calls Gemini with a structured JSON output schema.
5. `askNavBot()` parses the JSON, **removes any place ID not present in the loaded places**, and returns the result. The UI renders the message plus a place card for each remaining ID.
6. Any failure (timeout, quota, network, malformed JSON, no valid IDs) falls back to local search results plus a friendly message.

### 5.4 Reference implementation (verify against the current docs)

```ts
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "firebase/ai";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Run once at app start, after initializeApp()
initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider(process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY!),
  isTokenAutoRefreshEnabled: true,
});

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

const model = getGenerativeModel(ai, {
  model: process.env.EXPO_PUBLIC_NAVBOT_MODEL!,
  systemInstruction: SYSTEM_PROMPT, // section 5.6
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: Schema.object({
      properties: {
        intent: Schema.enumString({
          enum: ["find_place", "find_person", "find_course", "nearest", "hours", "unknown"],
        }),
        message: Schema.string(),
        placeIds: Schema.array({ items: Schema.string() }),
        followUps: Schema.array({ items: Schema.string() }),
      },
    }),
  },
});

export async function askNavBot(question: string, places: Place[]) {
  const result = await withTimeout(
    model.generateContent(
      `Places:\n${JSON.stringify(slim(places))}\n\nQuestion: ${question}`
    ),
    8000
  );
  const out = JSON.parse(result.response.text());
  const valid = new Set(places.map((p) => p.id));
  out.placeIds = (out.placeIds ?? []).filter((id: string) => valid.has(id));
  return out;
}
```

If `Schema` options, import paths, or App Check usage have changed, follow the current docs.

### 5.5 What goes into the prompt

- `slim(places)` keeps only: `id`, `name`, `aliases`, `buildingName`, `floor`, `room`, `people`, `courses`, `hours`, `category`. Drop coordinates, URLs, and anything else.
- If the slimmed JSON is under about 40,000 characters, send all places. If it is larger, send only the top 20 results from the local `search()` for that question.
- Send only the question and place data. Never send the user's name, email, matric number, phone, wallet data, or location.

### 5.6 System prompt (starting point, tune during testing)

> You are NavBot, the campus guide for NavCamp. Answer only using the places data provided. If the answer is not in the data, say you don't know and suggest searching by room or building. Never guess room numbers, names, or hours. Reply with the JSON schema only. Keep messages under 40 words.

### 5.7 Guardrails and quota protection

The free tier is a quota shared by every user of the project, and the app is a public client, so protect it:

- Require a signed-in user (existing Firebase Auth) before the first AI call.
- App Check must be initialised (5.4). Do not remove it.
- Client-side cooldown of 3 seconds between questions and a soft cap of 20 AI questions per user per hour. This is a convenience limit, not a security control; do not describe it as one.
- Cache answers in memory and `localStorage`, keyed by the lowercased and trimmed question, up to the last 50. A cache hit makes no AI call.
- Timeout of 8 seconds. On timeout, quota error (HTTP 429 or "resource exhausted"), network error, or invalid JSON, show "NavBot is unavailable. Try searching instead." and fall back to local search results. Never show raw error text.
- Optional: log the question text, intent, and timestamp (no user identifiers) for `unknown` intents to a small Firestore collection so the places data can be improved. Add Firestore security rules so users can only create, not read, these documents.

### 5.8 Testing

- Unit tests (mock the model): unknown IDs are removed, malformed JSON falls back, timeout falls back, cache hits skip the call, the cooldown works.
- A fixture file `navbot-questions.json` with at least 20 questions and the expected place IDs, written by the owner from the real data. A manual script (not part of CI) runs them against the real model and prints the pass rate. Report the result.
- Test every demo question in section 9 on the deployed domain, not just on `localhost`, because App Check is domain-bound.

### 5.9 UI

- Chat view as a bottom sheet or full screen: user bubbles in brand colour (white text), assistant text on plain background.
- Assistant answers with a place card (icon, name, subtitle) and **Navigate** and **Floor plan** buttons.
- Follow-up chips under the answer.
- Input bar at the bottom: `Ask about campus`, send icon.
- Show a small typing indicator while waiting, and the fallback message from 5.7 on failure.

### 5.10 Known trade-offs

- The prompt and places data are visible to anyone who inspects the app. They must contain only public campus information.
- On the free tier, Google may use inputs and outputs to improve its products. This is acceptable only because inputs are non-personal.
- Free-tier limits depend on the model and can change. Do not assume a specific number.
- If the project must later move to a server (for example for stricter per-user limits), replace the body of `askNavBot()` only.

## 6. Student and Rider screens

### 6.1 Ride (student home)

- Header: small greeting, name, and a wallet pill (`₦0`) on the right. Remove the big "Hello, NAME" block.
- "Campus live" shrinks to one inline line: green dot and `3 riders online · 1 in queue`.
- Request card with two linked rows: Pickup (default **My location**) and Drop-off. Both open the same searchable place picker used by Pathfinder (shared data source), not native dropdowns.
- Show **Estimated fare** and rider ETA before the request button.
- Payment: two options, **Cash** and **Wallet**. If wallet balance is less than the fare, preselect Cash and show "Top up to use" under Wallet. Never default to an option that will fail.
- Primary button: **Request keke**. Disabled-looking states are confusing; keep it enabled and show an inline message if something is missing.
- Ride History: empty state with icon and "Your rides will show up here."
- Add ride status screens: searching, matched (rider name, plate, ETA), arriving, on trip, completed with rating (1 to 5 stars).

### 6.2 Wallet

- Calm balance card with the neutral surface colour. Remove the amber "Low balance" warning for new users; use the hint "Top up to pay for rides without cash." Only show a low-balance warning when balance is below the typical fare and the user has taken a ride.
- Replace the duplicate tiles ("This week" and "Total balance") with **Spent this week** and **Rides this week**.
- Top up button opens a sheet with preset amounts (₦500, ₦1000, ₦2000), a custom amount, and a payment provider (Paystack or Flutterwave). Wallet balance changes only after the server confirms the payment via webhook.
- Transaction filters (All, Top-ups, Rides) stay as chips. Empty state: receipt icon and "No transactions yet. Top-ups and rides show up here."

### 6.3 Profile (student)

- Show the matric number and email once (header or account card, not both).
- Fix contrast: **Help and support** must be dark text on a light card with a life-buoy line icon. **Log out** must be `--danger` text on a transparent or very light danger background with at least 4.5:1 contrast.
- Add: edit phone.

### 6.4 Rider Home

- Header: name on one line, with the status pill (Online/Offline) beneath or aligned right with proper wrapping. The name must never overlap the pill.
- Go online toggle as a large, clear card. When online, show incoming requests with pickup, drop-off, fare, and an Accept/Decline with a 20-second timer.
- Earnings strip: Today, Balance, Total rides.

### 6.5 Rider Earnings and Profile

- Same tokens as the rest of the app, with brand green replacing orange.
- Withdrawal flow: Request withdrawal, bank account details (stored securely), pending/approved/paid statuses.
- Profile: remove the duplicated Status row (the pill already shows it).

### 6.6 Auth screens

- Login and Sign up as segmented control. Sign up has Student/Rider chips.
- Student sign up: full name, email, password (with show/hide and strength hint), phone, matric number.
- Rider sign up: full name, email, password, phone, **plate number**, **vehicle type**.
- Validation: email format; password at least 8 characters; Nigerian phone number (11 digits starting with 0, or +234 followed by 10 digits); matric number format matching the university pattern (for example `VUG/CSC/25/14902`, confirm the exact pattern with the owner). Inline error text under each field, not alerts.
- Add "Forgot password" and email verification if not present.

## 7. Bugs and inconsistencies to fix (from review)

1. Student Home: Wallet selected by default with ₦0 balance (see 6.1).
2. Student Wallet: amber "Low balance" for new users; duplicate balance tile; card icon clipped by the tab bar.
3. Student Profile: "Help and support" is white on light (unreadable); Log out has weak contrast; email and matric shown twice.
4. Rider Home: name text collides with the OFFLINE pill.
5. Rider: Total Rides shows 0 while Earnings lists a ₦100 "Ride fare received" entry; Balance (₦200) and Total Earned (₦300) need to reconcile. Investigate whether this is seed data or a counter bug, and make the counters derive from the same source of truth.
6. Rider Profile: status shown twice.
7. Inconsistent brand colour (orange for riders, green for students).
8. Content hidden under the bottom tab bar on multiple screens.
9. Pathfinder: toggle, chips, and search bar stacked with no spacing; every row repeats two buttons.
10. Emoji used as icons.

## 8. Extensions worth adding (in priority order)

1. Shared place data layer used by Ride, Explore, and NavBot (one `places.json`, one loader).
2. Ride-to-walk handoff: the "Need a keke?" button on the route screen, and "Walk instead" suggestions on short rides (under about 300 m).
3. Favorites: star a place to pin it above Recents.
4. Offline mode: cache `places.json` and the app shell so search and route steps work without data.
5. Floor plans: simple SVG or image per floor, with a highlighted room, opened from "Floor plan".
6. Safety: share trip with a contact, and rider details (name, plate, photo) shown before pickup.
7. Admin page (even a simple authenticated form) to edit places, offices, and lecturers without touching JSON by hand.
8. Analytics: most searched places, unanswered NavBot questions.

## 9. Pathfinder-only MVP (for a focused demo)

If time is short, ship only:

- Auth (student only), Explore (4.2 to 4.6), Place sheet, Route screen, and NavBot.
- Hide the Ride, Wallet, and rider flows behind a feature flag (`FEATURES = { rides: false, wallet: false }`) so they can be re-enabled without code changes. Tabs become Explore, Map and Profile.
- Seed data: at least 15 outdoor places and 15 indoor places (offices, lecture halls, 5 lecturers, 5 courses) so every demo query returns a result.

Suggested 5-minute demo script:

1. Open the installed app, show the clean Explore screen.
2. Type "hostel n": instant result, Navigate, show the route.
3. Ask "where is the Dean of Student Affairs office?": NavBot answers with the place card.
4. Ask "who teaches CSC 301?": answer with lecturer, office, and hall.
5. Tap Navigate: outdoor steps, then indoor steps.
6. Tap "Need a keke?": show the ride request pre-filled.
7. Turn off network: show that search still works offline.

## 10. Build order

**Phase 1: foundation.** Tokens, typography, icon set, tab bar padding, manifest, empty states. No behaviour changes. Review.

**Phase 2: data and search.** `loadPlaces()`, `search.ts` with tests (exact, prefix, fuzzy, person, course, room number). Review.

**Phase 3: Explore UI.** Search bar, From pill, chips, Recents, Browse grid, category list, Place sheet, Route screen. Review.

**Phase 4: NavBot.** Firebase AI Logic client (no server), App Check, schema validation, caching and cooldown, UI, fallbacks. Review. The owner completes section 5.2 first.

**Phase 5: Ride and Wallet.** Section 6.1 and 6.2 changes and shared place picker. Review.

**Phase 6: Profile, Rider, Auth.** Section 6.3 to 6.6 and bug list items 3 to 6. Review.

**Phase 7: polish.** Skeletons, outdoor-readability and accessibility pass, offline cache, demo seed data.

## 11. Acceptance criteria

- Explore shows no more than 5 distinct regions above the fold on a 360x800 viewport: title, search bar, From pill, chips, and either Recents or Browse.
- Searching "dean", "csc 301", "room 204", or a hostel name returns the right place in under 100 ms offline.
- NavBot returns only place IDs that exist in the data; unknown IDs are discarded; failures fall back to local search with a friendly message.
- No API key, server, or Cloud Function exists in the codebase for NavBot; the project stays on the Spark plan.
- All text passes WCAG AA contrast, including Help and support and Log out.
- No emoji icons remain. No screen has content clipped by the tab bar.
- Rider and student share one brand colour.
- The app is light-only: it looks the same when the phone is set to dark mode.
- Explore contains no map; Navigate opens the Map tab in route mode.
- Wallet-default bug fixed: an insufficient balance never preselects Wallet.
- App installs as a PWA and the app shell loads offline.
- Report anything in this spec that conflicts with the existing code or data instead of silently choosing.

## 12. Compatibility with the planned 3D map

A separate 3D campus map project (Three.js, geometry generated from the QGIS export) is planned. It is **not part of this spec**. Do not add 3D dependencies and do not rewrite the map renderer. To keep both efforts compatible:

1. **The Map tab owns the renderer.** Wrap whatever map exists behind one `MapView` component with a renderer-agnostic interface: props `places`, `selectedPlaceId`, `route`, `userLocation`, `mode` (`"browse"` or `"route"`), and events `onSelectPlace(id)` and `onMapReady`. Explore, the Place sheet, the route sheet, and NavBot talk only to this interface, never to the map library directly. Then a 3D renderer can replace or sit beside the 2D one later.
2. **Overlay UI stays independent.** Search bar, chips, and bottom sheets are plain UI layered over the map with no dependency on the map library.
3. **Place IDs must match the QGIS export.** For outdoor places, `Place.id` is the exported feature ID (do not generate new ones). Outdoor coordinates and entrances come from the QGIS export and are not duplicated by hand into `places.json`. Indoor records use the same feature ID in `buildingId`. This lets a tapped 3D building resolve to the same Place later.
4. **Routing is untouched.** The route steps in section 4.6 consume the output of the existing routing module. Do not reimplement it. Routing data and render geometry stay separate.
5. **PWA caching.** Inspect the existing Expo PWA and service worker setup first and extend it rather than replacing it. Version the cached `places.json` so updated data is not served stale.
6. **No 2D assumptions outside `MapView`.** Do not hardcode 2D-specific logic (for example tile layers or 2D-only gestures) in Explore, Ride, or NavBot code.
7. **Separate branches.** Work on this redesign and the 3D project on separate branches. Conflicts should be confined to the Map tab.
8. **Order.** Redesign phases 1 to 4 (Explore and NavBot) come first. The 3D map comes after, and the 2D map remains the fallback.
