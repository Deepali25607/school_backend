// Assignments & submissions store.
//
// Two persistent collections layered on store.js:
//   assignments → array of { id, title, description, subject, grade, section,
//                            teacherId, createdAt, dueAt, maxMarks }
//   submissions → array of { id, assignmentId, studentId, submittedAt,
//                            text, marks, feedback, status }
//
// Both live under db/<name>.json so they survive restarts (locally — Render
// free-tier disk is ephemeral, so prod resets on each deploy).

const store = require("./store");

const VALID_SUBJECTS = [
  "Mathematics", "Physics", "Chemistry", "Biology", "English",
  "History", "Geography", "Computer Sci", "PE", "Art",
];

const SUB_STATUSES = ["Submitted", "Graded", "Late"];

// Assignment photos (e.g. a teacher snapping the worksheet) are stored inline
// as base64 data URLs — same approach as profile photos, since this app has no
// external file store. The client resizes before upload, so real payloads are
// small; these caps just guard against accidental full-resolution dumps.
const MAX_ASSIGNMENT_IMAGES = 6;
const ASSIGNMENT_IMAGE_MAX_BYTES = 1024 * 1024; // ~1 MB per image (base64 chars)

function validateImages(value) {
  if (!Array.isArray(value)) throw new Error("images must be an array");
  if (value.length > MAX_ASSIGNMENT_IMAGES)
    throw new Error(`too many images (max ${MAX_ASSIGNMENT_IMAGES})`);
  return value.map((img) => {
    if (typeof img !== "string")
      throw new Error("each image must be a data:image base64 string");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(img))
      throw new Error("images must be data:image/... base64 URLs");
    if (img.length > ASSIGNMENT_IMAGE_MAX_BYTES)
      throw new Error(
        `an image is too large (max ${Math.round(ASSIGNMENT_IMAGE_MAX_BYTES / 1024)} KB each)`
      );
    return img;
  });
}

let assignments = store.load("assignments", () => []);
let submissions = store.load("submissions", () => []);

const persistA = () => store.save("assignments", assignments);
const persistS = () => store.save("submissions", submissions);

function nextAssignmentId() {
  let max = 0;
  for (const a of assignments) {
    const n = parseInt(String(a.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ASG${String(max + 1).padStart(4, "0")}`;
}

function nextSubmissionId() {
  let max = 0;
  for (const s of submissions) {
    const n = parseInt(String(s.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `SUB${String(max + 1).padStart(4, "0")}`;
}

function validateAssignmentPayload(p, { partial = false } = {}) {
  const out = {};
  if (p.title !== undefined) {
    const v = String(p.title).trim();
    if (!v) throw new Error("title is required");
    if (v.length > 200) throw new Error("title too long (max 200 chars)");
    out.title = v;
  } else if (!partial) throw new Error("title is required");

  if (p.description !== undefined) {
    out.description = String(p.description).trim().slice(0, 4000);
  } else if (!partial) out.description = "";

  if (p.subject !== undefined) {
    if (!VALID_SUBJECTS.includes(p.subject))
      throw new Error(`subject must be one of: ${VALID_SUBJECTS.join(", ")}`);
    out.subject = p.subject;
  } else if (!partial) throw new Error("subject is required");

  if (p.grade !== undefined) {
    const g = Number(p.grade);
    if (!Number.isInteger(g) || g < 1 || g > 12)
      throw new Error("grade must be 1-12");
    out.grade = g;
  } else if (!partial) throw new Error("grade is required");

  if (p.section !== undefined) {
    if (p.section === null || p.section === "") {
      out.section = null;
    } else {
      const sec = String(p.section).toUpperCase();
      if (!["A", "B", "C", "D"].includes(sec))
        throw new Error("section must be A, B, C, D or null (whole grade)");
      out.section = sec;
    }
  } else if (!partial) out.section = null;

  if (p.dueAt !== undefined) {
    const d = new Date(p.dueAt);
    if (Number.isNaN(d.getTime())) throw new Error("dueAt must be a valid date");
    out.dueAt = d.toISOString();
  } else if (!partial) throw new Error("dueAt is required");

  if (p.maxMarks !== undefined) {
    if (p.maxMarks === null || p.maxMarks === "") {
      out.maxMarks = null;
    } else {
      const m = Number(p.maxMarks);
      if (!Number.isFinite(m) || m <= 0 || m > 1000)
        throw new Error("maxMarks must be 1-1000");
      out.maxMarks = m;
    }
  } else if (!partial) out.maxMarks = null;

  if (p.images !== undefined) {
    out.images = validateImages(p.images);
  } else if (!partial) out.images = [];

  return out;
}

function listAssignments({ grade, section, subject, teacherId, status } = {}) {
  let list = assignments.slice();
  if (grade !== undefined && grade !== null && grade !== "")
    list = list.filter((a) => String(a.grade) === String(grade));
  if (section) list = list.filter((a) => !a.section || a.section === section);
  if (subject) list = list.filter((a) => a.subject === subject);
  if (teacherId) list = list.filter((a) => a.teacherId === teacherId);
  if (status === "open")
    list = list.filter((a) => new Date(a.dueAt).getTime() >= Date.now());
  if (status === "closed")
    list = list.filter((a) => new Date(a.dueAt).getTime() < Date.now());
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getAssignment(id) {
  return assignments.find((a) => a.id === id) || null;
}

function addAssignment(payload, teacherId) {
  if (!teacherId) throw new Error("teacherId required");
  const clean = validateAssignmentPayload(payload);
  const rec = {
    id: nextAssignmentId(),
    teacherId,
    createdAt: new Date().toISOString(),
    ...clean,
  };
  assignments.push(rec);
  persistA();
  return rec;
}

function updateAssignment(id, payload) {
  const rec = getAssignment(id);
  if (!rec) throw new Error("Assignment not found");
  const clean = validateAssignmentPayload(payload, { partial: true });
  Object.assign(rec, clean);
  persistA();
  return rec;
}

function removeAssignment(id) {
  const i = assignments.findIndex((a) => a.id === id);
  if (i === -1) throw new Error("Assignment not found");
  const [removed] = assignments.splice(i, 1);
  // Cascade: also clear submissions for this assignment.
  submissions = submissions.filter((s) => s.assignmentId !== id);
  persistA();
  persistS();
  return removed;
}

// ---------- submissions ----------

function listSubmissions({ assignmentId, studentId } = {}) {
  let list = submissions.slice();
  if (assignmentId) list = list.filter((s) => s.assignmentId === assignmentId);
  if (studentId) list = list.filter((s) => s.studentId === studentId);
  return list.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getSubmissionFor(assignmentId, studentId) {
  return (
    submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === studentId
    ) || null
  );
}

function submitAssignment(assignmentId, studentId, payload = {}) {
  const a = getAssignment(assignmentId);
  if (!a) throw new Error("Assignment not found");
  if (!studentId) throw new Error("studentId required");
  const text = String(payload.text || "").trim().slice(0, 8000);
  // Students can submit a written answer, photos of the solved sheet, or both.
  const images = payload.images !== undefined ? validateImages(payload.images) : [];
  if (!text && images.length === 0)
    throw new Error("Add an answer — write something or attach a photo");

  const now = new Date();
  const due = new Date(a.dueAt);
  const status = now.getTime() > due.getTime() ? "Late" : "Submitted";

  const existing = getSubmissionFor(assignmentId, studentId);
  if (existing) {
    // Allow resubmission until graded.
    if (existing.status === "Graded")
      throw new Error("This submission has already been graded");
    existing.text = text;
    existing.images = images;
    existing.submittedAt = now.toISOString();
    existing.status = status;
    persistS();
    return existing;
  }

  const rec = {
    id: nextSubmissionId(),
    assignmentId,
    studentId,
    text,
    images,
    submittedAt: now.toISOString(),
    marks: null,
    feedback: null,
    status,
  };
  submissions.push(rec);
  persistS();
  return rec;
}

function gradeSubmission(submissionId, { marks, feedback }) {
  const sub = submissions.find((s) => s.id === submissionId);
  if (!sub) throw new Error("Submission not found");
  const a = getAssignment(sub.assignmentId);
  if (!a) throw new Error("Underlying assignment is gone");

  if (marks !== undefined && marks !== null) {
    const m = Number(marks);
    if (!Number.isFinite(m) || m < 0)
      throw new Error("marks must be a non-negative number");
    if (a.maxMarks && m > a.maxMarks)
      throw new Error(`marks cannot exceed maxMarks (${a.maxMarks})`);
    sub.marks = m;
  }
  if (feedback !== undefined) {
    sub.feedback = feedback === null ? null : String(feedback).trim().slice(0, 4000);
  }
  sub.status = "Graded";
  persistS();
  return sub;
}

function summaryForAssignment(assignmentId, eligibleStudentIds) {
  const eligible = eligibleStudentIds ? new Set(eligibleStudentIds) : null;
  const subs = submissions.filter((s) => s.assignmentId === assignmentId);
  const filtered = eligible
    ? subs.filter((s) => eligible.has(s.studentId))
    : subs;
  const submitted = filtered.length;
  const graded = filtered.filter((s) => s.status === "Graded").length;
  const late = filtered.filter((s) => s.status === "Late").length;
  return {
    submitted,
    graded,
    late,
    total: eligibleStudentIds ? eligibleStudentIds.length : null,
  };
}

module.exports = {
  VALID_SUBJECTS,
  SUB_STATUSES,
  MAX_ASSIGNMENT_IMAGES,
  listAssignments,
  getAssignment,
  addAssignment,
  updateAssignment,
  removeAssignment,
  listSubmissions,
  getSubmissionFor,
  submitAssignment,
  gradeSubmission,
  summaryForAssignment,
  get assignments() { return assignments; },
  get submissions() { return submissions; },
};
