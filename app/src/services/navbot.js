/**
 * src/services/navbot.js
 *
 * NavBot — AI campus assistant powered by Firebase AI Logic (Gemini).
 * No server, no Cloud Functions, no API key in code.
 * All calls go through Firebase AI Logic client SDK with App Check.
 *
 * Entry point: askNavBot(question, history?)
 *
 * Guardrails:
 *   - Requires signed-in user
 *   - 3s cooldown between questions
 *   - 20 questions per hour (soft cap, in-memory)
 *   - Response cache (last 50, keyed by lowercased question)
 *   - 8s timeout
 *   - Unknown place IDs stripped from response
 *   - All failures fall back gracefully — never throws to the UI
 */

import { getApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { auth } from "../config/firebase";
import { getPlaces, getPlaceById } from "./places";
import { search } from "./search";

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are NavBot, the campus guide for NavCamp at Veritas University Abuja.
Answer only using the places data provided in each message.
If the answer is not in the data, say you don't know and suggest searching by room or building name.
Never guess room numbers, names, or hours.
Reply with valid JSON matching the schema only.
Keep the message field under 40 words.
Be friendly and direct.`;

// ─── RESPONSE SCHEMA ─────────────────────────────────────────────────────────
// We ask Gemini to return structured JSON — no Schema object needed,
// we use responseMimeType + manual parsing with validation.
const RESPONSE_SCHEMA_DESCRIPTION = `{
  "intent": "find_place" | "find_person" | "find_course" | "nearest" | "hours" | "unknown",
  "message": string (under 40 words),
  "placeIds": string[] (IDs from the provided places data only),
  "followUps": string[] (1-3 short follow-up questions)
}`;

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _model       = null;
let _lastCallMs  = 0;
let _hourBucket  = { hour: -1, count: 0 };
const _cache     = new Map(); // question → NavBotResponse
const MAX_CACHE  = 50;
const COOLDOWN   = 3000;   // ms between calls
const HOUR_LIMIT = 20;     // soft cap per hour
const TIMEOUT_MS = 8000;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getModel() {
  if (_model) return _model;
  const app = getApp();
  const ai  = getAI(app, { backend: new GoogleAIBackend() });
  const modelName = process.env.EXPO_PUBLIC_NAVBOT_MODEL ?? "gemini-2.0-flash-lite";
  _model = getGenerativeModel(ai, {
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });
  return _model;
}

/**
 * Slim a place record down to only what the model needs.
 * Never send coordinates, URLs, or PII.
 */
function slim(place) {
  return {
    id:          place.id,
    name:        place.name,
    category:    place.category,
    scope:       place.scope,
    buildingName:place.buildingName,
    floor:       place.floor,
    room:        place.room,
    aliases:     place.aliases?.length ? place.aliases : undefined,
    people:      place.people?.length  ? place.people  : undefined,
    courses:     place.courses?.length ? place.courses : undefined,
    hours:       place.hours,
  };
}

function buildPrompt(question, places) {
  const slimmed = places.map(slim);
  const json    = JSON.stringify(slimmed);

  // If data is large, truncate to 40k chars to stay within context
  const data = json.length > 40000
    ? JSON.stringify(search(question).map(slim))  // top search results only
    : json;

  return `Places data:\n${data}\n\nExpected response schema:\n${RESPONSE_SCHEMA_DESCRIPTION}\n\nQuestion: ${question}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
}

function cacheKey(question) {
  return question.trim().toLowerCase();
}

function addToCache(key, value) {
  if (_cache.size >= MAX_CACHE) {
    // Remove oldest entry
    _cache.delete(_cache.keys().next().value);
  }
  _cache.set(key, value);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Ask NavBot a question about the campus.
 *
 * @param {string}   question
 * @param {object[]} [history]  — previous {role, text} turns for multi-turn (future)
 * @returns {Promise<NavBotResponse>}
 *
 * NavBotResponse:
 * {
 *   ok:        boolean
 *   intent:    string
 *   message:   string
 *   placeIds:  string[]   — validated IDs only
 *   places:    Place[]    — resolved from placeIds
 *   followUps: string[]
 *   cached:    boolean
 *   error?:    string     — only when ok=false
 * }
 */
export async function askNavBot(question) {
  const fallback = (msg, errorCode) => ({
    ok: false, intent: "unknown", message: msg,
    placeIds: [], places: [], followUps: [], cached: false,
    error: errorCode,
  });

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (!auth.currentUser) {
    return fallback("Sign in to use NavBot.", "NOT_SIGNED_IN");
  }

  // ── Cache check ───────────────────────────────────────────────────────────
  const key = cacheKey(question);
  if (_cache.has(key)) {
    return { ..._cache.get(key), cached: true };
  }

  // ── Cooldown ──────────────────────────────────────────────────────────────
  const now = Date.now();
  if (now - _lastCallMs < COOLDOWN) {
    return fallback("Please wait a moment before asking again.", "COOLDOWN");
  }

  // ── Hourly cap ────────────────────────────────────────────────────────────
  const currentHour = Math.floor(now / 3_600_000);
  if (_hourBucket.hour !== currentHour) {
    _hourBucket = { hour: currentHour, count: 0 };
  }
  if (_hourBucket.count >= HOUR_LIMIT) {
    return fallback("NavBot has been used a lot this hour. Try again later.", "QUOTA");
  }

  // ── Call model ────────────────────────────────────────────────────────────
  _lastCallMs = now;
  _hourBucket.count++;

  try {
    const places = getPlaces();
    const prompt = buildPrompt(question, places);
    const model  = getModel();

    const result = await withTimeout(
      model.generateContent(prompt),
      TIMEOUT_MS
    );

    const raw  = result.response.text();
    const data = JSON.parse(raw);

    // Validate and strip unknown IDs
    const validIds = new Set(places.map(p => p.id));
    const placeIds = (data.placeIds ?? []).filter(id => validIds.has(id));
    const resolved = placeIds.map(id => getPlaceById(id)).filter(Boolean);

    const response = {
      ok:        true,
      intent:    data.intent    ?? "unknown",
      message:   data.message   ?? "",
      placeIds,
      places:    resolved,
      followUps: data.followUps ?? [],
      cached:    false,
    };

    addToCache(key, response);
    return response;

  } catch (err) {
    // Log unknown intents for data improvement (no user identifiers)
    if (__DEV__) console.warn("[navbot] error:", err.message);

    if (err.message === "TIMEOUT") {
      return fallback("NavBot is taking too long. Try searching instead.", "TIMEOUT");
    }
    if (err.message?.includes("429") || err.message?.toLowerCase().includes("quota")) {
      return fallback("NavBot is busy right now. Try searching instead.", "RATE_LIMIT");
    }
    return fallback("NavBot is unavailable. Try searching instead.", "ERROR");
  }
}

/**
 * Check if NavBot is available (model name configured, user signed in).
 * Used to decide whether to show the NavBot UI at all.
 */
export function isNavBotAvailable() {
  return !!(process.env.EXPO_PUBLIC_NAVBOT_MODEL && auth.currentUser);
}

/**
 * Clear the response cache — call after place data is refreshed.
 */
export function clearNavBotCache() {
  _cache.clear();
  _model = null; // force model re-init next call
}
