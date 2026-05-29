// Practice quizzes + question bank.
//
// Two collections persisted via store:
//   1. quiz-sets       — teacher-authored question sets
//   2. quiz-attempts   — every student attempt at a set (one row per submission)
//
// A SET is { id, subject, grade, title, description, createdBy, createdAt,
//            updatedAt, questions[] }
// A QUESTION is { id, text, options:string[4], correctIndex, points, explanation }
// An ATTEMPT is { id, setId, studentId, startedAt, submittedAt, answers,
//                 score, maxScore, timeSpentSec }
//
// We store the *full question set* at attempt time so editing a set later
// doesn't retroactively change historic scores.

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

let sets = store.load("quiz-sets", () => []);
let attempts = store.load("quiz-attempts", () => []);
const persistSets = () => store.save("quiz-sets", sets);
const persistAttempts = () => store.save("quiz-attempts", attempts);

function nowIso() {
  return new Date().toISOString();
}

function nextSetId() {
  let max = 0;
  for (const s of sets) {
    const n = parseInt(String(s.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `QS${String(max + 1).padStart(5, "0")}`;
}

function nextAttemptId() {
  let max = 0;
  for (const a of attempts) {
    const n = parseInt(String(a.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `QA${String(max + 1).padStart(6, "0")}`;
}

function nextQuestionId(set) {
  let max = 0;
  for (const q of set.questions || []) {
    const n = parseInt(String(q.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `Q${String(max + 1).padStart(4, "0")}`;
}

// ---------- validation ----------

function validateQuestion(q) {
  if (!q || typeof q !== "object") throw new Error("question must be an object");
  if (!q.text || !String(q.text).trim()) throw new Error("question.text required");
  if (!Array.isArray(q.options) || q.options.length !== 4)
    throw new Error("question.options must be an array of exactly 4 strings");
  if (q.options.some((o) => !String(o).trim()))
    throw new Error("question.options cannot be blank");
  const ci = Number(q.correctIndex);
  if (!Number.isInteger(ci) || ci < 0 || ci > 3)
    throw new Error("question.correctIndex must be 0..3");
  if (q.points !== undefined) {
    const p = Number(q.points);
    if (!Number.isFinite(p) || p <= 0 || p > 20)
      throw new Error("question.points must be 1..20");
  }
}

function normalizeQuestion(q, set) {
  return {
    id: q.id || nextQuestionId(set),
    text: String(q.text).trim().slice(0, 600),
    options: q.options.map((o) => String(o).trim().slice(0, 200)),
    correctIndex: Number(q.correctIndex),
    points: q.points !== undefined ? Number(q.points) : 1,
    explanation: q.explanation
      ? String(q.explanation).trim().slice(0, 600)
      : null,
  };
}

function validateSet(payload, { partial } = {}) {
  if (!partial) {
    if (!payload.title || !String(payload.title).trim())
      throw new Error("title required");
    if (!payload.subject) throw new Error("subject required");
    if (payload.grade === undefined) throw new Error("grade required");
  }
  if (payload.subject !== undefined && !SUBJECTS.includes(payload.subject))
    throw new Error(`subject must be one of ${SUBJECTS.join(", ")}`);
  if (payload.grade !== undefined) {
    const g = Number(payload.grade);
    if (!Number.isInteger(g) || g < 1 || g > 12)
      throw new Error("grade must be 1..12");
  }
  if (payload.questions !== undefined) {
    if (!Array.isArray(payload.questions))
      throw new Error("questions must be an array");
    if (payload.questions.length > 100)
      throw new Error("max 100 questions per set");
    payload.questions.forEach(validateQuestion);
  }
}

// ---------- mutations ----------

function createSet(payload, creator) {
  validateSet(payload);
  const now = nowIso();
  const set = {
    id: nextSetId(),
    title: String(payload.title).trim().slice(0, 140),
    subject: payload.subject,
    grade: Number(payload.grade),
    description: payload.description
      ? String(payload.description).trim().slice(0, 600)
      : null,
    createdBy: creator?.id || null,
    createdByName: creator?.name || null,
    createdAt: now,
    updatedAt: now,
    questions: [],
  };
  if (Array.isArray(payload.questions)) {
    set.questions = payload.questions.map((q) => normalizeQuestion(q, set));
  }
  sets.unshift(set);
  persistSets();
  return set;
}

function updateSet(id, patch) {
  const s = sets.find((x) => x.id === id);
  if (!s) throw new Error("Quiz set not found");
  validateSet(patch, { partial: true });
  if (patch.title !== undefined) s.title = String(patch.title).trim().slice(0, 140);
  if (patch.subject !== undefined) s.subject = patch.subject;
  if (patch.grade !== undefined) s.grade = Number(patch.grade);
  if (patch.description !== undefined)
    s.description = patch.description
      ? String(patch.description).trim().slice(0, 600)
      : null;
  if (Array.isArray(patch.questions)) {
    s.questions = patch.questions.map((q) => normalizeQuestion(q, s));
  }
  s.updatedAt = nowIso();
  persistSets();
  return s;
}

function deleteSet(id) {
  const idx = sets.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Quiz set not found");
  // Keep historic attempts (they snapshot the set), just unlink the live set.
  const [removed] = sets.splice(idx, 1);
  persistSets();
  return removed;
}

function getSet(id) {
  return sets.find((s) => s.id === id) || null;
}

function listSets({ subject, grade, q, createdBy } = {}) {
  let out = sets;
  if (subject && subject !== "all") out = out.filter((s) => s.subject === subject);
  if (grade) out = out.filter((s) => s.grade === Number(grade));
  if (createdBy) out = out.filter((s) => s.createdBy === createdBy);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (s) =>
        s.title.toLowerCase().includes(t) ||
        (s.description || "").toLowerCase().includes(t)
    );
  }
  return [...out].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- attempts ----------

/**
 * Build a "take" view of a set — same fields except `correctIndex` and
 * `explanation` are stripped from each question so the student can't see
 * answers before submitting.
 */
function takeView(set) {
  return {
    id: set.id,
    title: set.title,
    subject: set.subject,
    grade: set.grade,
    description: set.description,
    questions: set.questions.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
      points: q.points,
    })),
  };
}

function startAttempt(setId, studentId) {
  const set = getSet(setId);
  if (!set) throw new Error("Quiz set not found");
  if (!studentId) throw new Error("studentId required");
  if (set.questions.length === 0)
    throw new Error("This quiz has no questions yet");
  const rec = {
    id: nextAttemptId(),
    setId,
    setSnapshot: JSON.parse(JSON.stringify(set)), // freeze content at attempt-time
    studentId,
    startedAt: nowIso(),
    submittedAt: null,
    answers: {},
    score: null,
    maxScore: set.questions.reduce((s, q) => s + (q.points || 1), 0),
    timeSpentSec: null,
  };
  attempts.unshift(rec);
  persistAttempts();
  return { attempt: rec, take: takeView(set) };
}

function getAttempt(id) {
  return attempts.find((a) => a.id === id) || null;
}

function submitAttempt(id, { answers } = {}) {
  const a = attempts.find((x) => x.id === id);
  if (!a) throw new Error("Attempt not found");
  if (a.submittedAt) throw new Error("Attempt already submitted");
  if (!answers || typeof answers !== "object")
    throw new Error("answers object required");
  const set = a.setSnapshot;
  let score = 0;
  const breakdown = set.questions.map((q) => {
    const picked = answers[q.id];
    const correct = picked !== undefined && Number(picked) === q.correctIndex;
    if (correct) score += q.points || 1;
    return {
      questionId: q.id,
      pickedIndex: picked === undefined ? null : Number(picked),
      correctIndex: q.correctIndex,
      correct,
      points: q.points || 1,
      explanation: q.explanation,
    };
  });
  a.answers = answers;
  a.submittedAt = nowIso();
  a.timeSpentSec = Math.max(
    0,
    Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 1000)
  );
  a.score = score;
  persistAttempts();
  return { attempt: a, breakdown };
}

function listAttempts({ studentId, setId } = {}) {
  let out = attempts;
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (setId) out = out.filter((a) => a.setId === setId);
  return [...out].sort((a, b) =>
    (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt)
  );
}

/**
 * Teacher-side analytics for a single set: average score, completion rate,
 * per-question correctness percentages.
 */
function setAnalytics(setId) {
  const set = getSet(setId);
  if (!set) return null;
  const done = attempts.filter((a) => a.setId === setId && a.submittedAt);
  const avgPct =
    done.length === 0
      ? null
      : Math.round(
          (done.reduce(
            (s, a) => s + (a.maxScore ? a.score / a.maxScore : 0),
            0
          ) /
            done.length) *
            100
        );
  const perQuestion = set.questions.map((q) => {
    let attempted = 0;
    let correct = 0;
    for (const a of done) {
      const picked = a.answers[q.id];
      if (picked === undefined) continue;
      attempted++;
      // Use the snapshot's correctIndex — the set may have been edited
      // since, but the *attempt* was scored against the snapshot at the time.
      const snapQ = (a.setSnapshot.questions || []).find((x) => x.id === q.id);
      const cIdx = snapQ ? snapQ.correctIndex : q.correctIndex;
      if (Number(picked) === cIdx) correct++;
    }
    return {
      questionId: q.id,
      text: q.text,
      attempted,
      correct,
      correctPct: attempted ? Math.round((correct / attempted) * 100) : null,
    };
  });
  return {
    totalAttempts: done.length,
    avgPct,
    medianTimeSec:
      done.length === 0
        ? null
        : (() => {
            const times = done
              .map((a) => a.timeSpentSec || 0)
              .sort((a, b) => a - b);
            return times[Math.floor(times.length / 2)] || 0;
          })(),
    perQuestion,
  };
}

function summary() {
  const totalSets = sets.length;
  const totalQuestions = sets.reduce((s, x) => s + x.questions.length, 0);
  const totalAttempts = attempts.filter((a) => a.submittedAt).length;
  const last7 = Date.now() - 7 * 86400000;
  const attemptsLast7 = attempts.filter(
    (a) => a.submittedAt && new Date(a.submittedAt).getTime() >= last7
  ).length;
  return { totalSets, totalQuestions, totalAttempts, attemptsLast7 };
}

module.exports = {
  SUBJECTS,
  createSet,
  updateSet,
  deleteSet,
  getSet,
  listSets,
  takeView,
  startAttempt,
  getAttempt,
  submitAttempt,
  listAttempts,
  setAnalytics,
  summary,
};
