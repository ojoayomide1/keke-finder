/**
 * src/services/navbot.js
 *
 * NavBot — AI campus assistant powered by Firebase AI Logic (Gemini).
 * No server, no Cloud Functions, no API key in code.
 */

import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { app, auth } from "../config/firebase";
import { loadPlaces, getPlaces, getPlaceById } from "./places";
import { search } from "./search";

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are NavBot, the campus guide for NavCamp at Veritas University Abuja.
Answer only using the places data provided in each message.
If the answer is not in the data, say you don't know and suggest searching by room or building name.
Never guess room numbers, names, or hours.
Reply with valid JSON matching the schema only.
Keep the message field under 40 words.
Be friendly and direct.`;

const RESPONSE_SCHEMA_DESCRIPTION = `{
  "intent": "find_place" | "find_person" | "find_course" | "nearest" | "hours" | "unknown",
  "message": string (under 40 words),
  "placeIds": string[] (IDs from the provided places data only),
  "followUps": string[] (1-3 short follow-up questions)
}`;

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _model      = null;
let _lastCallMs = 0;
let _hourBucket = { hour: -1, count: 0 };
const _cache    = new Map();
const MAX_CACHE  = 50;
const COOLDOWN   = 3000;
const HOUR_LIMIT = 20;
const TIMEOUT_MS = 15000; // increased from 8s — slow networks need more time

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getModel() {
  if (_model) return _model;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const modelName = process.env.EXPO_PUBLIC_NAVBOT_MODEL ?? "gemini-2.0-flash-lite";
  _model = getGenerativeModel(ai, {
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json" },
  });
  return _model;
}

function slim(place) {
  return {
    id:          place.id,
    name:        place.name,
    category:    place.category,
    scope:       place.scope,
    buildingName:place.buildingName ?? undefined,
    floor:       place.floor        ?? undefined,
    room:        place.room         ?? undefined,
    aliases:     place.aliases?.length  ? place.aliases  : undefined,
    people:      place.people?.length   ? place.people   : undefined,
    courses:     place.courses?.length  ? place.courses  : undefined,
    questions:   place.questions?.length ? place.questions : undefined,
    hours:       place.hours ?? undefined,
  };
}

function buildPrompt(question, places) {
  const slimmed = places.map(slim);
  const json    = JSON.stringify(slimmed);
  const data    = json.length > 40000
    ? JSON.stringify(search(question).map(slim))
    : json;
  return `Places data:\n${data}\n\nExpected response schema:\n${RESPONSE_SCHEMA_DESCRIPTION}\n\nQuestion: ${question}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
  ]);
}

function cacheKey(q) { return q.trim().toLowerCase(); }

function addToCache(key, value) {
  if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
  _cache.set(key, value);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export async function askNavBot(question) {
  const fallback = (msg, code) => ({
    ok: false, intent: "unknown", message: msg,
    placeIds: [], places: [], followUps: [], cached: false, error: code,
  });

  if (!auth.currentUser) return fallback("Sign in to use NavBot.", "NOT_SIGNED_IN");

  const key = cacheKey(question);
  if (_cache.has(key)) return { ..._cache.get(key), cached: true };

  const now = Date.now();
  if (now - _lastCallMs < COOLDOWN) return fallback("Please wait a moment before asking again.", "COOLDOWN");

  const currentHour = Math.floor(now / 3_600_000);
  if (_hourBucket.hour !== currentHour) _hourBucket = { hour: currentHour, count: 0 };
  if (_hourBucket.count >= HOUR_LIMIT) return fallback("NavBot has been used a lot this hour. Try again later.", "QUOTA");

  _lastCallMs = now;
  _hourBucket.count++;

  try {
    // Ensure places are loaded before building the prompt
    let places = getPlaces();
    if (places.length === 0) {
      places = await loadPlaces();
    }

    const prompt = buildPrompt(question, places);
    const model  = getModel();

    const result = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);

    if (!result?.response) {
      if (__DEV__) console.warn("[navbot] no response object returned");
      return fallback("NavBot returned an empty response. Try searching instead.", "EMPTY_RESPONSE");
    }

    const raw = result.response.text();

    // Log raw response in dev to diagnose parsing issues
    if (__DEV__) console.log("[navbot] raw response:", raw.substring(0, 300));

    // Strip markdown code fences if model wraps JSON in them
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (parseErr) {
      if (__DEV__) console.warn("[navbot] JSON parse failed:", parseErr.message, "| raw:", cleaned.substring(0, 200));
      return fallback("NavBot returned an unexpected response. Try searching instead.", "PARSE_ERROR");
    }

    // Validate IDs — but log when we strip to help debug
    const validIds = new Set(places.map(p => p.id));
    const allIds   = data.placeIds ?? [];
    const placeIds = allIds.filter(id => validIds.has(id));

    if (__DEV__ && allIds.length !== placeIds.length) {
      console.warn("[navbot] stripped unknown IDs:", allIds.filter(id => !validIds.has(id)));
      console.warn("[navbot] valid IDs in dataset:", [...validIds].slice(0, 5), "...");
    }

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
    if (__DEV__) console.warn("[navbot] caught error:", err.message, "| code:", err.code, "| name:", err.name);

    if (err.message === "TIMEOUT")
      return fallback("NavBot is taking too long. Try searching instead.", "TIMEOUT");
    if (err.message?.includes("429") || err.message?.toLowerCase().includes("quota"))
      return fallback("NavBot is busy right now. Try searching instead.", "RATE_LIMIT");
    return fallback("NavBot is unavailable. Try searching instead.", "ERROR");
  }
}

export function isNavBotAvailable() {
  return !!(process.env.EXPO_PUBLIC_NAVBOT_MODEL && auth.currentUser);
}

export function clearNavBotCache() {
  _cache.clear();
  _model = null;
}
