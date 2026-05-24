const store = require("./store");

const SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "History",
  "Geography",
  "Computer Sci",
];

const TYPES = ["Unit Test", "Mid-term", "Final", "Practical"];

function buildSeed() {
  const today = new Date();
  const exams = [];
  let id = 1;
  for (const type of TYPES) {
    for (let grade = 1; grade <= 12; grade++) {
      const start = new Date(today);
      start.setDate(today.getDate() + (id % 30));
      const papers = SUBJECTS.slice(0, 5 + (grade % 4)).map((sub, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return {
          subject: sub,
          date: d.toISOString().slice(0, 10),
          startTime: "09:30",
          endTime: "12:30",
          maxMarks: 100,
          room: `Hall ${100 + ((id + i) % 12)}`,
        };
      });
      exams.push({
        id: `EX${1000 + id}`,
        name: `${type} · Grade ${grade}`,
        type,
        grade,
        startDate: papers[0].date,
        endDate: papers[papers.length - 1].date,
        status: computeStatus(papers, today),
        papers,
      });
      id++;
    }
  }
  return exams;
}

function computeStatus(papers, now = new Date()) {
  if (!papers || papers.length === 0) return "Scheduled";
  const sorted = [...papers].sort((a, b) => a.date.localeCompare(b.date));
  const first = new Date(sorted[0].date);
  const last = new Date(sorted[sorted.length - 1].date);
  // Treat exam day as fully within the window
  last.setHours(23, 59, 59, 999);
  if (last < now) return "Completed";
  if (first <= now) return "Ongoing";
  return "Scheduled";
}

let exams = store.load("exams", buildSeed);
const persist = () => store.save("exams", exams);

// Refresh statuses on boot — "Completed"/"Ongoing"/"Scheduled" flip with the
// calendar and we don't want a stale "Scheduled" tag once the dates have passed.
let statusesChanged = false;
for (const e of exams) {
  const fresh = computeStatus(e.papers);
  if (e.status !== fresh) {
    e.status = fresh;
    statusesChanged = true;
  }
}
if (statusesChanged) persist();

const marks = store.load("exam-marks", () => ({}));
const persistMarks = () => store.save("exam-marks", marks);

function gradeFor(pct) {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  if (pct >= 35) return "E";
  return "F";
}

// -------- helpers --------

function nextId() {
  let max = 1000;
  for (const e of exams) {
    const n = parseInt(String(e.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `EX${max + 1}`;
}

function recompute(exam) {
  if (!exam.papers || exam.papers.length === 0) {
    exam.startDate = null;
    exam.endDate = null;
  } else {
    const sorted = [...exam.papers].sort((a, b) => a.date.localeCompare(b.date));
    exam.startDate = sorted[0].date;
    exam.endDate = sorted[sorted.length - 1].date;
  }
  exam.status = computeStatus(exam.papers);
}

function validatePaper(p) {
  if (!p.subject) throw new Error("paper.subject required");
  if (!SUBJECTS.includes(p.subject))
    throw new Error(`paper.subject must be one of ${SUBJECTS.join(", ")}`);
  if (!p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date))
    throw new Error("paper.date must be YYYY-MM-DD");
  if (p.maxMarks !== undefined) {
    const m = Number(p.maxMarks);
    if (!Number.isFinite(m) || m <= 0 || m > 500)
      throw new Error("paper.maxMarks must be 1-500");
  }
}

function normalizePaper(p) {
  return {
    subject: p.subject,
    date: p.date,
    startTime: p.startTime || "09:30",
    endTime: p.endTime || "12:30",
    maxMarks: p.maxMarks !== undefined ? Number(p.maxMarks) : 100,
    room: p.room || "Hall 101",
  };
}

function validateExam(payload, { partial } = {}) {
  if (!partial) {
    if (!payload.name) throw new Error("name required");
    if (!payload.type) throw new Error("type required");
    if (payload.grade === undefined) throw new Error("grade required");
  }
  if (payload.type !== undefined && !TYPES.includes(payload.type))
    throw new Error(`type must be one of ${TYPES.join(", ")}`);
  if (payload.grade !== undefined) {
    const g = Number(payload.grade);
    if (!Number.isInteger(g) || g < 1 || g > 12)
      throw new Error("grade must be 1-12");
  }
  if (payload.papers !== undefined) {
    if (!Array.isArray(payload.papers) || payload.papers.length === 0)
      throw new Error("papers must be a non-empty array");
    const subs = new Set();
    for (const p of payload.papers) {
      validatePaper(p);
      if (subs.has(p.subject))
        throw new Error(`duplicate paper subject: ${p.subject}`);
      subs.add(p.subject);
    }
  }
}

// -------- mutations --------

function addExam(payload) {
  validateExam(payload);
  const exam = {
    id: nextId(),
    name: String(payload.name).trim(),
    type: payload.type,
    grade: Number(payload.grade),
    papers: payload.papers.map(normalizePaper),
  };
  recompute(exam);
  exams.unshift(exam);
  persist();
  return exam;
}

function updateExam(id, patch) {
  const e = exams.find((x) => x.id === id);
  if (!e) throw new Error("Exam not found");
  validateExam(patch, { partial: true });
  if (patch.name !== undefined) e.name = String(patch.name).trim();
  if (patch.type !== undefined) e.type = patch.type;
  if (patch.grade !== undefined) e.grade = Number(patch.grade);
  if (patch.papers !== undefined) e.papers = patch.papers.map(normalizePaper);
  recompute(e);
  persist();
  return e;
}

function removeExam(id) {
  const idx = exams.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Exam not found");
  const [removed] = exams.splice(idx, 1);
  // Cascade: remove this exam's marks from the marks store
  const prefix = `${id}:`;
  let removedMarks = 0;
  for (const key of Object.keys(marks)) {
    if (key.startsWith(prefix)) {
      delete marks[key];
      removedMarks++;
    }
  }
  persist();
  if (removedMarks > 0) persistMarks();
  return { ...removed, removedMarks };
}

function addPaper(id, paper) {
  const e = exams.find((x) => x.id === id);
  if (!e) throw new Error("Exam not found");
  validatePaper(paper);
  if (e.papers.some((p) => p.subject === paper.subject))
    throw new Error(`Paper for ${paper.subject} already exists`);
  e.papers.push(normalizePaper(paper));
  recompute(e);
  persist();
  return e;
}

function updatePaper(id, subject, patch) {
  const e = exams.find((x) => x.id === id);
  if (!e) throw new Error("Exam not found");
  const p = e.papers.find((x) => x.subject === subject);
  if (!p) throw new Error("Paper not found");
  validatePaper({ ...p, ...patch });
  if (patch.date !== undefined) p.date = patch.date;
  if (patch.startTime !== undefined) p.startTime = patch.startTime;
  if (patch.endTime !== undefined) p.endTime = patch.endTime;
  if (patch.maxMarks !== undefined) p.maxMarks = Number(patch.maxMarks);
  if (patch.room !== undefined) p.room = patch.room;
  recompute(e);
  persist();
  return e;
}

function removePaper(id, subject) {
  const e = exams.find((x) => x.id === id);
  if (!e) throw new Error("Exam not found");
  const idx = e.papers.findIndex((p) => p.subject === subject);
  if (idx === -1) throw new Error("Paper not found");
  if (e.papers.length === 1)
    throw new Error("Cannot remove the only paper — delete the exam instead");
  e.papers.splice(idx, 1);
  // Cascade: drop marks for this paper
  const prefix = `${id}:`;
  const suffix = `:${subject}`;
  for (const key of Object.keys(marks)) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) delete marks[key];
  }
  recompute(e);
  persist();
  persistMarks();
  return e;
}

module.exports = {
  get exams() { return exams; },
  marks,
  persistMarks,
  SUBJECTS,
  TYPES,
  gradeFor,
  computeStatus,
  addExam,
  updateExam,
  removeExam,
  addPaper,
  updatePaper,
  removePaper,
};
