// Notice Board — pinned static announcements separate from the broadcast
// Communications module. Communications = transient outbound messages;
// Notices = persistent posts that hang around until they expire.
//
// Each notice carries: title, body, category, audience scope, optional
// attachment URL, pinned flag, expiry date, and an acknowledgement set
// (who has read/acked the notice). Expired notices fall out of the default
// list view but remain queryable via `?includeExpired=true`.

const store = require("./store");
const usersData = require("./users");

const CATEGORIES = [
  "Academic",
  "Event",
  "Holiday",
  "Sports",
  "Exam",
  "Admin",
  "Emergency",
  "PTM",
];

const AUDIENCES = [
  "all",
  "students",
  "parents",
  "teachers",
  "staff",
  "admins",
];

const SEEDS = [
  {
    title: "Annual Day · Theme & Roles announced",
    body:
      "This year's Annual Day theme is 'Reimagined Futures'. Auditions for lead roles open Monday 9 AM in the main hall. All students Grades 6–10 are encouraged to participate. Costume guidelines will be shared via the parent portal.",
    category: "Event",
    audience: "all",
    pinned: true,
    expiresInDays: 21,
    daysAgo: 1,
    postedBy: "Principal's Office",
  },
  {
    title: "School closed for Buddha Purnima",
    body:
      "The school will remain closed on the upcoming public holiday for Buddha Purnima. Transport services will not operate. All classes will resume the following working day as per the regular timetable.",
    category: "Holiday",
    audience: "all",
    pinned: true,
    expiresInDays: 10,
    daysAgo: 0,
    postedBy: "Principal's Office",
  },
  {
    title: "PTM scheduled for Grades 6–10",
    body:
      "Parent–Teacher meetings for Grades 6–10 will be held this Saturday from 9:00 AM to 1:00 PM. Slot bookings via the parent portal. Class teachers will be available in their assigned rooms; subject teachers will rotate between rooms.",
    category: "PTM",
    audience: "parents",
    pinned: true,
    expiresInDays: 6,
    daysAgo: 2,
    postedBy: "Academic Coordinator",
  },
  {
    title: "Mid-term exam schedule released",
    body:
      "The mid-term examination schedule has been published. All students must download the personalised hall ticket from the Documents module. Hall tickets must be carried to every exam — no admission without one.",
    category: "Exam",
    audience: "students",
    pinned: false,
    expiresInDays: 14,
    daysAgo: 3,
    postedBy: "Examination Cell",
  },
  {
    title: "Library: New arrivals catalogue",
    body:
      "Over 120 new titles have been added across fiction, science, and competitive exam prep. Browse the digital catalogue from the Library module. Reservation limits remain at 3 books per student.",
    category: "Academic",
    audience: "all",
    pinned: false,
    expiresInDays: 30,
    daysAgo: 4,
    postedBy: "Library Committee",
  },
  {
    title: "Inter-house Sports Carnival · Sign-ups",
    body:
      "The annual inter-house sports carnival is open for sign-ups. Events span athletics, swimming, football, basketball, table tennis, and chess. Last date to register: Friday. Coordinators in each house will share the registration form.",
    category: "Sports",
    audience: "students",
    pinned: false,
    expiresInDays: 7,
    daysAgo: 1,
    postedBy: "Sports Department",
  },
  {
    title: "Updated fee structure for the next academic year",
    body:
      "The revised fee structure for the next academic year has been ratified by the school board. Detailed breakups are available in the parent portal under Fees & Finance → Notices. Early-bird discounts apply for payments before May 31.",
    category: "Admin",
    audience: "parents",
    pinned: false,
    expiresInDays: 45,
    daysAgo: 5,
    postedBy: "Accounts Department",
  },
  {
    title: "Cyber-safety workshop · Grades 8 & 9",
    body:
      "An interactive cyber-safety workshop will be conducted by the IT department for Grades 8 and 9. The session covers safe social media practices, password hygiene, and recognising phishing attempts.",
    category: "Academic",
    audience: "students",
    pinned: false,
    expiresInDays: 5,
    daysAgo: 2,
    postedBy: "IT Department",
  },
  {
    title: "Fire drill scheduled",
    body:
      "A mandatory fire-evacuation drill will take place during the second period this week. Students are to follow class-teacher instructions and assemble at designated muster points. Staff briefing notes available in the Staff Room.",
    category: "Emergency",
    audience: "all",
    pinned: true,
    expiresInDays: 3,
    daysAgo: 0,
    postedBy: "Administration",
  },
  {
    title: "Independence Day rehearsal",
    body:
      "Independence Day cultural programme rehearsals begin next Monday. Participating students should report to the auditorium at 2:30 PM after class. House captains will share the practice schedule.",
    category: "Event",
    audience: "students",
    pinned: false,
    expiresInDays: 25,
    daysAgo: 6,
    postedBy: "Cultural Committee",
  },
  {
    title: "Bus route #5 timing change",
    body:
      "Effective Monday, Bus Route #5 morning pickup will move 15 minutes earlier due to revised traffic patterns near the new metro construction. Parents will receive a personalised SMS with the updated pickup time for their stop.",
    category: "Admin",
    audience: "parents",
    pinned: false,
    expiresInDays: 14,
    daysAgo: 1,
    postedBy: "Transport Office",
  },
  {
    title: "Staff meeting · Friday 4 PM",
    body:
      "All teaching and non-teaching staff are required to attend the monthly review meeting in the conference room. Agenda includes Q4 academic targets, infrastructure updates, and the annual day delegation plan.",
    category: "Admin",
    audience: "staff",
    pinned: false,
    expiresInDays: 4,
    daysAgo: 1,
    postedBy: "Principal's Office",
  },
];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function buildSeed() {
  return SEEDS.map((s, i) => ({
    id: `NOT${String(7000 + i + 1)}`,
    title: s.title,
    body: s.body,
    category: s.category,
    audience: s.audience,
    pinned: s.pinned,
    postedAt: dateOffset(-s.daysAgo),
    postedBy: s.postedBy,
    expiresAt: dateOffset(s.expiresInDays),
    attachmentUrl: null,
    // Grade/section targeting. Empty arrays = whole-school within the audience.
    // Cyber-safety workshop seed explicitly targets Grades 8 & 9.
    targetGrades:
      /Grades?\s*8\s*&\s*9/i.test(s.title) ? [8, 9] :
      /Grades?\s*6.{0,3}10/i.test(s.title) ? [6, 7, 8, 9, 10] :
      [],
    targetSections: [],
    acks: [], // userIds who acknowledged
  }));
}

let items = store.load("notices", buildSeed);
// Forward-fill new fields on previously-persisted notices so the schema
// stays consistent without a migration step.
for (const n of items) {
  if (!Array.isArray(n.targetGrades)) n.targetGrades = [];
  if (!Array.isArray(n.targetSections)) n.targetSections = [];
}
const persist = () => store.save("notices", items);

function isExpired(n) {
  return new Date(n.expiresAt).getTime() < Date.now();
}

function decorate(n, user) {
  const ackedByMe = user ? n.acks.includes(user.id) : false;
  const isNew =
    Date.now() - new Date(n.postedAt).getTime() < 2 * 86400000; // <48h
  const daysToExpiry = Math.ceil(
    (new Date(n.expiresAt).getTime() - Date.now()) / 86400000
  );
  return {
    ...n,
    expired: isExpired(n),
    ackedByMe,
    isNew,
    daysToExpiry,
    ackCount: n.acks.length,
  };
}

function audienceMatches(notice, role) {
  if (!role) return true;
  if (notice.audience === "all") return true;
  if (notice.audience === "students" && role === "student") return true;
  if (notice.audience === "parents" && role === "parent") return true;
  if (notice.audience === "teachers" && role === "teacher") return true;
  if (notice.audience === "staff") {
    return ["teacher", "hr", "accountant", "admin", "principal"].includes(role);
  }
  if (notice.audience === "admins") {
    return ["admin", "principal"].includes(role);
  }
  return false;
}

// Grade/section targeting check. `who` is one of:
//   { grade: 8, section: "B" }                 — student
//   { grades: [{grade:8, section:"B"}, ...] }  — parent (children) or teacher (classes)
// A notice with empty targetGrades matches everyone within its audience.
function gradeMatches(notice, who) {
  if (!who) return true;
  const tg = Array.isArray(notice.targetGrades) ? notice.targetGrades : [];
  const ts = Array.isArray(notice.targetSections) ? notice.targetSections : [];
  if (tg.length === 0) return true; // whole-audience notice

  const checkOne = ({ grade, section }) => {
    if (!tg.includes(Number(grade))) return false;
    if (ts.length === 0) return true; // whole-grade notice
    return section ? ts.includes(String(section).toUpperCase()) : false;
  };

  if (Array.isArray(who.grades)) return who.grades.some(checkOne);
  return checkOne(who);
}

function list({
  q,
  category,
  audience,
  pinned,
  includeExpired,
  forRole,
  scope,
  user,
} = {}) {
  let out = items.slice();
  if (!includeExpired) out = out.filter((n) => !isExpired(n));
  if (forRole) out = out.filter((n) => audienceMatches(n, forRole));
  if (scope) out = out.filter((n) => gradeMatches(n, scope));
  if (category && category !== "all") out = out.filter((n) => n.category === category);
  if (audience && audience !== "all") out = out.filter((n) => n.audience === audience);
  if (pinned === "true") out = out.filter((n) => n.pinned);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (n) =>
        n.title.toLowerCase().includes(t) ||
        n.body.toLowerCase().includes(t) ||
        n.id.toLowerCase().includes(t) ||
        n.category.toLowerCase().includes(t)
    );
  }
  // Pinned first, then newest first
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.postedAt) - new Date(a.postedAt);
  });
  return out.map((n) => decorate(n, user));
}

function get(id, user) {
  const n = items.find((x) => x.id === id);
  if (!n) return null;
  return decorate(n, user);
}

function normalizeGrades(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    const g = Number(v);
    if (Number.isInteger(g) && g >= 1 && g <= 12 && !out.includes(g)) out.push(g);
  }
  return out.sort((a, b) => a - b);
}

function normalizeSections(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    const s = String(v).toUpperCase();
    if (["A", "B", "C", "D"].includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function add(payload, user) {
  if (!payload.title) throw new Error("title required");
  if (!payload.body) throw new Error("body required");
  const category = CATEGORIES.includes(payload.category) ? payload.category : "Admin";
  const audience = AUDIENCES.includes(payload.audience) ? payload.audience : "all";
  // Default expiry: 14 days, unless explicit
  const expiresAt =
    payload.expiresAt && /^\d{4}-\d{2}-\d{2}/.test(payload.expiresAt)
      ? new Date(payload.expiresAt).toISOString()
      : dateOffset(Number(payload.expiresInDays) || 14);
  const n = {
    id: `NOT${String(7000 + items.length + 1)}`,
    title: String(payload.title).trim(),
    body: String(payload.body).trim(),
    category,
    audience,
    pinned: payload.pinned === true,
    postedAt: new Date().toISOString(),
    postedBy: payload.postedBy || user?.name || "Administration",
    expiresAt,
    attachmentUrl: payload.attachmentUrl || null,
    targetGrades: normalizeGrades(payload.targetGrades),
    targetSections: normalizeSections(payload.targetSections),
    acks: [],
  };
  items.unshift(n);
  persist();
  return decorate(n, user);
}

function update(id, patch, user) {
  const n = items.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  const ALLOWED = [
    "title",
    "body",
    "category",
    "audience",
    "pinned",
    "expiresAt",
    "attachmentUrl",
    "postedBy",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) n[k] = patch[k];
  if (patch.targetGrades !== undefined) n.targetGrades = normalizeGrades(patch.targetGrades);
  if (patch.targetSections !== undefined) n.targetSections = normalizeSections(patch.targetSections);
  if (patch.category && !CATEGORIES.includes(n.category)) n.category = "Admin";
  if (patch.audience && !AUDIENCES.includes(n.audience)) n.audience = "all";
  persist();
  return decorate(n, user);
}

function acknowledge(id, user) {
  const n = items.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  if (!user) throw new Error("user required");
  if (!n.acks.includes(user.id)) {
    n.acks.push(user.id);
    persist();
  }
  return decorate(n, user);
}

function unacknowledge(id, user) {
  const n = items.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  if (!user) throw new Error("user required");
  n.acks = n.acks.filter((u) => u !== user.id);
  persist();
  return decorate(n, user);
}

function remove(id) {
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = items.splice(idx, 1);
  persist();
  return removed;
}

function togglePin(id, user) {
  const n = items.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  n.pinned = !n.pinned;
  persist();
  return decorate(n, user);
}

function summary(user, scope) {
  const liveAll = items.filter((n) => !isExpired(n));
  // Per-user lens: only notices that pass both audience + grade scope are
  // counted toward "live"/"pinned"/"unackedForMe" so stat tiles reflect what
  // the caller can actually see. Admin/principal get the full counts because
  // scope is null for them.
  const lens = (n) => {
    if (user?.role && !audienceMatches(n, user.role)) return false;
    if (scope && !gradeMatches(n, scope)) return false;
    return true;
  };
  const live = liveAll.filter(lens);
  const pinned = live.filter((n) => n.pinned);
  const expiringSoon = live.filter((n) => {
    const days = Math.ceil(
      (new Date(n.expiresAt).getTime() - Date.now()) / 86400000
    );
    return days >= 0 && days <= 3;
  });
  const unackedForMe = user
    ? live.filter((n) => !n.acks.includes(user.id)).length
    : 0;
  const byCategory = CATEGORIES.reduce((acc, c) => {
    acc[c] = live.filter((n) => n.category === c).length;
    return acc;
  }, {});
  return {
    live: live.length,
    pinned: pinned.length,
    expiringSoon: expiringSoon.length,
    expired: items.length - liveAll.length,
    unackedForMe,
    byCategory,
  };
}

module.exports = {
  CATEGORIES,
  AUDIENCES,
  notices: () => items,
  list,
  get,
  add,
  update,
  acknowledge,
  unacknowledge,
  togglePin,
  remove,
  summary,
};
