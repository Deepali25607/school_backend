// House Points System.
//
// Lumina has 4 houses (matching seed.houses): Crimson, Azure, Emerald, Amber.
// Every student belongs to one. Points are awarded or deducted by staff for
// various reasons and aggregated into a live leaderboard.
//
// Award shape:
//   { id, house, points (+/-), reason, category, studentId?, awardedBy,
//     awardedAt, term }
//
// Aggregation:
//   - totals: { Crimson: int, Azure: int, Emerald: int, Amber: int }
//   - rank-ordered leaderboard, with leader gap & last 24h delta
//   - per-category breakdown per house
//   - top contributors (students with most positive points)

const store = require("./store");
const seed = require("./seed");

const HOUSES = ["Crimson", "Azure", "Emerald", "Amber"];

// Visual identity: kept here so the frontend can use the same palette.
const HOUSE_META = {
  Crimson: { motto: "Courage in flame", colorPrimary: "#ff5ec4", colorSecondary: "#ff8e8e", emblem: "Phoenix" },
  Azure:   { motto: "Wisdom on the tides", colorPrimary: "#5b81ff", colorSecondary: "#7fb1ff", emblem: "Kingfisher" },
  Emerald: { motto: "Loyalty in the grove", colorPrimary: "#5cf2c4", colorSecondary: "#7be6a8", emblem: "Stag" },
  Amber:   { motto: "Light of the dawn", colorPrimary: "#ffd166", colorSecondary: "#ffc04d", emblem: "Lion" },
};

const CATEGORIES = [
  "Academic",
  "Sports",
  "Cultural",
  "Community Service",
  "Attendance",
  "Leadership",
  "Discipline",  // deductions go here
  "Bonus",
  "Other",
];

const REASONS = {
  Academic: [
    "Top scorer · class test",
    "Olympiad medal",
    "Project showcase winner",
    "Math quiz champion",
  ],
  Sports: [
    "Inter-house football final win",
    "Athletics relay champion",
    "Basketball MVP",
    "Swimming championship gold",
    "Yoga competition win",
  ],
  Cultural: [
    "Annual day · dance ensemble",
    "Drama festival winner",
    "Solo singing championship",
    "Photography contest",
  ],
  "Community Service": [
    "Tree plantation drive · 50+ saplings",
    "Beach cleanup volunteer",
    "Blood donation camp organising",
  ],
  Attendance: [
    "Perfect attendance · month",
    "Best attendance · house bonus",
  ],
  Leadership: [
    "House captain initiative",
    "Mentored junior students",
    "Class representative duties",
  ],
  Discipline: [
    "Uniform violation · house penalty",
    "Late submissions · repeated",
    "Disruption in assembly",
  ],
  Bonus: [
    "Spirit of the house",
    "Surprise principal's award",
  ],
  Other: ["Misc."],
};

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickFromArr(arr, ...parts) {
  return arr[hash(...parts) % arr.length];
}

function buildSeed() {
  // ~80 awards spread across all four houses over the last 90 days.
  const awards = [];
  const COUNT = 80;
  for (let i = 0; i < COUNT; i++) {
    const house = HOUSES[hash("h", i) % HOUSES.length];
    // 75% positive awards, 25% deductions
    const isDeduction = hash("d", i) % 100 < 25;
    const category = isDeduction
      ? "Discipline"
      : pickFromArr(
          CATEGORIES.filter((c) => c !== "Discipline" && c !== "Other"),
          "cat",
          i
        );

    const reasonPool = REASONS[category] || ["Recognised contribution"];
    const reason = pickFromArr(reasonPool, "r", i);

    // Magnitude: scale by category
    let magnitude;
    if (category === "Academic") magnitude = 10 + (hash("am", i) % 30);
    else if (category === "Sports") magnitude = 15 + (hash("sm", i) % 35);
    else if (category === "Cultural") magnitude = 10 + (hash("cm", i) % 25);
    else if (category === "Community Service") magnitude = 8 + (hash("comm", i) % 15);
    else if (category === "Attendance") magnitude = 5 + (hash("at", i) % 10);
    else if (category === "Leadership") magnitude = 10 + (hash("ldr", i) % 20);
    else if (category === "Bonus") magnitude = 20 + (hash("bn", i) % 30);
    else magnitude = 5 + (hash("dis", i) % 10); // discipline deductions

    const points = isDeduction ? -magnitude : magnitude;

    // 60% are attributed to a specific student of that house
    const houseStudents = seed.students.filter((s) => s.house === house);
    const linkStudent = hash("ls", i) % 100 < 60 && houseStudents.length > 0;
    const student = linkStudent
      ? houseStudents[hash("stu", i) % houseStudents.length]
      : null;

    const daysAgo = hash("date", i) % 90;
    awards.push({
      id: `HP${5000 + i + 1}`,
      house,
      points,
      reason,
      category,
      studentId: student?.id || null,
      studentName: student?.name || null,
      studentAvatar: student?.avatar || null,
      awardedBy: pickFromArr(
        [
          "Principal's Office",
          "Sports Department",
          "Cultural Committee",
          "Academic Coordinator",
          "Class Teacher",
          "Discipline Committee",
          "House Master",
        ],
        "by",
        i
      ),
      awardedAt: dateOffset(daysAgo),
      term: daysAgo > 60 ? "Term 1" : daysAgo > 30 ? "Term 2" : "Term 3",
    });
  }
  return { awards };
}

let state = store.load("housepoints", buildSeed);
const persist = () => store.save("housepoints", state);

// ---------- helpers ----------

function studentById(id) {
  return seed.students.find((s) => s.id === id) || null;
}

function totals({ term } = {}) {
  const out = {};
  for (const h of HOUSES) out[h] = 0;
  for (const a of state.awards) {
    if (term && term !== "all" && a.term !== term) continue;
    out[a.house] = (out[a.house] || 0) + a.points;
  }
  return out;
}

function leaderboard({ term } = {}) {
  const t = totals({ term });
  return Object.entries(t)
    .map(([house, points]) => ({
      house,
      points,
      meta: HOUSE_META[house],
    }))
    .sort((a, b) => b.points - a.points)
    .map((row, i, arr) => ({
      ...row,
      rank: i + 1,
      leadOver: i === arr.length - 1 ? 0 : row.points - arr[i + 1].points,
    }));
}

function categoryBreakdown({ term } = {}) {
  // { house: { category: total } }
  const out = {};
  for (const h of HOUSES) out[h] = {};
  for (const c of CATEGORIES) for (const h of HOUSES) out[h][c] = 0;
  for (const a of state.awards) {
    if (term && term !== "all" && a.term !== term) continue;
    out[a.house][a.category] = (out[a.house][a.category] || 0) + a.points;
  }
  return out;
}

function recentChange({ hours = 24, term } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  const out = {};
  for (const h of HOUSES) out[h] = 0;
  for (const a of state.awards) {
    if (term && term !== "all" && a.term !== term) continue;
    if (new Date(a.awardedAt).getTime() < cutoff) continue;
    out[a.house] += a.points;
  }
  return out;
}

function topContributors({ limit = 8, term } = {}) {
  const tally = new Map();
  for (const a of state.awards) {
    if (term && term !== "all" && a.term !== term) continue;
    if (!a.studentId) continue;
    const cur = tally.get(a.studentId) || { points: 0, count: 0, house: a.house };
    cur.points += a.points;
    cur.count++;
    tally.set(a.studentId, cur);
  }
  return [...tally.entries()]
    .map(([studentId, v]) => {
      const s = studentById(studentId);
      return {
        studentId,
        studentName: s?.name || studentId,
        studentAvatar: s?.avatar || "S",
        studentGrade: s?.grade,
        studentSection: s?.section,
        house: v.house,
        points: v.points,
        count: v.count,
      };
    })
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// ---------- queries ----------

function list({ house, category, term, studentId, q, limit = 100 } = {}) {
  let out = state.awards.slice();
  if (house && house !== "all") out = out.filter((a) => a.house === house);
  if (category && category !== "all") out = out.filter((a) => a.category === category);
  if (term && term !== "all") out = out.filter((a) => a.term === term);
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (a) =>
        a.id.toLowerCase().includes(t) ||
        a.reason.toLowerCase().includes(t) ||
        (a.studentName || "").toLowerCase().includes(t) ||
        a.awardedBy.toLowerCase().includes(t) ||
        a.category.toLowerCase().includes(t)
    );
  }
  return out
    .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt))
    .slice(0, limit);
}

function get(id) {
  return state.awards.find((a) => a.id === id) || null;
}

// ---------- mutations ----------

function add(payload, user) {
  const { house, points, reason, category, studentId, term } = payload || {};
  if (!HOUSES.includes(house)) throw new Error("invalid house");
  if (!Number.isFinite(Number(points)) || Number(points) === 0)
    throw new Error("points must be a non-zero number");
  if (!reason || !String(reason).trim()) throw new Error("reason required");
  if (!CATEGORIES.includes(category)) throw new Error("invalid category");

  let student = null;
  if (studentId) {
    student = studentById(studentId);
    if (!student) throw new Error("Student not found");
    if (student.house !== house)
      throw new Error(`Student belongs to ${student.house}, not ${house}`);
  }

  const next = state.awards.length + 1;
  const a = {
    id: `HP${5000 + next}`,
    house,
    points: Math.trunc(Number(points)),
    reason: String(reason).trim(),
    category,
    studentId: student?.id || null,
    studentName: student?.name || null,
    studentAvatar: student?.avatar || null,
    awardedBy: payload.awardedBy || user?.name || "Administration",
    awardedAt: new Date().toISOString(),
    term: term || "Term 3",
  };
  state.awards.unshift(a);
  persist();
  return a;
}

function remove(id) {
  const idx = state.awards.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("Award not found");
  const [removed] = state.awards.splice(idx, 1);
  persist();
  return removed;
}

function summary({ term } = {}) {
  const lb = leaderboard({ term });
  const t24 = recentChange({ hours: 24, term });
  return {
    houses: HOUSES,
    leaderboard: lb,
    leader: lb[0] || null,
    totals: totals({ term }),
    recent24h: t24,
    totalAwards: state.awards.length,
    deductionsCount: state.awards.filter((a) => a.points < 0).length,
    awardsCount: state.awards.filter((a) => a.points > 0).length,
    meta: HOUSE_META,
    categories: CATEGORIES,
  };
}

module.exports = {
  HOUSES,
  CATEGORIES,
  HOUSE_META,
  awards: () => state.awards,
  list,
  get,
  add,
  remove,
  totals,
  leaderboard,
  categoryBreakdown,
  recentChange,
  topContributors,
  summary,
};
