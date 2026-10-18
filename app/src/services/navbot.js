/**
 * src/services/navbot.js
 * NavBot — AI campus assistant via Firebase AI Logic (Gemini).
 */

import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { app, auth } from "../config/firebase";
import { loadPlaces, getPlaces, getPlaceById } from "./places";
import { search } from "./search";

const SYSTEM_PROMPT = `You are NavBot, the campus guide for NavCamp at Veritas University Abuja.
Answer ONLY using the places data provided. If not in the data, say you don't know.
Never invent room numbers, names, or hours.
Always reply with valid JSON only — no extra text, no markdown fences.
Keep the message field under 40 words. Be friendly and direct.`;

let _model      = null;
let _lastCallMs = 0;
let _hourBucket = { hour: -1, count: 0 };
const _cache    = new Map();
const COOLDOWN   = 2000;   // reduced from 3s
const HOUR_LIMIT = 20;
const TIMEOUT_MS = 25000; // 25s — generous for slow connections

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
  const s = {
    id:          place.id,
    name:        place.name,
    category:    place.category,
    scope:       place.scope,
  };
  if (place.buildingName) s.buildingName = place.buildingName;
  if (place.floor != null) s.floor = place.floor;
  if (place.room && place.room !== place.name) s.room = place.room;
  if (place.aliases?.length)   s.aliases   = place.aliases;
  if (place.people?.length)    s.people    = place.people;
  if (place.courses?.length)   s.courses   = place.courses;
  if (place.questions?.length) s.questions = place.questions;
  if (place.hours)             s.hours     = place.hours;
  if (place.hint)              s.hint      = place.hint;
  return s;
}

function buildPrompt(question, allPlaces) {
  // Always send top search results for the question (max 15)
  // plus all indoor places (they're the ones that need context)
  const searchResults = search(question, { limit: 15 });
  const indoor = allPlaces.filter(p => p.scope === "indoor");

  // Merge, deduplicate by id
  const seen = new Set();
  const relevant = [];
  for (const p of [...searchResults, ...indoor]) {
    if (!seen.has(p.id)) { seen.add(p.id); relevant.push(p); }
  }

  const data = JSON.stringify(relevant.map(slim));

  return `You have ${allPlaces.length} campus places total. Here are the most relevant ones for this question:
${data}

Respond with this exact JSON schema:
{"intent":"find_place","message":"<under 40 words>","placeIds":["<id from data>"],"followUps":["<question>"]}

Question: ${question}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
  ]);
}

function cacheKey(q) { return q.trim().toLowerCase(); }
function addToCache(key, val) {
  if (_cache.size >= 50) _cache.delete(_cache.keys().next().value);
  _cache.set(key, val);
}

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

  let places = getPlaces();
  if (places.length === 0) places = await loadPlaces();

  const prompt = buildPrompt(question, places);
  const model  = getModel();

  console.log("[navbot] sending prompt, relevant places count:", prompt.split('"id"').length - 1);

  let result;
  try {
    result = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);
  } catch (callErr) {
    console.warn("[navbot] generateContent failed:", callErr?.message);
    if (callErr?.message === "TIMEOUT")
      return fallback("NavBot is taking too long. Try searching instead.", "TIMEOUT");
    return fallback("NavBot is unavailable. Try searching instead.", "CALL_ERROR");
  }

  let raw = "";
  try {
    raw = result?.response?.text() ?? "";
    console.log("[navbot] response:", raw.substring(0, 200));
  } catch (textErr) {
    console.warn("[navbot] response.text() failed:", textErr?.message);
    return fallback("NavBot returned an unreadable response.", "TEXT_ERROR");
  }

  if (!raw.trim()) {
    console.warn("[navbot] empty response");
    return fallback("NavBot returned an empty response.", "EMPTY");
  }

  let data;
  try {
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    data = JSON.parse(cleaned);
  } catch (parseErr) {
    console.warn("[navbot] JSON parse failed:", parseErr?.message, "| raw:", raw.substring(0, 150));
    return fallback("NavBot returned an unexpected response. Try searching instead.", "PARSE_ERROR");
  }

  const validIds = new Set(places.map(p => p.id));
  const placeIds = (data.placeIds ?? []).filter(id => {
    const valid = validIds.has(id);
    if (!valid) console.warn("[navbot] stripped unknown id:", id);
    return valid;
  });
  const resolved = placeIds.map(id => getPlaceById(id)).filter(Boolean);

  const response = {
    ok: true,
    intent:    data.intent    ?? "unknown",
    message:   data.message   ?? "",
    placeIds,
    places:    resolved,
    followUps: data.followUps ?? [],
    cached:    false,
  };

  addToCache(key, response);
  return response;
}

export function isNavBotAvailable() {
  return !!(process.env.EXPO_PUBLIC_NAVBOT_MODEL && auth.currentUser);
}

export function clearNavBotCache() {
  _cache.clear();
  _model = null;
}
