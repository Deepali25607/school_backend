// School-bus routes & stops. Each route carries:
//   - a Bus (id, plate, capacity, driver, helper)
//   - an ordered list of Stops, each with name, ETA, students, and an (x, y)
//     position on the 1000×600 viewBox map the frontend renders
//
// The last stop is conventionally the school itself ({ school: true }).
//
// Coordinates are kept inside the viewBox margins (60..940 horizontally,
// 60..540 vertically) so the SVG map stays readable.

const store = require("./store");

const VIEWBOX_W = 1000;
const VIEWBOX_H = 600;
const X_MIN = 60;
const X_MAX = 940;
const Y_MIN = 60;
const Y_MAX = 540;

const SCHOOL_X = 920;
const SCHOOL_Y = 300;

const PALETTE = [
  "#5b81ff", "#ff5ec4", "#5cf2c4", "#ffd166",
  "#9b5cff", "#3ad6ff", "#ff8b5c", "#86ff9d",
  "#c4a7e7", "#f6c177",
];

const STOPS_POOL = [
  "Central Square", "Park Avenue", "Riverside", "Hilltop", "Lakeview",
  "Tech Park", "Mall Plaza", "Old Town", "Sunrise Colony", "Greenfield",
  "Maple Street", "Crescent", "Marina Drive", "Sunset Blvd", "North Gate",
  "South Junction", "East Loop", "West Wing", "Garden Estate", "Stadium",
];

const DRIVERS_POOL = [
  "Anand R.", "Suresh K.", "Mahesh P.", "Vijay S.",
  "Rajan M.", "Kishore D.", "Pankaj T.", "Hari N.",
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pickFrom(arr, r) {
  return arr[Math.floor(r() * arr.length)];
}

function buildSeed() {
  const routes = [];
  for (let i = 1; i <= 8; i++) {
    const r = rng(1000 + i);
    const numStops = 4 + Math.floor(r() * 4);
    const usedStops = new Set();
    const stops = [];
    let x = 80 + Math.floor(r() * 200);
    let y = 80 + Math.floor(r() * 100);
    for (let k = 0; k < numStops; k++) {
      let name;
      do {
        name = pickFrom(STOPS_POOL, r);
      } while (usedStops.has(name));
      usedStops.add(name);
      stops.push({
        name,
        eta: `${7 + Math.floor(k * 0.4)}:${String(15 + k * 7).slice(0, 2).padStart(2, "0")}`,
        x: Math.round(x),
        y: Math.round(y),
        students: 2 + Math.floor(r() * 6),
      });
      x += 80 + Math.floor(r() * 100);
      y += (k % 2 === 0 ? 40 : -40) + Math.floor(r() * 60 - 30);
      y = clamp(y, Y_MIN, Y_MAX);
      x = clamp(x, X_MIN, X_MAX);
    }
    stops.push({
      name: "Lumina School",
      eta: `${7 + Math.floor(numStops * 0.4) + 1}:30`,
      x: SCHOOL_X,
      y: SCHOOL_Y,
      students: 0,
      school: true,
    });
    routes.push({
      id: `RT${100 + i}`,
      name: `Route ${i}`,
      color: PALETTE[(i - 1) % PALETTE.length],
      bus: {
        id: `BUS-${1000 + i}`,
        plate: `KA-01-${String(1000 + i * 11)}`,
        capacity: 32,
        driver: DRIVERS_POOL[(i - 1) % DRIVERS_POOL.length],
        helper: "Ramesh",
      },
      stops,
      totalStudents: stops.reduce((a, s) => a + s.students, 0),
      progress: Math.round(r() * 100) / 100,
      status: r() > 0.85 ? "Delayed" : "On schedule",
      lastPing: `${1 + Math.floor(r() * 4)} min ago`,
    });
  }
  return routes;
}

let routes = store.load("transport-routes", buildSeed);
const persist = () => store.save("transport-routes", routes);

// ---- helpers ----

function recomputeTotals(route) {
  route.totalStudents = route.stops.reduce(
    (a, s) => a + (Number(s.students) || 0),
    0
  );
  // bus capacity sanity (cosmetic — UI surfaces it)
  if (route.bus && route.bus.capacity && route.totalStudents > route.bus.capacity) {
    route.over = true;
  } else {
    route.over = false;
  }
}

function nextRouteId() {
  let max = 100;
  for (const r of routes) {
    const n = parseInt(String(r.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `RT${max + 1}`;
}

function nextBusId() {
  let max = 1000;
  for (const r of routes) {
    const n = parseInt(String(r.bus?.id || "").replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `BUS-${max + 1}`;
}

function nextColor() {
  const used = new Set(routes.map((r) => r.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[routes.length % PALETTE.length];
}

function validateStop(s, { partial = false } = {}) {
  if (!partial && !s.name) throw new Error("stop.name required");
  if (s.eta !== undefined && !/^\d{1,2}:\d{2}$/.test(s.eta))
    throw new Error("stop.eta must be H:MM or HH:MM");
  if (s.students !== undefined) {
    const n = Number(s.students);
    if (!Number.isInteger(n) || n < 0 || n > 200)
      throw new Error("stop.students must be 0-200");
  }
  if (s.x !== undefined) {
    const x = Number(s.x);
    if (!Number.isFinite(x) || x < 0 || x > VIEWBOX_W)
      throw new Error(`stop.x must be 0-${VIEWBOX_W}`);
  }
  if (s.y !== undefined) {
    const y = Number(s.y);
    if (!Number.isFinite(y) || y < 0 || y > VIEWBOX_H)
      throw new Error(`stop.y must be 0-${VIEWBOX_H}`);
  }
}

function normalizeStop(s, idx) {
  return {
    name: String(s.name).trim(),
    eta: s.eta || `${7 + Math.floor(idx * 0.4)}:${String(15 + idx * 7).slice(-2).padStart(2, "0")}`,
    x: clamp(Math.round(Number(s.x ?? X_MIN + idx * 100)), X_MIN, X_MAX),
    y: clamp(Math.round(Number(s.y ?? Y_MIN + (idx % 2 === 0 ? 80 : 200))), Y_MIN, Y_MAX),
    students: Number(s.students ?? 0),
    school: !!s.school,
  };
}

function ensureSchoolAtEnd(stops) {
  // Strip any school entries the caller passed mid-list, then re-append one.
  const cleaned = stops.filter((s) => !s.school);
  cleaned.push({
    name: "Lumina School",
    eta: cleaned.length
      ? `${7 + Math.floor(cleaned.length * 0.4) + 1}:30`
      : "8:00",
    x: SCHOOL_X,
    y: SCHOOL_Y,
    students: 0,
    school: true,
  });
  return cleaned;
}

function validateRoute(payload, { partial = false } = {}) {
  if (!partial) {
    if (!payload.name) throw new Error("name required");
    if (!Array.isArray(payload.stops) || payload.stops.length === 0)
      throw new Error("stops must be a non-empty array");
  }
  if (payload.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(payload.color))
    throw new Error("color must be a #RRGGBB hex string");
  if (payload.bus !== undefined) {
    const b = payload.bus;
    if (b.capacity !== undefined) {
      const c = Number(b.capacity);
      if (!Number.isInteger(c) || c < 1 || c > 80)
        throw new Error("bus.capacity must be 1-80");
    }
  }
  if (payload.stops !== undefined) {
    for (const s of payload.stops) validateStop(s);
  }
}

// ---- public API ----

function list() {
  return routes;
}

function get(id) {
  return routes.find((r) => r.id === id) || null;
}

function addRoute(payload) {
  validateRoute(payload);
  const stops = ensureSchoolAtEnd(
    payload.stops.map((s, i) => normalizeStop(s, i))
  );
  const route = {
    id: nextRouteId(),
    name: String(payload.name).trim(),
    color: payload.color || nextColor(),
    bus: {
      id: payload.bus?.id || nextBusId(),
      plate: payload.bus?.plate || "KA-01-0000",
      capacity:
        payload.bus?.capacity !== undefined ? Number(payload.bus.capacity) : 32,
      driver: payload.bus?.driver || "TBD",
      helper: payload.bus?.helper || "",
    },
    stops,
    progress: 0,
    status: "On schedule",
    lastPing: "just now",
  };
  recomputeTotals(route);
  routes.push(route);
  persist();
  return route;
}

function updateRoute(id, patch) {
  const r = routes.find((x) => x.id === id);
  if (!r) throw new Error("Route not found");
  validateRoute(patch, { partial: true });
  if (patch.name !== undefined) r.name = String(patch.name).trim();
  if (patch.color !== undefined) r.color = patch.color;
  if (patch.status !== undefined) r.status = patch.status;
  if (patch.bus !== undefined) {
    r.bus = {
      ...r.bus,
      ...patch.bus,
      capacity:
        patch.bus.capacity !== undefined
          ? Number(patch.bus.capacity)
          : r.bus.capacity,
    };
  }
  if (patch.stops !== undefined) {
    r.stops = ensureSchoolAtEnd(
      patch.stops.map((s, i) => normalizeStop(s, i))
    );
  }
  recomputeTotals(r);
  persist();
  return r;
}

function removeRoute(id) {
  const idx = routes.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Route not found");
  const [removed] = routes.splice(idx, 1);
  persist();
  return removed;
}

function addStop(routeId, stop) {
  const r = routes.find((x) => x.id === routeId);
  if (!r) throw new Error("Route not found");
  validateStop(stop);
  if (stop.school) throw new Error("Use a normal stop — school is automatic");
  // Insert before the school marker so school stays last.
  const schoolIdx = r.stops.findIndex((s) => s.school);
  const insertAt = schoolIdx >= 0 ? schoolIdx : r.stops.length;
  r.stops.splice(insertAt, 0, normalizeStop(stop, insertAt));
  recomputeTotals(r);
  persist();
  return r;
}

function updateStop(routeId, index, patch) {
  const r = routes.find((x) => x.id === routeId);
  if (!r) throw new Error("Route not found");
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= r.stops.length)
    throw new Error("Stop index out of range");
  const cur = r.stops[idx];
  if (cur.school)
    throw new Error("School stop position is fixed");
  validateStop({ ...cur, ...patch }, { partial: true });
  r.stops[idx] = normalizeStop({ ...cur, ...patch }, idx);
  recomputeTotals(r);
  persist();
  return r;
}

function removeStop(routeId, index) {
  const r = routes.find((x) => x.id === routeId);
  if (!r) throw new Error("Route not found");
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= r.stops.length)
    throw new Error("Stop index out of range");
  if (r.stops[idx].school)
    throw new Error("Cannot remove the school stop");
  if (r.stops.filter((s) => !s.school).length <= 1)
    throw new Error("A route needs at least one pickup stop");
  const [removed] = r.stops.splice(idx, 1);
  recomputeTotals(r);
  persist();
  return { route: r, removed };
}

function summary() {
  return {
    routes: routes.length,
    students: routes.reduce((a, r) => a + (r.totalStudents || 0), 0),
    onSchedule: routes.filter((r) => r.status === "On schedule").length,
    delayed: routes.filter((r) => r.status === "Delayed").length,
  };
}

// ---- per-student assignment ----
// A student's bus assignment is stored on the student record as
// { routeId, stopName } (set manually when enrolling/editing the student) and
// resolved here into a rich object for display. Legacy seeded students that
// predate this field have NO `transport` property; for them we fall back to a
// deterministic derivation from the id so their profile isn't suddenly blank.
function hashStr(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function shapeAssignment(route, stop, pickups) {
  return {
    routeId: route.id,
    routeName: route.name,
    color: route.color,
    status: route.status,
    bus: {
      id: route.bus?.id || null,
      plate: route.bus?.plate || null,
      driver: route.bus?.driver || null,
      helper: route.bus?.helper || null,
      capacity: route.bus?.capacity || null,
    },
    stop: {
      name: stop.name,
      eta: stop.eta,
      order: route.stops.indexOf(stop) + 1,
    },
    totalStops: pickups.length,
  };
}

// Resolve a stored { routeId, stopName } into the display object. Returns null
// if the route was since deleted or has no pickup stops.
function resolveAssignment(routeId, stopName) {
  const route = routes.find((r) => r.id === routeId);
  if (!route) return null;
  const pickups = route.stops.filter((s) => !s.school);
  if (pickups.length === 0) return null;
  const stop = pickups.find((s) => s.name === stopName) || pickups[0];
  return shapeAssignment(route, stop, pickups);
}

function studentAssignment(student, opts = {}) {
  if (!student || !student.id) return null;
  // Explicit, manually-set assignment takes priority.
  if (student.transport !== undefined) {
    if (!student.transport || !student.transport.routeId) return null;
    return resolveAssignment(student.transport.routeId, student.transport.stopName);
  }
  // Legacy seeded students (no transport field): derive deterministically.
  // Boarders and ~30% of the rest are treated as non-transport.
  if (opts.isResident) return null;
  const h = hashStr(student.id);
  if (h % 10 < 3) return null;
  if (routes.length === 0) return null;
  const route = routes[h % routes.length];
  const pickups = route.stops.filter((s) => !s.school);
  if (pickups.length === 0) return null;
  const stop = pickups[(h >>> 4) % pickups.length];
  return shapeAssignment(route, stop, pickups);
}

module.exports = {
  get routes() { return routes; },
  PALETTE,
  STOPS_POOL,
  list,
  get,
  addRoute,
  updateRoute,
  removeRoute,
  addStop,
  updateStop,
  removeStop,
  summary,
  studentAssignment,
  resolveAssignment,
};
