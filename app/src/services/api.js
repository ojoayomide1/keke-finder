/**
 * api.js — all calls to your VPS backend go through here.
 *
 * Replace VPS_BASE_URL with your actual server address.
 * On the VPS, run Express + Nginx. These endpoints replace
 * what was in the Cloudflare Worker.
 */

const VPS_BASE_URL = "https://your-vps-domain.com"; // TODO: replace with real URL

/**
 * Generic fetch wrapper with JSON handling and error normalization.
 */
async function request(path, options = {}) {
  const url = `${VPS_BASE_URL}${path}`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with status ${response.status}`);
  }

  return data;
}

// ─── PAYSTACK ─────────────────────────────────────────────────────────────────

/**
 * Create a Paystack virtual account for a student.
 * Moved from Cloudflare Worker → VPS Express route.
 *
 * @param {string} studentId - Firebase UID
 * @param {string} name      - Student's display name
 * @param {string} email     - Student's email
 */
export async function createVirtualAccount(studentId, name, email) {
  return request("/paystack/create-virtual-account", {
    method: "POST",
    body: JSON.stringify({ studentId, name, email })
  });
}

/**
 * Manually trigger a wallet top-up check (optional — webhook handles it automatically).
 *
 * @param {string} reference - Paystack payment reference
 */
export async function verifyPayment(reference) {
  return request("/paystack/verify", {
    method: "POST",
    body: JSON.stringify({ reference })
  });
}

// ─── RIDES ────────────────────────────────────────────────────────────────────

/**
 * Placeholder for any ride-matching logic you move to the VPS.
 * Right now ride state lives in Firestore directly — this is for
 * heavier operations like batch processing or scheduled jobs.
 */
export async function notifyRideAssigned(rideId, riderId, studentId) {
  return request("/rides/notify-assigned", {
    method: "POST",
    body: JSON.stringify({ rideId, riderId, studentId })
  });
}
