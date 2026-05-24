// Health & Medical records — per-student health profile + nurse-visit log.
//
// Two collections in this module:
//   1. profiles  — keyed by studentId: blood group, allergies, conditions,
//                  emergency contact, vaccinations
//   2. visits    — append-only log of nurse-office visits / sickbay entries
//
// Profiles are auto-seeded from the student roster the first time the file is
// missing. Future restarts read what's on disk so edits stick.

const store = require("./store");
const seed = require("./seed");

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const COMMON_ALLERGIES = ["Peanuts", "Dust mites", "Pollen", "Penicillin", "Lactose", "Shellfish", "Latex"];
const COMMON_CONDITIONS = ["Asthma", "Diabetes Type 1", "Migraine", "Epilepsy", "ADHD", "Anxiety"];
const VACCINES = [
  { code: "MMR", name: "MMR (Measles–Mumps–Rubella)" },
  { code: "TDAP", name: "Tdap (Tetanus–Diphtheria–Pertussis)" },
  { code: "HEPB", name: "Hepatitis B" },
  { code: "VARI", name: "Varicella (Chicken pox)" },
  { code: "POLIO", name: "Polio (IPV)" },
  { code: "HPV", name: "HPV" },
  { code: "FLU", name: "Influenza (annual)" },
];
const VISIT_SEVERITIES = ["Routine", "Minor", "Moderate", "Urgent"];
const COMMON_COMPLAINTS = [
  "Headache",
  "Stomach ache",
  "Fever",
  "Cut / Scrape",
  "Sprain",
  "Nausea",
  "Cough / Cold",
  "Eye irritation",
  "Anxiety / Panic",
  "Fatigue",
];

// Deterministic small hash (mirrors the one in index.js — duplicating to keep
// this module standalone). Stable across restarts so demo data doesn't shuffle.
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

function buildProfiles() {
  return seed.students.map((s) => {
    const h = hash(s.id);
    const allergyCount = h % 4 === 0 ? 2 : h % 3 === 0 ? 1 : 0;
    const allergies = [];
    for (let i = 0; i < allergyCount; i++) {
      const a = pick(COMMON_ALLERGIES, s.id, "ally", i);
      if (!allergies.includes(a)) allergies.push(a);
    }
    const conditionRoll = (h >>> 4) % 9;
    const conditions =
      conditionRoll < 2 ? [pick(COMMON_CONDITIONS, s.id, "cond")] : [];
    // Each student has a vaccination record for ~5 of the 7 vaccines
    const vaccinations = VACCINES.map((v) => {
      const taken = hash(s.id, v.code) % 6 !== 0; // ~83% coverage
      return {
        code: v.code,
        taken,
        date: taken ? dateOffset(60 + (hash(s.id, v.code) % 900)) : null,
      };
    });
    return {
      studentId: s.id,
      bloodGroup: pick(BLOOD_GROUPS, s.id, "blood"),
      heightCm: 120 + (hash(s.id, "h") % 60),
      weightKg: 25 + (hash(s.id, "w") % 40),
      allergies,
      chronicConditions: conditions,
      emergencyContact: {
        name: s.parent,
        relation: "Parent",
        phone: s.contact,
      },
      doctor: pick(["Dr. Priya Menon", "Dr. Rajiv Bhatia", "Dr. Anand Iyer"], s.id, "doc"),
      lastCheckup: dateOffset(30 + (hash(s.id, "check") % 240)),
      vaccinations,
      notes: null,
    };
  });
}

function buildVisits() {
  // Seed ~25 sample nurse visits across the roster, spread across last 30 days
  const visits = [];
  const allStudents = seed.students;
  for (let i = 0; i < 25; i++) {
    const s = allStudents[hash("visit", i) % allStudents.length];
    const complaint = COMMON_COMPLAINTS[hash(s.id, i) % COMMON_COMPLAINTS.length];
    const severity = VISIT_SEVERITIES[hash(s.id, i, "sev") % VISIT_SEVERITIES.length];
    const daysAgo = hash("vd", i) % 30;
    visits.push({
      id: `VIS${String(8000 + i + 1)}`,
      studentId: s.id,
      visitedOn: dateOffset(daysAgo),
      visitedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      complaint,
      severity,
      diagnosis: `${complaint} — observed`,
      treatment:
        severity === "Routine"
          ? "Rest in sickbay. Returned to class."
          : severity === "Minor"
          ? "Paracetamol 250mg. Hydration. Observed 30 min."
          : severity === "Moderate"
          ? "Treated and parents notified. Sent home."
          : "Referred to hospital. Parents contacted.",
      attendedBy: pick(["Nurse Aisha Khan", "Nurse Prakash R.", "Dr. on duty"], s.id, "nurse"),
      followUp: hash("fup", i) % 5 === 0,
    });
  }
  // newest first
  return visits.sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt));
}

let profiles = store.load("health_profiles", buildProfiles);
let visits = store.load("health_visits", buildVisits);
const persistProfiles = () => store.save("health_profiles", profiles);
const persistVisits = () => store.save("health_visits", visits);

function getProfile(studentId) {
  return profiles.find((p) => p.studentId === studentId) || null;
}

function listProfiles({ q, condition, bloodGroup } = {}) {
  let list = profiles.slice();
  if (bloodGroup && bloodGroup !== "all")
    list = list.filter((p) => p.bloodGroup === bloodGroup);
  if (condition && condition !== "all") {
    if (condition === "allergies") list = list.filter((p) => p.allergies.length > 0);
    else if (condition === "chronic")
      list = list.filter((p) => p.chronicConditions.length > 0);
    else list = list.filter((p) => p.chronicConditions.includes(condition));
  }
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (p) =>
        p.studentId.toLowerCase().includes(t) ||
        (p.allergies || []).some((a) => a.toLowerCase().includes(t)) ||
        (p.chronicConditions || []).some((c) => c.toLowerCase().includes(t))
    );
  }
  return list;
}

function updateProfile(studentId, patch) {
  const p = getProfile(studentId);
  if (!p) throw new Error("Profile not found");
  const ALLOWED = [
    "bloodGroup",
    "heightCm",
    "weightKg",
    "allergies",
    "chronicConditions",
    "emergencyContact",
    "doctor",
    "lastCheckup",
    "vaccinations",
    "notes",
  ];
  for (const k of ALLOWED) {
    if (patch[k] !== undefined) p[k] = patch[k];
  }
  persistProfiles();
  return p;
}

function listVisits({ q, studentId, severity, sinceDays } = {}) {
  let list = visits.slice();
  if (studentId) list = list.filter((v) => v.studentId === studentId);
  if (severity && severity !== "all") list = list.filter((v) => v.severity === severity);
  if (sinceDays) {
    const cutoff = Date.now() - Number(sinceDays) * 86400000;
    list = list.filter((v) => new Date(v.visitedAt).getTime() >= cutoff);
  }
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (v) =>
        v.studentId.toLowerCase().includes(t) ||
        v.complaint.toLowerCase().includes(t) ||
        (v.diagnosis || "").toLowerCase().includes(t)
    );
  }
  return list;
}

function addVisit(payload) {
  if (!payload.studentId) throw new Error("studentId required");
  if (!payload.complaint) throw new Error("complaint required");
  const v = {
    id: `VIS${String(8000 + visits.length + 1)}`,
    studentId: payload.studentId,
    visitedOn: dateOffset(0),
    visitedAt: new Date().toISOString(),
    complaint: payload.complaint,
    severity: VISIT_SEVERITIES.includes(payload.severity) ? payload.severity : "Minor",
    diagnosis: payload.diagnosis || payload.complaint + " — observed",
    treatment: payload.treatment || "Rest in sickbay.",
    attendedBy: payload.attendedBy || "Nurse on duty",
    followUp: !!payload.followUp,
  };
  visits.unshift(v);
  persistVisits();
  return v;
}

function summary() {
  const today = new Date().toISOString().slice(0, 10);
  const last7 = Date.now() - 7 * 86400000;
  return {
    totalProfiles: profiles.length,
    visitsToday: visits.filter((v) => v.visitedOn === today).length,
    visitsLast7d: visits.filter((v) => new Date(v.visitedAt).getTime() >= last7).length,
    urgentLast7d: visits.filter(
      (v) =>
        new Date(v.visitedAt).getTime() >= last7 && v.severity === "Urgent"
    ).length,
    withAllergies: profiles.filter((p) => p.allergies.length > 0).length,
    withConditions: profiles.filter((p) => p.chronicConditions.length > 0).length,
    fullyVaccinated: profiles.filter(
      (p) => p.vaccinations.filter((x) => x.taken).length === p.vaccinations.length
    ).length,
  };
}

module.exports = {
  BLOOD_GROUPS,
  COMMON_ALLERGIES,
  COMMON_CONDITIONS,
  VACCINES,
  VISIT_SEVERITIES,
  COMMON_COMPLAINTS,
  profiles: () => profiles,
  visits: () => visits,
  getProfile,
  listProfiles,
  updateProfile,
  listVisits,
  addVisit,
  summary,
};
