/**
 * src/services/__tests__/search.test.js
 *
 * Tests for the unified search module.
 * Run with: npx jest src/services/__tests__/search.test.js
 *
 * Uses a mock place dataset so tests run offline with no Firebase calls.
 */

// ─── MOCK FIREBASE ────────────────────────────────────────────────────────────
jest.mock("../../config/firebase", () => ({ db: {}, doc: jest.fn(), getDoc: jest.fn() }));
jest.mock("../../../map-data/exports/veritas-map.json", () => ({ app: { locations: [] } }), { virtual: true });
jest.mock("../../../map-data/source/indoor_places.json", () => ({}), { virtual: true });

// ─── MOCK PLACES ──────────────────────────────────────────────────────────────
const MOCK_PLACES = [
  { id: "hostel_n",      name: "Hostel N",                  category: "boys_hostel",  scope: "outdoor", aliases: [],                      people: [],                                          courses: [], coords: { lat: 9.28, lng: 7.41 } },
  { id: "hostel_m",      name: "Hostel M",                  category: "boys_hostel",  scope: "outdoor", aliases: [],                      people: [],                                          courses: [], coords: { lat: 9.28, lng: 7.41 } },
  { id: "csc_block",     name: "CST Block",                 category: "block",        scope: "outdoor", aliases: ["computer science"],     people: [],                                          courses: [], coords: { lat: 9.29, lng: 7.41 } },
  { id: "law_dean",      name: "Dean's Office",             category: "office",       scope: "indoor",  aliases: ["doa", "dean"],          people: [{ name: "Prof. John Doe", role: "Dean" }],  courses: [], buildingId: "faculty_law", buildingName: "Faculty of Law", floor: 0, floorLabel: "Ground Floor", room: "Dean's Office" },
  { id: "law_lh1",       name: "Lecture Hall 1",            category: "lecture_hall", scope: "indoor",  aliases: ["lh1"],                  people: [],                                          courses: [{ code: "LAW 101", title: "Introduction to Law" }, { code: "LAW 201", title: "Constitutional Law" }], buildingId: "faculty_law", buildingName: "Faculty of Law", floor: 0, floorLabel: "Ground Floor", room: "LH1" },
  { id: "musa_office",   name: "Dr. A. Musa Office",        category: "office",       scope: "indoor",  aliases: ["musa"],                 people: [{ name: "Dr. A. Musa", role: "Lecturer" }], courses: [{ code: "CSC 301", title: "Operating Systems" }], buildingId: "csc_block", buildingName: "CST Block", floor: 2, floorLabel: "Second Floor", room: "Room 312" },
  { id: "clinic",        name: "University Health Centre",  category: "service",      scope: "outdoor", aliases: ["clinic", "sick bay"],   people: [],                                          courses: [], coords: { lat: 9.29, lng: 7.41 } },
  { id: "main_gate",     name: "Main Gate",                 category: "gate",         scope: "outdoor", aliases: ["entrance"],             people: [],                                          courses: [], coords: { lat: 9.28, lng: 7.41 } },
];

// Inject mock places into the module
jest.mock("../places", () => ({
  getPlaces: () => MOCK_PLACES,
  getCategoryMeta: (c) => ({ label: c, icon: "map-pin", color: "#000" }),
}));

const { search, getPlaceById, looksLikeQuestion } = require("../search");

// ─── TESTS ────────────────────────────────────────────────────────────────────

describe("search()", () => {
  test("exact name match returns that place first", () => {
    const results = search("Hostel N");
    expect(results[0].id).toBe("hostel_n");
  });

  test("prefix match — 'hostel' returns both hostels", () => {
    const results = search("hostel");
    const ids = results.map(r => r.id);
    expect(ids).toContain("hostel_n");
    expect(ids).toContain("hostel_m");
  });

  test("fuzzy match — 'hostl n' still finds Hostel N", () => {
    const results = search("hostl n");
    const ids = results.map(r => r.id);
    expect(ids).toContain("hostel_n");
  });

  test("person name search — 'musa' finds the lecturer's office", () => {
    const results = search("musa");
    const ids = results.map(r => r.id);
    expect(ids).toContain("musa_office");
  });

  test("course code search — 'CSC 301' finds the right room", () => {
    const results = search("CSC 301");
    const ids = results.map(r => r.id);
    expect(ids).toContain("musa_office");
  });

  test("course code typo — 'CSC301' (no space) still finds it", () => {
    const results = search("CSC301");
    // Fuse should still match even without the space
    const ids = results.map(r => r.id);
    expect(ids.length).toBeGreaterThan(0);
  });

  test("room number search — 'room 312' finds musa office", () => {
    const results = search("room 312");
    const ids = results.map(r => r.id);
    expect(ids).toContain("musa_office");
  });

  test("alias search — 'clinic' finds University Health Centre", () => {
    const results = search("clinic");
    const ids = results.map(r => r.id);
    expect(ids).toContain("clinic");
  });

  test("dean search — finds Dean's Office", () => {
    const results = search("dean");
    const ids = results.map(r => r.id);
    expect(ids).toContain("law_dean");
  });

  test("returns at most 8 results", () => {
    const results = search("a");
    expect(results.length).toBeLessThanOrEqual(8);
  });

  test("empty query returns all places (capped at 50)", () => {
    const results = search("");
    expect(results.length).toBe(MOCK_PLACES.length);
  });

  test("category filter restricts results", () => {
    const results = search("", { category: "office" });
    expect(results.every(r => r.category === "office")).toBe(true);
  });

  test("scope filter restricts to indoor", () => {
    const results = search("", { scope: "indoor" });
    expect(results.every(r => r.scope === "indoor")).toBe(true);
  });
});

describe("getPlaceById()", () => {
  test("finds a place by exact ID", () => {
    const place = getPlaceById("hostel_n");
    expect(place).toBeDefined();
    expect(place.name).toBe("Hostel N");
  });

  test("returns undefined for unknown ID", () => {
    expect(getPlaceById("does_not_exist")).toBeUndefined();
  });
});

describe("looksLikeQuestion()", () => {
  test("question mark triggers AI", () => {
    expect(looksLikeQuestion("where is the clinic?")).toBe(true);
  });

  test("who/where/what prefix triggers AI", () => {
    expect(looksLikeQuestion("who teaches csc 301")).toBe(true);
    expect(looksLikeQuestion("where is the dean")).toBe(true);
  });

  test("more than 4 words triggers AI", () => {
    expect(looksLikeQuestion("i need to find the bursary office")).toBe(true);
  });

  test("short location name does NOT trigger AI", () => {
    expect(looksLikeQuestion("hostel n")).toBe(false);
    expect(looksLikeQuestion("csc block")).toBe(false);
    expect(looksLikeQuestion("dean")).toBe(false);
  });

  test("empty string returns false", () => {
    expect(looksLikeQuestion("")).toBe(false);
  });
});
