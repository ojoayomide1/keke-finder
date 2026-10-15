/**
 * server.js — Indoor Places Editor (local tool)
 *
 * Run: node server.js (or npm run indoor-editor)
 * Opens: http://localhost:3737
 *
 * Reads/writes:
 *   ../map-data/source/indoor_places.json  (local file — source of truth for app build)
 *   Firestore: indoorPlaces/main            (synced so admin panel sees the same data)
 *
 * Sync strategy:
 *   GET  /api/data  — reads local file. If local is empty/missing, pulls from Firestore first.
 *   POST /api/save  — writes local file AND pushes to Firestore simultaneously.
 *
 * Firestore REST API is used (no firebase-admin dep needed).
 * Set FIREBASE_API_KEY env var if the default below stops working.
 */

"use strict";

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT       = 3737;
const DATA_PATH  = path.resolve(__dirname, "../../map-data/source/indoor_places.json");
const PUBLIC_DIR = path.resolve(__dirname, ".");

// Firestore REST config — uses the public web API key (safe for local tools)
const PROJECT_ID   = "keke-finder-cd5fe";
const API_KEY      = process.env.FIREBASE_API_KEY || "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const DOC_PATH     = "indoorPlaces/main";

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

// ── Local file helpers ────────────────────────────────────────────────────────

function readLocalData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")); }
  catch { return null; }
}

function writeLocalData(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

/**
 * Convert a plain JS object into Firestore REST field format.
 * Supports string, number, boolean, null, array, and nested map.
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean")          return { booleanValue: val };
  if (typeof val === "number")           return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === "string")           return { stringValue: val };
  if (Array.isArray(val))                return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === "object")           return { mapValue: { fields: objToFields(val) } };
  return { stringValue: String(val) };
}

function objToFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

/**
 * Convert Firestore REST field format back to plain JS.
 */
function fromFirestoreValue(v) {
  if ("nullValue"    in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue"  in v) return v.doubleValue;
  if ("stringValue"  in v) return v.stringValue;
  if ("arrayValue"   in v) return (v.arrayValue.values ?? []).map(fromFirestoreValue);
  if ("mapValue"     in v) return fieldsToObj(v.mapValue.fields ?? {});
  return null;
}

function fieldsToObj(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromFirestoreValue(v);
  return obj;
}

/**
 * Fetch the indoorPlaces/main document from Firestore.
 * Returns the `buildings` field as a plain object, or null on failure.
 */
function fetchFromFirestore() {
  return new Promise((resolve) => {
    const reqUrl = `${FIRESTORE_BASE}/${DOC_PATH}?key=${API_KEY}`;
    https.get(reqUrl, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const doc = JSON.parse(raw);
          if (doc.fields?.buildings) {
            resolve(fromFirestoreValue(doc.fields.buildings));
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

/**
 * Push data to Firestore indoorPlaces/main via REST PATCH.
 * Fire-and-forget — local save is not blocked by this.
 */
function pushToFirestore(data) {
  const body = JSON.stringify({
    fields: {
      buildings:  toFirestoreValue(data),
      updatedAt:  { timestampValue: new Date().toISOString() },
      updatedBy:  { stringValue: "local-editor" },
    },
  });

  const patchUrl   = `${FIRESTORE_BASE}/${DOC_PATH}?key=${API_KEY}&updateMask.fieldPaths=buildings&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=updatedBy`;
  const parsedUrl  = new URL(patchUrl);

  const options = {
    hostname: parsedUrl.hostname,
    path:     parsedUrl.pathname + parsedUrl.search,
    method:   "PATCH",
    headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  };

  const req = https.request(options, (res) => {
    let raw = "";
    res.on("data", c => raw += c);
    res.on("end", () => {
      if (res.statusCode === 200) {
        console.log("  [firestore] Synced ✓");
      } else {
        console.warn("  [firestore] Sync failed:", res.statusCode, raw.slice(0, 120));
      }
    });
  });
  req.on("error", (e) => console.warn("  [firestore] Sync error:", e.message));
  req.write(body);
  req.end();
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function jsonRes(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    req.on("error", reject);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url);
  const pathname = parsed.pathname;

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // GET /api/data — return data (local file, or pull from Firestore if missing)
  if (req.method === "GET" && pathname === "/api/data") {
    let data = readLocalData();
    if (!data || Object.keys(data).length === 0) {
      console.log("  [local] File empty — pulling from Firestore…");
      const remote = await fetchFromFirestore();
      if (remote && Object.keys(remote).length > 0) {
        data = remote;
        writeLocalData(data);
        console.log("  [local] Seeded local file from Firestore ✓");
      } else {
        data = {};
      }
    }
    return jsonRes(res, 200, data);
  }

  // POST /api/save — save to local file AND push to Firestore
  if (req.method === "POST" && pathname === "/api/save") {
    try {
      const body = await readBody(req);
      if (typeof body !== "object" || Array.isArray(body)) {
        return jsonRes(res, 400, { error: "Body must be a JSON object" });
      }
      writeLocalData(body);
      pushToFirestore(body); // async, non-blocking
      return jsonRes(res, 200, { ok: true });
    } catch (err) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  const ext    = path.extname(filePath).toLowerCase();
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Indoor Places Editor`);
  console.log(`  ──────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Local file : ${DATA_PATH}`);
  console.log(`  Firestore  : ${PROJECT_ID}/indoorPlaces/main`);
  console.log(`  Saves write to BOTH simultaneously.`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
