// Discipline & Behavioral records — incident reports that walk through a small
// state machine (Open → Under Review → Resolved / Escalated). Each incident
// carries a demerit value, and the per-student demerit total is derivable on
// the fly from the open ledger.
//
// Sensitive territory in real schools — kept factual and process-oriented:
// every incident has a reporter, a category, a severity, and a documented
// resolution path. No free-text "comments by other students" or similar.

const store = require("./store");
const seed = require("./seed");

const CATEGORIES = [
  "Tardiness",
  "Uniform",
  "Homework",
  "Disruption",
  "Disrespect",
  "Phone use",
  "Bullying",
  "Cheating",
  "Vandalism",
  "Fighting",
  "Substance",
];

const SEVERITIES = ["Minor", "Moderate", "Major"];
const STATUSES = ["Open", "Under Review", "Resolved", "Escalated"];

// Default demerit weights — overridable per incident at creation time
const SEVERITY_DEMERITS = { Minor: 1, Moderate: 3, Major: 5 };

const REPORTERS = [
  "Ms. Sara Kapoor (Class teacher 7B)",
  "Mr. Vivek Arora (PE Coach)",
  "Dr. Anand Iyer (Lab supervisor)",
  "Ms. Diya Khan (Counsellor)",
  "Mr. Karan Mehta (Discipline committee)",
  "Hostel warden",
  "Security desk",
];

const RESOLUTIONS = [
  "Verbal warning issued",
  "Written warning logged",
  "Parents informed via call",
  "Parent meeting scheduled",
  "Detention assigned",
  "Community service",
  "Suspension (in-school)",
  "Suspension (off-campus)",
  "Counselling session arranged",
  "Restitution / damage repair",
];

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

function buildSeed() {
  // Hand-curated incidents so the dataset feels real but stays small.
  // Each: [daysAgo, category, severity, status, description, demerits, resolution]
  // studentId is picked deterministically below.
  const samples = [
    [1, "Tardiness", "Minor", "Open", "Late to first period without note", null, null],
    [2, "Uniform", "Minor", "Resolved", "Out-of-code shoes on Monday", null, "Verbal warning issued"],
    [3, "Phone use", "Minor", "Under Review", "Phone used during chemistry lecture", null, null],
    [4, "Disruption", "Moderate", "Resolved", "Repeated talking after warning in 8A", null, "Parents informed via call"],
    [5, "Homework", "Minor", "Resolved", "Math homework not submitted 3 times this week", null, "Verbal warning issued"],
    [6, "Disrespect", "Moderate", "Under Review", "Argued with substitute teacher", null, null],
    [9, "Cheating", "Major", "Escalated", "Copying during periodic test", 5, "Parent meeting scheduled"],
    [11, "Bullying", "Major", "Resolved", "Repeated name-calling during recess", null, "Counselling session arranged"],
    [12, "Fighting", "Major", "Resolved", "Physical altercation in corridor", null, "Suspension (in-school)"],
    [14, "Vandalism", "Moderate", "Resolved", "Defaced library desk", null, "Restitution / damage repair"],
    [16, "Tardiness", "Minor", "Resolved", "Late to morning assembly twice", null, "Verbal warning issued"],
    [18, "Disrespect", "Moderate", "Resolved", "Talked back to hostel warden", null, "Written warning logged"],
    [21, "Phone use", "Moderate", "Resolved", "Phone used during a test", null, "Detention assigned"],
    [25, "Cheating", "Moderate", "Resolved", "Unauthorised notes in geography test", null, "Detention assigned"],
    [28, "Disruption", "Minor", "Resolved", "Throwing paper during period 4", null, "Verbal warning issued"],
  ];

  return samples.map((row, i) => {
    const [daysAgo, category, severity, status, description, demeritsOverride, resolution] = row;
    const s = seed.students[hash("inc", i) % seed.students.length];
    const demerits = demeritsOverride != null ? demeritsOverride : SEVERITY_DEMERITS[severity];
    const reportedOn = dateOffset(daysAgo);
    const parentNotified =
      status === "Resolved" || status === "Escalated" || severity === "Major";
    const parentMeetingAt =
      severity === "Major" && status !== "Resolved"
        ? dateOffset(Math.max(0, daysAgo - 5))
        : null;
    return {
      id: `INC${String(6000 + i + 1)}`,
      studentId: s.id,
      category,
      severity,
      status,
      description,
      demerits,
      reportedBy: pick(REPORTERS, "rep", i),
      occurredOn: reportedOn,
      reportedOn,
      lastUpdate: dateOffset(Math.max(0, daysAgo - 1)),
      parentNotified,
      parentMeetingAt,
      resolution: resolution || null,
      witnesses: [],
    };
  });
}

let incidents = store.load("discipline", buildSeed);
const persist = () => store.save("discipline", incidents);

function nextId() {
  return `INC${String(6000 + incidents.length + 1)}`;
}

function list({ q, status, severity, category, studentId, sinceDays } = {}) {
  let out = incidents.slice();
  if (status && status !== "all") out = out.filter((i) => i.status === status);
  if (severity && severity !== "all")
    out = out.filter((i) => i.severity === severity);
  if (category && category !== "all")
    out = out.filter((i) => i.category === category);
  if (studentId) out = out.filter((i) => i.studentId === studentId);
  if (sinceDays) {
    const cutoff = Date.now() - Number(sinceDays) * 86400000;
    out = out.filter((i) => new Date(i.reportedOn).getTime() >= cutoff);
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (i) =>
        i.id.toLowerCase().includes(t) ||
        i.studentId.toLowerCase().includes(t) ||
        (i.description || "").toLowerCase().includes(t) ||
        (i.category || "").toLowerCase().includes(t) ||
        (i.resolution || "").toLowerCase().includes(t)
    );
  }
  return out;
}

function get(id) {
  return incidents.find((i) => i.id === id) || null;
}

function add(payload) {
  if (!payload.studentId) throw new Error("studentId required");
  if (!payload.description) throw new Error("description required");
  const severity = SEVERITIES.includes(payload.severity)
    ? payload.severity
    : "Minor";
  const category = CATEGORIES.includes(payload.category)
    ? payload.category
    : "Disruption";
  const demerits =
    typeof payload.demerits === "number" && payload.demerits >= 0
      ? payload.demerits
      : SEVERITY_DEMERITS[severity];
  const inc = {
    id: nextId(),
    studentId: payload.studentId,
    category,
    severity,
    status: "Open",
    description: payload.description,
    demerits,
    reportedBy: payload.reportedBy || "—",
    occurredOn: payload.occurredOn || dateOffset(0),
    reportedOn: dateOffset(0),
    lastUpdate: dateOffset(0),
    parentNotified: false,
    parentMeetingAt: null,
    resolution: null,
    witnesses: Array.isArray(payload.witnesses) ? payload.witnesses : [],
  };
  incidents.unshift(inc);
  persist();
  return inc;
}

function update(id, patch) {
  const i = incidents.find((x) => x.id === id);
  if (!i) throw new Error("Not found");
  if (patch.status) {
    if (!STATUSES.includes(patch.status)) throw new Error("Invalid status");
    i.status = patch.status;
  }
  if (patch.resolution !== undefined) i.resolution = patch.resolution || null;
  if (patch.parentNotified !== undefined)
    i.parentNotified = !!patch.parentNotified;
  if (patch.parentMeetingAt !== undefined)
    i.parentMeetingAt = patch.parentMeetingAt || null;
  if (typeof patch.demerits === "number" && patch.demerits >= 0)
    i.demerits = patch.demerits;
  i.lastUpdate = dateOffset(0);
  persist();
  return i;
}

function studentLedger(studentId) {
  const own = incidents.filter((i) => i.studentId === studentId);
  return {
    total: own.length,
    demerits: own
      .filter((i) => i.status !== "Resolved" || i.severity !== "Minor") // resolved minor incidents drop off
      .reduce((a, i) => a + i.demerits, 0),
    open: own.filter((i) => i.status === "Open" || i.status === "Under Review")
      .length,
    last90: own.filter(
      (i) =>
        new Date(i.reportedOn).getTime() >= Date.now() - 90 * 86400000
    ).length,
    bySeverity: SEVERITIES.reduce((acc, s) => {
      acc[s] = own.filter((i) => i.severity === s).length;
      return acc;
    }, {}),
    items: own,
  };
}

function summary() {
  const out = { total: incidents.length };
  STATUSES.forEach((s) => (out[s] = incidents.filter((i) => i.status === s).length));
  SEVERITIES.forEach(
    (s) => (out[`sev_${s}`] = incidents.filter((i) => i.severity === s).length)
  );
  const last7 = Date.now() - 7 * 86400000;
  out.thisWeek = incidents.filter(
    (i) => new Date(i.reportedOn).getTime() >= last7
  ).length;
  out.pendingMeetings = incidents.filter(
    (i) => i.parentMeetingAt && i.status !== "Resolved"
  ).length;
  out.openCount = out.Open + out["Under Review"];
  out.totalDemerits = incidents.reduce((a, i) => a + i.demerits, 0);
  return out;
}

module.exports = {
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  REPORTERS,
  RESOLUTIONS,
  SEVERITY_DEMERITS,
  incidents: () => incidents,
  list,
  get,
  add,
  update,
  studentLedger,
  summary,
};
