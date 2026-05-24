// Year-End Class Promotion
//
// Once a year, the entire active roster moves up a grade:
//   - Grades 1..11 → Grades 2..12 (carrying section + house + parent + contact)
//   - Grade 12     → graduated into the Alumni directory
//
// Admins can:
//   - "Hold back" individual students (they keep their current grade)
//   - Tag the graduating cohort with a stream (Science / Commerce / Arts /
//     General) and a graduation year — used to seed their alumni record
//   - Preview the impact (per-grade flow + at-risk roster) before committing
//   - Roll back the most recent cycle if something looks wrong — restores the
//     pre-commit student snapshot AND removes the alumni records that were
//     auto-created at graduation
//
// Cycles are durable: each commit appends to `promotion-cycles` with a deep
// snapshot of the prior student state, the new alumni IDs created, and stats
// for the audit trail.

const store = require("./store");
const alumniData = require("./alumni");

// The active-student array reference is owned by index.js (`db.students`).
// We accept it via `bind()` so mutations stay visible to every route that
// reads from the same reference — no need to refresh stale copies.
let studentsRef = null;
function bind(arr) {
  studentsRef = arr;
}

// At-risk thresholds — surfaced in the preview so admins can decide whether
// to hold any of them back. Not enforced — the admin always has the final say.
const ATTENDANCE_AT_RISK = 75;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function academicYearLabel(year) {
  return `${year}-${year + 1}`;
}

function defaultGradStream(student) {
  // Heuristic for the demo — real schools pick stream in Grade 11.
  // Round-robin by id for variety.
  const n = parseInt(String(student.id).replace(/\D+/g, ""), 10) || 0;
  return ["Science", "Commerce", "Arts", "General"][n % 4];
}

function loadCycles() {
  return store.load("promotion-cycles", () => []);
}

function persistCycles(cycles) {
  store.save("promotion-cycles", cycles);
}

function persistStudents() {
  store.save("students", studentsRef);
}

// -------- preview --------

function preview({ holdBackIds = [], graduatingYear } = {}) {
  const heldSet = new Set(holdBackIds);
  const year = Number(graduatingYear) || new Date().getFullYear();

  const perGrade = {};
  for (let g = 1; g <= 12; g++) {
    perGrade[g] = { fromGrade: g, toGrade: g + 1, count: 0 };
  }
  perGrade[12].toGrade = "Alumni";

  const heldBack = [];
  const promoted = [];
  const graduating = [];
  const atRisk = [];

  for (const s of studentsRef) {
    if (heldSet.has(s.id)) {
      heldBack.push({
        id: s.id,
        name: s.name,
        grade: s.grade,
        section: s.section,
        reason: atRiskReason(s),
      });
      continue;
    }
    if (s.grade >= 12) {
      graduating.push({
        id: s.id,
        name: s.name,
        section: s.section,
        house: s.house,
        avatar: s.avatar,
        gpa: s.gpa,
        attendance: s.attendance,
        feeStatus: s.feeStatus,
        defaultStream: defaultGradStream(s),
      });
    } else {
      promoted.push({ id: s.id, name: s.name, from: s.grade, to: s.grade + 1 });
      perGrade[s.grade].count++;
    }
  }
  perGrade[12].count = graduating.length;

  for (const s of studentsRef) {
    if (heldSet.has(s.id)) continue;
    if (s.attendance < ATTENDANCE_AT_RISK || s.feeStatus === "Pending") {
      atRisk.push({
        id: s.id,
        name: s.name,
        grade: s.grade,
        section: s.section,
        attendance: s.attendance,
        feeStatus: s.feeStatus,
        reason: atRiskReason(s),
      });
    }
  }
  atRisk.sort((a, b) => a.attendance - b.attendance);

  return {
    targetAcademicYear: academicYearLabel(year),
    totals: {
      total: studentsRef.length,
      promoted: promoted.length,
      graduated: graduating.length,
      heldBack: heldBack.length,
    },
    perGrade: Object.values(perGrade),
    heldBack,
    graduating,
    atRisk: atRisk.slice(0, 25),
    atRiskTotal: atRisk.length,
  };
}

function atRiskReason(s) {
  const reasons = [];
  if (s.attendance < ATTENDANCE_AT_RISK) reasons.push(`Attendance ${s.attendance}%`);
  if (s.feeStatus === "Pending") reasons.push("Fees pending");
  if (s.feeStatus === "Partial") reasons.push("Fees partial");
  return reasons.join(" · ") || null;
}

// -------- commit --------

function commit({ holdBackIds = [], graduatingYear, gradStreams = {}, note, user } = {}) {
  const cycles = loadCycles();
  // Block stacking active drafts — one cycle at a time
  const lastUncommitted = cycles.find((c) => c.status === "committed" && c.targetAcademicYear === academicYearLabel(Number(graduatingYear) || new Date().getFullYear()));
  if (lastUncommitted) {
    throw new Error(
      `Already promoted into ${lastUncommitted.targetAcademicYear} (cycle ${lastUncommitted.id}). Roll back first.`
    );
  }

  const heldSet = new Set(holdBackIds);
  const year = Number(graduatingYear) || new Date().getFullYear();

  // 1. Snapshot students BEFORE we mutate, so rollback is exact.
  const studentsSnapshot = deepClone(studentsRef);

  // 2. Build alumni records for the graduating cohort.
  const newAlumni = [];
  const graduatedStudentIds = [];

  for (const s of studentsRef) {
    if (heldSet.has(s.id)) continue;
    if (s.grade !== 12) continue;
    const stream = gradStreams[s.id] || defaultGradStream(s);
    const alumnus = alumniData.add({
      name: s.name,
      gradYear: year,
      stream,
      house: s.house,
      formerRollNo: s.id,
      destination: "College",
      destinationLabel: null,
      city: "Bengaluru",
      email: emailFor(s),
      phone: s.contact,
      verified: false,
      mentor: false,
      donor: false,
      consent: { directory: true, contact: false },
      notes: `Auto-created on promotion ${academicYearLabel(year)}.`,
    });
    newAlumni.push({ alumnusId: alumnus.id, studentId: s.id, name: s.name, stream });
    graduatedStudentIds.push(s.id);
  }

  // 3. Mutate the active roster in-place:
  //    - drop graduating students entirely
  //    - increment grade for everyone else (unless held back)
  const promoted = [];
  const heldBack = [];

  const gradSet = new Set(graduatedStudentIds);
  const newStudents = [];
  for (const s of studentsRef) {
    if (gradSet.has(s.id)) continue;
    if (heldSet.has(s.id)) {
      heldBack.push({ id: s.id, name: s.name, grade: s.grade });
      newStudents.push(s);
      continue;
    }
    const from = s.grade;
    s.grade = Math.min(12, s.grade + 1);
    promoted.push({ id: s.id, name: s.name, from, to: s.grade });
    newStudents.push(s);
  }
  // Mutate the bound array in place so every other route that already holds
  // this reference (e.g. `db.students`) keeps seeing the live roster.
  studentsRef.length = 0;
  for (const s of newStudents) studentsRef.push(s);
  persistStudents();

  // 4. Record the cycle.
  const id = `PROM-${year}-${String(cycles.length + 1).padStart(2, "0")}`;
  const cycle = {
    id,
    status: "committed",
    targetAcademicYear: academicYearLabel(year),
    graduatingYear: year,
    committedAt: new Date().toISOString(),
    committedBy: user?.name || "system",
    committedByRole: user?.role || null,
    note: note || null,
    totals: {
      total: studentsSnapshot.length,
      promoted: promoted.length,
      graduated: graduatedStudentIds.length,
      heldBack: heldBack.length,
    },
    promoted,
    heldBack,
    graduates: newAlumni,
    snapshot: studentsSnapshot,
  };
  cycles.unshift(cycle);
  persistCycles(cycles);
  return publicCycle(cycle);
}

function emailFor(student) {
  const slug = String(student.name || "alum")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  const n = String(student.id).replace(/\D+/g, "").slice(-2) || "00";
  return `${slug}${n}@gmail.com`;
}

// -------- rollback --------

function rollback(id, { user } = {}) {
  const cycles = loadCycles();
  const cycle = cycles.find((c) => c.id === id);
  if (!cycle) throw new Error("Cycle not found");
  if (cycle.status !== "committed") {
    throw new Error(`Cycle is ${cycle.status}, cannot roll back`);
  }

  // Restore the active roster from the snapshot. We replace contents in-place
  // so the array reference stays stable (same reasoning as the commit path).
  const snap = cycle.snapshot || [];
  studentsRef.length = 0;
  for (const s of deepClone(snap)) studentsRef.push(s);
  persistStudents();

  // Remove the alumni records this cycle auto-created.
  for (const g of cycle.graduates || []) {
    try {
      alumniData.remove(g.alumnusId);
    } catch {
      // Alumnus may have been deleted by an admin already — non-fatal.
    }
  }

  cycle.status = "rolled_back";
  cycle.rolledBackAt = new Date().toISOString();
  cycle.rolledBackBy = user?.name || "system";
  cycle.rolledBackByRole = user?.role || null;
  persistCycles(cycles);
  return publicCycle(cycle);
}

// -------- read helpers --------

function publicCycle(c) {
  if (!c) return null;
  // Don't ship the (potentially large) snapshot back to the UI on list views —
  // it's only needed server-side for rollback.
  const { snapshot, ...rest } = c;
  return { ...rest, snapshotSize: Array.isArray(snapshot) ? snapshot.length : 0 };
}

function list() {
  return loadCycles().map(publicCycle);
}

function get(id) {
  const c = loadCycles().find((x) => x.id === id);
  return c ? publicCycle(c) : null;
}

function summary() {
  const cycles = loadCycles();
  const committed = cycles.filter((c) => c.status === "committed");
  const last = committed[0] || null;
  const totalGraduates = committed.reduce(
    (s, c) => s + (c.totals?.graduated || 0),
    0
  );
  const totalPromoted = committed.reduce(
    (s, c) => s + (c.totals?.promoted || 0),
    0
  );
  return {
    cyclesCommitted: committed.length,
    cyclesTotal: cycles.length,
    lastCycle: last
      ? {
          id: last.id,
          targetAcademicYear: last.targetAcademicYear,
          committedAt: last.committedAt,
          graduated: last.totals?.graduated || 0,
          promoted: last.totals?.promoted || 0,
        }
      : null,
    totalGraduates,
    totalPromoted,
  };
}

module.exports = {
  bind,
  preview,
  commit,
  rollback,
  list,
  get,
  summary,
  ATTENDANCE_AT_RISK,
};
