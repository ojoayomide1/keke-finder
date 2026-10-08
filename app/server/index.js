/**
 * NavCamp VPS Express Server
 *
 * Mirrors the Cloudflare Worker logic (cloudflare-worker/worker.js) for Node.js.
 * Routes:
 *   POST /paystack/create-virtual-account  — initialize Paystack transaction → return payment URL
 *   POST /paystack/webhook                 — receive Paystack charge.success → credit wallet
 *   POST /rides/notify-assigned            — placeholder for ride assignment notifications
 *   GET  /health                           — uptime check
 *
 * Env vars (set in /etc/navcamp.env on the VPS):
 *   PORT                        (default 3000)
 *   PAYSTACK_SECRET_KEY
 *   PROJECT_ID                  (Firebase project ID)
 *   SERVICE_ACCOUNT_EMAIL
 *   SERVICE_ACCOUNT_PRIVATE_KEY (full PEM, newlines as \n)
 *   FIREBASE_WEB_API_KEY
 */

"use strict";

const http    = require("http");
const https   = require("https");
const crypto  = require("crypto");
const fs      = require("fs");
const path    = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT || "3000", 10);
const BRAND_NAME  = "NavCamp";

function env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ─── TINY HTTP ROUTER ─────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-paystack-signature");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const body = await readBody(req);

    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { status: "ok", timestamp: new Date().toISOString() });
    }

    if (req.method === "POST" && req.url === "/paystack/create-virtual-account") {
      return await handleCreateVirtualAccount(req, res, body);
    }

    if (req.method === "POST" && (req.url === "/paystack/webhook" || req.url === "/")) {
      return await handlePaystackWebhook(req, res, body);
    }

    if (req.method === "POST" && req.url === "/rides/notify-assigned") {
      return await handleNotifyRideAssigned(req, res, body);
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[server] Unhandled error:", err.message);
    json(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[navcamp] Server running on port ${PORT}`);
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────

async function handlePaystackWebhook(req, res, rawBody) {
  const signature = req.headers["x-paystack-signature"] || "";

  if (!verifyPaystackSignature(rawBody, signature)) {
    return json(res, 401, { error: "Unauthorized" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  if (event.event !== "charge.success") {
    return json(res, 200, { message: "OK" });
  }

  const { reference, amount, metadata } = event.data || {};
  const token = await getFirebaseToken();
  const base  = firestoreBase();

  const duplicate = await referenceAlreadyProcessed(base, token, reference);
  if (duplicate) return json(res, 200, { message: "Already processed" });

  const topUpAmount = Number(amount || 0);

  const matchedTopUp = reference
    ? await findPendingTopUpByReference(base, token, reference)
    : null;

  const studentId = metadata?.studentId
    || matchedTopUp?.fields?.studentId?.stringValue
    || null;

  if (!studentId) return json(res, 400, { error: "No matching student top-up" });

  const studentRes = await httpsGet(`${base}/users/${studentId}`, {
    Authorization: `Bearer ${token}`
  });
  if (!studentRes.ok) return json(res, 404, { error: "Student not found" });

  const studentDoc   = await studentRes.json();
  const currentBalance = parseInt(
    studentDoc.fields?.wallet?.mapValue?.fields?.balance?.integerValue || "0",
    10
  );
  const newBalance = currentBalance + topUpAmount;
  const now        = new Date().toISOString();

  const updateRes = await httpsPatch(
    `${base}/users/${studentId}?updateMask.fieldPaths=wallet.balance&updateMask.fieldPaths=wallet.lastTopUp`,
    {
      fields: {
        wallet: {
          mapValue: {
            fields: {
              balance:   { integerValue: newBalance.toString() },
              lastTopUp: { timestampValue: now }
            }
          }
        }
      }
    },
    { Authorization: `Bearer ${token}` }
  );

  if (!updateRes.ok) return json(res, 500, { error: "Wallet update failed" });

  await createFirestoreDoc(base, token, "walletTransactions", {
    userId:        { stringValue: studentId },
    type:          { stringValue: "topup" },
    amount:        { integerValue: topUpAmount.toString() },
    balanceBefore: { integerValue: currentBalance.toString() },
    balanceAfter:  { integerValue: newBalance.toString() },
    description:   { stringValue: "Wallet top-up via bank transfer" },
    reference:     { stringValue: reference },
    rideId:        { nullValue: null },
    status:        { stringValue: "success" },
    createdAt:     { timestampValue: now }
  });

  if (matchedTopUp?.name) {
    await updateFirestoreDocByName(matchedTopUp.name, token, {
      reference:  { stringValue: reference },
      status:     { stringValue: "credited" },
      creditedAt: { timestampValue: now }
    }, ["reference", "status", "creditedAt"]);
  } else {
    await createFirestoreDoc(base, token, "topUpRequests", {
      studentId:  { stringValue: studentId },
      amount:     { integerValue: topUpAmount.toString() },
      reference:  { stringValue: reference },
      status:     { stringValue: "credited" },
      createdAt:  { timestampValue: now },
      creditedAt: { timestampValue: now }
    });
  }

  console.log(`[webhook] Credited ₦${topUpAmount / 100} to student ${studentId}`);
  return json(res, 200, { message: "OK" });
}

async function handleCreateVirtualAccount(req, res, body) {
  const authHeader = req.headers["authorization"] || "";
  const idToken    = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return json(res, 401, { error: "Unauthorized" });

  const firebaseUser = await lookupFirebaseUser(idToken);
  if (!firebaseUser?.localId) return json(res, 401, { error: "Unauthorized" });

  let amount = 0;
  try {
    const parsed = JSON.parse(body);
    amount = Number(parsed.amount);
  } catch {
    return json(res, 400, { error: "Invalid request body" });
  }

  if (!amount || amount < 50000) return json(res, 400, { error: "Minimum top-up is ₦500" });

  const token     = await getFirebaseToken();
  const base      = firestoreBase();
  const studentId = firebaseUser.localId;

  const studentRes = await httpsGet(`${base}/users/${studentId}`, {
    Authorization: `Bearer ${token}`
  });
  if (!studentRes.ok) return json(res, 404, { error: "Student not found" });

  const studentDoc = await studentRes.json();
  const fields     = studentDoc.fields || {};
  const role       = fields.role?.stringValue;

  if (role !== "student") return json(res, 403, { error: "Only students can top up" });

  const email     = fields.email?.stringValue     || firebaseUser.email;
  const name      = fields.name?.stringValue      || firebaseUser.displayName || `${BRAND_NAME} Student`;
  const reference = `navcamp-topup-${studentId}-${Date.now()}`;

  const tx = await paystackRequest("https://api.paystack.co/transaction/initialize", {
    email,
    amount,
    reference,
    metadata: {
      studentId,
      custom_fields: [
        { display_name: "Student ID", variable_name: "student_id", value: studentId },
        { display_name: "App",        variable_name: "app",        value: BRAND_NAME }
      ]
    },
    callback_url: `https://api.oprides.site/paystack/webhook`
  });

  const authorizationUrl = tx?.data?.authorization_url;
  if (!authorizationUrl) {
    return json(res, 502, { error: "Could not initialize payment", paystack: tx });
  }

  await createFirestoreDoc(base, token, "topUpRequests", {
    studentId: { stringValue: studentId },
    amount:    { integerValue: amount.toString() },
    reference: { stringValue: reference },
    status:    { stringValue: "pending" },
    createdAt: { timestampValue: new Date().toISOString() }
  });

  return json(res, 200, { paymentUrl: authorizationUrl, reference });
}

async function handleNotifyRideAssigned(req, res, body) {
  // Placeholder — add push notification logic here later
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  console.log("[rides] notify-assigned:", parsed);
  return json(res, 200, { message: "Notification queued" });
}

// ─── PAYSTACK ────────────────────────────────────────────────────────────────

function verifyPaystackSignature(body, signature) {
  try {
    const hash = crypto
      .createHmac("sha512", env("PAYSTACK_SECRET_KEY"))
      .update(body)
      .digest("hex");
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function paystackRequest(url, payload) {
  const options = {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${env("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  };
  const res  = await nodeFetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...data };
}

// ─── FIREBASE AUTH ───────────────────────────────────────────────────────────

async function lookupFirebaseUser(idToken) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4";
  const res = await nodeFetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ idToken })
    }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.users?.[0] || null;
}

// ─── FIREBASE SERVICE ACCOUNT JWT ────────────────────────────────────────────

let _cachedToken   = null;
let _tokenExpiresAt = 0;

async function getFirebaseToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;

  const now        = Math.floor(Date.now() / 1000);
  const email      = env("SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");

  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss:   email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now
  }));

  const signing  = `${header}.${payload}`;
  const sign     = crypto.createSign("RSA-SHA256");
  sign.update(signing);
  sign.end();
  const sig = sign.sign(privateKey, "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signing}.${sig}`;

  const tokenRes = await nodeFetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to get Firebase token: " + JSON.stringify(tokenData));
  }

  _cachedToken    = tokenData.access_token;
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000; // cache for 55 min
  return _cachedToken;
}

function b64url(str) {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── FIRESTORE HELPERS ───────────────────────────────────────────────────────

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${env("PROJECT_ID")}/databases/(default)/documents`;
}

async function createFirestoreDoc(base, token, collectionId, fields) {
  return nodeFetch(`${base}/${collectionId}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ fields })
  });
}

async function updateFirestoreDocByName(documentName, token, fields, updateMask) {
  const mask = updateMask
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join("&");
  return nodeFetch(`https://firestore.googleapis.com/v1/${documentName}?${mask}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ fields })
  });
}

async function referenceAlreadyProcessed(base, token, reference) {
  const res = await nodeFetch(`${base}:runQuery`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({
      structuredQuery: {
        from:  [{ collectionId: "topUpRequests" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "reference" },
            op:    "EQUAL",
            value: { stringValue: reference }
          }
        },
        limit: 1
      }
    })
  });
  const data = await res.json().catch(() => []);
  return Array.isArray(data) && data.some((row) => row.document);
}

async function findPendingTopUpByReference(base, token, reference) {
  const res = await nodeFetch(`${base}:runQuery`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({
      structuredQuery: {
        from:  [{ collectionId: "topUpRequests" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "reference" },
                  op:    "EQUAL",
                  value: { stringValue: reference }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: "status" },
                  op:    "EQUAL",
                  value: { stringValue: "pending" }
                }
              }
            ]
          }
        },
        limit: 1
      }
    })
  });
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => r.document).filter(Boolean)[0] || null;
}

// ─── HTTP UTILITIES ──────────────────────────────────────────────────────────

/**
 * Minimal fetch() for Node.js using the built-in https module.
 * Node 22 has global fetch, but using it here explicitly avoids any ambiguity.
 */
function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = options.body || null;
    const reqOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   options.method || "GET",
      headers:  options.headers || {}
    };

    if (payload) {
      reqOptions.headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = https.request(reqOptions, (nodeRes) => {
      const chunks = [];
      nodeRes.on("data", (chunk) => chunks.push(chunk));
      nodeRes.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({
          ok:     nodeRes.statusCode >= 200 && nodeRes.statusCode < 300,
          status: nodeRes.statusCode,
          json:   () => Promise.resolve(JSON.parse(raw)),
          text:   () => Promise.resolve(raw)
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(new Error("Request timed out")); });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return nodeFetch(url, { method: "GET", headers });
}

function httpsPatch(url, body, headers = {}) {
  return nodeFetch(url, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(body)
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}
