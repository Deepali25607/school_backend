// Scholarships & Financial Aid.
//
// Two collections:
//   - Schemes:      catalog of available awards (merit / need / sports / arts /
//                   sibling / alumni-funded). Each scheme has a `value` (either
//                   a percentage of annual fees or a fixed INR amount), a `slots`
//                   cap, an academic year window, criteria, and optionally a
//                   sponsor (alumnus id or text).
//
//   - Applications: a student applies for a scheme. State machine:
//                     Applied → Under Review → (Awarded | Rejected)
//                   Plus terminal: Withdrawn.
//                   Each application records the student, scheme, family income
//                   (for need-based), the reviewer, the decision note, and the
//                   eventual disbursement plan (this term / annually).
//
// Awarded scholarships are exposed to the Fees module via `awardedForStudent()`
// so receipts can show the discount. Slot enforcement: when a scheme's slots are
// full, new applications can still be submitted (they go on a waitlist) but
// awarding is blocked.

const store = require("./store");
const seed = require("./seed");

const TYPES = [
  "Merit",
  "Need-based",
  "Sports",
  "Arts",
  "Sibling",
  "Alumni-funded",
  "Staff ward",
  "Single parent",
];

const STATUSES = [
  "Applied",
  "Under Review",
  "Awarded",
  "Rejected",
  "Withdrawn",
];

const VALUE_TYPES = ["percentage", "fixed"];

const DEFAULT_ACADEMIC_YEAR = "2026-27";

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSeed() {
  const schemes = [
    {
      id: "SCH3001",
      name: "Lumina Merit Excellence Award",
      type: "Merit",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 50,
      slots: 8,
      criteria:
        "Top 5% of the grade in the previous academic year, with subject average ≥ 90%.",
      sponsor: "Lumina Endowment Fund",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3002",
      name: "Need-based Tuition Aid",
      type: "Need-based",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 75,
      slots: 12,
      criteria:
        "Household income below ₹3,00,000 per annum. Documents required: latest ITR, salary slips.",
      sponsor: "School Corpus + Donor Pool",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3003",
      name: "Sports Performance Grant",
      type: "Sports",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 30,
      slots: 10,
      criteria:
        "State-level representation or above in any sport, with current Achievements record.",
      sponsor: "Sports Department Trust",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3004",
      name: "Performing Arts Bursary",
      type: "Arts",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "fixed",
      value: 25000,
      slots: 6,
      criteria:
        "Recognition in classical music, dance, theatre, or visual arts at district level+.",
      sponsor: "Cultural Committee",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3005",
      name: "Sibling Concession",
      type: "Sibling",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 15,
      slots: 50,
      criteria:
        "Automatic for the 2nd and subsequent child of any family enrolled at Lumina.",
      sponsor: "School Policy",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3006",
      name: "Class of 2014 Alumni Grant · STEM",
      type: "Alumni-funded",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "fixed",
      value: 40000,
      slots: 3,
      criteria:
        "Grade 11/12 students pursuing STEM streams with demonstrated initiative (project, olympiad, or research).",
      sponsor: "Class of 2014 Alumni",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-60),
    },
    {
      id: "SCH3007",
      name: "Staff Ward Education Support",
      type: "Staff ward",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 50,
      slots: 20,
      criteria:
        "Children of full-time Lumina teaching and non-teaching staff with continuous service ≥ 2 years.",
      sponsor: "HR Welfare Fund",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-90),
    },
    {
      id: "SCH3008",
      name: "Single Parent Support",
      type: "Single parent",
      academicYear: DEFAULT_ACADEMIC_YEAR,
      valueType: "percentage",
      value: 25,
      slots: 15,
      criteria:
        "Documented single-parent households. Verified annually by the school counsellor.",
      sponsor: "Principal's Discretionary Fund",
      sponsorAlumnusId: null,
      active: true,
      createdAt: dateOffset(-60),
    },
  ];

  // Hash helper for stable seed picks
  function hash(...parts) {
    let h = 17;
    const s = parts.map(String).join(":");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Seed ~30 applications spread across schemes & statuses
  const applications = [];
  const statusDist = [
    ...Array(10).fill("Awarded"),
    ...Array(8).fill("Under Review"),
    ...Array(7).fill("Applied"),
    ...Array(4).fill("Rejected"),
    ...Array(1).fill("Withdrawn"),
  ];

  for (let i = 0; i < statusDist.length; i++) {
    const scheme = schemes[hash("sch", i) % schemes.length];
    const student = seed.students[hash("stu", i) % seed.students.length];
    const status = statusDist[i];
    const appliedDaysAgo = 5 + (hash("app", i) % 60);
    const decidedDaysAgo =
      status === "Awarded" || status === "Rejected"
        ? Math.max(0, appliedDaysAgo - 3 - (hash("dec", i) % 10))
        : null;
    applications.push({
      id: `SAP${4000 + i + 1}`,
      schemeId: scheme.id,
      studentId: student.id,
      academicYear: DEFAULT_ACADEMIC_YEAR,
      status,
      familyIncome:
        scheme.type === "Need-based"
          ? 100000 + (hash("inc", i) % 250000)
          : null,
      reason:
        scheme.type === "Merit"
          ? "Top performer in Grade " + student.grade
          : scheme.type === "Sports"
          ? "District-level athletics representation"
          : scheme.type === "Arts"
          ? "Classical dance · State festival 2nd position"
          : scheme.type === "Sibling"
          ? "Has a younger sibling already enrolled"
          : scheme.type === "Staff ward"
          ? "Parent works as PE coach at Lumina"
          : scheme.type === "Single parent"
          ? "Single-parent household, verified by counsellor"
          : scheme.type === "Alumni-funded"
          ? "Cyber Olympiad gold + active GitHub portfolio"
          : "Household income below threshold",
      reviewer: status === "Applied" ? null : "Principal's Office",
      reviewerNote: status === "Awarded"
        ? "Meets all criteria; recommended for award."
        : status === "Rejected"
        ? "Criteria not fully met; encourage to reapply next cycle."
        : status === "Under Review"
        ? "Documents verified, awaiting committee call."
        : null,
      appliedAt: dateOffset(-appliedDaysAgo),
      decidedAt: decidedDaysAgo === null ? null : dateOffset(-decidedDaysAgo),
      disbursement: status === "Awarded"
        ? hash("disb", i) % 2 === 0
          ? "Annual lump sum"
          : "Per-term split"
        : null,
    });
  }

  return { schemes, applications };
}

let state = store.load("scholarships", buildSeed);
const persist = () => store.save("scholarships", state);

// ---------- helpers ----------

function studentById(id) {
  return seed.students.find((s) => s.id === id) || null;
}

function decorateScheme(s) {
  const apps = state.applications.filter(
    (a) => a.schemeId === s.id && a.academicYear === s.academicYear
  );
  const awarded = apps.filter((a) => a.status === "Awarded").length;
  return {
    ...s,
    valueLabel:
      s.valueType === "percentage"
        ? `${s.value}% of fees`
        : `₹${Number(s.value).toLocaleString("en-IN")}`,
    appliedCount: apps.length,
    awardedCount: awarded,
    slotsRemaining: Math.max(0, s.slots - awarded),
    fillPct: s.slots > 0 ? Math.round((awarded / s.slots) * 100) : 0,
    waitlisted: awarded >= s.slots,
  };
}

function decorateApplication(a) {
  const student = studentById(a.studentId);
  const scheme = state.schemes.find((s) => s.id === a.schemeId);
  return {
    ...a,
    studentName: student?.name || a.studentId,
    studentAvatar: student?.avatar || "S",
    studentGrade: student?.grade,
    studentSection: student?.section,
    studentHouse: student?.house,
    schemeName: scheme?.name || a.schemeId,
    schemeType: scheme?.type || "—",
    schemeValueLabel: scheme
      ? scheme.valueType === "percentage"
        ? `${scheme.value}%`
        : `₹${Number(scheme.value).toLocaleString("en-IN")}`
      : "—",
    daysInPipeline: Math.max(
      0,
      Math.round((Date.now() - new Date(a.appliedAt).getTime()) / 86400000)
    ),
  };
}

// ---------- queries ----------

function listSchemes({ q, type, active, year } = {}) {
  let out = state.schemes.slice();
  if (type && type !== "all") out = out.filter((s) => s.type === type);
  if (year && year !== "all") out = out.filter((s) => s.academicYear === year);
  if (active === "true") out = out.filter((s) => s.active);
  if (active === "false") out = out.filter((s) => !s.active);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (s) =>
        s.id.toLowerCase().includes(t) ||
        s.name.toLowerCase().includes(t) ||
        s.type.toLowerCase().includes(t) ||
        (s.sponsor || "").toLowerCase().includes(t)
    );
  }
  return out
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(decorateScheme);
}

function getScheme(id) {
  const s = state.schemes.find((x) => x.id === id);
  return s ? decorateScheme(s) : null;
}

function listApplications({ q, status, schemeId, studentId, year } = {}) {
  let out = state.applications.slice();
  if (status && status !== "all") out = out.filter((a) => a.status === status);
  if (schemeId) out = out.filter((a) => a.schemeId === schemeId);
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (year && year !== "all") out = out.filter((a) => a.academicYear === year);
  if (q) {
    const t = String(q).toLowerCase();
    out = out
      .map(decorateApplication)
      .filter(
        (a) =>
          a.id.toLowerCase().includes(t) ||
          a.studentName.toLowerCase().includes(t) ||
          a.studentId.toLowerCase().includes(t) ||
          a.schemeName.toLowerCase().includes(t) ||
          (a.reason || "").toLowerCase().includes(t)
      );
    return out.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  }
  return out
    .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))
    .map(decorateApplication);
}

function awardedForStudent(studentId) {
  return state.applications
    .filter((a) => a.studentId === studentId && a.status === "Awarded")
    .map(decorateApplication);
}

// ---------- mutations ----------

function addScheme(payload, user) {
  if (!payload.name) throw new Error("name required");
  if (!TYPES.includes(payload.type)) throw new Error("invalid type");
  if (!VALUE_TYPES.includes(payload.valueType))
    throw new Error("invalid valueType");
  if (!(Number(payload.value) > 0)) throw new Error("value must be positive");
  if (!(Number(payload.slots) > 0)) throw new Error("slots must be positive");

  const next = state.schemes.length + 1;
  const s = {
    id: `SCH${3000 + next}`,
    name: String(payload.name).trim(),
    type: payload.type,
    academicYear: payload.academicYear || DEFAULT_ACADEMIC_YEAR,
    valueType: payload.valueType,
    value: Number(payload.value),
    slots: Number(payload.slots),
    criteria: String(payload.criteria || "").trim(),
    sponsor: payload.sponsor || "School Corpus",
    sponsorAlumnusId: payload.sponsorAlumnusId || null,
    active: payload.active !== false,
    createdAt: new Date().toISOString(),
    createdBy: user?.name || null,
  };
  state.schemes.unshift(s);
  persist();
  return decorateScheme(s);
}

function updateScheme(id, patch) {
  const s = state.schemes.find((x) => x.id === id);
  if (!s) throw new Error("Scheme not found");
  const ALLOWED = [
    "name",
    "type",
    "academicYear",
    "valueType",
    "value",
    "slots",
    "criteria",
    "sponsor",
    "sponsorAlumnusId",
    "active",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) s[k] = patch[k];
  if (patch.value !== undefined) s.value = Number(s.value);
  if (patch.slots !== undefined) s.slots = Number(s.slots);
  persist();
  return decorateScheme(s);
}

function removeScheme(id) {
  const idx = state.schemes.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Scheme not found");
  if (state.applications.some((a) => a.schemeId === id)) {
    throw new Error("Cannot remove a scheme with applications");
  }
  const [removed] = state.schemes.splice(idx, 1);
  persist();
  return removed;
}

function apply(payload, user) {
  const { schemeId, studentId, familyIncome, reason } = payload;
  const scheme = state.schemes.find((s) => s.id === schemeId);
  if (!scheme) throw new Error("Scheme not found");
  if (!scheme.active) throw new Error("Scheme is not accepting applications");
  if (!studentById(studentId)) throw new Error("Student not found");

  // Prevent duplicate active application by same student for same scheme/year
  const existing = state.applications.find(
    (a) =>
      a.schemeId === schemeId &&
      a.studentId === studentId &&
      a.academicYear === scheme.academicYear &&
      !["Rejected", "Withdrawn"].includes(a.status)
  );
  if (existing)
    throw new Error("An application is already open for this student & scheme");

  const next = state.applications.length + 1;
  const a = {
    id: `SAP${4000 + next}`,
    schemeId,
    studentId,
    academicYear: scheme.academicYear,
    status: "Applied",
    familyIncome:
      scheme.type === "Need-based" && Number(familyIncome) > 0
        ? Number(familyIncome)
        : null,
    reason: String(reason || "").trim() || null,
    reviewer: null,
    reviewerNote: null,
    appliedAt: new Date().toISOString(),
    decidedAt: null,
    disbursement: null,
    submittedBy: user?.name || null,
  };
  state.applications.unshift(a);
  persist();
  return decorateApplication(a);
}

function transitionApplication(id, status, payload, user) {
  if (!STATUSES.includes(status)) throw new Error("invalid status");
  const a = state.applications.find((x) => x.id === id);
  if (!a) throw new Error("Application not found");

  // Slot enforcement when awarding
  if (status === "Awarded") {
    const scheme = state.schemes.find((s) => s.id === a.schemeId);
    if (scheme) {
      const awarded = state.applications.filter(
        (x) =>
          x.schemeId === scheme.id &&
          x.academicYear === scheme.academicYear &&
          x.status === "Awarded"
      ).length;
      if (awarded >= scheme.slots && a.status !== "Awarded") {
        throw new Error("All slots filled — increase slots or reject");
      }
    }
  }

  a.status = status;
  a.reviewer = user?.name || a.reviewer || "Reviewer";
  if (payload?.note !== undefined) a.reviewerNote = payload.note;
  if (payload?.disbursement !== undefined && status === "Awarded") {
    a.disbursement = payload.disbursement;
  }
  if (["Awarded", "Rejected"].includes(status)) {
    a.decidedAt = new Date().toISOString();
  }
  persist();
  return decorateApplication(a);
}

function withdrawApplication(id) {
  const a = state.applications.find((x) => x.id === id);
  if (!a) throw new Error("Application not found");
  if (a.status === "Awarded")
    throw new Error("Cannot withdraw an awarded application");
  a.status = "Withdrawn";
  a.decidedAt = new Date().toISOString();
  persist();
  return decorateApplication(a);
}

function summary() {
  const apps = state.applications;
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  for (const a of apps) counts[a.status] = (counts[a.status] || 0) + 1;

  // Total committed value (Awarded), only fixed-amount sums; percentage gives illustrative number
  let committedFixed = 0;
  let committedPercentageCount = 0;
  for (const a of apps) {
    if (a.status !== "Awarded") continue;
    const sc = state.schemes.find((s) => s.id === a.schemeId);
    if (!sc) continue;
    if (sc.valueType === "fixed") committedFixed += sc.value;
    else committedPercentageCount++;
  }

  return {
    schemes: state.schemes.length,
    activeSchemes: state.schemes.filter((s) => s.active).length,
    applications: apps.length,
    byStatus: counts,
    awarded: counts["Awarded"],
    pending: counts["Applied"] + counts["Under Review"],
    committedFixed,
    committedPercentageCount,
  };
}

module.exports = {
  TYPES,
  STATUSES,
  VALUE_TYPES,
  schemes: () => state.schemes,
  applications: () => state.applications,
  listSchemes,
  getScheme,
  listApplications,
  awardedForStudent,
  addScheme,
  updateScheme,
  removeScheme,
  apply,
  transitionApplication,
  withdrawApplication,
  summary,
};
