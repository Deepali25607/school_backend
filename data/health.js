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

// School-vaccination schedule. Each entry expresses *when* each dose for a
// vaccine should be administered, in terms of the student's grade and an
// optional gap-after-previous-dose window (in months). This mirrors the
// kind of policy a school nurse follows from a public-health calendar.
//
// `requiredByGrade`: dose is overdue if the student is in this grade or
//   later and the dose hasn't been recorded.
// `gapMonths`: if set, the next dose can be scheduled only this many
//   months after the previous dose was administered.
// `annual`: true → a fresh dose is expected every academic year.
const VACCINE_SCHEDULE = {
  MMR: {
    doses: [
      { label: "Dose 1", requiredByGrade: 1 },
      { label: "Dose 2", requiredByGrade: 5, gapMonths: 12 },
    ],
  },
  TDAP: {
    doses: [
      { label: "Primary", requiredByGrade: 1 },
      { label: "Booster", requiredByGrade: 7, gapMonths: 60 },
    ],
  },
  HEPB: {
    doses: [
      { label: "Dose 1", requiredByGrade: 1 },
      { label: "Dose 2", requiredByGrade: 1, gapMonths: 1 },
      { label: "Dose 3", requiredByGrade: 1, gapMonths: 5 },
    ],
  },
  VARI: {
    doses: [{ label: "Dose 1", requiredByGrade: 1 }],
  },
  POLIO: {
    doses: [
      { label: "Dose 1", requiredByGrade: 1 },
      { label: "Booster", requiredByGrade: 5, gapMonths: 48 },
    ],
  },
  HPV: {
    doses: [
      { label: "Dose 1", requiredByGrade: 9 },
      { label: "Dose 2", requiredByGrade: 9, gapMonths: 6 },
    ],
  },
  FLU: {
    annual: true,
    doses: [{ label: "Annual", requiredByGrade: 1 }],
  },
};
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

// =========================================================================
// VACCINATION SCHEDULE & COMPLIANCE
// =========================================================================
//
// The seed `vaccinations` array on each profile used to be a flat
// {code, taken, date} list — fine for "first dose given yes/no" but no good
// for boosters, annual flu shots, or a real compliance dashboard. We keep
// that shape for backwards compatibility but enrich it lazily: each
// schedule lookup walks the profile's `doses[]` (an array of records keyed
// by vaccine code + dose label) to determine status.

function ensureDosesArray(profile) {
  // Migration step: forward-fill `doses[]` from the legacy `vaccinations`
  // list the first time we see a profile that doesn't have it. We DON'T
  // back-fill every required dose — only the ones the legacy list says
  // were taken — so newly defined doses still show as "due".
  if (Array.isArray(profile.doses)) return;
  profile.doses = (profile.vaccinations || [])
    .filter((v) => v.taken)
    .map((v) => ({
      code: v.code,
      label: "Dose 1",
      date: v.date,
      administeredBy: "Seed",
    }));
}

function ageOf(student) {
  // We don't store DOBs, so we proxy "age" off grade. Good enough to
  // drive schedule rules expressed in grade terms.
  return Number(student?.grade) || 0;
}

function monthsBetween(a, b) {
  if (!a || !b) return Infinity;
  const da = new Date(a);
  const db = new Date(b);
  return (
    (db.getFullYear() - da.getFullYear()) * 12 +
    (db.getMonth() - da.getMonth())
  );
}

/**
 * Build the per-dose status report for a single student.
 * @returns {{
 *   vaccines: Array<{
 *     code, name, doses: Array<{
 *       label, status: "done"|"due"|"overdue"|"not-yet",
 *       requiredByGrade, gapMonths, administeredOn, administeredBy
 *     }>
 *   }>,
 *   summary: { total, done, due, overdue, notYet, compliancePct }
 * }}
 */
function vaccinationStatusFor(student, profile) {
  ensureDosesArray(profile);
  const today = new Date().toISOString().slice(0, 10);
  const grade = ageOf(student);
  const out = [];
  let done = 0,
    due = 0,
    overdue = 0,
    notYet = 0,
    total = 0;

  for (const vac of VACCINES) {
    const sched = VACCINE_SCHEDULE[vac.code];
    if (!sched) continue;
    const studentDoses = profile.doses.filter((d) => d.code === vac.code);
    // Sort administered doses by date so "previous dose" math is stable.
    const administered = [...studentDoses].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );

    const doseStatuses = [];
    for (let i = 0; i < sched.doses.length; i++) {
      const spec = sched.doses[i];
      const adm = administered[i] || null;
      let status;
      if (adm) {
        status = "done";
      } else if (grade < spec.requiredByGrade) {
        status = "not-yet";
      } else if (spec.gapMonths) {
        // The previous dose must exist before THIS dose can be due. If the
        // previous dose hasn't happened (or happened too recently), this
        // dose is "due" but not "overdue".
        const prev = administered[i - 1];
        if (!prev) status = "due";
        else {
          const monthsSince = monthsBetween(prev.date, today);
          status = monthsSince >= spec.gapMonths ? "overdue" : "due";
        }
      } else {
        status = "overdue";
      }

      doseStatuses.push({
        label: spec.label,
        status,
        requiredByGrade: spec.requiredByGrade,
        gapMonths: spec.gapMonths || null,
        administeredOn: adm?.date || null,
        administeredBy: adm?.administeredBy || null,
      });
      total++;
      if (status === "done") done++;
      else if (status === "due") due++;
      else if (status === "overdue") overdue++;
      else if (status === "not-yet") notYet++;
    }

    out.push({
      code: vac.code,
      name: vac.name,
      annual: !!sched.annual,
      doses: doseStatuses,
    });
  }

  const compliancePct =
    total - notYet === 0
      ? 100
      : Math.round((done / (total - notYet)) * 100);

  return {
    vaccines: out,
    summary: { total, done, due, overdue, notYet, compliancePct },
  };
}

/**
 * Record that a dose has been administered. The dose label must match one
 * of the labels defined in VACCINE_SCHEDULE for the given vaccine code.
 */
function recordDose(studentId, payload) {
  const profile = getProfile(studentId);
  if (!profile) throw new Error("No health profile for that student");
  ensureDosesArray(profile);
  const { code, label, date, administeredBy } = payload || {};
  if (!code || !VACCINES.find((v) => v.code === code))
    throw new Error("Unknown vaccine code");
  const sched = VACCINE_SCHEDULE[code];
  const validLabels = (sched?.doses || []).map((d) => d.label);
  if (!label || !validLabels.includes(label))
    throw new Error(
      `Dose label must be one of: ${validLabels.join(", ")}`
    );
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("date must be YYYY-MM-DD");
  // Reject duplicates: same code + label already recorded.
  const dupe = profile.doses.find((d) => d.code === code && d.label === label);
  if (dupe) {
    // Permit overwriting an older date if explicitly newer — typical use
    // case is "we logged the wrong date and want to fix it".
    dupe.date = date;
    dupe.administeredBy = administeredBy
      ? String(administeredBy).slice(0, 80)
      : dupe.administeredBy || null;
  } else {
    profile.doses.push({
      code,
      label,
      date,
      administeredBy: administeredBy
        ? String(administeredBy).slice(0, 80)
        : null,
    });
  }
  // Also forward-fill the legacy vaccinations flag so the existing
  // student-profile UI keeps showing "✓" without reaching for doses[].
  const legacy = profile.vaccinations.find((v) => v.code === code);
  if (legacy && !legacy.taken) {
    legacy.taken = true;
    legacy.date = date;
  }
  persistProfiles();
  return profile;
}

/**
 * Roster-wide compliance summary: counts per vaccine + per status. Used
 * to drive the staff "compliance overview" cards.
 */
function vaccinationCompliance({ students } = {}) {
  if (!Array.isArray(students)) return null;
  const perVaccine = {};
  for (const vac of VACCINES) {
    perVaccine[vac.code] = {
      code: vac.code,
      name: vac.name,
      done: 0,
      due: 0,
      overdue: 0,
      notYet: 0,
    };
  }
  let fullyCompliantStudents = 0;
  let studentsWithOverdue = 0;
  const overdueStudentIds = new Set();

  for (const s of students) {
    const profile = getProfile(s.id);
    if (!profile) continue;
    const status = vaccinationStatusFor(s, profile);
    let hasOverdue = false;
    let allDoneOrNotYet = true;
    for (const v of status.vaccines) {
      for (const d of v.doses) {
        const bucket = perVaccine[v.code];
        if (!bucket) continue;
        bucket[d.status === "not-yet" ? "notYet" : d.status]++;
        if (d.status === "overdue") {
          hasOverdue = true;
          overdueStudentIds.add(s.id);
        }
        if (d.status !== "done" && d.status !== "not-yet") allDoneOrNotYet = false;
      }
    }
    if (allDoneOrNotYet) fullyCompliantStudents++;
    if (hasOverdue) studentsWithOverdue++;
  }

  return {
    totalStudents: students.length,
    fullyCompliantStudents,
    studentsWithOverdue,
    perVaccine: Object.values(perVaccine),
    overdueStudentIds: Array.from(overdueStudentIds),
  };
}

module.exports = {
  BLOOD_GROUPS,
  COMMON_ALLERGIES,
  COMMON_CONDITIONS,
  VACCINES,
  VACCINE_SCHEDULE,
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
  // vaccinations
  vaccinationStatusFor,
  vaccinationCompliance,
  recordDose,
};
