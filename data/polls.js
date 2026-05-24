// Polls & Surveys — multi-question feedback collection.
//
// Each Poll has a title, description, audience, status, and a list of
// Questions. Question types:
//   - "single"   → one choice from `options[]`
//   - "multi"    → many choices from `options[]`
//   - "rating"   → integer 1..5
//   - "text"     → free-text answer (truncated to 500 chars)
//
// Responses are stored per-user (or anonymous) keyed by pollId:
//   { id, pollId, userId|null, anonymous, answers: { [questionId]: value }, submittedAt }
//
// Aggregation: results returned with each poll detail (counts per choice,
// rating average, sample text answers). Anonymous polls do NOT expose userIds
// in the result rollup.

const store = require("./store");

const TYPES = ["single", "multi", "rating", "text"];
const STATUSES = ["draft", "active", "closed"];
const AUDIENCES = ["all", "students", "parents", "teachers", "staff"];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSeed() {
  // Three seeded polls + a handful of responses each.
  const polls = [
    {
      id: "POLL5001",
      title: "How was the recent Annual Day?",
      description:
        "Share your feedback on the Annual Day event so we can plan an even better one next year.",
      audience: "all",
      status: "active",
      anonymous: false,
      createdBy: "Cultural Committee",
      createdAt: dateOffset(-3),
      startsAt: dateOffset(-3),
      endsAt: dateOffset(7),
      questions: [
        {
          id: "Q1",
          type: "rating",
          text: "Overall, how would you rate the event?",
          required: true,
        },
        {
          id: "Q2",
          type: "single",
          text: "Which performance did you enjoy the most?",
          options: [
            "Group dance",
            "Drama production",
            "Solo singing",
            "Instrumental ensemble",
            "Stand-up comedy",
          ],
          required: true,
        },
        {
          id: "Q3",
          type: "multi",
          text: "Which areas should we improve next year?",
          options: [
            "Seating arrangement",
            "Sound system",
            "Lighting",
            "Refreshments",
            "Programme schedule",
            "Parking",
          ],
          required: false,
        },
        {
          id: "Q4",
          type: "text",
          text: "Anything else you'd like to add?",
          required: false,
        },
      ],
    },
    {
      id: "POLL5002",
      title: "Cafeteria menu — which dishes should stay?",
      description:
        "Help us decide what stays on next month's lunch rotation. Top 3 picks across responses make the cut.",
      audience: "students",
      status: "active",
      anonymous: true,
      createdBy: "Cafeteria Committee",
      createdAt: dateOffset(-7),
      startsAt: dateOffset(-7),
      endsAt: dateOffset(3),
      questions: [
        {
          id: "Q1",
          type: "multi",
          text: "Pick your top dishes (you can pick up to 5):",
          options: [
            "Rajma chawal",
            "Veg biryani",
            "Chole bhature",
            "Aloo paratha",
            "Pasta arrabbiata",
            "Idli sambar",
            "Masala dosa",
            "Mixed veg curry & rice",
            "Pav bhaji",
            "Sandwich platter",
            "Chinese fried rice",
            "Khichdi",
          ],
          required: true,
        },
        {
          id: "Q2",
          type: "single",
          text: "How often should we have a dessert?",
          options: ["Daily", "Twice a week", "Once a week", "Only on Fridays"],
          required: false,
        },
        {
          id: "Q3",
          type: "rating",
          text: "Overall, how satisfied are you with cafeteria food?",
          required: false,
        },
      ],
    },
    {
      id: "POLL5000",
      title: "Staff well-being check-in · Q1",
      description: "Anonymous well-being check-in for all teaching staff.",
      audience: "teachers",
      status: "closed",
      anonymous: true,
      createdBy: "HR Department",
      createdAt: dateOffset(-40),
      startsAt: dateOffset(-40),
      endsAt: dateOffset(-25),
      questions: [
        {
          id: "Q1",
          type: "rating",
          text: "How would you rate your work-life balance this quarter?",
          required: true,
        },
        {
          id: "Q2",
          type: "single",
          text: "Do you feel supported by your immediate team?",
          options: [
            "Strongly agree",
            "Agree",
            "Neither agree nor disagree",
            "Disagree",
            "Strongly disagree",
          ],
          required: true,
        },
        {
          id: "Q3",
          type: "text",
          text: "What would make your work life easier?",
          required: false,
        },
      ],
    },
  ];

  // Seeded responses (anonymous flag determines if userId is stored)
  function r(pollId, idx, answers, opts = {}) {
    return {
      id: `${pollId}-R${pad2(idx)}`,
      pollId,
      userId: opts.anonymous ? null : opts.userId || `user-seed-${idx}`,
      anonymous: !!opts.anonymous,
      answers,
      submittedAt: opts.at || dateOffset(-Math.floor(Math.random() * 5)),
    };
  }

  const responses = [
    // POLL5001 — Annual Day
    r("POLL5001", 1, { Q1: 5, Q2: "Drama production", Q3: ["Sound system"], Q4: "The drama was outstanding!" }, { userId: "user-001" }),
    r("POLL5001", 2, { Q1: 4, Q2: "Group dance", Q3: ["Refreshments", "Parking"], Q4: "Need more food stalls." }, { userId: "user-002" }),
    r("POLL5001", 3, { Q1: 5, Q2: "Solo singing", Q3: [], Q4: "" }, { userId: "user-003" }),
    r("POLL5001", 4, { Q1: 3, Q2: "Instrumental ensemble", Q3: ["Seating arrangement", "Lighting"] }, { userId: "user-004" }),
    r("POLL5001", 5, { Q1: 5, Q2: "Drama production", Q3: ["Programme schedule"], Q4: "Loved the variety." }, { userId: "user-005" }),
    r("POLL5001", 6, { Q1: 4, Q2: "Group dance", Q3: ["Sound system", "Seating arrangement"] }, { userId: "user-006" }),
    r("POLL5001", 7, { Q1: 5, Q2: "Stand-up comedy", Q3: [], Q4: "More comedy please!" }, { userId: "user-007" }),
    r("POLL5001", 8, { Q1: 4, Q2: "Solo singing", Q3: ["Refreshments"] }, { userId: "user-008" }),
    r("POLL5001", 9, { Q1: 2, Q2: "Group dance", Q3: ["Sound system", "Lighting"], Q4: "Sound was muffled in the back rows." }, { userId: "user-009" }),
    r("POLL5001", 10, { Q1: 5, Q2: "Drama production", Q3: [] }, { userId: "user-010" }),

    // POLL5002 — Cafeteria (anonymous)
    r("POLL5002", 1, { Q1: ["Rajma chawal", "Veg biryani", "Masala dosa", "Pav bhaji"], Q2: "Twice a week", Q3: 4 }, { anonymous: true }),
    r("POLL5002", 2, { Q1: ["Veg biryani", "Chole bhature", "Pasta arrabbiata", "Sandwich platter"], Q2: "Once a week", Q3: 3 }, { anonymous: true }),
    r("POLL5002", 3, { Q1: ["Masala dosa", "Idli sambar", "Khichdi"], Q2: "Daily", Q3: 4 }, { anonymous: true }),
    r("POLL5002", 4, { Q1: ["Pasta arrabbiata", "Chinese fried rice", "Pav bhaji", "Sandwich platter"], Q2: "Twice a week", Q3: 5 }, { anonymous: true }),
    r("POLL5002", 5, { Q1: ["Rajma chawal", "Aloo paratha", "Mixed veg curry & rice"], Q2: "Once a week", Q3: 3 }, { anonymous: true }),
    r("POLL5002", 6, { Q1: ["Veg biryani", "Chole bhature", "Masala dosa", "Pav bhaji", "Pasta arrabbiata"], Q2: "Only on Fridays", Q3: 4 }, { anonymous: true }),
    r("POLL5002", 7, { Q1: ["Veg biryani", "Rajma chawal"], Q2: "Twice a week", Q3: 2 }, { anonymous: true }),
    r("POLL5002", 8, { Q1: ["Idli sambar", "Masala dosa", "Khichdi", "Aloo paratha"], Q2: "Once a week", Q3: 4 }, { anonymous: true }),

    // POLL5000 — Staff well-being (closed, anonymous)
    r("POLL5000", 1, { Q1: 3, Q2: "Agree", Q3: "More planning periods would help." }, { anonymous: true }),
    r("POLL5000", 2, { Q1: 4, Q2: "Strongly agree", Q3: "Good support overall." }, { anonymous: true }),
    r("POLL5000", 3, { Q1: 2, Q2: "Neither agree nor disagree", Q3: "Workload during exam weeks is heavy." }, { anonymous: true }),
    r("POLL5000", 4, { Q1: 4, Q2: "Agree", Q3: "" }, { anonymous: true }),
    r("POLL5000", 5, { Q1: 3, Q2: "Agree", Q3: "Reduce admin paperwork." }, { anonymous: true }),
  ];

  return { polls, responses };
}

let state = store.load("polls", buildSeed);
const persist = () => store.save("polls", state);

// ---------- helpers ----------

function autoCloseExpired() {
  let changed = false;
  const now = Date.now();
  for (const p of state.polls) {
    if (p.status === "active" && p.endsAt && new Date(p.endsAt).getTime() < now) {
      p.status = "closed";
      changed = true;
    }
  }
  if (changed) persist();
}

function audienceMatches(poll, role) {
  if (!role) return true;
  if (poll.audience === "all") return true;
  if (poll.audience === "students" && role === "student") return true;
  if (poll.audience === "parents" && role === "parent") return true;
  if (poll.audience === "teachers" && role === "teacher") return true;
  if (poll.audience === "staff") {
    return ["teacher", "hr", "accountant", "admin", "principal"].includes(role);
  }
  return false;
}

function findResponseByUser(pollId, userId) {
  if (!userId) return null;
  return state.responses.find(
    (r) => r.pollId === pollId && r.userId === userId
  );
}

function aggregateResults(pollId) {
  const poll = state.polls.find((p) => p.id === pollId);
  if (!poll) return null;
  const responses = state.responses.filter((r) => r.pollId === pollId);
  const total = responses.length;
  const byQuestion = {};

  for (const q of poll.questions) {
    if (q.type === "single") {
      const counts = {};
      for (const opt of q.options) counts[opt] = 0;
      for (const r of responses) {
        const a = r.answers?.[q.id];
        if (a && counts[a] !== undefined) counts[a]++;
      }
      byQuestion[q.id] = {
        type: q.type,
        total,
        counts,
        top:
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([opt, c]) => ({ option: opt, count: c }))[0] || null,
      };
    } else if (q.type === "multi") {
      const counts = {};
      for (const opt of q.options) counts[opt] = 0;
      for (const r of responses) {
        const a = r.answers?.[q.id] || [];
        if (Array.isArray(a)) for (const opt of a) if (counts[opt] !== undefined) counts[opt]++;
      }
      byQuestion[q.id] = {
        type: q.type,
        total,
        counts,
        sorted: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([opt, c]) => ({ option: opt, count: c })),
      };
    } else if (q.type === "rating") {
      const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      let n = 0;
      for (const r of responses) {
        const a = Number(r.answers?.[q.id]);
        if (a >= 1 && a <= 5) {
          buckets[a]++;
          sum += a;
          n++;
        }
      }
      byQuestion[q.id] = {
        type: q.type,
        total: n,
        buckets,
        average: n > 0 ? Number((sum / n).toFixed(2)) : null,
      };
    } else if (q.type === "text") {
      const samples = [];
      for (const r of responses) {
        const a = r.answers?.[q.id];
        if (typeof a === "string" && a.trim()) samples.push(a.trim());
      }
      byQuestion[q.id] = {
        type: q.type,
        total: samples.length,
        samples: samples.slice(0, 12),
      };
    }
  }

  return { pollId, total, byQuestion };
}

function decoratePoll(p, user) {
  const myResp = user ? findResponseByUser(p.id, user.id) : null;
  const results = aggregateResults(p.id);
  return {
    ...p,
    questionCount: p.questions.length,
    respondedByMe: !!myResp,
    myResponse: myResp || null,
    totalResponses: results?.total || 0,
    results,
    daysLeft:
      p.status === "active" && p.endsAt
        ? Math.ceil((new Date(p.endsAt).getTime() - Date.now()) / 86400000)
        : null,
  };
}

// ---------- queries ----------

function list({ status, audience, forRole, q, user } = {}) {
  autoCloseExpired();
  let out = state.polls.slice();
  if (status && status !== "all") out = out.filter((p) => p.status === status);
  if (audience && audience !== "all")
    out = out.filter((p) => p.audience === audience);
  if (forRole) out = out.filter((p) => audienceMatches(p, forRole));
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (p) =>
        p.title.toLowerCase().includes(t) ||
        p.description.toLowerCase().includes(t) ||
        p.createdBy.toLowerCase().includes(t)
    );
  }
  out.sort((a, b) => {
    // active first, then draft, then closed; within each group newest first
    const rank = { active: 0, draft: 1, closed: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return out.map((p) => decoratePoll(p, user));
}

function get(id, user) {
  autoCloseExpired();
  const p = state.polls.find((x) => x.id === id);
  return p ? decoratePoll(p, user) : null;
}

// ---------- mutations ----------

function validateQuestion(q, i) {
  if (!q.text) throw new Error(`Question ${i + 1}: text required`);
  if (!TYPES.includes(q.type))
    throw new Error(`Question ${i + 1}: invalid type ${q.type}`);
  if ((q.type === "single" || q.type === "multi") &&
      (!Array.isArray(q.options) || q.options.length < 2))
    throw new Error(`Question ${i + 1}: at least 2 options required`);
}

function add(payload, user) {
  if (!payload.title) throw new Error("title required");
  if (!Array.isArray(payload.questions) || payload.questions.length === 0)
    throw new Error("at least one question required");
  payload.questions.forEach((q, i) => validateQuestion(q, i));

  const audience = AUDIENCES.includes(payload.audience)
    ? payload.audience
    : "all";

  const startsAt = payload.startsAt || new Date().toISOString();
  const endsAt =
    payload.endsAt || dateOffset(Number(payload.durationDays) || 14);

  const status =
    payload.status === "draft"
      ? "draft"
      : new Date(startsAt).getTime() > Date.now()
      ? "draft"
      : "active";

  const next = state.polls.length + 1;
  const p = {
    id: `POLL${5000 + next}`,
    title: String(payload.title).trim(),
    description: String(payload.description || "").trim(),
    audience,
    status,
    anonymous: payload.anonymous === true,
    createdBy: payload.createdBy || user?.name || "Administration",
    createdAt: new Date().toISOString(),
    startsAt,
    endsAt,
    questions: payload.questions.map((q, i) => ({
      id: q.id || `Q${i + 1}`,
      type: q.type,
      text: String(q.text).trim(),
      options:
        q.type === "single" || q.type === "multi" ? q.options.slice() : undefined,
      required: q.required !== false,
    })),
  };
  state.polls.unshift(p);
  persist();
  return decoratePoll(p, user);
}

function update(id, patch, user) {
  const p = state.polls.find((x) => x.id === id);
  if (!p) throw new Error("Not found");
  const ALLOWED = ["title", "description", "audience", "status", "endsAt", "anonymous"];
  for (const k of ALLOWED) if (patch[k] !== undefined) p[k] = patch[k];
  persist();
  return decoratePoll(p, user);
}

function close(id, user) {
  return update(id, { status: "closed" }, user);
}
function reopen(id, user) {
  return update(id, { status: "active" }, user);
}

function remove(id) {
  const idx = state.polls.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = state.polls.splice(idx, 1);
  state.responses = state.responses.filter((r) => r.pollId !== id);
  persist();
  return removed;
}

function respond(id, answers, user) {
  const p = state.polls.find((x) => x.id === id);
  if (!p) throw new Error("Poll not found");
  if (p.status !== "active") throw new Error("Poll is not accepting responses");

  // Validate required questions
  for (const q of p.questions) {
    if (q.required && (answers[q.id] === undefined || answers[q.id] === "" ||
        (Array.isArray(answers[q.id]) && answers[q.id].length === 0))) {
      throw new Error(`Question "${q.text}" is required`);
    }
    // type-specific validation
    if (q.type === "rating") {
      const v = answers[q.id];
      if (v !== undefined && (Number(v) < 1 || Number(v) > 5)) {
        throw new Error(`Question "${q.text}": rating must be 1..5`);
      }
    }
    if (q.type === "single") {
      const v = answers[q.id];
      if (v !== undefined && !q.options.includes(v)) {
        throw new Error(`Question "${q.text}": invalid option`);
      }
    }
    if (q.type === "multi") {
      const v = answers[q.id];
      if (v !== undefined && Array.isArray(v)) {
        for (const x of v) if (!q.options.includes(x)) {
          throw new Error(`Question "${q.text}": invalid option ${x}`);
        }
      }
    }
    if (q.type === "text" && typeof answers[q.id] === "string") {
      answers[q.id] = answers[q.id].slice(0, 500);
    }
  }

  // One response per user per poll (unless anonymous)
  if (!p.anonymous && user) {
    const existing = findResponseByUser(p.id, user.id);
    if (existing) {
      // Update in place
      existing.answers = answers;
      existing.submittedAt = new Date().toISOString();
      persist();
      return existing;
    }
  }

  const r = {
    id: `${p.id}-R${pad2(state.responses.filter((x) => x.pollId === p.id).length + 1)}`,
    pollId: p.id,
    userId: p.anonymous ? null : user?.id || null,
    anonymous: p.anonymous,
    answers,
    submittedAt: new Date().toISOString(),
  };
  state.responses.push(r);
  persist();
  return r;
}

function withdrawResponse(id, user) {
  if (!user) throw new Error("Not authenticated");
  const p = state.polls.find((x) => x.id === id);
  if (!p) throw new Error("Poll not found");
  if (p.anonymous) throw new Error("Cannot withdraw anonymous response");
  const idx = state.responses.findIndex(
    (r) => r.pollId === id && r.userId === user.id
  );
  if (idx === -1) throw new Error("No response found");
  const [removed] = state.responses.splice(idx, 1);
  persist();
  return removed;
}

function summary(user) {
  autoCloseExpired();
  const active = state.polls.filter((p) => p.status === "active");
  const closed = state.polls.filter((p) => p.status === "closed");
  const draft = state.polls.filter((p) => p.status === "draft");
  let needMyResponse = 0;
  if (user) {
    for (const p of active) {
      if (audienceMatches(p, user.role) && !findResponseByUser(p.id, user.id)) {
        needMyResponse++;
      }
    }
  }
  return {
    active: active.length,
    closed: closed.length,
    draft: draft.length,
    totalResponses: state.responses.length,
    needMyResponse,
  };
}

module.exports = {
  TYPES,
  STATUSES,
  AUDIENCES,
  polls: () => state.polls,
  responses: () => state.responses,
  list,
  get,
  add,
  update,
  close,
  reopen,
  remove,
  respond,
  withdrawResponse,
  summary,
  aggregateResults,
};
