// Sports & Co-curricular Achievements — positive recognition log.
// Each achievement records: who won what, in what category, at what level,
// and what position. Tied to a student so the 360° profile + reports can
// aggregate naturally.

const store = require("./store");
const seed = require("./seed");

const CATEGORIES = [ 
  "Sports",
  "Academic",
  "Arts",
  "Cultural",
  "Leadership",
  "Community Service",
  "Olympiad",
  "Debate",
];

const LEVELS = [
  "School",
  "Inter-school",
  "District",
  "State",
  "National",
  "International",
];

const POSITIONS = ["1st", "2nd", "3rd", "Finalist", "Participation"];

// Visual + scoring weight per level
const LEVEL_POINTS = {
  School: 5,
  "Inter-school": 10,
  District: 20,
  State: 40,
  National: 80,
  International: 150,
};

const POSITION_MULTIPLIER = {
  "1st": 1.0,
  "2nd": 0.7,
  "3rd": 0.5,
  Finalist: 0.3,
  Participation: 0.1,
};

const EVENTS_BY_CATEGORY = {
  Sports: [
    "Annual Athletic Meet · 100m sprint",
    "Annual Athletic Meet · Long jump",
    "Annual Athletic Meet · High jump",
    "Annual Athletic Meet · Relay 4x100",
    "Inter-school Football Cup",
    "Inter-school Basketball Tournament",
    "Inter-school Cricket League",
    "Swimming Championship · Freestyle 50m",
    "Swimming Championship · Butterfly 100m",
    "Table Tennis Championship",
    "Badminton Singles",
    "Chess Tournament",
    "Yoga competition",
  ],
  Academic: [
    "Mathematics Quiz Bowl",
    "Science Fair · Project showcase",
    "Spell-it competition",
    "Geography Bee",
  ],
  Arts: [
    "Painting competition · Theme: Climate",
    "Sketching competition",
    "Solo singing · Hindi classical",
    "Solo singing · Western contemporary",
    "Solo dance · Bharatanatyam",
    "Solo dance · Contemporary",
    "Drama festival · Solo monologue",
    "Photography contest",
  ],
  Cultural: [
    "Annual Day · Group dance",
    "Cultural festival · Musical instrument solo",
    "Independence Day skit",
    "Folk dance competition",
  ],
  Leadership: [
    "Elected House Captain",
    "Sports Prefect of the Year",
    "Cultural Secretary",
    "Model UN · Best Delegate",
    "Student Council President",
  ],
  "Community Service": [
    "Tree plantation drive · 50+ saplings",
    "Beach cleanup volunteer · 20 hours",
    "Old age home visit · monthly",
    "Blood donation camp coordinator",
  ],
  Olympiad: [
    "International Math Olympiad",
    "National Science Olympiad",
    "Cyber Olympiad",
    "English Olympiad",
  ],
  Debate: [
    "Annual Debate · English",
    "Annual Debate · Hindi",
    "Inter-school MUN",
    "Parliamentary debate",
  ],
};

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const pick = (arr, ...parts) => arr[hash(...parts) % arr.length];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function pointsFor(level, position) {
  return Math.round(
    (LEVEL_POINTS[level] || 5) * (POSITION_MULTIPLIER[position] || 0.1)
  );
}

function buildSeed() {
  // Generate ~30 diverse achievements across the roster.
  const out = [];
  for (let i = 0; i < 30; i++) {
    const s = seed.students[hash("ach", i) % seed.students.length];
    const category = CATEGORIES[hash("cat", i) % CATEGORIES.length];
    const event = pick(EVENTS_BY_CATEGORY[category] || ["—"], "evt", i);
    const level = LEVELS[hash("lvl", i) % LEVELS.length];
    const position = POSITIONS[hash("pos", i) % POSITIONS.length];
    const daysAgo = hash("date", i) % 240; // within last ~8 months
    out.push({
      id: `ACH${String(5000 + i + 1)}`,
      studentId: s.id,
      title: event,
      category,
      level,
      position,
      event,
      awardedBy: pick(
        [
          "Principal's Office",
          "Sports Department",
          "Cultural Committee",
          "Academic Coordinator",
          "Olympiad Cell",
          "External Organisation",
        ],
        "by",
        i
      ),
      date: dateOffset(daysAgo),
      points: pointsFor(level, position),
      certificate: position !== "Participation" || hash("cert", i) % 2 === 0,
      description:
        position === "Participation"
          ? `Participated in ${event}`
          : `Awarded ${position} place at ${event} (${level} level)`,
    });
  }
  // newest first
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}

let items = store.load("achievements", buildSeed);
const persist = () => store.save("achievements", items);

function list({ q, category, level, position, studentId, sinceDays } = {}) {
  let out = items.slice();
  if (category && category !== "all") out = out.filter((a) => a.category === category);
  if (level && level !== "all") out = out.filter((a) => a.level === level);
  if (position && position !== "all") out = out.filter((a) => a.position === position);
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (sinceDays) {
    const cutoff = Date.now() - Number(sinceDays) * 86400000;
    out = out.filter((a) => new Date(a.date).getTime() >= cutoff);
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (a) =>
        a.id.toLowerCase().includes(t) ||
        a.studentId.toLowerCase().includes(t) ||
        a.title.toLowerCase().includes(t) ||
        a.category.toLowerCase().includes(t) ||
        a.event.toLowerCase().includes(t)
    );
  }
  return out;
}

function get(id) {
  return items.find((a) => a.id === id) || null;
}

function add(payload) {
  if (!payload.studentId) throw new Error("studentId required");
  if (!payload.title) throw new Error("title required");
  const category = CATEGORIES.includes(payload.category)
    ? payload.category
    : "Sports";
  const level = LEVELS.includes(payload.level) ? payload.level : "School";
  const position = POSITIONS.includes(payload.position)
    ? payload.position
    : "Participation";
  const a = {
    id: `ACH${String(5000 + items.length + 1)}`,
    studentId: payload.studentId,
    title: payload.title,
    category,
    level,
    position,
    event: payload.event || payload.title,
    awardedBy: payload.awardedBy || "Principal's Office",
    date: payload.date || dateOffset(0),
    points: pointsFor(level, position),
    certificate: payload.certificate !== false,
    description: payload.description || `${position} place at ${payload.title}`,
  };
  items.unshift(a);
  persist();
  return a;
}

function update(id, patch) {
  const a = items.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  const ALLOWED = [
    "title",
    "category",
    "level",
    "position",
    "event",
    "awardedBy",
    "date",
    "certificate",
    "description",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) a[k] = patch[k];
  // Recompute points if level/position changed
  a.points = pointsFor(a.level, a.position);
  persist();
  return a;
}

function remove(id) {
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = items.splice(idx, 1);
  persist();
  return removed;
}

function studentTally(studentId) {
  const own = items.filter((a) => a.studentId === studentId);
  return {
    total: own.length,
    points: own.reduce((s, a) => s + a.points, 0),
    gold: own.filter((a) => a.position === "1st").length,
    silver: own.filter((a) => a.position === "2nd").length,
    bronze: own.filter((a) => a.position === "3rd").length,
    byCategory: CATEGORIES.reduce((acc, c) => {
      acc[c] = own.filter((a) => a.category === c).length;
      return acc;
    }, {}),
    items: own,
  };
}

function topStudents(limit = 10) {
  const byStudent = new Map();
  for (const a of items) {
    const cur = byStudent.get(a.studentId) || { points: 0, count: 0, gold: 0 };
    cur.points += a.points;
    cur.count++;
    if (a.position === "1st") cur.gold++;
    byStudent.set(a.studentId, cur);
  }
  return [...byStudent.entries()]
    .map(([studentId, v]) => ({ studentId, ...v }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

function summary() {
  const out = { total: items.length };
  const thisYear = new Date().getFullYear();
  out.thisYear = items.filter(
    (a) => new Date(a.date).getFullYear() === thisYear
  ).length;
  out.gold = items.filter((a) => a.position === "1st").length;
  out.silver = items.filter((a) => a.position === "2nd").length;
  out.bronze = items.filter((a) => a.position === "3rd").length;
  out.national = items.filter(
    (a) => a.level === "National" || a.level === "International"
  ).length;
  out.byCategory = CATEGORIES.reduce((acc, c) => {
    acc[c] = items.filter((a) => a.category === c).length;
    return acc;
  }, {});
  out.byLevel = LEVELS.reduce((acc, l) => {
    acc[l] = items.filter((a) => a.level === l).length;
    return acc;
  }, {});
  return out;
}

module.exports = {
  CATEGORIES,
  LEVELS,
  POSITIONS,
  LEVEL_POINTS,
  achievements: () => items,
  list,
  get,
  add,
  update,
  remove,
  studentTally,
  topStudents,
  summary,
};
