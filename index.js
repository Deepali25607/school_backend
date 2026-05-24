const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const seed = require("./data/seed");
const examsData = require("./data/exams");
const timetableData = require("./data/timetable");
const libraryData = require("./data/library");
const payrollData = require("./data/payroll");
const transportData = require("./data/transport");
const learningData = require("./data/learning");
const usersData = require("./data/users");
const admissionsData = require("./data/admissions");
const commsData = require("./data/communications");
const hostelData = require("./data/hostel");
const eventsData = require("./data/events");
const inventoryData = require("./data/inventory");
const leaveData = require("./data/leave");
const maintenanceData = require("./data/maintenance");
const visitorsData = require("./data/visitors");
const documentsData = require("./data/documents");
const healthData = require("./data/health");
const disciplineData = require("./data/discipline");
const achievementsData = require("./data/achievements");
const cafeteriaData = require("./data/cafeteria");
const feePaymentsData = require("./data/fee-payments");
const calendarData = require("./data/calendar");
const alumniData = require("./data/alumni");
const noticesData = require("./data/notices");
const ptmData = require("./data/ptm");
const pollsData = require("./data/polls");
const scholarshipsData = require("./data/scholarships");
const housePointsData = require("./data/housepoints");
const fundraisingData = require("./data/fundraising");
const sportsData = require("./data/sports");
const careersData = require("./data/careers");
const suggestionsData = require("./data/suggestions");
const promotionData = require("./data/promotion");
const substitutesData = require("./data/substitutes");
const staffData = require("./data/staff");
const notificationsData = require("./data/notifications");
const searchData = require("./data/search");
const auditData = require("./data/audit");
const realtime = require("./data/realtime");
const store = require("./data/store");

// Tiny deterministic hash → small integer. Used to replace request-time
// Math.random() so values are stable across reloads (no flicker).
function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, ...parts) {
  return arr[hash(...parts) % arr.length];
}

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "lumina-dev-secret-change-in-prod";
const JWT_TTL = "12h";

app.use(cors());
// 5 MB body limit so /api/admin/restore can accept full snapshots.
// All other endpoints have payloads well below 100 KB.
app.use(express.json({ limit: "5mb" }));

// --- in-memory store (some collections now persisted via data/store.js) ---
const db = {
  students: [...seed.students],
  teachers: [...seed.teachers],
  // attendance map { "YYYY-MM-DD:STU####": "Present"|... } persists to disk
  attendance: store.load("attendance", () => ({})),
};
const persistAttendance = () => store.save("attendance", db.attendance);

// Year-end promotion mutates the active roster — bind it to the same array
// reference that every other route reads from so changes are immediately
// visible without restart.
promotionData.bind(db.students);

// ============ AUTH ============
function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

// Public endpoints
app.get("/", (req, res) => {
  res.json({ name: "Lumina API", version: "1.0", status: "ok" });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password, role } = req.body || {};
  let user;
  if (email) user = usersData.findByEmail(email);
  else if (role) user = usersData.findByRole(role); // demo fallback
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (password !== undefined) {
    if (!usersData.verifyPassword(user, password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
  } else if (!role) {
    // no password and no role-pick → reject
    return res.status(400).json({ error: "Password required" });
  }

  const token = signToken(user);
  res.json({ token, user: usersData.publicUser(user) });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = usersData.users.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "User not gone" });
  res.json({ user: usersData.publicUser(user) });
});

app.patch("/api/auth/me", requireAuth, (req, res) => {
  try {
    const updated = usersData.updateProfile(req.user.sub, req.body || {});
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ user: usersData.publicUser(updated) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    usersData.changePassword(req.user.sub, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Everything below requires a valid token.
app.use("/api", (req, res, next) => {
  // skip auth endpoints (already past) and root
  if (req.path.startsWith("/auth/")) return next();
  return requireAuth(req, res, next);
});

// ============ AUDIT MIDDLEWARE ============
// Records every authenticated mutation (POST/PATCH/PUT/DELETE) after the
// response is sent. Skips reads, auth endpoints, and the audit log itself.
app.use("/api", (req, res, next) => {
  if (auditData.shouldSkip(req.path, req.method)) return next();
  if (req.path.startsWith("/audit")) return next(); // avoid recursive noise
  if (req.path.startsWith("/notifications")) return next(); // notifications themselves
  const start = Date.now();

  // Capture the JSON response body so notification rules can inspect it
  // (e.g. "was this maintenance ticket Critical?"). We patch res.json
  // because every route in this app uses it.
  let capturedBody = null;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    capturedBody = body;
    return origJson(body);
  };

  res.on("finish", () => {
    const user = req.user
      ? usersData.users.find((u) => u.id === req.user.sub)
      : null;
    const path = req.originalUrl.split("?")[0];
    const entry = auditData.record({
      userId: user?.id || null,
      userName: user?.name || "anonymous",
      role: req.user?.role || "anonymous",
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
      summary: summarizeBody(req.body),
    });

    // Live-broadcast: 1) a typed event for the resource so module pages can
    // refetch, and 2) a generic "audit.appended" so the Audit Log can
    // prepend the new row without reloading.
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const topic = realtime.eventTypeFor(path, req.method);
      if (topic) {
        realtime.broadcast({
          type: topic,
          path,
          method: req.method,
          by: user?.name || null,
          role: req.user?.role || null,
        });
      }
      realtime.broadcast({ type: "audit.appended", entry });

      // Notification log — only certain events qualify. Wrapped so a buggy
      // rule never breaks the response cycle.
      try {
        const notif = notificationsData.recordFromEvent({
          method: req.method,
          path,
          statusCode: res.statusCode,
          body: req.body,
          user,
          response: capturedBody,
        });
        if (notif) {
          realtime.broadcast({ type: "notification.appended", notification: notif });
        }
      } catch (e) {
        console.warn("[notifications] rule failed:", e.message);
      }
    }
  });
  next();
});

function summarizeBody(body) {
  if (!body || typeof body !== "object") return null;
  // keep audit entries small — record top-level keys and a brief value preview
  const keys = Object.keys(body);
  if (keys.length === 0) return null;
  const out = {};
  for (const k of keys.slice(0, 6)) {
    let v = body[k];
    if (Array.isArray(v)) v = `[${v.length} items]`;
    else if (v && typeof v === "object") v = "{…}";
    else if (typeof v === "string" && v.length > 60) v = v.slice(0, 60) + "…";
    out[k] = v;
  }
  return out;
}

// ============ DASHBOARD ============
app.get("/api/dashboard/summary", (req, res) => {
  res.json({
    stats: seed.stats,
    attendanceTrend: seed.attendanceTrend,
    feeBreakdown: seed.feeBreakdown,
    announcements: seed.announcements,
  });
});

// ============ STUDENTS ============
app.get("/api/students", (req, res) => {
  const { q = "", grade = "all" } = req.query;
  let list = db.students;
  if (grade !== "all") list = list.filter((s) => String(s.grade) === String(grade));
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (s) => s.name.toLowerCase().includes(t) || s.id.toLowerCase().includes(t)
    );
  }
  res.json({ total: list.length, items: list });
});

app.get("/api/students/:id", (req, res) => {
  const s = db.students.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

// 360° profile — single endpoint that aggregates across every module that
// holds per-student data. Used by the Student detail page so the UI doesn't
// have to fan out 10 separate calls and stitch them itself.
app.get("/api/students/:id/profile", (req, res) => {
  const studentId = req.params.id;
  const student = db.students.find((x) => x.id === studentId);
  if (!student) return res.status(404).json({ error: "Not found" });

  // ----- Health -----
  const healthProfile = healthData.getProfile(studentId);
  const healthVisits = healthData
    .listVisits({ studentId })
    .slice(0, 10);
  const vaxTaken = healthProfile
    ? healthProfile.vaccinations.filter((v) => v.taken).length
    : 0;
  const vaxTotal = healthProfile ? healthProfile.vaccinations.length : 0;

  // ----- Discipline -----
  const disciplineLedger = disciplineData.studentLedger(studentId);
  const recentIncidents = disciplineLedger.items
    .slice()
    .sort((a, b) => new Date(b.reportedOn) - new Date(a.reportedOn))
    .slice(0, 10);

  // ----- Cafeteria preference -----
  const cafeteriaPref = cafeteriaData.getPref(studentId);

  // ----- Fee billing -----
  const billing = feePaymentsData.studentBilling(student);

  // ----- Achievements -----
  const achievementsTally = achievementsData.studentTally(studentId);
  const recentAchievements = achievementsTally.items
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 12);

  // ----- Documents -----
  const docs = documentsData.docs().filter((d) => d.studentId === studentId);
  const docSummary = {
    total: docs.length,
    Requested: docs.filter((d) => d.status === "Requested").length,
    Approved: docs.filter((d) => d.status === "Approved").length,
    Issued: docs.filter((d) => d.status === "Issued").length,
    Rejected: docs.filter((d) => d.status === "Rejected").length,
  };

  // ----- Exam results across all completed exams -----
  const examResults = [];
  for (const exam of examsData.exams) {
    if (exam.grade !== student.grade) continue;
    if (exam.status !== "Completed") continue;
    const subjects = [];
    let total = 0;
    let max = 0;
    for (const paper of exam.papers) {
      const key = `${exam.id}:${studentId}:${paper.subject}`;
      const m = examsData.marks[key];
      if (typeof m === "number") {
        subjects.push({ subject: paper.subject, marks: m, maxMarks: paper.maxMarks });
        total += m;
        max += paper.maxMarks;
      }
    }
    if (subjects.length > 0) {
      const pct = max > 0 ? Math.round((total / max) * 100) : 0;
      examResults.push({
        examId: exam.id,
        examName: exam.name,
        type: exam.type,
        endDate: exam.endDate,
        subjects,
        total,
        max,
        pct,
        grade: examsData.gradeFor(pct),
      });
    }
  }
  examResults.sort((a, b) => new Date(b.endDate) - new Date(a.endDate));

  // ----- Library: current + recent issues -----
  const allIssues = libraryData.issues.filter((i) => i.studentId === studentId);
  const bookById = new Map(libraryData.books.map((b) => [b.id, b]));
  const libraryIssues = allIssues
    .slice()
    .sort((a, b) => new Date(b.issuedOn) - new Date(a.issuedOn))
    .slice(0, 15)
    .map((i) => {
      const b = bookById.get(i.bookId);
      return {
        ...i,
        bookTitle: b ? b.title : "(unknown)",
        bookAuthor: b ? b.author : "",
        overdue:
          !i.returnedOn &&
          new Date(i.dueOn).getTime() < Date.now(),
      };
    });

  // ----- Hostel: room assignment, if any -----
  let hostel = null;
  for (const r of hostelData.rooms()) {
    if ((r.occupants || []).some((o) => o.studentId === studentId)) {
      hostel = {
        roomId: r.id,
        block: r.block,
        number: r.number,
        floor: r.floor,
        capacity: r.capacity,
        occupants: r.occupants.length,
        gender: r.gender,
      };
      break;
    }
  }

  // ----- Recent audit activity touching this student -----
  // Pull the most recent N audit entries that mention this studentId in their
  // path or summary. Cheap scan — the audit log is capped at 2000 entries.
  const activity = auditData
    .list({})
    .filter((e) => {
      if (e.path.includes(studentId)) return true;
      if (e.summary) {
        for (const v of Object.values(e.summary)) {
          if (typeof v === "string" && v.includes(studentId)) return true;
        }
      }
      return false;
    })
    .slice(0, 15);

  res.json({
    student,
    health: healthProfile
      ? {
          profile: healthProfile,
          recentVisits: healthVisits,
          vaxTaken,
          vaxTotal,
        }
      : null,
    discipline: {
      total: disciplineLedger.total,
      demerits: disciplineLedger.demerits,
      open: disciplineLedger.open,
      last90: disciplineLedger.last90,
      bySeverity: disciplineLedger.bySeverity,
      recent: recentIncidents,
    },
    achievements: {
      total: achievementsTally.total,
      points: achievementsTally.points,
      gold: achievementsTally.gold,
      silver: achievementsTally.silver,
      bronze: achievementsTally.bronze,
      byCategory: achievementsTally.byCategory,
      recent: recentAchievements,
    },
    documents: { summary: docSummary, items: docs },
    exams: {
      total: examResults.length,
      avgPct:
        examResults.length > 0
          ? Math.round(
              examResults.reduce((a, e) => a + e.pct, 0) / examResults.length
            )
          : null,
      results: examResults,
    },
    library: {
      total: allIssues.length,
      current: allIssues.filter((i) => !i.returnedOn).length,
      overdue: allIssues.filter(
        (i) => !i.returnedOn && new Date(i.dueOn).getTime() < Date.now()
      ).length,
      issues: libraryIssues,
    },
    hostel,
    cafeteria: cafeteriaPref,
    billing,
    activity,
  });
});

const STUDENT_FIELDS = [
  "name",
  "grade",
  "section",
  "house",
  "attendance",
  "feeStatus",
  "parent",
  "contact",
  "gpa",
  "photoUrl",
];
const VALID_SECTIONS = ["A", "B", "C", "D"];
const VALID_HOUSES = ["Crimson", "Azure", "Emerald", "Amber"];
const VALID_FEE = ["Paid", "Pending", "Partial"];

function persistStudents() {
  store.save("students", db.students);
}

function avatarFromName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  const a = (parts[0] || "?")[0];
  const b = (parts[parts.length - 1] || "?")[0];
  return ((a || "?") + (b || "?")).toUpperCase();
}

// Profile photos are stored inline as base64 data URLs (no external CDN in
// this app). Frontend resizes before upload, so a typical payload is ~30 KB;
// the cap below catches accidental full-size uploads.
const PHOTO_MAX_BYTES = 256 * 1024;
function validatePhotoUrl(value) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string") throw new Error("photoUrl must be a string");
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(value))
    throw new Error("photoUrl must be a data:image/... base64 URL");
  if (value.length > PHOTO_MAX_BYTES)
    throw new Error(
      `photoUrl too large (max ${Math.round(PHOTO_MAX_BYTES / 1024)} KB)`
    );
}

function nextStudentId() {
  // Compute the next available numeric suffix — robust to gaps from deletes.
  let max = 1000;
  for (const s of db.students) {
    const n = parseInt(String(s.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `STU${max + 1}`;
}

function validateStudentPayload(body, { partial } = {}) {
  if (body.photoUrl !== undefined) validatePhotoUrl(body.photoUrl);
  if (!partial) {
    if (!body.name || !String(body.name).trim()) throw new Error("name required");
    if (!body.grade) throw new Error("grade required");
  }
  if (body.grade !== undefined) {
    const g = Number(body.grade);
    if (!Number.isInteger(g) || g < 1 || g > 12) throw new Error("grade must be 1-12");
  }
  if (body.section !== undefined && !VALID_SECTIONS.includes(body.section))
    throw new Error("section must be A/B/C/D");
  if (body.house !== undefined && !VALID_HOUSES.includes(body.house))
    throw new Error(`house must be one of ${VALID_HOUSES.join(", ")}`);
  if (body.feeStatus !== undefined && !VALID_FEE.includes(body.feeStatus))
    throw new Error(`feeStatus must be one of ${VALID_FEE.join(", ")}`);
  if (body.attendance !== undefined) {
    const a = Number(body.attendance);
    if (!Number.isFinite(a) || a < 0 || a > 100)
      throw new Error("attendance must be 0-100");
  }
  if (body.gpa !== undefined) {
    const g = Number(body.gpa);
    if (!Number.isFinite(g) || g < 0 || g > 5)
      throw new Error("gpa must be 0-5");
  }
}

app.post("/api/students", requireRole("admin", "principal"), (req, res) => {
  try {
    const body = req.body || {};
    validateStudentPayload(body);
    const s = {
      id: nextStudentId(),
      name: String(body.name).trim(),
      avatar: avatarFromName(body.name),
      grade: Number(body.grade),
      section: body.section || "A",
      house: body.house || "Azure",
      attendance:
        body.attendance !== undefined ? Number(body.attendance) : 100,
      feeStatus: body.feeStatus || "Pending",
      parent: body.parent || "",
      contact: body.contact || "",
      gpa: body.gpa !== undefined ? Number(body.gpa).toFixed(2) : "3.50",
      photoUrl: body.photoUrl || null,
    };
    db.students.push(s);
    persistStudents();
    res.status(201).json(s);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/students/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    const s = db.students.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: "Student not found" });
    const body = req.body || {};
    validateStudentPayload(body, { partial: true });
    for (const k of STUDENT_FIELDS) {
      if (body[k] === undefined) continue;
      if (k === "grade" || k === "attendance") s[k] = Number(body[k]);
      else if (k === "gpa") s[k] = Number(body[k]).toFixed(2);
      else s[k] = body[k];
    }
    if (body.name !== undefined) s.avatar = avatarFromName(body.name);
    persistStudents();
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete(
  "/api/students/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    const idx = db.students.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Student not found" });
    const [removed] = db.students.splice(idx, 1);
    persistStudents();
    res.json(removed);
  }
);

// Aggregate 360° profile for a single teacher. Mirrors the student endpoint —
// pulls data from every module that touches teachers so the detail page can
// render with one round trip.
app.get("/api/teachers/:id/profile", (req, res) => {
  const id = req.params.id;
  const teacher = db.teachers.find((t) => t.id === id);
  if (!teacher) return res.status(404).json({ error: "Not found" });

  // ----- Timetable: iterate every grade × section grid that contains
  // this teacher's classes. The timetable module generates grids on demand
  // (per grade+section), so we walk the small space ourselves. -----
  const SECTIONS = ["A", "B", "C", "D"];
  const classLoad = new Map(); // "Grade X-Y" → period count
  const subjectsTaught = new Set();
  let totalPeriods = 0;
  const weeklyByDay = {}; // day → count
  for (let grade = 1; grade <= 12; grade++) {
    for (const section of SECTIONS) {
      const grid = timetableData.buildGrid(grade, section);
      for (const day of grid) {
        for (const p of day.periods) {
          if (p.teacherId !== id) continue;
          const key = `Grade ${grade}-${section}`;
          classLoad.set(key, (classLoad.get(key) || 0) + 1);
          subjectsTaught.add(p.subject);
          totalPeriods++;
          weeklyByDay[day.day] = (weeklyByDay[day.day] || 0) + 1;
        }
      }
    }
  }

  // ----- Leave requests for this teacher -----
  const leaveRequests = leaveData
    .requests()
    .filter((r) => r.applicantId === id)
    .sort((a, b) => new Date(b.appliedOn) - new Date(a.appliedOn));
  const leaveSummary = {
    total: leaveRequests.length,
    pending: leaveRequests.filter((r) => r.status === "Pending").length,
    approved: leaveRequests.filter((r) => r.status === "Approved").length,
    rejected: leaveRequests.filter((r) => r.status === "Rejected").length,
    daysApproved: leaveRequests
      .filter((r) => r.status === "Approved")
      .reduce((s, r) => s + (r.days || 0), 0),
  };

  // ----- Discipline incidents this teacher logged (fuzzy match on name) -----
  // reportedBy is a free-text string in the discipline module — match by
  // checking if any name token appears in the reporter string.
  const firstName = (teacher.name || "").split(" ")[0];
  const lastName = (teacher.name || "").split(" ").slice(-1)[0];
  const incidentsLogged = disciplineData
    .incidents()
    .filter((inc) => {
      const r = inc.reportedBy || "";
      return (
        (firstName && r.includes(firstName)) ||
        (lastName && r.includes(lastName))
      );
    })
    .slice(0, 10);

  // ----- Recent activity from the audit log mentioning this teacher -----
  const recentActivity = auditData
    .list({})
    .filter((e) => {
      if (e.userName === teacher.name) return true;
      if (e.path && e.path.includes(id)) return true;
      return false;
    })
    .slice(0, 15);

  res.json({
    teacher,
    classLoad: {
      totalPeriods,
      classes: [...classLoad.entries()]
        .map(([k, periods]) => ({ classKey: k, periods }))
        .sort((a, b) => b.periods - a.periods),
      subjects: [...subjectsTaught],
      weeklyByDay,
    },
    leave: { items: leaveRequests, summary: leaveSummary },
    discipline: {
      total: incidentsLogged.length,
      recent: incidentsLogged,
    },
    activity: recentActivity,
  });
});

// ============ TEACHERS ============
app.get("/api/teachers", (req, res) => {
  const { q = "" } = req.query;
  let list = db.teachers;
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (x) =>
        x.name.toLowerCase().includes(t) ||
        x.subject.toLowerCase().includes(t) ||
        x.id.toLowerCase().includes(t) ||
        (x.email || "").toLowerCase().includes(t)
    );
  }
  res.json({ total: list.length, items: list });
});

const TEACHER_FIELDS = [
  "name",
  "subject",
  "classes",
  "experience",
  "rating",
  "email",
  "status",
  "photoUrl",
];
const VALID_TEACHER_SUBJECTS = [
  "Mathematics", "Physics", "Chemistry", "Biology", "English",
  "History", "Geography", "Computer Sci", "PE", "Art",
];
const VALID_TEACHER_STATUS = ["Active", "On leave"];

function persistTeachers() {
  store.save("teachers", db.teachers);
}

function nextTeacherId() {
  let max = 100;
  for (const t of db.teachers) {
    const n = parseInt(String(t.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TCH${max + 1}`;
}

function emailForTeacher(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug || "teacher"}@lumina.edu`;
}

function validateTeacherPayload(body, { partial } = {}) {
  if (body.photoUrl !== undefined) validatePhotoUrl(body.photoUrl);
  if (!partial && !body.name) throw new Error("name required");
  if (!partial && !body.subject) throw new Error("subject required");
  if (body.subject !== undefined && !VALID_TEACHER_SUBJECTS.includes(body.subject))
    throw new Error(`subject must be one of ${VALID_TEACHER_SUBJECTS.join(", ")}`);
  if (body.status !== undefined && !VALID_TEACHER_STATUS.includes(body.status))
    throw new Error(`status must be one of ${VALID_TEACHER_STATUS.join(", ")}`);
  if (body.classes !== undefined) {
    const c = Number(body.classes);
    if (!Number.isInteger(c) || c < 0 || c > 40)
      throw new Error("classes must be 0-40");
  }
  if (body.experience !== undefined) {
    const e = Number(body.experience);
    if (!Number.isFinite(e) || e < 0 || e > 60)
      throw new Error("experience must be 0-60");
  }
  if (body.rating !== undefined) {
    const r = Number(body.rating);
    if (!Number.isFinite(r) || r < 0 || r > 5)
      throw new Error("rating must be 0-5");
  }
}

app.post("/api/teachers", requireRole("admin", "principal", "hr"), (req, res) => {
  try {
    const body = req.body || {};
    validateTeacherPayload(body);
    const t = {
      id: nextTeacherId(),
      name: String(body.name).trim(),
      avatar: avatarFromName(body.name),
      subject: body.subject,
      classes: body.classes !== undefined ? Number(body.classes) : 0,
      experience: body.experience !== undefined ? Number(body.experience) : 0,
      rating: body.rating !== undefined ? Number(body.rating).toFixed(1) : "4.0",
      email: body.email || emailForTeacher(body.name),
      status: body.status || "Active",
      photoUrl: body.photoUrl || null,
    };
    db.teachers.push(t);
    persistTeachers();
    res.status(201).json(t);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch(
  "/api/teachers/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const t = db.teachers.find((x) => x.id === req.params.id);
      if (!t) return res.status(404).json({ error: "Teacher not found" });
      const body = req.body || {};
      validateTeacherPayload(body, { partial: true });
      for (const k of TEACHER_FIELDS) {
        if (body[k] === undefined) continue;
        if (k === "classes" || k === "experience") t[k] = Number(body[k]);
        else if (k === "rating") t[k] = Number(body[k]).toFixed(1);
        else t[k] = body[k];
      }
      if (body.name !== undefined) t.avatar = avatarFromName(body.name);
      persistTeachers();
      res.json(t);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/teachers/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    const idx = db.teachers.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Teacher not found" });
    const [removed] = db.teachers.splice(idx, 1);
    persistTeachers();
    res.json(removed);
  }
);

// ============ ATTENDANCE ============
app.get("/api/attendance/today", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const FALLBACK = ["Present", "Present", "Present", "Present", "Absent", "Late", "Present", "Leave"];
  const list = db.students.slice(0, 30).map((s) => ({
    ...s,
    status:
      db.attendance[`${today}:${s.id}`] ||
      pick(FALLBACK, today, s.id),
  }));
  res.json({ date: today, items: list });
});

app.post("/api/attendance/:date", (req, res) => {
  const { date } = req.params;
  const { entries = {} } = req.body || {};
  Object.entries(entries).forEach(([id, status]) => {
    db.attendance[`${date}:${id}`] = status;
  });
  persistAttendance();
  res.json({ ok: true, saved: Object.keys(entries).length });
});

// ============ FEES ============
app.get("/api/fees/ledger", (req, res) => {
  const items = db.students.slice(0, 40).map((s) => {
    // Pull computed billing from the payments module so the ledger reflects
    // real transactions rather than a stable hash.
    const billing = feePaymentsData.studentBilling(s);
    return {
      id: s.id,
      name: s.name,
      grade: s.grade,
      section: s.section,
      total: billing.totalExpected,
      paid: billing.totalPaid,
      pending: billing.outstanding,
      status: billing.status,
    };
  });
  res.json({ total: items.length, items });
});

app.get("/api/fees/monthly", (req, res) => {
  res.json([
    { m: "Jan", v: 720000 },
    { m: "Feb", v: 810000 },
    { m: "Mar", v: 760000 },
    { m: "Apr", v: 900000 },
    { m: "May", v: 1020000 },
    { m: "Jun", v: 880000 },
    { m: "Jul", v: 960000 },
    { m: "Aug", v: 1100000 },
  ]);
});

// Billing breakdown + payment history for one student
app.get("/api/fees/student/:id", (req, res) => {
  const s = db.students.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  const billing = feePaymentsData.studentBilling(s);
  res.json({ student: s, ...billing });
});

// List all payments with filters
app.get("/api/fees/payments", (req, res) => {
  const { q, mode, status, studentId, sinceDays } = req.query;
  const list = feePaymentsData.listPayments({
    q, mode, status, studentId, sinceDays,
  });
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((p) => {
    const s = studentsById.get(p.studentId);
    return {
      ...p,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
      studentAvatar: s ? s.avatar : null,
    };
  });
  res.json({
    total: items.length,
    items,
    modes: feePaymentsData.PAYMENT_MODES,
    statuses: feePaymentsData.PAYMENT_STATUSES,
    summary: feePaymentsData.summary(),
  });
});

// Record a new payment — admin/principal/accountant/parent allowed
app.post(
  "/api/fees/payments",
  requireRole("admin", "principal", "accountant", "parent"),
  (req, res) => {
    try {
      const p = feePaymentsData.recordPayment(req.body || {});
      res.status(201).json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Receipt render — fetch payment + student + school info for the print page
app.get("/api/fees/payments/:id/receipt", (req, res) => {
  const p = feePaymentsData.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const s = db.students.find((x) => x.id === p.studentId);
  res.json({
    payment: p,
    student: s,
    school: {
      name: "Lumina Public School",
      tagline: "Light · Learning · Legacy",
      address: "12 Aurora Avenue, New Delhi, 110001",
      phone: "+91 11 4000 1234",
      email: "office@lumina.edu",
      registrationNo: "DOE/2007/4451",
      affiliation: "CBSE Affiliation No. 2730412",
      gstin: "07AAACL1234F1ZH",
    },
  });
});

// ============ EXAMS ============
app.get("/api/exams", (req, res) => {
  const { grade, status } = req.query;
  let list = examsData.exams;
  if (grade) list = list.filter((e) => String(e.grade) === String(grade));
  if (status) list = list.filter((e) => e.status === status);
  res.json({ total: list.length, items: list });
});

app.get("/api/exams/:id", (req, res) => {
  const e = examsData.exams.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json(e);
});

app.get("/api/exams/:id/marks", (req, res) => {
  const exam = examsData.exams.find((x) => x.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  const students = db.students.filter((s) => s.grade === exam.grade).slice(0, 24);
  const rows = students.map((s) => {
    const subjects = {};
    let total = 0;
    let max = 0;
    exam.papers.forEach((p) => {
      const key = `${exam.id}:${s.id}:${p.subject}`;
      const stored = examsData.marks[key];
      const m =
        stored !== undefined
          ? stored
          : exam.status === "Completed"
          ? 35 + (hash(key) % 66) // stable 35-100 fallback for completed exams
          : null;
      subjects[p.subject] = m;
      if (m !== null) {
        total += m;
        max += p.maxMarks;
      }
    });
    const pct = max ? (total / max) * 100 : null;
    return {
      studentId: s.id,
      name: s.name,
      avatar: s.avatar,
      section: s.section,
      subjects,
      total,
      max,
      pct: pct === null ? null : Number(pct.toFixed(2)),
      grade: pct === null ? null : examsData.gradeFor(pct),
    };
  });
  const ranked = [...rows].filter((r) => r.pct !== null).sort((a, b) => b.pct - a.pct);
  ranked.forEach((r, i) => (r.rank = i + 1));
  res.json({ exam, rows });
});

app.post(
  "/api/exams",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.status(201).json(examsData.addExam(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/exams/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(examsData.updateExam(req.params.id, req.body || {}));
    } catch (e) {
      res
        .status(e.message === "Exam not found" ? 404 : 400)
        .json({ error: e.message });
    }
  }
);

app.delete(
  "/api/exams/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(examsData.removeExam(req.params.id));
    } catch (e) {
      res
        .status(e.message === "Exam not found" ? 404 : 400)
        .json({ error: e.message });
    }
  }
);

app.post(
  "/api/exams/:id/papers",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.status(201).json(examsData.addPaper(req.params.id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/exams/:id/papers/:subject",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(
        examsData.updatePaper(req.params.id, req.params.subject, req.body || {})
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/exams/:id/papers/:subject",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(examsData.removePaper(req.params.id, req.params.subject));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.post("/api/exams/:id/marks", requireRole("admin", "principal", "teacher"), (req, res) => {
  const exam = examsData.exams.find((x) => x.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  const { marks: payload = [] } = req.body || {};
  let count = 0;
  payload.forEach((row) => {
    if (!row.studentId || !row.subjects) return;
    Object.entries(row.subjects).forEach(([subject, value]) => {
      const key = `${exam.id}:${row.studentId}:${subject}`;
      const v = value === "" || value === null ? null : Number(value);
      if (v === null || Number.isNaN(v)) return;
      examsData.marks[key] = Math.max(0, Math.min(100, v));
      count++;
    });
  });
  if (count > 0) examsData.persistMarks();
  res.json({ ok: true, saved: count });
});

app.get("/api/results/:studentId", (req, res) => {
  const s = db.students.find((x) => x.id === req.params.studentId);
  if (!s) return res.status(404).json({ error: "Not found" });
  const studentExams = examsData.exams.filter((e) => e.grade === s.grade);
  const report = studentExams.map((exam) => {
    let total = 0,
      max = 0;
    const subjects = exam.papers.map((p) => {
      const key = `${exam.id}:${s.id}:${p.subject}`;
      const stored = examsData.marks[key];
      const m =
        stored !== undefined
          ? stored
          : exam.status === "Completed"
          ? 35 + (hash(key) % 66)
          : null;
      if (m !== null) {
        total += m;
        max += p.maxMarks;
      }
      return {
        subject: p.subject,
        marks: m,
        max: p.maxMarks,
        grade: m === null ? null : examsData.gradeFor((m / p.maxMarks) * 100),
      };
    });
    const pct = max ? (total / max) * 100 : null;
    return {
      examId: exam.id,
      name: exam.name,
      type: exam.type,
      status: exam.status,
      startDate: exam.startDate,
      total,
      max,
      pct: pct === null ? null : Number(pct.toFixed(2)),
      grade: pct === null ? null : examsData.gradeFor(pct),
      subjects,
    };
  });
  res.json({ student: s, report });
});

// ============ TIMETABLE ============
app.get("/api/timetable", (req, res) => {
  const { grade = "8", section = "A", teacherId } = req.query;
  if (teacherId) {
    const sections = ["A", "B", "C", "D"];
    const grades = Array.from({ length: 12 }, (_, i) => i + 1);
    const view = timetableData.DAYS.map((day) => ({
      day,
      periods: timetableData.PERIODS.map((slot) => {
        for (const g of grades) {
          for (const s of sections) {
            const row = timetableData
              .buildGrid(g, s)
              .find((d) => d.day === day)
              .periods.find((p) => p.p === slot.p);
            if (row && row.teacherId === teacherId) {
              return { ...slot, subject: row.subject, room: row.room, grade: g, section: s };
            }
          }
        }
        return { ...slot, free: true };
      }),
    }));
    return res.json({
      view: "teacher",
      teacherId,
      days: view,
      periods: timetableData.PERIODS,
      daysList: timetableData.DAYS,
    });
  }
  const grid = timetableData.buildGrid(Number(grade), section);
  res.json({
    view: "class",
    grade: Number(grade),
    section,
    days: grid,
    periods: timetableData.PERIODS,
    daysList: timetableData.DAYS,
  });
});

app.get(
  "/api/timetable/overrides",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    res.json({
      items: timetableData.listOverrides(),
      subjects: timetableData.SUBJECTS,
    });
  }
);

app.post(
  "/api/timetable/cell",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const { grade, section, day, period, subject, teacherId, room } =
        req.body || {};
      const next = timetableData.setOverride(
        Number(grade),
        section,
        day,
        Number(period),
        { subject, teacherId, room }
      );
      res.json({ ok: true, override: next });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/timetable/cell",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const { grade, section, day, period } = req.body || {};
      const had = timetableData.clearOverride(
        Number(grade),
        section,
        day,
        Number(period)
      );
      res.json({ ok: true, removed: had });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.post(
  "/api/timetable/clear-class",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const { grade, section } = req.body || {};
      const removed = timetableData.clearClass(Number(grade), section);
      res.json({ ok: true, removed });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ LIBRARY ============
app.get("/api/library/books", (req, res) => {
  const { q = "", category = "all" } = req.query;
  let list = libraryData.books;
  if (category !== "all") list = list.filter((b) => b.category === category);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (b) =>
        b.title.toLowerCase().includes(t) ||
        b.author.toLowerCase().includes(t) ||
        b.isbn.toLowerCase().includes(t)
    );
  }
  res.json({ total: list.length, items: list });
});

app.get("/api/library/issues", (req, res) => {
  const enriched = libraryData.issues.map((i) => {
    const book = libraryData.books.find((b) => b.id === i.bookId);
    const student = db.students.find((s) => s.id === i.studentId);
    const overdueDays =
      !i.returnedOn && new Date(i.dueOn) < new Date()
        ? Math.floor((new Date() - new Date(i.dueOn)) / 86400000)
        : 0;
    return {
      ...i,
      book: book ? { id: book.id, title: book.title, author: book.author } : null,
      student: student
        ? { id: student.id, name: student.name, avatar: student.avatar, grade: student.grade }
        : null,
      overdueDays,
      runningFine: overdueDays * 5,
    };
  });
  res.json({ total: enriched.length, items: enriched });
});

app.post("/api/library/issue", (req, res) => {
  try {
    const { bookId, studentId, days } = req.body || {};
    const rec = libraryData.issueBook({ bookId, studentId, days });
    res.status(201).json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/library/return/:issueId", (req, res) => {
  try {
    const rec = libraryData.returnBook({ issueId: req.params.issueId });
    res.json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ PAYROLL ============
app.get("/api/payroll", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  const { q = "", department = "all" } = req.query;
  let list = payrollData.staff;
  if (department !== "all") list = list.filter((s) => s.department === department);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(t) ||
        s.role.toLowerCase().includes(t) ||
        s.id.toLowerCase().includes(t)
    );
  }
  res.json({
    total: list.length,
    items: list,
    summary: payrollData.summary(),
  });
});

app.get("/api/payroll/:id", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  const s = payrollData.staff.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

// ============ TRANSPORT ============
// Each route has a fixed period (seeded from its id) — progress advances
// smoothly over wall-clock time so the bus crawls forward predictably and
// every client sees the same position at the same instant.
app.get("/api/transport/routes", (req, res) => {
  const now = Date.now();
  const live = transportData.routes.map((r) => {
    const periodMs = 4 * 60 * 1000 + (hash("trip", r.id) % (3 * 60 * 1000)); // 4-7 min loop
    const phase = (hash("phase", r.id) % 1000) / 1000;
    const progress = ((now / periodMs + phase) % 1);
    return { ...r, progress };
  });
  res.json({ total: live.length, items: live });
});

app.get("/api/transport/routes/:id", (req, res) => {
  const r = transportData.routes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json(r);
});

app.post(
  "/api/transport/routes",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.status(201).json(transportData.addRoute(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/transport/routes/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(transportData.updateRoute(req.params.id, req.body || {}));
    } catch (e) {
      const code = e.message === "Route not found" ? 404 : 400;
      res.status(code).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/transport/routes/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(transportData.removeRoute(req.params.id));
    } catch (e) {
      const code = e.message === "Route not found" ? 404 : 400;
      res.status(code).json({ error: e.message });
    }
  }
);

app.post(
  "/api/transport/routes/:id/stops",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res
        .status(201)
        .json(transportData.addStop(req.params.id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/transport/routes/:id/stops/:index",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(
        transportData.updateStop(
          req.params.id,
          req.params.index,
          req.body || {}
        )
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/transport/routes/:id/stops/:index",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(transportData.removeStop(req.params.id, req.params.index));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ LEARNING ============
app.get("/api/learning/live", (req, res) => {
  const { status } = req.query;
  // recompute live/scheduled/ended based on `new Date()`
  const items = learningData.live.map((c) => {
    const start = new Date(c.startsAt);
    const end = new Date(c.endsAt);
    const now = new Date();
    let st = "Scheduled";
    if (now >= start && now <= end) st = "Live";
    else if (now > end) st = "Ended";
    return { ...c, status: st };
  });
  const filtered = status ? items.filter((c) => c.status === status) : items;
  res.json({ total: filtered.length, items: filtered });
});

app.get("/api/learning/recordings", (req, res) => {
  const { q = "", subject = "all" } = req.query;
  let list = learningData.recordings;
  if (subject !== "all") list = list.filter((r) => r.subject === subject);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (r) =>
        r.title.toLowerCase().includes(t) ||
        r.subject.toLowerCase().includes(t) ||
        r.teacher.name.toLowerCase().includes(t)
    );
  }
  res.json({ total: list.length, items: list, subjects: learningData.SUBJECTS });
});

app.get("/api/learning/materials", (req, res) => {
  res.json({ total: learningData.materials.length, items: learningData.materials });
});

// ============ ADMISSIONS ============
app.get("/api/admissions", (req, res) => {
  const { stage, q = "" } = req.query;
  let list = admissionsData.applicants();
  if (stage) list = list.filter((a) => a.stage === stage);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (a) =>
        a.name.toLowerCase().includes(t) ||
        a.id.toLowerCase().includes(t) ||
        a.parentContact.includes(t)
    );
  }
  // group by stage for kanban
  const board = {};
  admissionsData.STAGES.forEach((s) => (board[s] = []));
  admissionsData.applicants().forEach((a) => board[a.stage]?.push(a));
  res.json({
    stages: admissionsData.STAGES,
    total: list.length,
    items: list,
    board,
  });
});

app.get("/api/admissions/:id", (req, res) => {
  const a = admissionsData.applicants().find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  res.json(a);
});

app.post("/api/admissions", requireRole("admin", "principal"), (req, res) => {
  const a = admissionsData.add(req.body || {});
  res.status(201).json(a);
});

app.patch("/api/admissions/:id/move", requireRole("admin", "principal"), (req, res) => {
  try {
    const a = admissionsData.move(req.params.id, req.body?.stage);
    res.json(a);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ COMMUNICATIONS ============
app.get("/api/communications/audiences", (req, res) => {
  res.json({ channels: commsData.CHANNELS, audiences: commsData.AUDIENCES });
});

app.get("/api/communications/broadcasts", (req, res) => {
  res.json({ total: commsData.broadcasts().length, items: commsData.broadcasts() });
});

app.post("/api/communications/broadcasts", requireRole("admin", "principal", "teacher", "hr"), (req, res) => {
  const payload = req.body || {};
  const sentBy = (() => {
    const u = usersData.users.find((u) => u.id === req.user.sub);
    return u ? u.name : "System";
  })();
  const rec = commsData.send({ ...payload, sentBy });
  res.status(201).json(rec);
});

// ============ HOSTEL ============
app.get("/api/hostel/summary", (req, res) => {
  res.json(hostelData.summary());
});

app.get("/api/hostel/rooms", (req, res) => {
  const { block, status } = req.query;
  let list = hostelData.rooms();
  if (block && block !== "all") list = list.filter((r) => r.block === block);
  if (status && status !== "all") list = list.filter((r) => r.status === status);
  res.json({ total: list.length, items: list, blocks: hostelData.BLOCKS });
});

app.post("/api/hostel/rooms/:roomId/assign", requireRole("admin", "principal"), (req, res) => {
  try {
    const room = hostelData.assign({ roomId: req.params.roomId, ...(req.body || {}) });
    res.json(room);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/hostel/rooms/:roomId/evict", requireRole("admin", "principal"), (req, res) => {
  try {
    const room = hostelData.evict({ roomId: req.params.roomId, ...(req.body || {}) });
    res.json(room);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ EVENTS ============
app.get("/api/events", (req, res) => {
  const { month, category } = req.query;
  let list = eventsData.events();
  if (category && category !== "all") list = list.filter((e) => e.category === category);
  if (month) list = list.filter((e) => e.date.startsWith(month));
  res.json({
    total: list.length,
    items: list,
    categories: eventsData.CATEGORIES,
  });
});

app.post("/api/events", requireRole("admin", "principal", "teacher"), (req, res) => {
  const ev = eventsData.add(req.body || {});
  res.status(201).json(ev);
});

app.delete("/api/events/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    const removed = eventsData.remove(req.params.id);
    res.json(removed);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ============ INVENTORY ============
app.get("/api/inventory", (req, res) => {
  const { q = "", category = "all", lowStock } = req.query;
  let list = inventoryData.assets();
  if (category !== "all") list = list.filter((a) => a.category === category);
  if (lowStock === "true") list = list.filter((a) => a.qty <= a.reorder);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (a) =>
        a.name.toLowerCase().includes(t) ||
        a.sku.toLowerCase().includes(t) ||
        a.vendor.toLowerCase().includes(t)
    );
  }
  res.json({
    total: list.length,
    items: list,
    categories: inventoryData.CATEGORIES,
    summary: inventoryData.summary(),
  });
});

app.post("/api/inventory/:id/adjust", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const a = inventoryData.adjust(req.params.id, req.body?.delta, req.body?.note);
    res.json(a);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ LEAVE ============
app.get("/api/leave", (req, res) => {
  const { status, type } = req.query;
  let list = leaveData.requests();
  if (status && status !== "all") list = list.filter((r) => r.status === status);
  if (type && type !== "all") list = list.filter((r) => r.type === type);
  res.json({
    total: list.length,
    items: list,
    types: leaveData.TYPES,
    summary: leaveData.summary(),
  });
});

app.post("/api/leave", (req, res) => {
  const rec = leaveData.add(req.body || {});
  res.status(201).json(rec);
});

app.patch("/api/leave/:id", requireRole("admin", "principal", "hr"), (req, res) => {
  try {
    const decider = (() => {
      const u = usersData.users.find((u) => u.id === req.user.sub);
      return u ? u.name : "Admin";
    })();
    const rec = leaveData.decide(req.params.id, req.body?.status, decider);
    res.json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ GLOBAL SEARCH ============
// One endpoint that scans every searchable collection and returns grouped hits.
// Intended for the topbar Cmd+K palette. Read-only — no auth-role gating, every
// authed user can search (the link they get takes them to a page that already
// has its own role gate).
app.get("/api/search", (req, res) => {
  res.json(searchData.search(req.query.q || ""));
});

// ============ NOTIFICATIONS ============
// Any authenticated user can read their own notification feed.
// Notifications are recorded server-side by the audit middleware whenever an
// "interesting" mutation happens; clients also get a live `notification.appended`
// event via the realtime WS.

app.get("/api/notifications", (req, res) => {
  const userId = req.user?.sub || null;
  const items = notificationsData.list({
    userId,
    limit: req.query.limit,
    unread: req.query.unread === "true",
    type: req.query.type,
  });
  res.json({
    total: items.length,
    items,
    unreadCount: notificationsData.unreadCount(userId),
  });
});

app.get("/api/notifications/unread-count", (req, res) => {
  res.json({ unreadCount: notificationsData.unreadCount(req.user?.sub || null) });
});

app.patch("/api/notifications/:id/read", (req, res) => {
  try {
    const n = notificationsData.markRead(req.params.id, req.user?.sub || null);
    res.json(n);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/notifications/mark-all-read", (req, res) => {
  const out = notificationsData.markAllRead(req.user?.sub || null);
  res.json(out);
});

// ============ AUDIT LOGS ============
app.get("/api/audit", requireRole("admin", "principal"), (req, res) => {
  const items = auditData.list(req.query);
  const limit = Math.min(500, parseInt(req.query.limit || "200", 10));
  res.json({
    total: items.length,
    items: items.slice(0, limit),
    summary: auditData.summary(),
  });
});

// ============ MAINTENANCE ============
app.get("/api/maintenance", (req, res) => {
  const { stage, priority, category, q = "" } = req.query;
  let list = maintenanceData.tickets();
  if (stage && stage !== "all") list = list.filter((t) => t.stage === stage);
  if (priority && priority !== "all")
    list = list.filter((t) => t.priority === priority);
  if (category && category !== "all")
    list = list.filter((t) => t.category === category);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (x) =>
        x.title.toLowerCase().includes(t) ||
        x.id.toLowerCase().includes(t) ||
        x.location.toLowerCase().includes(t)
    );
  }
  res.json({
    total: list.length,
    items: list,
    summary: maintenanceData.summary(),
    stages: maintenanceData.STAGES,
    priorities: maintenanceData.PRIORITIES,
    categories: maintenanceData.CATEGORIES,
    technicians: maintenanceData.TECHNICIANS,
  });
});

app.post("/api/maintenance", (req, res) => {
  const t = maintenanceData.add(req.body || {});
  res.status(201).json(t);
});

app.patch(
  "/api/maintenance/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const t = maintenanceData.update(req.params.id, req.body || {});
      res.json(t);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ VISITORS ============
app.get("/api/visitors", (req, res) => {
  const { active, q = "", purpose } = req.query;
  let list = visitorsData.visitors();
  if (active === "true") list = list.filter((v) => !v.checkOutAt);
  if (active === "false") list = list.filter((v) => v.checkOutAt);
  if (purpose && purpose !== "all") list = list.filter((v) => v.purpose === purpose);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (v) =>
        v.name.toLowerCase().includes(t) ||
        v.phone.includes(t) ||
        v.pass.toLowerCase().includes(t) ||
        v.host.toLowerCase().includes(t)
    );
  }
  res.json({
    total: list.length,
    items: list,
    summary: visitorsData.summary(),
    purposes: visitorsData.PURPOSES,
    idTypes: visitorsData.ID_TYPES,
  });
});

app.post("/api/visitors", (req, res) => {
  const rec = visitorsData.checkIn(req.body || {});
  res.status(201).json(rec);
});

app.post("/api/visitors/:id/checkout", (req, res) => {
  try {
    const rec = visitorsData.checkOut(req.params.id);
    res.json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ DOCUMENTS & CERTIFICATES ============
// Anyone with a valid token can list/request; only admin/principal/hr can issue.
app.get("/api/documents", (req, res) => {
  const { status, type, studentId, q = "" } = req.query;
  let list = documentsData.docs().slice();
  if (status && status !== "all") list = list.filter((d) => d.status === status);
  if (type && type !== "all") list = list.filter((d) => d.type === type);
  if (studentId) list = list.filter((d) => d.studentId === studentId);
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(
      (d) =>
        d.id.toLowerCase().includes(t) ||
        d.studentId.toLowerCase().includes(t) ||
        (d.purpose || "").toLowerCase().includes(t) ||
        (d.certificateNo || "").toLowerCase().includes(t)
    );
  }
  // Decorate each record with the student's display name/grade so the table
  // doesn't need a second round-trip.
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((d) => {
    const s = studentsById.get(d.studentId);
    return {
      ...d,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
    };
  });
  res.json({
    total: items.length,
    items,
    types: documentsData.TYPES,
    statuses: documentsData.STATUSES,
    summary: documentsData.summary(),
  });
});

app.post("/api/documents", (req, res) => {
  try {
    const d = documentsData.add(req.body || {});
    res.status(201).json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch(
  "/api/documents/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const actor = req.user?.email || "office";
      const d = documentsData.updateStatus(req.params.id, req.body || {}, actor);
      res.json(d);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ HEALTH & MEDICAL ============
// Profiles are auto-created per student. Visits are an append-only log.
// Role policy:
//   - All authed users: read (so parents/students see their own data)
//   - admin/principal/teacher: write (school nurse runs under "teacher" role
//     in this demo; real deployments would add a "nurse" role)

app.get("/api/health/profiles", (req, res) => {
  const { q, condition, bloodGroup } = req.query;
  const list = healthData.listProfiles({ q, condition, bloodGroup });
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((p) => {
    const s = studentsById.get(p.studentId);
    return {
      ...p,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
      studentAvatar: s ? s.avatar : null,
      studentHouse: s ? s.house : null,
    };
  });
  res.json({
    total: items.length,
    items,
    bloodGroups: healthData.BLOOD_GROUPS,
    vaccines: healthData.VACCINES,
    commonAllergies: healthData.COMMON_ALLERGIES,
    commonConditions: healthData.COMMON_CONDITIONS,
    summary: healthData.summary(),
  });
});

app.get("/api/health/profiles/:studentId", (req, res) => {
  const p = healthData.getProfile(req.params.studentId);
  if (!p) return res.status(404).json({ error: "Not found" });
  const s = db.students.find((x) => x.id === p.studentId);
  res.json({
    profile: p,
    student: s || null,
    vaccines: healthData.VACCINES,
    visits: healthData.listVisits({ studentId: p.studentId }).slice(0, 25),
  });
});

app.patch(
  "/api/health/profiles/:studentId",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const p = healthData.updateProfile(req.params.studentId, req.body || {});
      res.json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/health/visits", (req, res) => {
  const { q, studentId, severity, sinceDays } = req.query;
  const list = healthData.listVisits({ q, studentId, severity, sinceDays });
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((v) => {
    const s = studentsById.get(v.studentId);
    return {
      ...v,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
    };
  });
  res.json({
    total: items.length,
    items,
    severities: healthData.VISIT_SEVERITIES,
    complaints: healthData.COMMON_COMPLAINTS,
    summary: healthData.summary(),
  });
});

app.post(
  "/api/health/visits",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const v = healthData.addVisit(req.body || {});
      res.status(201).json(v);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ DISCIPLINE & BEHAVIORAL ============
// Read: any authed user (parents/students see their own kid).
// Write: teacher+ for new incidents; admin/principal for resolution + escalation.

app.get("/api/discipline", (req, res) => {
  const { q, status, severity, category, studentId, sinceDays } = req.query;
  const list = disciplineData.list({ q, status, severity, category, studentId, sinceDays });
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((i) => {
    const s = studentsById.get(i.studentId);
    return {
      ...i,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
      studentAvatar: s ? s.avatar : null,
      studentHouse: s ? s.house : null,
    };
  });
  res.json({
    total: items.length,
    items,
    summary: disciplineData.summary(),
    categories: disciplineData.CATEGORIES,
    severities: disciplineData.SEVERITIES,
    statuses: disciplineData.STATUSES,
    reporters: disciplineData.REPORTERS,
    resolutions: disciplineData.RESOLUTIONS,
    severityDemerits: disciplineData.SEVERITY_DEMERITS,
  });
});

app.get("/api/discipline/students/:studentId", (req, res) => {
  const ledger = disciplineData.studentLedger(req.params.studentId);
  const s = db.students.find((x) => x.id === req.params.studentId);
  res.json({ student: s || null, ...ledger });
});

app.get("/api/discipline/:id", (req, res) => {
  const i = disciplineData.get(req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const s = db.students.find((x) => x.id === i.studentId);
  res.json({ ...i, student: s || null });
});

app.post(
  "/api/discipline",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const inc = disciplineData.add({
        ...(req.body || {}),
        reportedBy: req.body?.reportedBy || req.user?.email || "—",
      });
      res.status(201).json(inc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/discipline/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const inc = disciplineData.update(req.params.id, req.body || {});
      res.json(inc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ ACHIEVEMENTS ============
// Sports & co-curricular recognition log.
// Read: any authed user. Write: teacher+. Delete: admin/principal only.

app.get("/api/achievements", (req, res) => {
  const { q, category, level, position, studentId, sinceDays } = req.query;
  const list = achievementsData.list({ q, category, level, position, studentId, sinceDays });
  const studentsById = new Map(db.students.map((s) => [s.id, s]));
  const items = list.map((a) => {
    const s = studentsById.get(a.studentId);
    return {
      ...a,
      studentName: s ? s.name : "(unknown)",
      studentGrade: s ? s.grade : null,
      studentSection: s ? s.section : null,
      studentAvatar: s ? s.avatar : null,
      studentHouse: s ? s.house : null,
    };
  });
  res.json({
    total: items.length,
    items,
    summary: achievementsData.summary(),
    categories: achievementsData.CATEGORIES,
    levels: achievementsData.LEVELS,
    positions: achievementsData.POSITIONS,
    levelPoints: achievementsData.LEVEL_POINTS,
    topStudents: achievementsData
      .topStudents(8)
      .map((t) => {
        const s = studentsById.get(t.studentId);
        return {
          ...t,
          studentName: s ? s.name : "(unknown)",
          studentGrade: s ? s.grade : null,
          studentSection: s ? s.section : null,
          studentAvatar: s ? s.avatar : null,
          studentHouse: s ? s.house : null,
        };
      }),
  });
});

app.get("/api/achievements/students/:studentId", (req, res) => {
  const tally = achievementsData.studentTally(req.params.studentId);
  const s = db.students.find((x) => x.id === req.params.studentId);
  res.json({ student: s || null, ...tally });
});

app.get("/api/achievements/:id", (req, res) => {
  const a = achievementsData.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const s = db.students.find((x) => x.id === a.studentId);
  res.json({ ...a, student: s || null });
});

app.post(
  "/api/achievements",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const a = achievementsData.add(req.body || {});
      res.status(201).json(a);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/achievements/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const a = achievementsData.update(req.params.id, req.body || {});
      res.json(a);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/achievements/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const a = achievementsData.remove(req.params.id);
      res.json({ ok: true, removed: a });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ CAFETERIA & MESS ============
// Read: anyone authed. Write menu: admin/principal/hr.
// Per-student preferences: anyone authed can read; same student or admin can write.

app.get("/api/cafeteria/menu", (req, res) => {
  const day = req.query.day;
  if (day) {
    const meals = cafeteriaData.getDay(day);
    if (!meals) return res.status(404).json({ error: "Invalid day" });
    // Attach per-meal at-risk lists
    const decorated = {};
    for (const meal of cafeteriaData.MEALS) {
      if (meals[meal]) {
        decorated[meal] = {
          ...meals[meal],
          atRisk: cafeteriaData.atRiskForMeal(day, meal),
        };
      }
    }
    return res.json({
      day,
      meals: decorated,
      today: cafeteriaData.todayKey(),
    });
  }
  // Whole week
  res.json({
    days: cafeteriaData.DAYS,
    meals: cafeteriaData.MEALS,
    mealPlans: cafeteriaData.MEAL_PLANS,
    commonAllergens: cafeteriaData.COMMON_ALLERGENS,
    specialDiets: cafeteriaData.SPECIAL_DIETS,
    today: cafeteriaData.todayKey(),
    week: cafeteriaData.getWeek(),
    summary: cafeteriaData.summary(),
  });
});

app.patch(
  "/api/cafeteria/menu/:day/:meal",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const m = cafeteriaData.updateMeal(
        req.params.day,
        req.params.meal,
        req.body || {}
      );
      res.json(m);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/cafeteria/preferences", (req, res) => {
  const prefs = cafeteriaData.prefs();
  const items = db.students.map((s) => ({
    studentId: s.id,
    studentName: s.name,
    studentGrade: s.grade,
    studentSection: s.section,
    studentAvatar: s.avatar,
    studentHouse: s.house,
    ...(prefs[s.id] || { mealPlan: "Veg", specialDiet: null, optedOut: [] }),
  }));
  // Optional filter
  let out = items;
  const { mealPlan, specialDiet, q } = req.query;
  if (mealPlan && mealPlan !== "all")
    out = out.filter((i) => i.mealPlan === mealPlan);
  if (specialDiet === "true") out = out.filter((i) => !!i.specialDiet);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (i) =>
        i.studentId.toLowerCase().includes(t) ||
        i.studentName.toLowerCase().includes(t)
    );
  }
  res.json({
    total: out.length,
    items: out,
    mealPlans: cafeteriaData.MEAL_PLANS,
    specialDiets: cafeteriaData.SPECIAL_DIETS,
    summary: cafeteriaData.summary(),
  });
});

app.get("/api/cafeteria/preferences/:studentId", (req, res) => {
  const p = cafeteriaData.getPref(req.params.studentId);
  res.json(p || { mealPlan: "Veg", specialDiet: null, optedOut: [] });
});

app.patch(
  "/api/cafeteria/preferences/:studentId",
  requireRole("admin", "principal", "hr", "teacher", "parent", "student"),
  (req, res) => {
    try {
      const p = cafeteriaData.setPref(req.params.studentId, req.body || {});
      res.json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Render data — pulls the document + full student profile so the print page
// can render the certificate without a second fetch.
app.get("/api/documents/:id/render", (req, res) => {
  const d = documentsData.get(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  const student = db.students.find((s) => s.id === d.studentId) || null;
  res.json({
    document: d,
    student,
    school: {
      name: "Lumina Public School",
      tagline: "Light · Learning · Legacy",
      address: "12 Aurora Avenue, New Delhi, 110001",
      phone: "+91 11 4000 1234",
      email: "office@lumina.edu",
      website: "https://lumina.edu",
      principal: "Dr. Meera Krishnan",
      registrationNo: "DOE/2007/4451",
      affiliation: "CBSE Affiliation No. 2730412",
    },
  });
});

// ============ UNIFIED ACADEMIC CALENDAR ============
// Single endpoint that aggregates all date-bound items across the platform.
// Read-only — driven by the existing source modules.
app.get("/api/calendar", (req, res) => {
  const { from, to } = req.query;
  const entries = calendarData.getEntries({ from, to });
  res.json({
    range: {
      from: from || null,
      to: to || null,
    },
    total: entries.length,
    entries,
    summary: calendarData.summary({ from, to }),
    types: ["Holiday", "Event", "Exam", "Leave"],
  });
});

// ============ ALUMNI ============
app.get("/api/alumni", (req, res) => {
  const items = alumniData.list(req.query || {});
  res.json({
    total: items.length,
    items,
    streams: alumniData.STREAMS,
    destinations: alumniData.DESTINATION_TYPES,
  });
});

app.get("/api/alumni/summary", (req, res) => {
  res.json(alumniData.summary());
});

app.get("/api/alumni/:id", (req, res) => {
  const a = alumniData.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  res.json(a);
});

app.post("/api/alumni", requireRole("admin", "principal", "hr"), (req, res) => {
  try {
    const a = alumniData.add(req.body || {});
    res.status(201).json(a);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/alumni/:id", requireRole("admin", "principal", "hr"), (req, res) => {
  try {
    const a = alumniData.update(req.params.id, req.body || {});
    res.json(a);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/alumni/:id/contact", requireRole("admin", "principal", "hr"), (req, res) => {
  try {
    const user = req.user ? usersData.users.find((u) => u.id === req.user.sub) : null;
    const a = alumniData.logContact(
      req.params.id,
      user?.name || null,
      (req.body && req.body.channel) || "email"
    );
    res.json(a);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete("/api/alumni/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    res.json(alumniData.remove(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ============ NOTICE BOARD ============
function currentUserFromReq(req) {
  return req.user ? usersData.users.find((u) => u.id === req.user.sub) : null;
}

app.get("/api/notices", (req, res) => {
  const user = currentUserFromReq(req);
  // forRole: optionally narrow to the caller's role audience.
  // If `mine=true`, force role-filtering against the caller.
  const mine = req.query.mine === "true";
  const items = noticesData.list({
    q: req.query.q,
    category: req.query.category,
    audience: req.query.audience,
    pinned: req.query.pinned,
    includeExpired: req.query.includeExpired === "true",
    forRole: mine ? user?.role : req.query.forRole,
    user,
  });
  res.json({
    total: items.length,
    items,
    categories: noticesData.CATEGORIES,
    audiences: noticesData.AUDIENCES,
    summary: noticesData.summary(user),
  });
});

app.get("/api/notices/summary", (req, res) => {
  const user = currentUserFromReq(req);
  res.json(noticesData.summary(user));
});

app.get("/api/notices/:id", (req, res) => {
  const user = currentUserFromReq(req);
  const n = noticesData.get(req.params.id, user);
  if (!n) return res.status(404).json({ error: "Not found" });
  res.json(n);
});

app.post(
  "/api/notices",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const n = noticesData.add(req.body || {}, user);
      res.status(201).json(n);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/notices/:id",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const n = noticesData.update(req.params.id, req.body || {}, user);
      res.json(n);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post("/api/notices/:id/ack", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const n = noticesData.acknowledge(req.params.id, user);
    res.json(n);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete("/api/notices/:id/ack", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const n = noticesData.unacknowledge(req.params.id, user);
    res.json(n);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post(
  "/api/notices/:id/pin",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const n = noticesData.togglePin(req.params.id, user);
      res.json(n);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/notices/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(noticesData.remove(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ PTM SCHEDULING ============
app.get("/api/ptm/sessions", (req, res) => {
  res.json({
    sessions: ptmData.sessions({ status: req.query.status }),
    teachers: seed.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      avatar: t.avatar,
      subject: t.subject,
    })),
    summary: ptmData.summary(),
  });
});

app.get("/api/ptm/summary", (req, res) => {
  res.json(ptmData.summary());
});

app.get("/api/ptm/sessions/:id", (req, res) => {
  const s = ptmData.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  const bookings = ptmData.sessionBookings(s.id);
  res.json({ session: s, bookings });
});

app.post(
  "/api/ptm/sessions",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const s = ptmData.addSession(req.body || {});
      res.status(201).json(s);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/ptm/sessions/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const s = ptmData.updateSession(req.params.id, req.body || {});
      res.json(s);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/ptm/sessions/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(ptmData.removeSession(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post("/api/ptm/sessions/:id/book", (req, res) => {
  try {
    const b = ptmData.book(req.params.id, req.body || {});
    res.status(201).json(b);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/ptm/bookings/:id", (req, res) => {
  try {
    const b = ptmData.updateBooking(req.params.id, req.body || {});
    res.json(b);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete("/api/ptm/bookings/:id", (req, res) => {
  try {
    res.json(ptmData.cancelBooking(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get("/api/ptm/students/:studentId/bookings", (req, res) => {
  res.json({
    bookings: ptmData.studentBookings(req.params.studentId),
  });
});

// ============ POLLS & SURVEYS ============
app.get("/api/polls", (req, res) => {
  const user = currentUserFromReq(req);
  const mine = req.query.mine === "true";
  const items = pollsData.list({
    status: req.query.status,
    audience: req.query.audience,
    forRole: mine ? user?.role : req.query.forRole,
    q: req.query.q,
    user,
  });
  res.json({
    total: items.length,
    items,
    types: pollsData.TYPES,
    audiences: pollsData.AUDIENCES,
    statuses: pollsData.STATUSES,
    summary: pollsData.summary(user),
  });
});

app.get("/api/polls/summary", (req, res) => {
  const user = currentUserFromReq(req);
  res.json(pollsData.summary(user));
});

app.get("/api/polls/:id", (req, res) => {
  const user = currentUserFromReq(req);
  const p = pollsData.get(req.params.id, user);
  if (!p) return res.status(404).json({ error: "Poll not found" });
  res.json(p);
});

app.post(
  "/api/polls",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const p = pollsData.add(req.body || {}, user);
      res.status(201).json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/polls/:id",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const p = pollsData.update(req.params.id, req.body || {}, user);
      res.json(p);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post(
  "/api/polls/:id/close",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.json(pollsData.close(req.params.id, user));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post(
  "/api/polls/:id/reopen",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.json(pollsData.reopen(req.params.id, user));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/polls/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(pollsData.remove(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post("/api/polls/:id/respond", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    const r = pollsData.respond(
      req.params.id,
      (req.body && req.body.answers) || {},
      user
    );
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/polls/:id/respond", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res.json(pollsData.withdrawResponse(req.params.id, user));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ============ SCHOLARSHIPS & FINANCIAL AID ============
app.get("/api/scholarships/schemes", (req, res) => {
  res.json({
    items: scholarshipsData.listSchemes(req.query || {}),
    types: scholarshipsData.TYPES,
    valueTypes: scholarshipsData.VALUE_TYPES,
    summary: scholarshipsData.summary(),
  });
});

app.get("/api/scholarships/summary", (req, res) => {
  res.json(scholarshipsData.summary());
});

app.get("/api/scholarships/schemes/:id", (req, res) => {
  const s = scholarshipsData.getScheme(req.params.id);
  if (!s) return res.status(404).json({ error: "Scheme not found" });
  const apps = scholarshipsData.listApplications({ schemeId: s.id });
  res.json({ scheme: s, applications: apps });
});

app.post(
  "/api/scholarships/schemes",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.status(201).json(scholarshipsData.addScheme(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/scholarships/schemes/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(scholarshipsData.updateScheme(req.params.id, req.body || {}));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/scholarships/schemes/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(scholarshipsData.removeScheme(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/scholarships/applications", (req, res) => {
  res.json({
    items: scholarshipsData.listApplications(req.query || {}),
    statuses: scholarshipsData.STATUSES,
  });
});

app.post(
  "/api/scholarships/applications",
  requireRole("admin", "principal", "teacher", "hr", "parent"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res
        .status(201)
        .json(scholarshipsData.apply(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/scholarships/applications/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const { status, note, disbursement } = req.body || {};
      if (!status) return res.status(400).json({ error: "status required" });
      res.json(
        scholarshipsData.transitionApplication(
          req.params.id,
          status,
          { note, disbursement },
          user
        )
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/scholarships/applications/:id",
  (req, res) => {
    try {
      res.json(scholarshipsData.withdrawApplication(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get(
  "/api/scholarships/students/:studentId/awarded",
  (req, res) => {
    res.json({
      items: scholarshipsData.awardedForStudent(req.params.studentId),
    });
  }
);

// ============ HOUSE POINTS ============
app.get("/api/housepoints", (req, res) => {
  res.json({
    items: housePointsData.list(req.query || {}),
    summary: housePointsData.summary({ term: req.query.term }),
    categoryBreakdown: housePointsData.categoryBreakdown({ term: req.query.term }),
    topContributors: housePointsData.topContributors({
      limit: 8,
      term: req.query.term,
    }),
  });
});

app.get("/api/housepoints/summary", (req, res) => {
  res.json(housePointsData.summary({ term: req.query.term }));
});

app.get("/api/housepoints/:id", (req, res) => {
  const a = housePointsData.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Award not found" });
  res.json(a);
});

app.post(
  "/api/housepoints",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.status(201).json(housePointsData.add(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/housepoints/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(housePointsData.remove(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ FUNDRAISING & DONATIONS ============
app.get("/api/fundraising/campaigns", (req, res) => {
  res.json({
    items: fundraisingData.listCampaigns(req.query || {}),
    categories: fundraisingData.CATEGORIES,
    statuses: fundraisingData.STATUSES,
    paymentModes: fundraisingData.PAYMENT_MODES,
    summary: fundraisingData.summary(),
  });
});

app.get("/api/fundraising/summary", (req, res) => {
  res.json(fundraisingData.summary());
});

app.get("/api/fundraising/campaigns/:id", (req, res) => {
  const c = fundraisingData.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const donations = fundraisingData.listDonations({
    campaignId: c.id,
    limit: 100,
  });
  const topDonors = fundraisingData.topDonors({ campaignId: c.id, limit: 10 });
  res.json({ campaign: c, donations, topDonors });
});

app.post(
  "/api/fundraising/campaigns",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res
        .status(201)
        .json(fundraisingData.addCampaign(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/fundraising/campaigns/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(fundraisingData.updateCampaign(req.params.id, req.body || {}));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.post(
  "/api/fundraising/campaigns/:id/close",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(fundraisingData.closeCampaign(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/fundraising/campaigns/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(fundraisingData.removeCampaign(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/fundraising/donations", (req, res) => {
  res.json({
    items: fundraisingData.listDonations(req.query || {}),
  });
});

app.get("/api/fundraising/top-donors", (req, res) => {
  res.json({
    items: fundraisingData.topDonors({
      campaignId: req.query.campaignId,
      limit: Number(req.query.limit) || 10,
    }),
  });
});

app.post("/api/fundraising/donate", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res
      .status(201)
      .json(fundraisingData.donate(req.body || {}, user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete(
  "/api/fundraising/donations/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(fundraisingData.cancelDonation(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ SPORTS FIXTURES & TOURNAMENTS ============
app.get("/api/sports/tournaments", (req, res) => {
  res.json({
    items: sportsData.listTournaments(req.query || {}),
    sports: sportsData.SPORTS,
    formats: sportsData.FORMATS,
    statuses: sportsData.STATUSES,
    matchStatuses: sportsData.MATCH_STATUSES,
    houses: sportsData.HOUSES,
    venues: sportsData.VENUES,
    summary: sportsData.summary(),
  });
});

app.get("/api/sports/summary", (req, res) => {
  res.json(sportsData.summary());
});

app.get("/api/sports/tournaments/:id", (req, res) => {
  const t = sportsData.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: "Tournament not found" });
  const matches = sportsData.listMatches({ tournamentId: t.id });
  const standings = sportsData.tournamentStanding(t.id);
  res.json({ tournament: t, matches, standings });
});

app.post(
  "/api/sports/tournaments",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res
        .status(201)
        .json(sportsData.addTournament(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/sports/tournaments/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      res.json(sportsData.updateTournament(req.params.id, req.body || {}));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/sports/tournaments/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(sportsData.removeTournament(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.get("/api/sports/matches", (req, res) => {
  res.json({ items: sportsData.listMatches(req.query || {}) });
});

app.get("/api/sports/matches/:id", (req, res) => {
  const m = sportsData.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: "Match not found" });
  res.json(m);
});

app.post(
  "/api/sports/matches",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      res.status(201).json(sportsData.addMatch(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/sports/matches/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      res.json(sportsData.updateMatch(req.params.id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/sports/matches/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(sportsData.removeMatch(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ CAREER COUNSELLING & PLACEMENTS ============
app.get("/api/careers/profiles", (req, res) => {
  res.json({
    items: careersData.listProfiles(req.query || {}),
    tracks: careersData.CAREER_TRACKS,
    streams: careersData.STREAMS,
    countries: careersData.COUNTRIES,
    exams: careersData.EXAMS,
    counsellors: careersData.COUNSELLORS,
    indianColleges: careersData.TOP_COLLEGES_INDIA,
    abroadColleges: careersData.TOP_COLLEGES_ABROAD,
    summary: careersData.summary(),
  });
});

app.get("/api/careers/summary", (req, res) => {
  res.json(careersData.summary());
});

app.get("/api/careers/profiles/:studentId", (req, res) => {
  const p = careersData.getProfile(req.params.studentId);
  if (!p) return res.status(404).json({ error: "Student not found" });
  const sessions = careersData.listSessions({ studentId: req.params.studentId });
  const applications = careersData.listApplications({
    studentId: req.params.studentId,
  });
  res.json({ profile: p, sessions, applications });
});

app.patch(
  "/api/careers/profiles/:studentId",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      res.json(
        careersData.updateProfile(req.params.studentId, req.body || {})
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/careers/sessions", (req, res) => {
  res.json({ items: careersData.listSessions(req.query || {}) });
});

app.post(
  "/api/careers/sessions",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      res.status(201).json(careersData.addSession(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/careers/sessions/:id",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      res.json(careersData.updateSession(req.params.id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/careers/sessions/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(careersData.removeSession(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

app.get("/api/careers/applications", (req, res) => {
  res.json({
    items: careersData.listApplications(req.query || {}),
    statuses: careersData.APP_STATUSES,
  });
});

app.post(
  "/api/careers/applications",
  requireRole("admin", "principal", "hr", "teacher", "parent"),
  (req, res) => {
    try {
      res.status(201).json(careersData.addApplication(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/careers/applications/:id",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      res.json(careersData.updateApplication(req.params.id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/careers/applications/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      res.json(careersData.removeApplication(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ SUGGESTION BOX / IDEA HUB ============
app.get("/api/suggestions", (req, res) => {
  const user = currentUserFromReq(req);
  res.json({
    items: suggestionsData.list({ ...req.query, user }),
    categories: suggestionsData.CATEGORIES,
    statuses: suggestionsData.STATUSES,
    statusFlow: suggestionsData.STATUS_FLOW,
    summary: suggestionsData.summary(),
  });
});

app.get("/api/suggestions/summary", (req, res) => {
  res.json(suggestionsData.summary());
});

app.get("/api/suggestions/:id", (req, res) => {
  const user = currentUserFromReq(req);
  const i = suggestionsData.get(req.params.id, user);
  if (!i) return res.status(404).json({ error: "Idea not found" });
  res.json(i);
});

app.post("/api/suggestions", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res.status(201).json(suggestionsData.add(req.body || {}, user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/suggestions/:id/upvote", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res.json(suggestionsData.upvote(req.params.id, user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/suggestions/:id/upvote", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res.json(suggestionsData.unvote(req.params.id, user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch(
  "/api/suggestions/:id/status",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const { status, note } = req.body || {};
      if (!status) return res.status(400).json({ error: "status required" });
      res.json(
        suggestionsData.transition(req.params.id, status, note, user)
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.post("/api/suggestions/:id/comments", (req, res) => {
  try {
    const user = currentUserFromReq(req);
    res
      .status(201)
      .json(suggestionsData.addComment(req.params.id, req.body || {}, user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete(
  "/api/suggestions/:id/comments/:commentId",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.json(
        suggestionsData.removeComment(req.params.id, req.params.commentId, user)
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/suggestions/:id",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      res.json(suggestionsData.remove(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ============ YEAR-END CLASS PROMOTION ============
app.get("/api/promotion", requireRole("admin", "principal"), (req, res) => {
  res.json({
    summary: promotionData.summary(),
    cycles: promotionData.list(),
  });
});

app.get("/api/promotion/preview", requireRole("admin", "principal"), (req, res) => {
  const holdBackIds = String(req.query.holdBack || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const graduatingYear = req.query.year ? Number(req.query.year) : undefined;
  res.json(promotionData.preview({ holdBackIds, graduatingYear }));
});

app.post(
  "/api/promotion/preview",
  requireRole("admin", "principal"),
  (req, res) => {
    const { holdBackIds = [], graduatingYear } = req.body || {};
    res.json(
      promotionData.preview({
        holdBackIds: Array.isArray(holdBackIds) ? holdBackIds : [],
        graduatingYear,
      })
    );
  }
);

app.post("/api/promotion/commit", requireRole("admin", "principal"), (req, res) => {
  try {
    const user = currentUserFromReq(req);
    const { holdBackIds = [], graduatingYear, gradStreams, note } = req.body || {};
    const cycle = promotionData.commit({
      holdBackIds: Array.isArray(holdBackIds) ? holdBackIds : [],
      graduatingYear,
      gradStreams: gradStreams && typeof gradStreams === "object" ? gradStreams : {},
      note,
      user,
    });
    res.status(201).json(cycle);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/promotion/:id", requireRole("admin", "principal"), (req, res) => {
  const cycle = promotionData.get(req.params.id);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  res.json(cycle);
});

app.post(
  "/api/promotion/:id/rollback",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.json(promotionData.rollback(req.params.id, { user }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ STAFF DIRECTORY ============
app.get(
  "/api/staff",
  requireRole("admin", "principal", "hr", "accountant"),
  (req, res) => {
    res.json({
      items: staffData.list(req.query),
      categories: staffData.CATEGORIES,
      statuses: staffData.STATUSES,
      employmentTypes: staffData.EMPLOYMENT_TYPES,
      designationsByCategory: staffData.DESIGNATIONS_BY_CATEGORY,
      summary: staffData.summary(),
    });
  }
);

app.get(
  "/api/staff/summary",
  requireRole("admin", "principal", "hr", "accountant"),
  (req, res) => {
    res.json(staffData.summary());
  }
);

app.get(
  "/api/staff/:id",
  requireRole("admin", "principal", "hr", "accountant"),
  (req, res) => {
    const s = staffData.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Staff not found" });
    res.json(s);
  }
);

app.post(
  "/api/staff",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.status(201).json(staffData.add(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/staff/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      res.json(staffData.update(req.params.id, req.body || {}));
    } catch (e) {
      const code = e.message === "Staff not found" ? 404 : 400;
      res.status(code).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/staff/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      res.json(staffData.remove(req.params.id));
    } catch (e) {
      const code = e.message === "Staff not found" ? 404 : 400;
      res.status(code).json({ error: e.message });
    }
  }
);

// ============ SUBSTITUTE TEACHERS ============
app.get(
  "/api/substitutes",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    res.json(substitutesData.snapshot(date));
  }
);

app.get(
  "/api/substitutes/history",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    res.json({
      items: substitutesData.history(req.query),
      summary: substitutesData.summary(),
    });
  }
);

app.post(
  "/api/substitutes",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.status(201).json(substitutesData.assign(req.body || {}, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.post(
  "/api/substitutes/auto-fill",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      const date = req.body?.date || new Date().toISOString().slice(0, 10);
      res.json(substitutesData.autoFill(date, user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/substitutes/:id",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const user = currentUserFromReq(req);
      res.json(substitutesData.cancel(req.params.id, user, req.body?.reason));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ REPORTS & ANALYTICS ============
app.get("/api/reports/overview", requireRole("admin", "principal", "accountant"), (req, res) => {
  // ---- enrollment by grade ----
  const enrollmentByGrade = Array.from({ length: 12 }, (_, i) => i + 1).map(
    (g) => ({
      grade: `Grade ${g}`,
      students: db.students.filter((s) => s.grade === g).length,
    })
  );

  // ---- house distribution ----
  const houseCounts = {};
  db.students.forEach((s) => {
    houseCounts[s.house] = (houseCounts[s.house] || 0) + 1;
  });
  const houseDist = Object.entries(houseCounts).map(([name, value]) => ({
    name,
    value,
    color:
      name === "Crimson"
        ? "#ff5ec4"
        : name === "Azure"
        ? "#5b81ff"
        : name === "Emerald"
        ? "#5cf2c4"
        : "#ffd166",
  }));

  // ---- fee status mix ----
  const feeMix = ["Paid", "Pending", "Partial"].map((s) => ({
    status: s,
    count: db.students.filter((x) => x.feeStatus === s).length,
  }));

  // ---- attendance % per grade (deterministic from hash so stable) ----
  const attendanceByGrade = Array.from({ length: 12 }, (_, i) => i + 1).map(
    (g) => {
      const inGrade = db.students.filter((s) => s.grade === g);
      if (inGrade.length === 0) return { grade: `Grade ${g}`, present: 0 };
      const avg =
        inGrade.reduce((a, s) => a + s.attendance, 0) / inGrade.length;
      return { grade: `Grade ${g}`, present: Number(avg.toFixed(1)) };
    }
  );

  // ---- exam grade distribution (across completed exams) ----
  const gradeDist = { "A+": 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  Object.values(examsData.marks).forEach((m) => {
    if (typeof m === "number") gradeDist[examsData.gradeFor(m)]++;
  });
  const gradeDistArr = Object.entries(gradeDist).map(([grade, count]) => ({
    grade,
    count,
  }));

  // ---- module counts ----
  const moduleCounts = {
    students: db.students.length,
    teachers: db.teachers.length,
    admissionsInPipeline: admissionsData
      .applicants()
      .filter((a) => !["Enrolled", "Rejected"].includes(a.stage)).length,
    openTickets: maintenanceData
      .tickets()
      .filter((t) => !["Resolved", "Closed"].includes(t.stage)).length,
    visitorsToday: visitorsData
      .visitors()
      .filter((v) => v.checkInAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    pendingLeaves: leaveData.requests().filter((r) => r.status === "Pending").length,
    lowStockItems: inventoryData.assets().filter((a) => a.qty <= a.reorder).length,
    upcomingEvents: eventsData
      .events()
      .filter((e) => new Date(e.date) >= new Date()).length,
    pendingDocs: documentsData
      .docs()
      .filter((d) => d.status === "Requested" || d.status === "Approved").length,
    sickbayLast7d: healthData.summary().visitsLast7d,
    openIncidents: disciplineData.summary().openCount,
    medalsThisYear: achievementsData.summary().thisYear,
    mealsToday: cafeteriaData.summary().todayMeals,
    alumniMentors: alumniData.summary().mentors,
    alumniTotal: alumniData.summary().total,
    liveNotices: noticesData.summary().live,
    pinnedNotices: noticesData.summary().pinned,
    upcomingPTM: ptmData.summary().upcomingSessions,
    ptmConfirmedBookings: ptmData.summary().confirmedBookings,
    activePolls: pollsData.summary().active,
    pollResponses: pollsData.summary().totalResponses,
    activeScholarships: scholarshipsData.summary().activeSchemes,
    awardedScholarships: scholarshipsData.summary().awarded,
    pendingScholarshipApps: scholarshipsData.summary().pending,
    leadingHouse: housePointsData.summary().leader?.house || null,
    leadingHousePoints: housePointsData.summary().leader?.points || 0,
    activeCampaigns: fundraisingData.summary().activeCampaigns,
    totalRaised: fundraisingData.summary().totalRaised,
    ongoingTournaments: sportsData.summary().ongoingTournaments,
    liveMatches: sportsData.summary().liveMatches,
    careerApplications: careersData.summary().applicationsCount,
    careerAdmitted: careersData.summary().admitted,
    openSuggestions:
      suggestionsData.summary().submitted +
      suggestionsData.summary().underReview,
    implementedSuggestions: suggestionsData.summary().implemented,
    promotionCycles: promotionData.summary().cyclesCommitted,
    lastPromotionYear: promotionData.summary().lastCycle?.targetAcademicYear || null,
    lastPromotionGraduated: promotionData.summary().lastCycle?.graduated || 0,
    substitutesToday: substitutesData.summary().todayFilled,
    substitutesLast30: substitutesData.summary().last30,
    staffTotal: staffData.summary().total,
    staffActive: staffData.summary().active,
    staffPayroll: staffData.summary().payroll,
  };

  res.json({
    generatedAt: new Date().toISOString(),
    enrollmentByGrade,
    houseDist,
    feeMix,
    attendanceByGrade,
    gradeDist: gradeDistArr,
    moduleCounts,
  });
});

// ============ ADMIN — backup & restore ============
app.get("/api/admin/backup", requireRole("admin"), (req, res) => {
  const snap = {
    generatedAt: new Date().toISOString(),
    version: 1,
    data: store.snapshot(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="lumina-backup-${stamp}.json"`
  );
  res.send(JSON.stringify(snap, null, 2));
});

app.post("/api/admin/restore", requireRole("admin"), (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || body; // accept either { data: {...} } or raw map
    if (!data || typeof data !== "object")
      return res.status(400).json({ error: "Missing data" });
    const written = store.restore(data);
    res.json({
      ok: true,
      restored: written.length,
      collections: written,
      hint: "Restart the backend container so in-memory caches reload.",
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Realtime status endpoint (useful for ops)
app.get("/api/realtime/stats", requireRole("admin", "principal"), (req, res) => {
  res.json(realtime.stats());
});

// --- start ---
const server = app.listen(PORT, () => {
  console.log(`Lumina API listening on http://localhost:${PORT}`);
  console.log(`Demo login: any of admin@lumina.edu / teacher@lumina.edu / student@lumina.edu ... password: ${usersData.DEMO_PASSWORD}`);
});
realtime.attach(server, JWT_SECRET);
