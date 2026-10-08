/**
 * server.js — Indoor Places Editor (local tool)
 *
 * Run: node server.js
 * Opens: http://localhost:3737
 *
 * Reads/writes:
 *   ../map-data/source/indoor_places.json
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const url  = require("url");

const PORT       = 3737;
const DATA_PATH  = path.resolve(__dirname, "../map-data/source/indoor_places.json");
const PUBLIC_DIR = path.resolve(__dirname, ".");

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url);
  const pathname = parsed.pathname;

  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── API ────────────────────────────────────────────────────────────────────

  // GET /api/data — return full indoor_places.json
  if (req.method === "GET" && pathname === "/api/data") {
    return json(res, 200, readData());
  }

  // POST /api/save — overwrite indoor_places.json with body
  if (req.method === "POST" && pathname === "/api/save") {
    try {
      const body = await readBody(req);
      if (typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "Body must be a JSON object" });
      }
      writeData(body);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ── Static files ───────────────────────────────────────────────────────────

  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  const ext    = path.extname(filePath).toLowerCase();

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end("Not found");
  }

  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Indoor Places Editor`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Writing to: ${DATA_PATH}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
