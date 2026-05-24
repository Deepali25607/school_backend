// Career Counselling & College Placements.
//
// Focused on Grade 11 & 12 (and recent graduates). Three collections:
//
//   - Profiles:      one per student (Grade 11+). Career direction, target
//                    stream/country, dream colleges, planned exams,
//                    assigned counsellor.
//
//   - Sessions:      counsellor↔student meeting log with notes, action items,
//                    follow-up date.
//
//   - Applications:  college-by-college tracker per student. State machine:
//                    Planning → Applied → (Admitted | Rejected | Waitlisted)
//                                       → Enrolled (only after Admitted)
//
// Profile is auto-seeded for every Grade 11/12 student so the page has data
// out of the box.

const store = require("./store");
const seed = require("./seed");

const CAREER_TRACKS = [
  "Engineering / Tech",
  "Medicine / Healthcare",
  "Business / Commerce",
  "Liberal Arts",
  "Design / Architecture",
  "Law",
  "Civil Services",
  "Performing Arts",
  "Sciences (Pure)",
  "Sports / Athletics",
  "Defence Services",
  "Undecided",
];

const STREAMS = ["Science (PCM)", "Science (PCB)", "Commerce", "Humanities"];

const COUNTRIES = [
  "India",
  "USA",
  "UK",
  "Canada",
  "Australia",
  "Singapore",
  "Germany",
  "Netherlands",
  "Ireland",
  "Hong Kong",
  "UAE",
];

const EXAMS = [
  "JEE Mains",
  "JEE Advanced",
  "NEET",
  "CUET",
  "CLAT",
  "NIFT",
  "NID",
  "SAT",
  "ACT",
  "TOEFL",
  "IELTS",
  "GRE",
  "GMAT",
  "BITSAT",
  "NDA",
];

const TOP_COLLEGES_INDIA = [
  "IIT Bombay",
  "IIT Delhi",
  "IIT Madras",
  "IIT Kanpur",
  "IIT Kharagpur",
  "BITS Pilani",
  "AIIMS Delhi",
  "NLSIU Bangalore",
  "NLU Delhi",
  "Delhi University · St. Stephen's",
  "Delhi University · LSR",
  "Christ University, Bangalore",
  "Symbiosis Pune",
  "NIFT Delhi",
  "NID Ahmedabad",
  "Ashoka University",
  "FLAME University",
  "Loyola College, Chennai",
  "St. Xavier's Mumbai",
];

const TOP_COLLEGES_ABROAD = [
  "MIT",
  "Stanford University",
  "Harvard University",
  "University of Oxford",
  "University of Cambridge",
  "ETH Zurich",
  "National University of Singapore",
  "University of Toronto",
  "University of Melbourne",
  "Imperial College London",
  "UC Berkeley",
  "Carnegie Mellon",
  "Cornell University",
  "TU Delft",
  "King's College London",
];

const APP_STATUSES = [
  "Planning",
  "Applied",
  "Admitted",
  "Rejected",
  "Waitlisted",
  "Enrolled",
];

const COUNSELLORS = [
  "Ms. Anjali Sinha",
  "Mr. Vikram Bhat",
  "Dr. Meera Krishnan",
  "Mr. Arvind Kapoor",
  "Ms. Pooja Rawat",
];

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, ...parts) {
  return arr[hash(...parts) % arr.length];
}
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSeed() {
  const seniors = seed.students.filter((s) => s.grade === 11 || s.grade === 12);
  const profiles = [];
  const sessions = [];
  const applications = [];

  let sessSeq = 1;
  let appSeq = 1;

  seniors.forEach((s, i) => {
    const track = pick(
      CAREER_TRACKS.filter((c) => c !== "Undecided"),
      "track",
      s.id
    );
    let stream;
    if (track.startsWith("Engineering") || track.startsWith("Sciences"))
      stream = "Science (PCM)";
    else if (track.startsWith("Medicine")) stream = "Science (PCB)";
    else if (track.startsWith("Business")) stream = "Commerce";
    else stream = "Humanities";

    // 70% India-only, 20% mixed, 10% abroad-only
    const r = hash("country", s.id) % 100;
    let targetCountries;
    if (r < 70) targetCountries = ["India"];
    else if (r < 90)
      targetCountries = ["India", pick(["USA", "UK", "Canada", "Singapore"], "abr", s.id)];
    else
      targetCountries = [pick(["USA", "UK", "Canada", "Singapore", "Australia"], "ab2", s.id)];

    const dreamColleges = [];
    if (targetCountries.includes("India")) {
      for (let k = 0; k < 3; k++) dreamColleges.push(pick(TOP_COLLEGES_INDIA, "dc", s.id, k));
    }
    if (targetCountries.some((c) => c !== "India")) {
      for (let k = 0; k < 2; k++) dreamColleges.push(pick(TOP_COLLEGES_ABROAD, "dca", s.id, k));
    }

    const examsPlanned = [];
    if (track.startsWith("Engineering")) {
      examsPlanned.push("JEE Mains", "JEE Advanced");
      if (targetCountries.some((c) => c !== "India")) examsPlanned.push("SAT");
    } else if (track.startsWith("Medicine")) {
      examsPlanned.push("NEET");
    } else if (track.startsWith("Business") || track.startsWith("Liberal")) {
      examsPlanned.push("CUET");
      if (targetCountries.some((c) => c !== "India")) examsPlanned.push("SAT");
    } else if (track.startsWith("Law")) {
      examsPlanned.push("CLAT", "CUET");
    } else if (track.startsWith("Design")) {
      examsPlanned.push("NIFT", "NID");
    } else if (track.startsWith("Civil")) {
      examsPlanned.push("CUET");
    }
    if (targetCountries.some((c) => c !== "India")) examsPlanned.push("TOEFL");

    const counsellor = pick(COUNSELLORS, "couns", s.id);

    profiles.push({
      studentId: s.id,
      track,
      stream,
      targetCountries: [...new Set(targetCountries)],
      dreamColleges: [...new Set(dreamColleges)],
      examsPlanned: [...new Set(examsPlanned)],
      counsellor,
      careerNotes: null,
      strengths: pick(
        [
          ["Strong in problem-solving", "Self-motivated"],
          ["Excellent communicator", "Leadership inclination"],
          ["Analytical thinker", "Curious about research"],
          ["Creative", "Detail-oriented"],
          ["Empathetic", "Team player"],
        ],
        "str",
        s.id
      ),
      updatedAt: dateOffset(-(hash("upd", s.id) % 30)),
    });

    // 0-3 sessions per student
    const numSessions = hash("ns", s.id) % 4;
    for (let k = 0; k < numSessions; k++) {
      const daysAgo = 7 + ((hash("sess", s.id, k) % 90));
      sessions.push({
        id: `CCS${5000 + sessSeq++}`,
        studentId: s.id,
        counsellor,
        date: dateOffset(-daysAgo),
        topics: pick(
          [
            ["Stream selection", "College shortlisting"],
            ["JEE prep strategy"],
            ["SAT prep + essay roadmap"],
            ["NEET timetable + revision"],
            ["Backup options review", "Parent meeting"],
            ["Internship suggestions", "Portfolio review"],
            ["Scholarship eligibility check"],
          ],
          "top",
          s.id,
          k
        ),
        notes: pick(
          [
            "Student is on track. Suggested 2 more practice tests before mid-term.",
            "Discussed shortlisting strategy — narrowed dream list to 5 colleges.",
            "Reviewed mock test scores; identified weak areas. Plan revised.",
            "Parent attended; aligned on UK applications and budget.",
            "Portfolio looking strong; advised adding 1 more design project.",
            "Considering a gap year option. Will discuss again next month.",
            "Identified mentor from Alumni network for application essays.",
          ],
          "note",
          s.id,
          k
        ),
        actionItems: pick(
          [
            ["Complete 2 JEE mock tests by next session"],
            ["Draft Common App essay rough outline"],
            ["Schedule SAT in next test window"],
            ["Submit NIFT portfolio entries"],
            ["Connect with Riya (alumna) for IIT-B chat"],
            ["Finalise university shortlist by Friday"],
          ],
          "ai",
          s.id,
          k
        ),
        followUp: daysAgo > 30 ? null : dateOffset(7 + (hash("fu", s.id, k) % 14)),
        durationMin: 30 + (hash("dur", s.id, k) % 4) * 15,
      });
    }

    // 0-5 applications per student
    const numApps = hash("na", s.id) % 6;
    for (let k = 0; k < numApps; k++) {
      const isAbroad = targetCountries.some((c) => c !== "India") && hash("abr2", s.id, k) % 2 === 0;
      const college = isAbroad
        ? pick(TOP_COLLEGES_ABROAD, "col", s.id, k)
        : pick(TOP_COLLEGES_INDIA, "col", s.id, k);
      // Status distribution: 35% Planning, 25% Applied, 15% Admitted, 10% Waitlisted, 10% Rejected, 5% Enrolled
      const r2 = hash("st", s.id, k) % 100;
      let status;
      if (r2 < 35) status = "Planning";
      else if (r2 < 60) status = "Applied";
      else if (r2 < 75) status = "Admitted";
      else if (r2 < 85) status = "Waitlisted";
      else if (r2 < 95) status = "Rejected";
      else status = "Enrolled";

      const appliedAt = status === "Planning" ? null : dateOffset(-(hash("apt", s.id, k) % 90));
      const decidedAt =
        ["Admitted", "Rejected", "Waitlisted", "Enrolled"].includes(status)
          ? dateOffset(-(hash("dec", s.id, k) % 30))
          : null;

      const programs = [
        "B.Tech · Computer Science",
        "B.Tech · Mechanical",
        "MBBS",
        "B.Sc Physics (Hons.)",
        "B.A. Economics",
        "BBA",
        "B.Des",
        "B.A. LLB (Hons.)",
        "Liberal Arts",
        "B.A. History",
        "B.Sc Biology",
      ];

      applications.push({
        id: `CCA${6000 + appSeq++}`,
        studentId: s.id,
        college,
        country: isAbroad ? pick(["USA", "UK", "Canada", "Singapore"], "co", s.id, k) : "India",
        program: pick(programs, "pr", s.id, k),
        status,
        appliedAt,
        decidedAt,
        feeAmount: status !== "Planning" ? (isAbroad ? 8500 : 1500) + (hash("fee", s.id, k) % 4000) : null,
        notes: status === "Rejected"
          ? "Encouraged to apply elsewhere with stronger application."
          : status === "Admitted"
          ? "Great news! Confirmation pending family decision."
          : null,
      });
    }
  });

  return { profiles, sessions, applications };
}

let state = store.load("careers", buildSeed);
const persist = () => store.save("careers", state);

// ---------- helpers ----------

function studentById(id) {
  return seed.students.find((s) => s.id === id) || null;
}

function decorateProfile(p) {
  const s = studentById(p.studentId);
  const apps = state.applications.filter((a) => a.studentId === p.studentId);
  const sess = state.sessions.filter((x) => x.studentId === p.studentId);
  const latestSess = sess.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  // pending = future follow-ups + applications still in Planning/Applied/Waitlisted
  const openApplications = apps.filter((a) =>
    ["Planning", "Applied", "Waitlisted"].includes(a.status)
  ).length;
  const admittedCount = apps.filter((a) => ["Admitted", "Enrolled"].includes(a.status)).length;
  const enrolledTo = apps.find((a) => a.status === "Enrolled") || null;
  return {
    ...p,
    studentName: s?.name || p.studentId,
    studentAvatar: s?.avatar || "S",
    studentGrade: s?.grade,
    studentSection: s?.section,
    studentHouse: s?.house,
    applicationsCount: apps.length,
    openApplicationsCount: openApplications,
    admittedCount,
    enrolledTo: enrolledTo
      ? { college: enrolledTo.college, country: enrolledTo.country, program: enrolledTo.program }
      : null,
    sessionsCount: sess.length,
    lastSessionDate: latestSess?.date || null,
  };
}

function decorateSession(s) {
  const stu = studentById(s.studentId);
  return {
    ...s,
    studentName: stu?.name || s.studentId,
    studentAvatar: stu?.avatar || "S",
  };
}

function decorateApplication(a) {
  const stu = studentById(a.studentId);
  return {
    ...a,
    studentName: stu?.name || a.studentId,
    studentAvatar: stu?.avatar || "S",
    studentGrade: stu?.grade,
    studentSection: stu?.section,
    daysSinceApplied: a.appliedAt
      ? Math.max(0, Math.round((Date.now() - new Date(a.appliedAt).getTime()) / 86400000))
      : null,
  };
}

// ---------- queries ----------

function listProfiles({ q, track, stream, counsellor, grade } = {}) {
  let out = state.profiles.slice();
  if (track && track !== "all") out = out.filter((p) => p.track === track);
  if (stream && stream !== "all") out = out.filter((p) => p.stream === stream);
  if (counsellor && counsellor !== "all")
    out = out.filter((p) => p.counsellor === counsellor);
  if (grade && grade !== "all") {
    out = out.filter((p) => {
      const s = studentById(p.studentId);
      return s && String(s.grade) === String(grade);
    });
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out
      .map(decorateProfile)
      .filter(
        (p) =>
          p.studentId.toLowerCase().includes(t) ||
          p.studentName.toLowerCase().includes(t) ||
          p.track.toLowerCase().includes(t) ||
          (p.counsellor || "").toLowerCase().includes(t)
      );
    return out.sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
  return out
    .map(decorateProfile)
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

function getProfile(studentId) {
  let p = state.profiles.find((x) => x.studentId === studentId);
  if (!p) {
    // Auto-create empty profile for seniors who don't have one yet
    const student = studentById(studentId);
    if (!student) return null;
    p = {
      studentId,
      track: "Undecided",
      stream: student.grade >= 11 ? "Science (PCM)" : "Humanities",
      targetCountries: ["India"],
      dreamColleges: [],
      examsPlanned: [],
      counsellor: COUNSELLORS[0],
      careerNotes: null,
      strengths: [],
      updatedAt: new Date().toISOString(),
    };
    state.profiles.push(p);
    persist();
  }
  return decorateProfile(p);
}

function listSessions({ studentId, counsellor, q, limit = 50 } = {}) {
  let out = state.sessions.slice();
  if (studentId) out = out.filter((s) => s.studentId === studentId);
  if (counsellor && counsellor !== "all")
    out = out.filter((s) => s.counsellor === counsellor);
  if (q) {
    const t = String(q).toLowerCase();
    out = out
      .map(decorateSession)
      .filter(
        (s) =>
          s.studentName.toLowerCase().includes(t) ||
          (s.notes || "").toLowerCase().includes(t) ||
          (s.topics || []).join(" ").toLowerCase().includes(t)
      );
    return out.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
  }
  return out
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
    .map(decorateSession);
}

function listApplications({ studentId, status, country, q, limit = 100 } = {}) {
  let out = state.applications.slice();
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (status && status !== "all") out = out.filter((a) => a.status === status);
  if (country && country !== "all") out = out.filter((a) => a.country === country);
  if (q) {
    const t = String(q).toLowerCase();
    out = out
      .map(decorateApplication)
      .filter(
        (a) =>
          a.studentName.toLowerCase().includes(t) ||
          a.college.toLowerCase().includes(t) ||
          (a.program || "").toLowerCase().includes(t)
      );
    return out.sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0)).slice(0, limit);
  }
  return out
    .sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0))
    .slice(0, limit)
    .map(decorateApplication);
}

// ---------- mutations ----------

function updateProfile(studentId, patch) {
  let p = state.profiles.find((x) => x.studentId === studentId);
  if (!p) {
    // Bootstrap via getProfile semantics
    getProfile(studentId);
    p = state.profiles.find((x) => x.studentId === studentId);
    if (!p) throw new Error("Student not found");
  }
  const ALLOWED = [
    "track",
    "stream",
    "targetCountries",
    "dreamColleges",
    "examsPlanned",
    "counsellor",
    "careerNotes",
    "strengths",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) p[k] = patch[k];
  p.updatedAt = new Date().toISOString();
  persist();
  return decorateProfile(p);
}

function addSession(payload) {
  const { studentId, counsellor, date, topics, notes, actionItems, followUp, durationMin } =
    payload || {};
  if (!studentId) throw new Error("studentId required");
  if (!studentById(studentId)) throw new Error("Student not found");
  if (!counsellor) throw new Error("counsellor required");

  const next = state.sessions.length + 1;
  const s = {
    id: `CCS${5000 + next}`,
    studentId,
    counsellor,
    date: date || new Date().toISOString(),
    topics: Array.isArray(topics) ? topics : [],
    notes: notes || null,
    actionItems: Array.isArray(actionItems) ? actionItems : [],
    followUp: followUp || null,
    durationMin: Number(durationMin) || 30,
  };
  state.sessions.unshift(s);
  persist();
  return decorateSession(s);
}

function updateSession(id, patch) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) throw new Error("Session not found");
  const ALLOWED = [
    "counsellor",
    "date",
    "topics",
    "notes",
    "actionItems",
    "followUp",
    "durationMin",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) s[k] = patch[k];
  persist();
  return decorateSession(s);
}

function removeSession(id) {
  const idx = state.sessions.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Session not found");
  const [removed] = state.sessions.splice(idx, 1);
  persist();
  return removed;
}

function addApplication(payload) {
  const { studentId, college, country, program, status } = payload || {};
  if (!studentId) throw new Error("studentId required");
  if (!studentById(studentId)) throw new Error("Student not found");
  if (!college) throw new Error("college required");
  if (status && !APP_STATUSES.includes(status))
    throw new Error("invalid status");

  // Prevent duplicate application for same student + same college
  if (
    state.applications.some(
      (a) => a.studentId === studentId && a.college === college
    )
  ) {
    throw new Error("Application for this college already exists");
  }

  const initialStatus = status || "Planning";
  const next = state.applications.length + 1;
  const a = {
    id: `CCA${6000 + next}`,
    studentId,
    college: String(college).trim(),
    country: country || "India",
    program: program || null,
    status: initialStatus,
    appliedAt: initialStatus === "Planning" ? null : new Date().toISOString(),
    decidedAt: null,
    feeAmount: Number(payload.feeAmount) || null,
    notes: payload.notes || null,
  };
  state.applications.unshift(a);
  persist();
  return decorateApplication(a);
}

function updateApplication(id, patch) {
  const a = state.applications.find((x) => x.id === id);
  if (!a) throw new Error("Application not found");
  if (patch.status !== undefined && !APP_STATUSES.includes(patch.status))
    throw new Error("invalid status");
  // Enrolled is only valid after Admitted
  if (patch.status === "Enrolled" && a.status !== "Admitted") {
    if (a.status !== "Enrolled") {
      throw new Error("Application must be Admitted before Enrolled");
    }
  }

  const ALLOWED = [
    "college",
    "country",
    "program",
    "status",
    "feeAmount",
    "notes",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) a[k] = patch[k];

  // Status transitions side-effects
  if (patch.status) {
    if (patch.status !== "Planning" && !a.appliedAt) {
      a.appliedAt = new Date().toISOString();
    }
    if (["Admitted", "Rejected", "Waitlisted", "Enrolled"].includes(patch.status)) {
      a.decidedAt = new Date().toISOString();
    }
  }
  persist();
  return decorateApplication(a);
}

function removeApplication(id) {
  const idx = state.applications.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Application not found");
  const [removed] = state.applications.splice(idx, 1);
  persist();
  return removed;
}

function summary() {
  const seniors = seed.students.filter(
    (s) => s.grade === 11 || s.grade === 12
  ).length;
  const enrolled = state.applications.filter((a) => a.status === "Enrolled").length;
  const admitted = state.applications.filter((a) =>
    ["Admitted", "Enrolled"].includes(a.status)
  ).length;
  const applied = state.applications.filter((a) => a.status === "Applied").length;
  const planning = state.applications.filter((a) => a.status === "Planning").length;
  const rejected = state.applications.filter((a) => a.status === "Rejected").length;
  const waitlisted = state.applications.filter((a) => a.status === "Waitlisted").length;

  // Counsellor workload — sessions in last 30 days
  const cutoff = Date.now() - 30 * 86400000;
  const recentSessions = state.sessions.filter(
    (s) => new Date(s.date).getTime() >= cutoff
  );
  const byCounsellor = {};
  for (const c of COUNSELLORS) byCounsellor[c] = 0;
  for (const s of recentSessions)
    byCounsellor[s.counsellor] = (byCounsellor[s.counsellor] || 0) + 1;

  // Track distribution
  const byTrack = {};
  for (const t of CAREER_TRACKS) byTrack[t] = 0;
  for (const p of state.profiles) byTrack[p.track] = (byTrack[p.track] || 0) + 1;

  // Top dream colleges
  const collegeCounts = {};
  for (const p of state.profiles) {
    for (const c of p.dreamColleges) {
      collegeCounts[c] = (collegeCounts[c] || 0) + 1;
    }
  }
  const topDreamColleges = Object.entries(collegeCounts)
    .map(([college, count]) => ({ college, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Upcoming follow-ups in next 14d
  const upcomingFollowUps = state.sessions
    .filter(
      (s) =>
        s.followUp &&
        new Date(s.followUp).getTime() > Date.now() &&
        new Date(s.followUp).getTime() < Date.now() + 14 * 86400000
    ).length;

  return {
    seniors,
    profilesCount: state.profiles.length,
    sessionsCount: state.sessions.length,
    applicationsCount: state.applications.length,
    enrolled,
    admitted,
    applied,
    planning,
    rejected,
    waitlisted,
    upcomingFollowUps,
    byCounsellor,
    byTrack,
    topDreamColleges,
    counsellors: COUNSELLORS,
  };
}

module.exports = {
  CAREER_TRACKS,
  STREAMS,
  COUNTRIES,
  EXAMS,
  APP_STATUSES,
  COUNSELLORS,
  TOP_COLLEGES_INDIA,
  TOP_COLLEGES_ABROAD,
  profiles: () => state.profiles,
  sessions: () => state.sessions,
  applications: () => state.applications,
  listProfiles,
  getProfile,
  listSessions,
  listApplications,
  updateProfile,
  addSession,
  updateSession,
  removeSession,
  addApplication,
  updateApplication,
  removeApplication,
  summary,
};
