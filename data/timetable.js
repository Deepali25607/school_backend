const store = require("./store");

const SUBJECTS = [
  "Mathematics",
  "English",
  "Physics",
  "Chemistry",
  "Biology",
  "History",
  "Geography",
  "Computer Sci",
  "PE",
  "Art",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PERIODS = [
  { p: 1, start: "08:00", end: "08:45" },
  { p: 2, start: "08:50", end: "09:35" },
  { p: 3, start: "09:40", end: "10:25" },
  { p: 4, start: "10:45", end: "11:30" },
  { p: 5, start: "11:35", end: "12:20" },
  { p: 6, start: "13:00", end: "13:45" },
  { p: 7, start: "13:50", end: "14:35" },
];

// deterministic but varied per (grade, section, day, period)
function hash(...args) {
  let h = 17;
  for (const v of args) {
    const s = String(v);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Persistent per-cell overrides. Keyed by "grade-section-day-period".
// Each override is { subject, teacherId, room } — any subset applies on top
// of the deterministic default below.
let overrides = store.load("timetable-overrides", () => ({}));
const persistOverrides = () => store.save("timetable-overrides", overrides);
const cellKey = (g, s, d, p) => `${g}-${s}-${d}-${p}`;

// Listeners that need to know when the timetable mutates (e.g. the substitute
// module caches an index of teacher → slots and must rebuild on change).
const invalidationListeners = new Set();
function onChange(fn) {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}
function notifyChange() {
  for (const fn of invalidationListeners) {
    try { fn(); } catch {}
  }
}

function buildGrid(grade, section) {
  return DAYS.map((day) => ({
    day,
    periods: PERIODS.map((slot) => {
      const seed = hash(grade, section, day, slot.p);
      // Lunch break placeholder between period 5 and 6 is implicit (gap 12:20-13:00).
      let subject = SUBJECTS[seed % SUBJECTS.length];
      let teacherId = `TCH${101 + ((seed >>> 3) % 24)}`;
      let room = `R-${100 + ((seed >>> 6) % 30)}`;
      const ov = overrides[cellKey(grade, section, day, slot.p)];
      let overridden = false;
      if (ov) {
        if (ov.subject) subject = ov.subject;
        if (ov.teacherId) teacherId = ov.teacherId;
        if (ov.room) room = ov.room;
        overridden = true;
      }
      return {
        ...slot,
        subject,
        teacherId,
        room,
        overridden,
      };
    }),
  }));
}

function setOverride(grade, section, day, period, patch) {
  if (!DAYS.includes(day)) throw new Error("Invalid day");
  if (!Number.isInteger(grade) || grade < 1 || grade > 12)
    throw new Error("Invalid grade");
  if (!["A", "B", "C", "D"].includes(section))
    throw new Error("Invalid section");
  if (!Number.isInteger(period) || period < 1 || period > PERIODS.length)
    throw new Error("Invalid period");
  if (patch.subject && !SUBJECTS.includes(patch.subject))
    throw new Error(`subject must be one of ${SUBJECTS.join(", ")}`);
  const key = cellKey(grade, section, day, period);
  const existing = overrides[key] || {};
  const next = { ...existing };
  for (const k of ["subject", "teacherId", "room"]) {
    if (patch[k] !== undefined) next[k] = patch[k] || undefined;
  }
  // If nothing is set, drop the entry — we don't want empty objects littering disk.
  if (!next.subject && !next.teacherId && !next.room) {
    delete overrides[key];
  } else {
    overrides[key] = next;
  }
  persistOverrides();
  notifyChange();
  return next;
}

function clearOverride(grade, section, day, period) {
  const key = cellKey(grade, section, day, period);
  const had = !!overrides[key];
  delete overrides[key];
  if (had) {
    persistOverrides();
    notifyChange();
  }
  return had;
}

function clearClass(grade, section) {
  const prefix = `${grade}-${section}-`;
  let removed = 0;
  for (const key of Object.keys(overrides)) {
    if (key.startsWith(prefix)) {
      delete overrides[key];
      removed++;
    }
  }
  if (removed > 0) {
    persistOverrides();
    notifyChange();
  }
  return removed;
}

function listOverrides() {
  return Object.entries(overrides).map(([key, value]) => {
    const [g, s, d, p] = key.split("-");
    return {
      key,
      grade: Number(g),
      section: s,
      day: d,
      period: Number(p),
      ...value,
    };
  });
}

module.exports = {
  DAYS,
  PERIODS,
  SUBJECTS,
  buildGrid,
  setOverride,
  clearOverride,
  clearClass,
  listOverrides,
  onChange,
};
