const DEFAULT_FIREBASE_WEB_API_KEY = "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4";
const BRAND_NAME = "NavCamp";

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (request.method !== "POST") {
      return withCors(new Response("OK", { status: 200 }));
    }

    if (url.pathname === "/paystack/create-virtual-account") {
      return withCors(await handleCreateVirtualAccount(request, env));
    }

    if (url.pathname === "/" || url.pathname === "/paystack/webhook") {
      return withCors(await handlePaystackWebhook(request, env));
    }

    return withCors(new Response("Not found", { status: 404 }));
  } catch (err) {
    return withCors(jsonResponse({ error: err.message || "Worker error" }, 500));
  }
}

async function handlePaystackWebhook(request, env) {
  const body = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";

  if (!(await verifyPaystackSignature(body, signature, env))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.event !== "charge.success") {
    return new Response("OK", { status: 200 });
  }

  const eventData = event.data || {};
  const { reference, amount, metadata } = eventData;
  const token = await getFirebaseToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;

  const duplicate = await referenceAlreadyProcessed(base, token, reference);
  if (duplicate) return new Response("Already processed", { status: 200 });

  const topUpAmount = Number(amount || 0);

  // Try to match the pending topUpRequest by reference first (transaction/initialize flow),
  // then fall back to account number (legacy dedicated account flow)
  const matchedTopUp = reference
    ? await findPendingTopUpByReference(base, token, reference)
    : null;

  const studentId = metadata?.studentId
    || matchedTopUp?.fields?.studentId?.stringValue
    || null;
  if (!studentId) return new Response("No matching student top-up", { status: 400 });

  const studentRes = await fetch(`${base}/users/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!studentRes.ok) return new Response("Student not found", { status: 404 });

  const studentDoc = await studentRes.json();
  const currentBalance = parseInt(
    studentDoc.fields?.wallet?.mapValue?.fields?.balance?.integerValue || "0",
    10
  );
  const newBalance = currentBalance + topUpAmount;
  const now = new Date().toISOString();

  const updateRes = await fetch(
    `${base}/users/${studentId}?updateMask.fieldPaths=wallet.balance&updateMask.fieldPaths=wallet.lastTopUp`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        fields: {
          wallet: {
            mapValue: {
              fields: {
                balance: { integerValue: newBalance.toString() },
                lastTopUp: { timestampValue: now }
              }
            }
          }
        }
      })
    }
  );

  if (!updateRes.ok) return new Response("Wallet update failed", { status: 500 });

  await createFirestoreDoc(base, token, "walletTransactions", {
    userId: { stringValue: studentId },
    type: { stringValue: "topup" },
    amount: { integerValue: topUpAmount.toString() },
    balanceBefore: { integerValue: currentBalance.toString() },
    balanceAfter: { integerValue: newBalance.toString() },
    description: { stringValue: "Wallet top-up via bank transfer" },
    reference: { stringValue: reference },
    rideId: { nullValue: null },
    status: { stringValue: "success" },
    createdAt: { timestampValue: now }
  });

  if (matchedTopUp?.name) {
    await updateFirestoreDocByName(matchedTopUp.name, token, {
      reference: { stringValue: reference },
      status: { stringValue: "credited" },
      creditedAt: { timestampValue: now }
    }, ["reference", "status", "creditedAt"]);
  } else {
    await createFirestoreDoc(base, token, "topUpRequests", {
      studentId: { stringValue: studentId },
      amount: { integerValue: topUpAmount.toString() },
      reference: { stringValue: reference },
      status: { stringValue: "credited" },
      createdAt: { timestampValue: now },
      creditedAt: { timestampValue: now }
    });
  }

  return new Response("OK", { status: 200 });
}

async function handleCreateVirtualAccount(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return new Response("Unauthorized", { status: 401 });

  const firebaseUser = await lookupFirebaseUser(idToken, env);
  if (!firebaseUser?.localId) return new Response("Unauthorized", { status: 401 });

  let amount = 0;
  try {
    const body = await request.json();
    amount = Number(body.amount);
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (!amount || amount < 50000) return jsonResponse({ error: "Invalid amount" }, 400);

  const token = await getFirebaseToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;
  const studentId = firebaseUser.localId;

  const studentRes = await fetch(`${base}/users/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!studentRes.ok) return new Response("Student not found", { status: 404 });

  const studentDoc = await studentRes.json();
  const fields = studentDoc.fields || {};
  const role = fields.role?.stringValue;
  if (role !== "student") return new Response("Only students can top up", { status: 403 });

  const email = fields.email?.stringValue || firebaseUser.email;
  const name = fields.name?.stringValue || firebaseUser.displayName || `${BRAND_NAME} Student`;

  // Generate a unique reference for this top-up
  const reference = `navcamp-topup-${studentId}-${Date.now()}`;

  // Initialize a Paystack transaction (works on all account types)
  // The checkout URL is opened in the student's browser
  const tx = await paystackRequest("https://api.paystack.co/transaction/initialize", env, {
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
    callback_url: `https://navcamp-webhook.ojopraise423.workers.dev/paystack/webhook`
  });

  const authorizationUrl = tx?.data?.authorization_url;
  if (!authorizationUrl) {
    return jsonResponse({ error: "Could not initialize payment", paystack: tx }, 502);
  }

  // Record the pending top-up so the webhook can match it by reference
  await createFirestoreDoc(base, token, "topUpRequests", {
    studentId: { stringValue: studentId },
    amount:    { integerValue: amount.toString() },
    reference: { stringValue: reference },
    status:    { stringValue: "pending" },
    createdAt: { timestampValue: new Date().toISOString() }
  });

  return jsonResponse({ paymentUrl: authorizationUrl, reference });
}

async function lookupFirebaseUser(idToken, env) {
  const apiKey = env.FIREBASE_WEB_API_KEY || DEFAULT_FIREBASE_WEB_API_KEY;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.users?.[0] || null;
}

async function createOrFetchPaystackCustomer(env, payload) {
  const created = await paystackRequest("https://api.paystack.co/customer", env, payload);
  if (created?.status && created?.data?.customer_code) return created;

  const email = encodeURIComponent(payload.email);
  const fetched = await paystackRequest(`https://api.paystack.co/customer/${email}`, env);
  if (fetched?.status && fetched?.data?.customer_code) return fetched;

  return created;
}

async function paystackRequest(url, env, payload) {
  const options = {
    method: payload ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    }
  };

  if (payload) options.body = JSON.stringify(payload);

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...data };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, x-paystack-signature");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function verifyPaystackSignature(body, signature, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hash = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hash.length === signature.length && hash === signature;
}

async function referenceAlreadyProcessed(base, token, reference) {
  const res = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "topUpRequests" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "reference" },
            op: "EQUAL",
            value: { stringValue: reference }
          }
        },
        limit: 1
      }
    })
  });
  const data = await res.json();
  return Array.isArray(data) && data.some((row) => row.document);
}

async function findPendingTopUpByReference(base, token, reference) {
  const res = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "topUpRequests" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "reference" },
                  op: "EQUAL",
                  value: { stringValue: reference }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: "status" },
                  op: "EQUAL",
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
  return rows.map((row) => row.document).filter(Boolean)[0] || null;
}

async function findPendingTopUpByAccountNumber(base, token, accountNumber, amount) {
  const res = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "topUpRequests" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "accountNumber" },
            op: "EQUAL",
            value: { stringValue: accountNumber }
          }
        },
        limit: 20
      }
    })
  });

  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) return null;

  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .find((doc) => {
      const fields = doc.fields || {};
      const status = fields.status?.stringValue;
      const requestedAmount = Number(fields.amount?.integerValue || 0);
      return status === "pending" && (!amount || requestedAmount === amount);
    }) || null;
}

async function updateFirestoreDocByName(documentName, token, fields, updateMask) {
  const mask = updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  return fetch(`https://firestore.googleapis.com/v1/${documentName}?${mask}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ fields })
  });
}
async function createFirestoreDoc(base, token, collectionId, fields) {
  return fetch(`${base}/${collectionId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ fields })
  });
}

async function getFirebaseToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = base64UrlEncode(JSON.stringify({
    iss: env.SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );

  const sigB64 = bytesToBase64Url(new Uint8Array(sigBytes));
  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "\n")
    .replace(/\n/g, "")
    .trim();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
