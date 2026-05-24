// Suggestion Box / Idea Hub.
//
// An ideas channel — students, parents, and staff post improvement ideas.
// Each idea has:
//   - title, body, category
//   - submitter (named or anonymous)
//   - status pipeline: Submitted → Under Review → Planned → In Progress
//                                                     → Implemented | Rejected
//   - upvoters (Set of userIds) — anonymous voters tracked by per-session token
//   - comments (lightweight thread, named or anonymous)
//
// Anonymous toggle is per-idea AND per-comment (a named idea can have anonymous
// comments, and vice-versa). Voting is one-per-user per idea.

const store = require("./store");

const CATEGORIES = [
  "Academic",
  "Facilities",
  "Cafeteria",
  "Sports",
  "Cultural",
  "Safety",
  "Technology",
  "Transport",
  "Hostel",
  "Other",
];

const STATUSES = [
  "Submitted",
  "Under Review",
  "Planned",
  "In Progress",
  "Implemented",
  "Rejected",
];

const STATUS_FLOW = {
  Submitted: ["Under Review", "Rejected"],
  "Under Review": ["Planned", "Rejected"],
  Planned: ["In Progress", "Rejected"],
  "In Progress": ["Implemented", "Rejected"],
  Implemented: [],
  Rejected: ["Under Review"], // can be reopened
};

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSeed() {
  // 12 seeded ideas across categories + a handful of comments and upvotes.
  const SEEDS = [
    {
      title: "Install water purifiers on every floor",
      body: "Currently students have to walk to the ground floor for clean drinking water. RO purifiers on every floor would help — especially during exams when we're packed in classrooms all day.",
      category: "Facilities",
      submitter: "Riya Sharma (Grade 11)",
      anonymous: false,
      status: "Planned",
      upvotes: 47,
      daysAgo: 30,
      comments: [
        { by: "Maintenance team", anon: false, text: "We've shortlisted 3 vendors. Procurement in next quarter.", daysAgo: 18 },
        { by: null, anon: true, text: "Yes please! The 3rd-floor classes really need this.", daysAgo: 15 },
      ],
    },
    {
      title: "Add more vegetarian protein options at lunch",
      body: "The cafeteria lunches are heavy on carbs and light on protein for vegetarians. Adding paneer, soy chunks, or sprouted moong dishes a couple of times a week would really help.",
      category: "Cafeteria",
      submitter: null,
      anonymous: true,
      status: "Under Review",
      upvotes: 38,
      daysAgo: 12,
      comments: [
        { by: "Cafeteria Committee", anon: false, text: "We're meeting with the catering vendor next week to discuss.", daysAgo: 5 },
      ],
    },
    {
      title: "Outdoor study deck on the roof terrace",
      body: "The roof terrace is largely unused. With some shaded seating and outdoor power outlets, it could be a beautiful spot to study in the cooler months.",
      category: "Facilities",
      submitter: "Arjun Mehta (Grade 12)",
      anonymous: false,
      status: "Submitted",
      upvotes: 28,
      daysAgo: 4,
      comments: [],
    },
    {
      title: "Bike racks near the main gate",
      body: "Several of us cycle to school. There's nowhere safe to lock our bikes. A covered rack with bike-stand bars by the main gate would be great.",
      category: "Transport",
      submitter: null,
      anonymous: true,
      status: "Implemented",
      upvotes: 65,
      daysAgo: 60,
      comments: [
        { by: "Administration", anon: false, text: "Done! 30-slot bike rack installed last month with CCTV coverage.", daysAgo: 10 },
        { by: "Aman", anon: false, text: "Thanks! Already using it daily.", daysAgo: 8 },
      ],
    },
    {
      title: "More frequent senior career-counselling sessions",
      body: "The counselling team is great, but slots fill up weeks in advance. Could we have a couple more weekly slots, especially for Grade 12?",
      category: "Academic",
      submitter: "Ira Bose (Grade 12)",
      anonymous: false,
      status: "In Progress",
      upvotes: 33,
      daysAgo: 22,
      comments: [
        { by: "Counselling Office", anon: false, text: "Hiring a 2nd counsellor — starts next month. Will add 6 new weekly slots.", daysAgo: 9 },
      ],
    },
    {
      title: "Better lighting in the rear corridor",
      body: "The corridor behind the science block is poorly lit after 5 PM. Some of us stay back for clubs and it feels unsafe walking through there.",
      category: "Safety",
      submitter: null,
      anonymous: true,
      status: "Planned",
      upvotes: 41,
      daysAgo: 8,
      comments: [
        { by: "Maintenance team", anon: false, text: "LED fixtures ordered. Install scheduled for next weekend.", daysAgo: 2 },
      ],
    },
    {
      title: "Coding club for juniors (Grades 6-8)",
      body: "The current coding club only takes seniors. Many younger students are interested too — Scratch, Python basics, etc. Could we start a junior chapter?",
      category: "Technology",
      submitter: "Dhruv Kapoor (Grade 7)",
      anonymous: false,
      status: "Under Review",
      upvotes: 24,
      daysAgo: 18,
      comments: [
        { by: null, anon: true, text: "+1, my younger sister would love this.", daysAgo: 12 },
      ],
    },
    {
      title: "Bring back the inter-house Music Night",
      body: "We used to have a yearly inter-house music competition that was hugely popular. It got dropped during the renovation years. Bringing it back would be amazing for cultural engagement.",
      category: "Cultural",
      submitter: "Anaya Patel (Grade 11)",
      anonymous: false,
      status: "Planned",
      upvotes: 52,
      daysAgo: 25,
      comments: [
        { by: "Cultural Committee", anon: false, text: "We're bringing it back in February. Stay tuned for the details.", daysAgo: 11 },
      ],
    },
    {
      title: "Quiet study room in the library",
      body: "The library is great but it gets noisy near the discussion area. Could one of the smaller rooms be designated a strict-quiet zone?",
      category: "Academic",
      submitter: null,
      anonymous: true,
      status: "Submitted",
      upvotes: 19,
      daysAgo: 5,
      comments: [],
    },
    {
      title: "Hostel curfew flexibility on weekends",
      body: "Could weekend curfew be 30 minutes later? Many of us return from inter-school events and the current cutoff is too tight.",
      category: "Hostel",
      submitter: "Vihaan Singh (Grade 12)",
      anonymous: false,
      status: "Rejected",
      upvotes: 16,
      daysAgo: 45,
      comments: [
        { by: "Hostel Warden", anon: false, text: "Curfew is set after security review. Please coordinate event timings with us instead and we'll arrange escorted return.", daysAgo: 40 },
      ],
    },
    {
      title: "Solar panels on the main block roof",
      body: "Lumina could be a leader in sustainability. Solar panels would cut electricity costs and inspire students. Maybe partner with an alumnus or sponsor?",
      category: "Facilities",
      submitter: "Krishna Iyer (alumnus)",
      anonymous: false,
      status: "Under Review",
      upvotes: 71,
      daysAgo: 14,
      comments: [
        { by: "Principal's Office", anon: false, text: "We love this. Exploring CSR funding partners — will update soon.", daysAgo: 6 },
        { by: null, anon: true, text: "Class of 2014 might pitch in!", daysAgo: 4 },
      ],
    },
    {
      title: "Cricket nets need replacement",
      body: "The practice nets are torn in two places — balls keep escaping into the badminton court. Time for new ones before the season starts.",
      category: "Sports",
      submitter: "Athletics Captain",
      anonymous: false,
      status: "In Progress",
      upvotes: 22,
      daysAgo: 16,
      comments: [
        { by: "Sports Department", anon: false, text: "New nets arriving Friday. Installation Saturday morning.", daysAgo: 3 },
      ],
    },
  ];

  function buildIdea(s, idx) {
    return {
      id: `IDEA${4000 + idx + 1}`,
      title: s.title,
      body: s.body,
      category: s.category,
      submittedBy: s.anonymous ? null : s.submitter,
      anonymous: s.anonymous,
      status: s.status,
      // Pre-seed upvoter set with synthetic ids; current viewer toggles in/out
      upvoterIds: Array.from({ length: s.upvotes }, (_, i) => `seed-user-${idx}-${i}`),
      createdAt: dateOffset(s.daysAgo),
      updatedAt: dateOffset(Math.max(0, s.daysAgo - 1)),
      // status history
      history: buildHistory(s.status, s.daysAgo),
      comments: (s.comments || []).map((c, i) => ({
        id: `IDEA${4000 + idx + 1}-C${pad2(i + 1)}`,
        by: c.anon ? null : c.by,
        anonymous: c.anon,
        text: c.text,
        createdAt: dateOffset(c.daysAgo),
      })),
    };
  }

  function buildHistory(finalStatus, ageDays) {
    const trace = ["Submitted"];
    const order = STATUSES;
    const finalIdx = order.indexOf(finalStatus);
    if (finalStatus === "Rejected") trace.push("Rejected");
    else if (finalIdx > 0) for (let i = 1; i <= finalIdx; i++) trace.push(order[i]);
    const out = [];
    trace.forEach((status, k) => {
      out.push({
        status,
        by: k === 0 ? "Submitter" : "Administration",
        at: dateOffset(Math.max(0, ageDays - k * Math.max(1, Math.floor(ageDays / Math.max(1, trace.length))))),
        note: null,
      });
    });
    return out;
  }

  return { ideas: SEEDS.map(buildIdea) };
}

let state = store.load("suggestions", buildSeed);
const persist = () => store.save("suggestions", state);

// ---------- helpers ----------

function decorate(idea, user) {
  const me = user?.id || null;
  return {
    ...idea,
    upvotes: idea.upvoterIds.length,
    upvotedByMe: me ? idea.upvoterIds.includes(me) : false,
    commentCount: (idea.comments || []).length,
  };
}

// ---------- queries ----------

function list({ q, category, status, mine, user, sort = "trending" } = {}) {
  let out = state.ideas.slice();
  if (category && category !== "all") out = out.filter((i) => i.category === category);
  if (status && status !== "all") out = out.filter((i) => i.status === status);
  if (mine === "true" && user) {
    out = out.filter(
      (i) =>
        (!i.anonymous && i.submittedBy === user.name) ||
        i.upvoterIds.includes(user.id)
    );
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (i) =>
        i.title.toLowerCase().includes(t) ||
        i.body.toLowerCase().includes(t) ||
        i.id.toLowerCase().includes(t) ||
        i.category.toLowerCase().includes(t) ||
        (i.submittedBy || "").toLowerCase().includes(t)
    );
  }

  if (sort === "newest")
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  else if (sort === "oldest")
    out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  else if (sort === "most-voted")
    out.sort((a, b) => b.upvoterIds.length - a.upvoterIds.length);
  else {
    // trending: log10(votes) + recency boost
    const score = (i) => {
      const ageH = (Date.now() - new Date(i.createdAt).getTime()) / 3600000;
      const ageBoost = Math.max(0, 5 - ageH / 24);
      return Math.log10(Math.max(1, i.upvoterIds.length)) * 4 + ageBoost;
    };
    out.sort((a, b) => score(b) - score(a));
  }

  return out.map((i) => decorate(i, user));
}

function get(id, user) {
  const i = state.ideas.find((x) => x.id === id);
  return i ? decorate(i, user) : null;
}

// ---------- mutations ----------

function add(payload, user) {
  if (!payload.title || !payload.title.trim()) throw new Error("title required");
  if (!payload.body || !payload.body.trim()) throw new Error("body required");
  const category = CATEGORIES.includes(payload.category)
    ? payload.category
    : "Other";

  const anonymous = payload.anonymous === true;
  const submittedBy = anonymous
    ? null
    : payload.submittedBy || user?.name || "Anonymous";

  const next = state.ideas.length + 1;
  const idea = {
    id: `IDEA${4000 + next}`,
    title: String(payload.title).trim().slice(0, 140),
    body: String(payload.body).trim().slice(0, 2000),
    category,
    submittedBy,
    anonymous,
    status: "Submitted",
    upvoterIds: user ? [user.id] : [], // submitter auto-upvotes
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [
      {
        status: "Submitted",
        by: anonymous ? "Anonymous" : (user?.name || "Submitter"),
        at: new Date().toISOString(),
        note: null,
      },
    ],
    comments: [],
  };
  state.ideas.unshift(idea);
  persist();
  return decorate(idea, user);
}

function upvote(id, user) {
  if (!user) throw new Error("Not authenticated");
  const i = state.ideas.find((x) => x.id === id);
  if (!i) throw new Error("Idea not found");
  if (!i.upvoterIds.includes(user.id)) {
    i.upvoterIds.push(user.id);
    persist();
  }
  return decorate(i, user);
}

function unvote(id, user) {
  if (!user) throw new Error("Not authenticated");
  const i = state.ideas.find((x) => x.id === id);
  if (!i) throw new Error("Idea not found");
  i.upvoterIds = i.upvoterIds.filter((u) => u !== user.id);
  persist();
  return decorate(i, user);
}

function transition(id, nextStatus, note, user) {
  const i = state.ideas.find((x) => x.id === id);
  if (!i) throw new Error("Idea not found");
  if (!STATUSES.includes(nextStatus))
    throw new Error("invalid status");
  const allowed = STATUS_FLOW[i.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `Cannot move from ${i.status} → ${nextStatus} (allowed: ${
        allowed.join(", ") || "none"
      })`
    );
  }
  i.status = nextStatus;
  i.updatedAt = new Date().toISOString();
  i.history.push({
    status: nextStatus,
    by: user?.name || "Administration",
    at: new Date().toISOString(),
    note: note || null,
  });
  persist();
  return decorate(i, user);
}

function addComment(id, payload, user) {
  const i = state.ideas.find((x) => x.id === id);
  if (!i) throw new Error("Idea not found");
  if (!payload.text || !String(payload.text).trim())
    throw new Error("text required");
  const anon = payload.anonymous === true;
  const c = {
    id: `${id}-C${pad2((i.comments || []).length + 1)}`,
    by: anon ? null : payload.by || user?.name || "Anonymous",
    anonymous: anon,
    text: String(payload.text).trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  i.comments = [...(i.comments || []), c];
  persist();
  return c;
}

function removeComment(ideaId, commentId, user) {
  const i = state.ideas.find((x) => x.id === ideaId);
  if (!i) throw new Error("Idea not found");
  i.comments = (i.comments || []).filter((c) => c.id !== commentId);
  persist();
  return { ideaId, commentId };
}

function remove(id) {
  const idx = state.ideas.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Idea not found");
  const [removed] = state.ideas.splice(idx, 1);
  persist();
  return removed;
}

function summary() {
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  for (const i of state.ideas) counts[i.status] = (counts[i.status] || 0) + 1;
  const totalVotes = state.ideas.reduce(
    (s, i) => s + i.upvoterIds.length,
    0
  );
  const totalComments = state.ideas.reduce(
    (s, i) => s + (i.comments?.length || 0),
    0
  );
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  for (const i of state.ideas)
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
  // Top idea by votes
  const topIdea = state.ideas
    .slice()
    .sort((a, b) => b.upvoterIds.length - a.upvoterIds.length)[0];
  return {
    total: state.ideas.length,
    byStatus: counts,
    implemented: counts.Implemented,
    inProgress: counts["In Progress"],
    planned: counts.Planned,
    submitted: counts.Submitted,
    underReview: counts["Under Review"],
    rejected: counts.Rejected,
    totalVotes,
    totalComments,
    byCategory,
    topIdea: topIdea
      ? { id: topIdea.id, title: topIdea.title, votes: topIdea.upvoterIds.length }
      : null,
  };
}

module.exports = {
  CATEGORIES,
  STATUSES,
  STATUS_FLOW,
  ideas: () => state.ideas,
  list,
  get,
  add,
  upvote,
  unvote,
  transition,
  addComment,
  removeComment,
  remove,
  summary,
};
