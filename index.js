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
const expensesData = require("./data/expenses");
const leaveData = require("./data/leave");
const maintenanceData = require("./data/maintenance");
const visitorsData = require("./data/visitors");
const documentsData = require("./data/documents");
const healthData = require("./data/health");
const disciplineData = require("./data/discipline");
const safeReportsData = require("./data/safe-reports");
const quizzesData = require("./data/quizzes");
const achievementsData = require("./data/achievements");
const cafeteriaData = require("./data/cafeteria");
const feePaymentsData = require("./data/fee-payments");
const feeAdjustmentsData = require("./data/fee-adjustments");
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
const assignmentsData = require("./data/assignments");
const messagesData = require("./data/messages");
const passwordResetsData = require("./data/password-resets");
const notificationsData = require("./data/notifications");
const searchData = require("./data/search");
const auditData = require("./data/audit");
const realtime = require("./data/realtime");
const totp = require("./data/totp");
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

// Decorate a user payload with their resolved scope (grade/section for
// student users, linked children for parent users, null otherwise). The
// /api/auth/login and /me endpoints both surface this so the frontend can
// render contextual UI without having to fetch the linked records itself.
function withScope(userObj) {
  if (!userObj) return userObj;
  const fake = { sub: userObj.id, role: userObj.role };
  if (userObj.role === "student") {
    const sc = resolveStudentScope(fake);
    if (!sc.scoped) return userObj;
    return {
      ...userObj,
      scope: {
        studentId: sc.student.id,
        grade: sc.student.grade,
        section: sc.student.section,
        house: sc.student.house,
      },
    };
  }
  if (userObj.role === "parent") {
    const ps = resolveParentScope(fake);
    if (!ps.scoped) return userObj;
    return {
      ...userObj,
      scope: {
        children: ps.children.map((c) => ({
          id: c.id,
          name: c.name,
          avatar: c.avatar,
          grade: c.grade,
          section: c.section,
          house: c.house,
        })),
      },
    };
  }
  if (userObj.role === "teacher") {
    const ts = resolveTeacherScope(fake);
    if (!ts.scoped) return userObj;
    return {
      ...userObj,
      scope: {
        teacherId: ts.teacher.id,
        teacherName: ts.teacher.name,
        subjects: ts.subjects,
        classes: ts.classes,
        studentCount: ts.studentIds.size,
        // Exposed so client-side checks (e.g. the bell's audience filter)
        // know which students this teacher relates to without a fetch.
        studentIds: [...ts.studentIds],
      },
    };
  }
  return userObj;
}

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

  // If the account has 2FA enabled, don't issue the session token yet — return
  // a short-lived challenge token the client exchanges for the real token once
  // it submits a valid authenticator code (BRD §12).
  if (usersData.isTwoFactorEnabled(user)) {
    const challengeToken = jwt.sign(
      { sub: user.id, twofa: "pending" },
      JWT_SECRET,
      { expiresIn: "5m" }
    );
    return res.json({ twoFactorRequired: true, challengeToken });
  }

  const token = signToken(user);
  res.json({ token, user: withScope(usersData.publicUser(user)) });
});

// Step 2 of a 2FA login: exchange the challenge token + authenticator code for
// a real session token.
app.post("/api/auth/2fa/login", (req, res) => {
  const { challengeToken, code } = req.body || {};
  if (!challengeToken || !code)
    return res.status(400).json({ error: "challengeToken and code are required" });
  let payload;
  try {
    payload = jwt.verify(challengeToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Challenge expired — please log in again" });
  }
  if (payload.twofa !== "pending")
    return res.status(400).json({ error: "Invalid challenge token" });
  const user = usersData.findById(payload.sub);
  if (!user || !usersData.isTwoFactorEnabled(user))
    return res.status(400).json({ error: "2FA is not enabled for this account" });
  const secret = usersData.getTwoFactorSecret(user.id);
  if (!totp.verify(secret, code))
    return res.status(401).json({ error: "Invalid authentication code" });
  const token = signToken(user);
  res.json({ token, user: withScope(usersData.publicUser(user)) });
});

// ---- 2FA enrolment (authenticated) ----
// Start setup: generate a secret and return the otpauth URI for the user's
// authenticator app. Not active until confirmed via /2fa/enable.
app.post("/api/auth/2fa/setup", requireAuth, (req, res) => {
  const user = usersData.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (usersData.isTwoFactorEnabled(user))
    return res.status(400).json({ error: "2FA is already enabled" });
  const secret = totp.generateSecret();
  usersData.startTwoFactorSetup(user.id, secret);
  res.json({
    secret,
    otpauthUrl: totp.otpauthURL({ secret, label: user.email, issuer: "Lumina School" }),
  });
});

// Confirm setup: verify a code against the pending secret, then activate.
app.post("/api/auth/2fa/enable", requireAuth, (req, res) => {
  try {
    const { code } = req.body || {};
    const pending = usersData.getTwoFactorSecret(req.user.sub, { pending: true });
    if (!pending) return res.status(400).json({ error: "Start 2FA setup first" });
    if (!totp.verify(pending, code))
      return res.status(401).json({ error: "Invalid code — check your authenticator app" });
    usersData.enableTwoFactor(req.user.sub);
    res.json({ ok: true, twoFactorEnabled: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Disable 2FA — requires the account password to confirm identity.
app.post("/api/auth/2fa/disable", requireAuth, (req, res) => {
  const user = usersData.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { password } = req.body || {};
  if (!password || !usersData.verifyPassword(user, password))
    return res.status(401).json({ error: "Password is incorrect" });
  usersData.disableTwoFactor(user.id);
  res.json({ ok: true, twoFactorEnabled: false });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = usersData.users.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "User not gone" });
  res.json({ user: withScope(usersData.publicUser(user)) });
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

// Self-service password reset (public).
//
// We always return { ok: true } regardless of whether the email exists so
// the endpoint cannot be used to enumerate registered users. When the email
// does match a real account, the token is also returned in `devToken` so
// the mock UI can pre-fill the next screen — in a real deployment this
// branch would be removed and the token would only be sent by email.
app.post("/api/auth/forgot-password", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });
  const user = usersData.findByEmail(email);
  if (!user) {
    // Don't leak which emails are registered.
    return res.json({ ok: true });
  }
  const token = passwordResetsData.createTokenFor(user.id, user.email);
  console.log(
    `[password-reset] issued token for ${user.email} (${user.id}): ${token}`
  );
  res.json({
    ok: true,
    // dev-only convenience: surfaces the token to the UI so manual testing
    // doesn't require checking the server console. Strip this when wiring
    // a real email gateway.
    devToken: token,
    expiresInMinutes: Math.round(passwordResetsData.TOKEN_TTL_MS / 60000),
  });
});

// Validate a reset token without consuming it — used by the ResetPassword
// screen to show "valid link" vs "expired" up front.
app.get("/api/auth/reset-password/:token", (req, res) => {
  const entry = passwordResetsData.findActive(req.params.token);
  if (!entry) return res.status(404).json({ error: "Invalid or expired token" });
  res.json({
    ok: true,
    email: entry.email,
    expiresAt: entry.expiresAt,
  });
});

app.post("/api/auth/reset-password", (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token) return res.status(400).json({ error: "Token is required" });
    const entry = passwordResetsData.resetPassword(token, newPassword);
    console.log(`[password-reset] consumed by ${entry.email} (${entry.userId})`);
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

    // Anonymity guard: anonymous safe-report submissions must NOT record
    // userId / IP / message contents in the audit trail. We still record
    // *that* an anonymous report was filed (so staff have a trail) but
    // strip every identifying field.
    const isAnonSafeReport =
      req.method === "POST" &&
      path === "/api/safe-reports" &&
      !!req.body?.anonymous;

    const entry = auditData.record({
      userId: isAnonSafeReport ? null : user?.id || null,
      userName: isAnonSafeReport ? "anonymous reporter" : user?.name || "anonymous",
      role: isAnonSafeReport ? "anonymous" : req.user?.role || "anonymous",
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: isAnonSafeReport ? null : req.ip,
      summary: isAnonSafeReport
        ? {
            category: req.body?.category,
            severity: req.body?.severity,
            anonymous: true,
          }
        : summarizeBody(req.body),
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
          by: isAnonSafeReport ? null : user?.name || null,
          role: isAnonSafeReport ? "anonymous" : req.user?.role || null,
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

// ============ TEACHER SCOPE HELPER ============
// Teachers see only the students + classes they actually teach. The source
// of truth is the timetable: every cell with `teacherId === X` is a class
// teacher X teaches. We walk the 12×4 grid once and cache the result per
// teacher; invalidated when the timetable mutates.
const SECTIONS = ["A", "B", "C", "D"];
let teacherScopeIndex = null;

function buildTeacherScopeIndex() {
  const map = new Map(); // teacherId -> { classes:Set, subjects:Set, studentIds:Set }
  for (let grade = 1; grade <= 12; grade++) {
    for (const section of SECTIONS) {
      const grid = timetableData.buildGrid(grade, section);
      for (const day of grid) {
        for (const cell of day.periods) {
          if (!cell.teacherId) continue;
          let entry = map.get(cell.teacherId);
          if (!entry) {
            entry = { classes: new Set(), subjects: new Set(), studentIds: new Set() };
            map.set(cell.teacherId, entry);
          }
          entry.classes.add(`${grade}-${section}`);
          if (cell.subject) entry.subjects.add(cell.subject);
        }
      }
    }
  }
  // Now resolve studentIds for each teacher from db.students.
  for (const [, entry] of map) {
    for (const s of db.students) {
      if (entry.classes.has(`${s.grade}-${s.section}`)) {
        entry.studentIds.add(s.id);
      }
    }
  }
  return map;
}

function getTeacherScopeIndex() {
  if (!teacherScopeIndex) teacherScopeIndex = buildTeacherScopeIndex();
  return teacherScopeIndex;
}

// Invalidate the index when the timetable mutates so override edits show up
// immediately. Same pattern as substitutes.js.
timetableData.onChange(() => {
  teacherScopeIndex = null;
});

function resolveTeacherScope(reqUser) {
  if (!reqUser || reqUser.role !== "teacher") {
    return { teacher: null, scoped: false };
  }
  const full = usersData.findById(reqUser.sub);
  if (!full) return { teacher: null, scoped: false };

  let teacherId = full.permissions?.linkedTeacherId || null;
  let teacher = teacherId ? db.teachers.find((t) => t.id === teacherId) : null;
  if (!teacher) {
    // Seed fallback: match by name (seed user "Marcus Chen" → matching teacher)
    // or first teacher in the roster.
    teacher =
      db.teachers.find((t) => t.name === full.name) || db.teachers[0] || null;
  }
  if (!teacher) return { teacher: null, scoped: false };

  const idx = getTeacherScopeIndex();
  const entry = idx.get(teacher.id) || {
    classes: new Set(),
    subjects: new Set(),
    studentIds: new Set(),
  };
  return {
    teacher,
    classes: [...entry.classes],
    subjects: [...entry.subjects],
    studentIds: entry.studentIds,
    scoped: true,
  };
}

// ============ PARENT SCOPE HELPER ============
// Parents (role="parent") see only their linked children. Linkage is set via
// the Permissions modal on the admin Users & Access page and stored as
// permissions.linkedStudentIds on the user record. For the demo seed
// (U005 "Priya Sharma") we fall back to the first student so the demo flow
// renders something meaningful before any admin linking has happened.
function resolveParentScope(reqUser) {
  if (!reqUser || reqUser.role !== "parent") {
    return { children: [], scoped: false };
  }
  const full = usersData.findById(reqUser.sub);
  if (!full) return { children: [], scoped: false };
  const ids = (full.permissions?.linkedStudentIds || []).filter(Boolean);
  let children = ids
    .map((id) => db.students.find((s) => s.id === id))
    .filter(Boolean);
  if (children.length === 0) {
    // Seed fallback so the demo parent account isn't empty.
    const match =
      db.students.find((s) => s.name === full.name) || db.students[0];
    if (match) children = [match];
  }
  return { children, scoped: children.length > 0 };
}

// ============ STUDENT SCOPE HELPER ============
// For users with role=student we want every data endpoint to silently scope
// down to that student's own grade/section. Linkage priority:
//   1. admin-set scopeStudentId on the user overlay
//   2. sourceType=="student" && sourceId set during admin-create-from-student
//   3. fallback for seed U004: match by name "Aarav Sharma", else first student
// Returns { student, scoped: true } or { student: null, scoped: false }.
function resolveStudentScope(reqUser) {
  if (!reqUser || reqUser.role !== "student") return { student: null, scoped: false };
  const full = usersData.findById(reqUser.sub);
  if (!full) return { student: null, scoped: false };

  let studentId = full.scopeStudentId || null;
  if (!studentId && full.sourceType === "student" && full.sourceId) {
    studentId = full.sourceId;
  }
  let student = studentId
    ? db.students.find((s) => s.id === studentId)
    : null;
  if (!student) {
    // Seed fallback so the demo "student" login still feels scoped.
    student =
      db.students.find((s) => s.name === full.name) ||
      db.students[0] ||
      null;
  }
  return { student, scoped: !!student };
}

// ============ SHARED PER-STUDENT-RECORD SCOPING ============
// Single source of truth for "which student records can this caller read?"
// Used by Discipline / Health / Documents — all three modules are keyed by
// studentId and would otherwise leak every child's personal data to every
// authenticated user.
//   - admin / principal / hr / accountant : null (no narrowing, full access)
//   - teacher                              : students in classes they teach
//   - parent                               : their linked children
//   - student                              : their own record only
// Returns either:
//   { fullView: true }                                  — see everything
//   { fullView: false, studentIds: Set<string> }        — narrowed
function studentRecordsScope(req) {
  const role = req.user?.role;
  if (!role) return { fullView: false, studentIds: new Set() };
  if (["admin", "principal", "hr", "accountant"].includes(role))
    return { fullView: true };

  if (role === "student") {
    const s = resolveStudentScope(req.user);
    return {
      fullView: false,
      studentIds: s.scoped ? new Set([s.student.id]) : new Set(),
    };
  }
  if (role === "parent") {
    const p = resolveParentScope(req.user);
    return {
      fullView: false,
      studentIds: p.scoped ? new Set(p.children.map((c) => c.id)) : new Set(),
    };
  }
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    return {
      fullView: false,
      studentIds: t.scoped ? new Set(t.studentIds) : new Set(),
    };
  }
  return { fullView: false, studentIds: new Set() };
}

// ============ ADMIN: USER & ACCESS MANAGEMENT ============
// Admin / principal can list users; only admin can create / change role /
// delete / reset password. Seed accounts (U001-U007) cannot have their role
// or email changed and cannot be deleted, so the demo flow always works.
app.get(
  "/api/users",
  requireRole("admin", "principal"),
  (req, res) => {
    const { role, q } = req.query || {};
    let list = usersData.listAll();
    if (role) list = list.filter((u) => u.role === role);
    if (q) {
      const key = String(q).toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(key) ||
          u.email.toLowerCase().includes(key)
      );
    }
    res.json({ users: list, roles: usersData.VALID_ROLES });
  }
);

app.post("/api/users", requireRole("admin"), (req, res) => {
  try {
    const u = usersData.adminCreate({
      ...(req.body || {}),
      createdBy: req.user.sub,
    });
    res.status(201).json({ user: usersData.publicUser(u) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/users/:id", requireRole("admin"), (req, res) => {
  try {
    const updated = usersData.adminUpdate(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ user: usersData.publicUser(updated) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/users/:id", requireRole("admin"), (req, res) => {
  try {
    const ok = usersData.adminDelete(req.params.id, req.user.sub);
    if (!ok) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post(
  "/api/users/:id/reset-password",
  requireRole("admin"),
  (req, res) => {
    try {
      const { newPassword } = req.body || {};
      usersData.adminResetPassword(req.params.id, newPassword);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Per-user permission overrides: which sidebar paths an admin has hidden
// for this user (on top of role gating), plus an optional Student link
// so a `role=student` account is scoped to a specific Student record.
app.patch(
  "/api/users/:id/permissions",
  requireRole("admin"),
  (req, res) => {
    try {
      const {
        hiddenPaths,
        scopeStudentId,
        hiddenWidgets,
        linkedStudentIds,
        linkedTeacherId,
      } = req.body || {};
      // Validate linkedStudentIds against the real students roster so the
      // admin can't accidentally save a typo.
      if (Array.isArray(linkedStudentIds)) {
        const known = new Set(db.students.map((s) => s.id));
        for (const sid of linkedStudentIds) {
          if (!known.has(sid)) {
            return res.status(400).json({ error: `Unknown student id: ${sid}` });
          }
        }
      }
      // Same validation for teacher linkage.
      if (linkedTeacherId) {
        const known = new Set(db.teachers.map((t) => t.id));
        if (!known.has(linkedTeacherId)) {
          return res
            .status(400)
            .json({ error: `Unknown teacher id: ${linkedTeacherId}` });
        }
      }
      const updated = usersData.adminSetPermissions(
        req.params.id,
        hiddenPaths,
        scopeStudentId,
        hiddenWidgets,
        linkedStudentIds,
        linkedTeacherId
      );
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json({ user: usersData.publicUser(updated) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ DASHBOARD ============
//
// Visibility model:
//   1. Each named widget has a default allowlist of roles.
//   2. Anything not in the role's default is never sent (financials never
//      reach students/teachers, etc.).
//   3. Admins can further restrict per-user via permissions.hiddenWidgets,
//      which subtracts from the role default at response time.
//   4. Student-role responses get their own-grade values where applicable
//      (own attendance %, not the school-wide 92.4%).
//
// Keep the keys here in sync with DASHBOARD_WIDGETS in the frontend
// PermissionsModal so the admin UI shows the same names.
const DASHBOARD_WIDGETS = {
  "stats.totalStudents":  { label: "Total students",   roles: ["admin", "principal", "teacher", "accountant", "hr"] },
  "stats.totalTeachers":  { label: "Total teachers",   roles: ["admin", "principal", "hr"] },
  "stats.feeCollected":   { label: "Fees collected",   roles: ["admin", "principal", "accountant"] },
  "stats.feePending":     { label: "Fees pending",     roles: ["admin", "principal", "accountant"] },
  "stats.attendanceToday":{ label: "Attendance today", roles: ["admin", "principal", "teacher", "parent", "student"] },
  "stats.upcomingExams":  { label: "Upcoming exams",   roles: ["admin", "principal", "teacher", "parent", "student"] },
  "attendanceTrend":      { label: "Attendance trend chart", roles: ["admin", "principal", "teacher"] },
  "feeBreakdown":         { label: "Fee breakdown chart",    roles: ["admin", "principal", "accountant"] },
  "announcements":        { label: "Announcements feed",     roles: "*" },
};

function isWidgetAllowedForRole(widgetId, role) {
  const def = DASHBOARD_WIDGETS[widgetId];
  if (!def) return false;
  if (def.roles === "*") return true;
  return def.roles.includes(role);
}

function effectiveAllowedWidgets(user) {
  const role = user?.role;
  const fullUser = user?.sub ? usersData.findById(user.sub) : null;
  const adminHidden = new Set(fullUser?.permissions?.hiddenWidgets || []);
  return Object.keys(DASHBOARD_WIDGETS).filter(
    (id) => isWidgetAllowedForRole(id, role) && !adminHidden.has(id)
  );
}

app.get("/api/dashboard/summary", (req, res) => {
  const allowed = new Set(effectiveAllowedWidgets(req.user));
  const scope = resolveStudentScope(req.user);
  const parentScope = resolveParentScope(req.user);

  // Build stats from only the allowed sub-keys. Use a per-student value
  // for attendanceToday when the user is scoped to a student record.
  const stats = {};
  if (allowed.has("stats.totalStudents"))  stats.totalStudents  = seed.stats.totalStudents;
  if (allowed.has("stats.totalTeachers"))  stats.totalTeachers  = seed.stats.totalTeachers;
  if (allowed.has("stats.feeCollected"))   stats.feeCollected   = seed.stats.feeCollected;
  if (allowed.has("stats.feePending"))     stats.feePending     = seed.stats.feePending;
  if (allowed.has("stats.upcomingExams")) {
    if (scope.scoped) {
      stats.upcomingExams = examsData.exams.filter(
        (e) => e.grade === scope.student.grade && e.status !== "Completed"
      ).length;
    } else if (parentScope.scoped) {
      const childGrades = new Set(parentScope.children.map((c) => c.grade));
      stats.upcomingExams = examsData.exams.filter(
        (e) => childGrades.has(e.grade) && e.status !== "Completed"
      ).length;
    } else {
      stats.upcomingExams = seed.stats.upcomingExams;
    }
  }
  if (allowed.has("stats.attendanceToday")) {
    if (scope.scoped) {
      const today = new Date().toISOString().slice(0, 10);
      const status =
        db.attendance[`${today}:${scope.student.id}`] || "Present";
      // For a single student we surface their status verbatim instead of a
      // percentage so the UI can render "Present today" rather than "100%".
      stats.attendanceToday = { self: true, status };
    } else if (parentScope.scoped) {
      // Parent: aggregate present/total across their linked children.
      const today = new Date().toISOString().slice(0, 10);
      const statuses = parentScope.children.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        section: c.section,
        status: db.attendance[`${today}:${c.id}`] || "Present",
      }));
      stats.attendanceToday = { parent: true, children: statuses };
    } else {
      stats.attendanceToday = seed.stats.attendanceToday;
    }
  }

  const payload = { stats };
  if (allowed.has("attendanceTrend")) payload.attendanceTrend = seed.attendanceTrend;
  if (allowed.has("feeBreakdown"))    payload.feeBreakdown = seed.feeBreakdown;
  if (allowed.has("announcements"))   payload.announcements = seed.announcements;

  payload.visibility = {
    role: req.user?.role || null,
    allowed: [...allowed],
    scopedTo: scope.scoped
      ? { studentId: scope.student.id, grade: scope.student.grade, section: scope.student.section }
      : parentScope.scoped
      ? { children: parentScope.children.map((c) => ({ id: c.id, name: c.name, grade: c.grade, section: c.section })) }
      : null,
  };

  res.json(payload);
});

// Admin needs to know the widget catalog (id + label + role defaults) so
// the Permissions modal can render an accurate toggle list.
app.get(
  "/api/dashboard/widgets",
  requireRole("admin", "principal"),
  (req, res) => {
    res.json({
      widgets: Object.entries(DASHBOARD_WIDGETS).map(([id, def]) => ({
        id,
        label: def.label,
        defaultRoles: def.roles,
      })),
    });
  }
);

// ============ STUDENTS ============
// For batchmates (same-grade classmates a student is allowed to see) we
// strip the private bits — parent contact, contact number, fee status, GPA.
// The remaining roster card is enough to identify a classmate without
// leaking anything financial or personal.
const STUDENT_PUBLIC_FIELDS = [
  "id", "name", "avatar", "grade", "section", "house", "attendance", "photoUrl",
];
function toBatchmateRow(s) {
  const out = {};
  for (const k of STUDENT_PUBLIC_FIELDS) out[k] = s[k];
  return out;
}

app.get("/api/students", (req, res) => {
  const { q = "", grade = "all" } = req.query;
  let list = db.students;

  // Student-role users see their batch (same-grade classmates).
  // Their own record is returned in full; everyone else is the public-only
  // version so financial / parent contact data never leaks.
  const scope = resolveStudentScope(req.user);
  if (scope.scoped) {
    const batch = list
      .filter((s) => s.grade === scope.student.grade)
      .map((s) => (s.id === scope.student.id ? s : toBatchmateRow(s)));
    return res.json({
      total: batch.length,
      items: batch,
      scopedTo: { studentId: scope.student.id, grade: scope.student.grade, section: scope.student.section },
    });
  }

  // Parent-role users see only their linked children.
  const parentScope = resolveParentScope(req.user);
  if (parentScope.scoped) {
    return res.json({
      total: parentScope.children.length,
      items: parentScope.children,
      scopedTo: {
        children: parentScope.children.map((c) => ({
          id: c.id, name: c.name, grade: c.grade, section: c.section,
        })),
      },
    });
  }

  // Teacher-role users see only students in classes they teach. We still
  // apply the user's grade filter on top of that scope.
  const teacherScope = resolveTeacherScope(req.user);
  if (teacherScope.scoped) {
    let taught = list.filter((s) => teacherScope.studentIds.has(s.id));
    if (grade !== "all") taught = taught.filter((s) => String(s.grade) === String(grade));
    if (q) {
      const t = String(q).toLowerCase();
      taught = taught.filter(
        (s) => s.name.toLowerCase().includes(t) || s.id.toLowerCase().includes(t)
      );
    }
    return res.json({
      total: taught.length,
      items: taught,
      scopedTo: {
        teacherId: teacherScope.teacher.id,
        classes: teacherScope.classes,
        subjects: teacherScope.subjects,
      },
    });
  }

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
  const scope = resolveStudentScope(req.user);
  if (scope.scoped) {
    if (s.grade !== scope.student.grade) {
      return res.status(403).json({ error: "Not in your grade" });
    }
    if (s.id !== scope.student.id) return res.json(toBatchmateRow(s));
  }
  const parentScope = resolveParentScope(req.user);
  if (parentScope.scoped) {
    const linked = parentScope.children.some((c) => c.id === s.id);
    if (!linked) {
      return res.status(403).json({ error: "Parents can only view their linked children" });
    }
  }
  const teacherScope = resolveTeacherScope(req.user);
  if (teacherScope.scoped && !teacherScope.studentIds.has(s.id)) {
    return res
      .status(403)
      .json({ error: "Teachers can only view students in classes they teach" });
  }
  res.json(s);
});

// 360° profile — single endpoint that aggregates across every module that
// holds per-student data. Used by the Student detail page so the UI doesn't
// have to fan out 10 separate calls and stitch them itself.
app.get("/api/students/:id/profile", (req, res) => {
  const studentId = req.params.id;
  const student = db.students.find((x) => x.id === studentId);
  if (!student) return res.status(404).json({ error: "Not found" });

  // Parents can only load their linked children's profile.
  const parentScope = resolveParentScope(req.user);
  if (parentScope.scoped) {
    const linked = parentScope.children.some((c) => c.id === student.id);
    if (!linked) {
      return res.status(403).json({ error: "Parents can only view their linked children" });
    }
  }

  // Teachers can only load profiles for students in their taught classes.
  const teacherScopeForProfile = resolveTeacherScope(req.user);
  if (teacherScopeForProfile.scoped && !teacherScopeForProfile.studentIds.has(student.id)) {
    return res
      .status(403)
      .json({ error: "Teachers can only view students in classes they teach" });
  }

  // A student account is allowed to load any batchmate's profile, but only
  // the public summary — health, discipline, fees, exam marks, library &
  // hostel are kept private. We return zero-filled shapes so the existing
  // detail page renders without crashing on deep field access.
  const scope = resolveStudentScope(req.user);
  if (scope.scoped) {
    if (student.grade !== scope.student.grade) {
      return res.status(403).json({ error: "Not in your grade" });
    }
    if (student.id !== scope.student.id) {
      const publicAch = achievementsData.studentTally(studentId);
      return res.json({
        viewMode: "batchmate",
        student: toBatchmateRow(student),
        health: null,
        discipline: {
          total: 0, demerits: 0, open: 0, last90: 0,
          bySeverity: { Minor: 0, Moderate: 0, Major: 0 },
          recent: [],
        },
        achievements: {
          total: publicAch.total,
          points: publicAch.points,
          gold: publicAch.gold,
          silver: publicAch.silver,
          bronze: publicAch.bronze,
          byCategory: publicAch.byCategory,
          recent: publicAch.items.slice(0, 5),
        },
        cafeteria: null,
        billing: {
          structure: {},
          totalExpected: 0,
          totalPaid: 0,
          outstanding: 0,
          status: "—",
          payments: [],
        },
        exams: { total: 0, avgPct: null, results: [] },
        library: { total: 0, current: 0, overdue: 0, issues: [] },
        hostel: null,
        transport: null,
        documents: {
          summary: { total: 0, Requested: 0, Approved: 0, Issued: 0, Rejected: 0 },
          items: [],
        },
        activity: [],
      });
    }
  }

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

  // ----- Transport: bus assignment, if the student rides a school bus -----
  // Boarders are excluded (they live on campus, no daily bus).
  const transport = transportData.studentAssignment(student, {
    isResident: !!hostel,
  });

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
    viewMode: scope.scoped ? "self" : "full",
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
    transport,
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

// Validate and normalize a student's transport assignment. Accepts:
//   - undefined  -> returns undefined (caller leaves the field unchanged)
//   - null / ""  -> returns null (student does not use school transport)
//   - { routeId, stopName } -> validated against live routes, returns the
//     normalized pair (stopName defaults to the route's first pickup stop)
function normalizeStudentTransport(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "object") throw new Error("transport must be an object or null");
  const routeId = value.routeId;
  if (!routeId) return null; // no route picked = not using transport
  const route = transportData.get(routeId);
  if (!route) throw new Error("transport.routeId not found");
  const pickups = route.stops.filter((st) => !st.school);
  if (pickups.length === 0) throw new Error("that route has no pickup stops");
  let stopName = value.stopName;
  if (stopName) {
    if (!pickups.some((st) => st.name === stopName))
      throw new Error("transport.stopName is not a stop on that route");
  } else {
    stopName = pickups[0].name;
  }
  return { routeId, stopName };
}

app.post("/api/students", requireRole("admin", "principal"), (req, res) => {
  try {
    const body = req.body || {};
    validateStudentPayload(body);
    const transport = normalizeStudentTransport(body.transport);
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
      // Explicit field so the profile shows exactly what was chosen (null when
      // no transport is selected), rather than the legacy id-derived fallback.
      transport: transport === undefined ? null : transport,
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
    if (body.transport !== undefined) {
      s.transport = normalizeStudentTransport(body.transport);
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

  const scope = resolveStudentScope(req.user);
  const parentScope = resolveParentScope(req.user);
  const teacherScope = resolveTeacherScope(req.user);
  const source = scope.scoped
    ? [scope.student]
    : parentScope.scoped
    ? parentScope.children
    : teacherScope.scoped
    ? db.students.filter((s) => teacherScope.studentIds.has(s.id))
    : db.students.slice(0, 30);
  const list = source.map((s) => ({
    ...s,
    status:
      db.attendance[`${today}:${s.id}`] ||
      pick(FALLBACK, today, s.id),
  }));
  res.json({
    date: today,
    items: list,
    scopedTo: scope.scoped
      ? { studentId: scope.student.id, grade: scope.student.grade, section: scope.student.section }
      : parentScope.scoped
      ? { children: parentScope.children.map((c) => ({ id: c.id, name: c.name, grade: c.grade, section: c.section })) }
      : teacherScope.scoped
      ? { teacherId: teacherScope.teacher.id, classes: teacherScope.classes }
      : null,
  });
});

app.post(
  "/api/attendance/:date",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    const { date } = req.params;
    const { entries = {} } = req.body || {};
    // Teachers can only mark attendance for students they teach. We silently
    // drop foreign entries rather than 403'ing the whole batch — a teacher
    // submitting "their class" might include a transferred student we don't
    // know about, and surfacing partial-save feedback is more useful here.
    const scope = studentRecordsScope(req);
    let saved = 0;
    let skipped = 0;
    for (const [id, status] of Object.entries(entries)) {
      if (!scope.fullView && !scope.studentIds.has(id)) {
        skipped++;
        continue;
      }
      db.attendance[`${date}:${id}`] = status;
      saved++;
    }
    persistAttendance();
    res.json({ ok: true, saved, skipped });
  }
);

// Per-student attendance history. Parents/students can pull their own ledger;
// teachers can pull any student in their classes; admin/principal: anyone.
app.get("/api/attendance/student/:id", (req, res) => {
  const sid = req.params.id;
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(sid))
    return res.status(403).json({ error: "Forbidden" });
  const s = db.students.find((x) => x.id === sid);
  if (!s) return res.status(404).json({ error: "Student not found" });

  // Pull every db.attendance[date:id] entry for this student.
  const entries = [];
  for (const key of Object.keys(db.attendance)) {
    const [date, who] = key.split(":");
    if (who !== sid) continue;
    entries.push({ date, status: db.attendance[key] });
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));

  // Optional date window (?days=30 or ?from=2026-01-01&to=2026-02-01)
  const { days, from, to } = req.query || {};
  let windowed = entries;
  if (days) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10);
    windowed = windowed.filter((e) => e.date >= cutoff);
  }
  if (from) windowed = windowed.filter((e) => e.date >= from);
  if (to) windowed = windowed.filter((e) => e.date <= to);

  const tally = windowed.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});
  const total = windowed.length;
  const presentish = (tally.Present || 0) + (tally.Late || 0);
  const pct = total === 0 ? null : Math.round((presentish / total) * 100);

  res.json({
    student: { id: s.id, name: s.name, grade: s.grade, section: s.section },
    total,
    tally,
    presentPct: pct,
    entries: windowed,
  });
});

// ============ FEES ============
app.get("/api/fees/ledger", (req, res) => {
  // Parents see only their linked children's ledger; students see only
  // their own row. Everyone else gets the same default sample of 40.
  const parentScope = resolveParentScope(req.user);
  const studentScope = resolveStudentScope(req.user);
  const source = studentScope.scoped
    ? [studentScope.student]
    : parentScope.scoped
    ? parentScope.children
    : db.students.slice(0, 40);
  const items = source.map((s) => {
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
  const studentScope = resolveStudentScope(req.user);
  if (studentScope.scoped && studentScope.student.id !== s.id) {
    return res.status(403).json({ error: "Students can only view their own fees" });
  }
  const parentScope = resolveParentScope(req.user);
  if (parentScope.scoped && !parentScope.children.some((c) => c.id === s.id)) {
    return res.status(403).json({ error: "Parents can only view their linked children's fees" });
  }
  const billing = feePaymentsData.studentBilling(s);
  res.json({ student: s, ...billing });
});

// List all payments with filters
app.get("/api/fees/payments", (req, res) => {
  const { q, mode, status, studentId, sinceDays } = req.query;
  const scope = studentRecordsScope(req);
  let list = feePaymentsData.listPayments({
    q, mode, status, studentId, sinceDays,
  });
  if (!scope.fullView) list = list.filter((p) => scope.studentIds.has(p.studentId));
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
    // Global summary is fine for admin/accountant; for narrow callers it's
    // not load-bearing in the UI but doesn't expose PII either.
    summary: feePaymentsData.summary(),
  });
});

// Record a new payment — admin/principal/accountant/parent allowed
app.post(
  "/api/fees/payments",
  requireRole("admin", "principal", "accountant", "parent"),
  (req, res) => {
    try {
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      // Parents must be paying for their own linked child.
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only pay fees for your own child" });
      }
      const p = feePaymentsData.recordPayment(req.body || {});
      res.status(201).json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ FEE PAYMENT ORDERS (Razorpay-style two-step flow) ============
// Parents kick off a real payment by creating an order; the mock "gateway"
// then captures it into a Payment record. Admin/accountant can also use the
// order flow but typically use POST /api/fees/payments directly for offline
// cash entries.

// Parent creates a pending order. Scope-gated like the direct path.
app.post(
  "/api/fees/payments/order",
  requireRole("admin", "principal", "accountant", "parent"),
  (req, res) => {
    try {
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only create orders for your own child" });
      }
      const order = feePaymentsData.createOrder(req.body || {}, req.user);
      res.status(201).json(order);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Fetch an order — used by the frontend to poll / check status after the
// user closes the gateway modal.
app.get("/api/fees/payments/order/:id", (req, res) => {
  const order = feePaymentsData.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(order.studentId))
    return res.status(403).json({ error: "Forbidden" });
  res.json(order);
});

// Capture endpoint — simulates the gateway's signed success callback. In a
// real Razorpay integration the body would carry razorpay_payment_id,
// razorpay_order_id, razorpay_signature, and the backend would HMAC-verify
// before crediting. Here we accept an optional gatewayRefId for traceability
// and a forceFail flag the UI can pass when the user picks the "fail" path
// in the mock gateway.
app.post("/api/fees/payments/order/:id/capture", (req, res) => {
  try {
    const order = feePaymentsData.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(order.studentId))
      return res.status(403).json({ error: "Forbidden" });
    const { gatewayRefId, forceFail } = req.body || {};
    const result = feePaymentsData.captureOrder(order.id, {
      gatewayRefId,
      forceFail: forceFail === true,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Parent / staff abandons the order (closes the gateway modal). Idempotent
// — re-cancelling an already-cancelled order is a no-op error rather than a
// state change.
app.post("/api/fees/payments/order/:id/cancel", (req, res) => {
  try {
    const order = feePaymentsData.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(order.studentId))
      return res.status(403).json({ error: "Forbidden" });
    res.json(feePaymentsData.cancelOrder(order.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List orders — usually scoped to a single student. Useful for the Fees
// page to show "Pay attempts" beside the payment ledger.
app.get("/api/fees/payments/orders", (req, res) => {
  const { studentId, status } = req.query || {};
  const scope = studentRecordsScope(req);
  let list = feePaymentsData.listOrders({ studentId, status });
  if (!scope.fullView) list = list.filter((o) => scope.studentIds.has(o.studentId));
  res.json({ total: list.length, items: list });
});

// Receipt render — fetch payment + student + school info for the print page
app.get("/api/fees/payments/:id/receipt", (req, res) => {
  const p = feePaymentsData.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(p.studentId))
    return res.status(403).json({ error: "Forbidden" });
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

// ============ FEE ADJUSTMENTS — discounts / fines / refunds (BRD 7.7) ============
app.get("/api/fees/adjustments", requireRole("admin", "principal", "accountant"), (req, res) => {
  const { type = "all", status = "all", q = "", studentId } = req.query;
  const list = feeAdjustmentsData.list({ type, status, q, studentId });
  res.json({
    total: list.length,
    items: list,
    types: feeAdjustmentsData.TYPES,
    reasons: feeAdjustmentsData.REASONS,
    statusFlow: feeAdjustmentsData.STATUS_FLOW,
    summary: feeAdjustmentsData.summary(),
  });
});

app.post("/api/fees/adjustments", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    const rec = feeAdjustmentsData.add(req.body || {}, actor?.name);
    res.status(201).json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/fees/adjustments/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const rec = feeAdjustmentsData.setStatus(req.params.id, req.body?.status);
    res.json(rec);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/fees/adjustments/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    res.json(feeAdjustmentsData.remove(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ EXAMS ============
app.get("/api/exams", (req, res) => {
  let { grade, status } = req.query;
  let list = examsData.exams;

  // Student-role: force scope to their grade.
  const scope = resolveStudentScope(req.user);
  if (scope.scoped) grade = scope.student.grade;

  // Parent-role: filter to exams covering any of the linked children's grades.
  const parentScope = resolveParentScope(req.user);
  if (parentScope.scoped) {
    const childGrades = new Set(parentScope.children.map((c) => c.grade));
    list = list.filter((e) => childGrades.has(e.grade));
  }

  // Teacher-role: filter to exams covering any of the grades they teach.
  const teacherScopeEx = resolveTeacherScope(req.user);
  if (teacherScopeEx.scoped) {
    const taughtGrades = new Set(
      teacherScopeEx.classes.map((c) => Number(c.split("-")[0]))
    );
    list = list.filter((e) => taughtGrades.has(e.grade));
  }

  if (grade) list = list.filter((e) => String(e.grade) === String(grade));
  if (status) list = list.filter((e) => e.status === status);
  res.json({
    total: list.length,
    items: list,
    scopedTo: scope.scoped
      ? { studentId: scope.student.id, grade: scope.student.grade }
      : parentScope.scoped
      ? { children: parentScope.children.map((c) => ({ id: c.id, name: c.name, grade: c.grade })) }
      : teacherScopeEx.scoped
      ? { teacherId: teacherScopeEx.teacher.id, grades: [...new Set(teacherScopeEx.classes.map((c) => Number(c.split("-")[0])))] }
      : null,
  });
});

app.get("/api/exams/:id", (req, res) => {
  const e = examsData.exams.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  const scope = resolveStudentScope(req.user);
  if (scope.scoped && String(e.grade) !== String(scope.student.grade)) {
    return res.status(403).json({ error: "This exam is not for your grade" });
  }
  res.json(e);
});

app.get("/api/exams/:id/marks", (req, res) => {
  const exam = examsData.exams.find((x) => x.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  const scope = resolveStudentScope(req.user);
  if (scope.scoped && String(exam.grade) !== String(scope.student.grade)) {
    return res.status(403).json({ error: "This exam is not for your grade" });
  }
  const students = scope.scoped
    ? [scope.student]
    : db.students.filter((s) => s.grade === exam.grade).slice(0, 24);
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

  // Teachers can only enter marks for subjects they teach AND for students
  // in classes they teach for that exam's grade.
  const role = req.user?.role;
  let allowedSubjects = null;   // null = unrestricted
  let allowedStudentIds = null;
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    if (!t.scoped) return res.status(403).json({ error: "No linked teacher record" });
    allowedSubjects = new Set(t.subjects || []);
    // Restrict to students this teacher teaches within the exam's grade.
    allowedStudentIds = new Set(
      [...t.studentIds].filter((sid) => {
        const stu = db.students.find((s) => s.id === sid);
        return stu && stu.grade === exam.grade;
      })
    );
  }

  let count = 0;
  let skipped = 0;
  payload.forEach((row) => {
    if (!row.studentId || !row.subjects) return;
    if (allowedStudentIds && !allowedStudentIds.has(row.studentId)) {
      skipped++;
      return;
    }
    Object.entries(row.subjects).forEach(([subject, value]) => {
      if (allowedSubjects && !allowedSubjects.has(subject)) {
        skipped++;
        return;
      }
      const key = `${exam.id}:${row.studentId}:${subject}`;
      const v = value === "" || value === null ? null : Number(value);
      if (v === null || Number.isNaN(v)) return;
      examsData.marks[key] = Math.max(0, Math.min(100, v));
      count++;
    });
  });
  if (count > 0) examsData.persistMarks();
  res.json({ ok: true, saved: count, skipped });
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

// Compute a student's overall percentage for an exam using stored marks,
// falling back to the same deterministic pseudo-mark the report card uses for
// completed exams. Returns null when no marks exist (e.g. upcoming exam). Used
// for class-rank calculation (BRD 7.10).
function examPctForStudent(exam, studentId) {
  let total = 0;
  let max = 0;
  for (const p of exam.papers) {
    const key = `${exam.id}:${studentId}:${p.subject}`;
    const stored = examsData.marks[key];
    const m =
      stored !== undefined
        ? stored
        : exam.status === "Completed"
        ? 35 + ((studentId.length * 31 + p.subject.length * 17 + p.maxMarks) % 66)
        : null;
    if (m !== null) {
      total += m;
      max += p.maxMarks;
    }
  }
  return max ? (total / max) * 100 : null;
}

// A student's 1-based rank within their grade for an exam, plus class size.
function examRankForStudent(exam, studentId) {
  const peers = db.students.filter((x) => x.grade === exam.grade);
  const ranking = peers
    .map((x) => ({ id: x.id, pct: examPctForStudent(exam, x.id) }))
    .filter((r) => r.pct !== null)
    .sort((a, b) => b.pct - a.pct);
  const idx = ranking.findIndex((r) => r.id === studentId);
  return { rank: idx >= 0 ? idx + 1 : null, classSize: ranking.length };
}

const EXAM_INSTRUCTIONS = [
  "Carry this hall ticket and a valid school ID to every paper.",
  "Be seated 15 minutes before the scheduled start time.",
  "Electronic devices, smart watches and study material are not permitted.",
  "Use only blue or black ink. Rough work must be done on the answer sheet.",
  "Report any discrepancy in this hall ticket to the examination cell immediately.",
];

// Deterministic seat number so the same student always gets the same seat for
// a given exam (no DB column needed).
function seatNoFor(examId, studentId) {
  const block = String.fromCharCode(65 + (hash("seatblock", examId, studentId) % 6)); // A–F
  const num = 1 + (hash("seatnum", examId, studentId) % 40);
  return `${block}-${String(num).padStart(2, "0")}`;
}

function buildHallTicket(exam, student) {
  const dayName = (d) =>
    new Date(d).toLocaleDateString("en-IN", { weekday: "short" });
  return {
    ticketNo: `HT/${exam.id}/${student.id}`,
    seatNo: seatNoFor(exam.id, student.id),
    rollNo: student.rollNo || student.id,
    exam: {
      id: exam.id,
      name: exam.name,
      type: exam.type,
      grade: exam.grade,
      startDate: exam.startDate,
      endDate: exam.endDate,
    },
    student: {
      id: student.id,
      name: student.name,
      grade: student.grade,
      section: student.section,
      avatar: student.avatar,
      photo: student.photo || null,
    },
    papers: [...exam.papers]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({
        subject: p.subject,
        date: p.date,
        day: dayName(p.date),
        startTime: p.startTime,
        endTime: p.endTime,
        room: p.room,
        maxMarks: p.maxMarks,
      })),
    instructions: EXAM_INSTRUCTIONS,
    generatedAt: new Date().toISOString(),
    school: {
      name: "Lumina Public School",
      tagline: "Light · Learning · Legacy",
      address: "12 Aurora Avenue, New Delhi, 110001",
      phone: "+91 11 4000 1234",
      email: "office@lumina.edu",
      affiliation: "CBSE Affiliation No. 2730412",
    },
  };
}

// ============ REPORT CARDS ============
// Aggregates marks + attendance + discipline + achievements into a single
// payload that the printable report-card view can render without extra
// fetches. Scoped through studentRecordsScope so parents/students/teachers
// can only print their own (or their class').
app.get("/api/students/:id/report-card", (req, res) => {
  const sid = req.params.id;
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(sid))
    return res.status(403).json({ error: "Out of scope" });

  const student = db.students.find((x) => x.id === sid);
  if (!student) return res.status(404).json({ error: "Student not found" });

  // ----- pick an exam -----
  // If ?examId is given, use it. Otherwise pick the most-recent Completed
  // exam for the student's grade. Falls back to the most recent of any
  // status so the page never blanks out before exams have results.
  const studentExams = examsData.exams.filter((e) => e.grade === student.grade);
  let exam = null;
  if (req.query.examId) {
    exam = studentExams.find((e) => e.id === req.query.examId) || null;
    if (!exam)
      return res
        .status(400)
        .json({ error: "examId not found for this student's grade" });
  } else {
    const byDate = [...studentExams].sort((a, b) =>
      (b.startDate || "").localeCompare(a.startDate || "")
    );
    exam = byDate.find((e) => e.status === "Completed") || byDate[0] || null;
  }

  // ----- marks block -----
  let examBlock = null;
  if (exam) {
    let total = 0;
    let max = 0;
    const subjects = exam.papers.map((p) => {
      const key = `${exam.id}:${sid}:${p.subject}`;
      const stored = examsData.marks[key];
      // Same fallback approach as /api/results: completed exams get a
      // deterministic pseudo-mark so the demo set isn't empty. We never
      // synthesise marks for non-completed exams.
      const m =
        stored !== undefined
          ? stored
          : exam.status === "Completed"
          ? 35 + ((sid.length * 31 + p.subject.length * 17 + p.maxMarks) % 66)
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
        date: p.date,
      };
    });
    const pct = max ? (total / max) * 100 : null;
    examBlock = {
      id: exam.id,
      name: exam.name,
      type: exam.type,
      status: exam.status,
      startDate: exam.startDate,
      endDate: exam.endDate,
      total,
      max,
      pct: pct === null ? null : Number(pct.toFixed(2)),
      grade: pct === null ? null : examsData.gradeFor(pct),
      subjects,
    };
    // Class rank within the student's grade for this exam (BRD 7.10).
    if (examBlock.pct !== null) {
      const { rank, classSize } = examRankForStudent(exam, sid);
      examBlock.rank = rank;
      examBlock.classSize = classSize;
    }
  }

  // ----- date window for attendance/discipline/achievements -----
  // Default to the exam window if one is selected, otherwise the last 90 days.
  const today = new Date().toISOString().slice(0, 10);
  const fromQ = req.query.from || exam?.startDate || null;
  const toQ = req.query.to || exam?.endDate || today;
  const cutoff =
    fromQ ||
    new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const upper = toQ || today;

  // ----- attendance -----
  const attEntries = [];
  for (const key of Object.keys(db.attendance)) {
    const [date, who] = key.split(":");
    if (who !== sid) continue;
    if (date < cutoff || date > upper) continue;
    attEntries.push({ date, status: db.attendance[key] });
  }
  attEntries.sort((a, b) => a.date.localeCompare(b.date));
  const tally = attEntries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});
  const attTotal = attEntries.length;
  const presentish = (tally.Present || 0) + (tally.Late || 0);
  const attBlock = {
    from: cutoff,
    to: upper,
    total: attTotal,
    tally,
    presentPct: attTotal === 0 ? null : Math.round((presentish / attTotal) * 100),
  };

  // ----- discipline -----
  const ledger = disciplineData.studentLedger(sid);
  const disciplineItems = ledger.items
    .filter((i) => i.reportedOn >= cutoff && i.reportedOn <= upper)
    .sort((a, b) => b.reportedOn.localeCompare(a.reportedOn))
    .map((i) => ({
      id: i.id,
      category: i.category,
      severity: i.severity,
      status: i.status,
      description: i.description,
      reportedOn: i.reportedOn,
      demerits: i.demerits,
    }));
  const disciplineBlock = {
    total: disciplineItems.length,
    demerits: disciplineItems.reduce((s, i) => s + (i.demerits || 0), 0),
    items: disciplineItems,
  };

  // ----- achievements -----
  const allAch = achievementsData.list({ studentId: sid });
  const achItems = allAch
    .filter((a) => a.date >= cutoff && a.date <= upper)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      level: a.level,
      position: a.position,
      points: a.points,
      date: a.date,
    }));
  const achBlock = {
    total: achItems.length,
    points: achItems.reduce((s, a) => s + (a.points || 0), 0),
    items: achItems,
  };

  // ----- class teacher remarks -----
  // Heuristic remarks pulled from the data we just summed. Real schools
  // would let teachers write these; we surface deterministic, neutral
  // copy so the printout doesn't look empty.
  const remarks = [];
  if (examBlock?.pct != null) {
    if (examBlock.pct >= 85)
      remarks.push("Excellent academic performance — keep up the strong work.");
    else if (examBlock.pct >= 70)
      remarks.push("Consistent academic effort with room to push further.");
    else if (examBlock.pct >= 50)
      remarks.push("Satisfactory grasp of fundamentals; aim for greater depth.");
    else
      remarks.push(
        "Significant scope for improvement — extra coaching recommended."
      );
  }
  if (attBlock.presentPct != null && attBlock.total > 0) {
    if (attBlock.presentPct >= 95) remarks.push("Outstanding attendance record.");
    else if (attBlock.presentPct < 80)
      remarks.push(
        "Attendance below the expected 80% — please ensure regular presence."
      );
  }
  if (disciplineBlock.total === 0)
    remarks.push("Conduct has been exemplary during this period.");
  if (achBlock.total > 0)
    remarks.push(
      `Recognised in ${achBlock.total} co-curricular event${achBlock.total === 1 ? "" : "s"}.`
    );

  res.json({
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
    student,
    generatedAt: new Date().toISOString(),
    period: { from: cutoff, to: upper, examId: exam?.id || null },
    availableExams: studentExams.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      status: e.status,
      startDate: e.startDate,
    })),
    exam: examBlock,
    attendance: attBlock,
    discipline: disciplineBlock,
    achievements: achBlock,
    remarks,
  });
});

// ============ HALL TICKETS (BRD 7.10) ============
// Single student's hall ticket for an exam.
app.get("/api/exams/:id/hall-ticket/:studentId", (req, res) => {
  const exam = examsData.exams.find((x) => x.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const sid = req.params.studentId;
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(sid))
    return res.status(403).json({ error: "Out of scope" });
  const student = db.students.find((x) => x.id === sid);
  if (!student) return res.status(404).json({ error: "Student not found" });
  if (String(student.grade) !== String(exam.grade))
    return res.status(400).json({ error: "Exam is not for this student's grade" });
  res.json(buildHallTicket(exam, student));
});

// All hall tickets for an exam (admin/principal/teacher) — for bulk printing.
app.get("/api/exams/:id/hall-tickets", requireRole("admin", "principal", "teacher"), (req, res) => {
  const exam = examsData.exams.find((x) => x.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const students = db.students.filter((s) => s.grade === exam.grade);
  res.json({
    exam: { id: exam.id, name: exam.name, type: exam.type, grade: exam.grade },
    total: students.length,
    tickets: students.map((s) => buildHallTicket(exam, s)),
  });
});

// ============ QUIZZES / QUESTION BANK ============
// Set authoring is teacher/admin/principal. Students take quizzes for
// themselves; parents may take on behalf of a child they're linked to.
// Visibility:
//   admin/principal/hr → all
//   teacher            → all sets (so they can pull from the bank), but
//                        edit/delete only their own
//   student/parent     → only sets matching their (child's) grade

function quizSetVisibleTo(set, req) {
  const role = req.user?.role;
  if (["admin", "principal", "hr", "teacher", "accountant"].includes(role))
    return true;
  if (role === "student") {
    return Number(set.grade) === Number(req.user?.scope?.grade);
  }
  if (role === "parent") {
    const grades = (req.user?.scope?.children || []).map((c) => Number(c.grade));
    return grades.includes(Number(set.grade));
  }
  return false;
}

function quizSetEditableBy(set, req) {
  const role = req.user?.role;
  if (["admin", "principal"].includes(role)) return true;
  if (role === "teacher") return set.createdBy === req.user?.sub;
  return false;
}

app.get("/api/quizzes/sets", (req, res) => {
  let items = quizzesData.listSets(req.query);
  items = items.filter((s) => quizSetVisibleTo(s, req));
  // Strip correctIndex + explanation for non-staff so a curious student
  // poking the API can't cheat the test.
  const canSeeAnswers =
    ["admin", "principal", "hr", "teacher"].includes(req.user?.role);
  const stripped = canSeeAnswers
    ? items
    : items.map((s) => ({
        ...s,
        questions: s.questions.map((q) => ({
          id: q.id,
          text: q.text,
          options: q.options,
          points: q.points,
        })),
      }));
  res.json({
    items: stripped.map((s) => ({
      ...s,
      questionCount: (s.questions || []).length,
    })),
    total: items.length,
    summary: quizzesData.summary(),
  });
});

app.get("/api/quizzes/sets/:id", (req, res) => {
  const set = quizzesData.getSet(req.params.id);
  if (!set) return res.status(404).json({ error: "Not found" });
  if (!quizSetVisibleTo(set, req))
    return res.status(403).json({ error: "Out of scope" });
  const canSeeAnswers =
    ["admin", "principal", "hr", "teacher"].includes(req.user?.role);
  if (canSeeAnswers) return res.json(set);
  res.json(quizzesData.takeView(set));
});

app.post(
  "/api/quizzes/sets",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const creator = { id: req.user.sub, name: req.user.name };
      const set = quizzesData.createSet(req.body || {}, creator);
      res.status(201).json(set);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/quizzes/sets/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const set = quizzesData.getSet(req.params.id);
      if (!set) return res.status(404).json({ error: "Not found" });
      if (!quizSetEditableBy(set, req))
        return res
          .status(403)
          .json({ error: "Only the author or admin/principal can edit this set" });
      const updated = quizzesData.updateSet(req.params.id, req.body || {});
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.delete(
  "/api/quizzes/sets/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const set = quizzesData.getSet(req.params.id);
      if (!set) return res.status(404).json({ error: "Not found" });
      if (!quizSetEditableBy(set, req))
        return res
          .status(403)
          .json({ error: "Only the author or admin/principal can delete this set" });
      quizzesData.deleteSet(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Per-set analytics — author or admin/principal.
app.get(
  "/api/quizzes/sets/:id/analytics",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    const set = quizzesData.getSet(req.params.id);
    if (!set) return res.status(404).json({ error: "Not found" });
    if (!quizSetEditableBy(set, req))
      return res
        .status(403)
        .json({ error: "Only the author or admin/principal can view analytics" });
    res.json(quizzesData.setAnalytics(req.params.id));
  }
);

// Start an attempt. Resolves the student to attribute the attempt to:
//   - role=student → their own scope.studentId
//   - role=parent  → must specify ?studentId= matching one of their children
//   - staff        → must specify ?studentId= (test-driving someone's quiz)
app.post("/api/quizzes/sets/:id/attempt", (req, res) => {
  try {
    const role = req.user?.role;
    let studentId = req.body?.studentId || req.query?.studentId || null;
    if (role === "student") {
      studentId = req.user?.scope?.studentId || studentId;
    }
    if (!studentId) return res.status(400).json({ error: "studentId required" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(studentId))
      return res.status(403).json({ error: "Out of scope for that student" });
    const out = quizzesData.startAttempt(req.params.id, studentId);
    res.status(201).json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/quizzes/attempts/:id/submit", (req, res) => {
  try {
    const a = quizzesData.getAttempt(req.params.id);
    if (!a) return res.status(404).json({ error: "Attempt not found" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(a.studentId))
      return res.status(403).json({ error: "Out of scope" });
    const out = quizzesData.submitAttempt(req.params.id, req.body || {});
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/quizzes/attempts/:id", (req, res) => {
  const a = quizzesData.getAttempt(req.params.id);
  if (!a) return res.status(404).json({ error: "Attempt not found" });
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(a.studentId))
    return res.status(403).json({ error: "Out of scope" });
  res.json(a);
});

app.get("/api/quizzes/attempts", (req, res) => {
  const scope = studentRecordsScope(req);
  let items = quizzesData.listAttempts(req.query);
  if (!scope.fullView) items = items.filter((a) => scope.studentIds.has(a.studentId));
  // Strip the snapshot to keep responses small. Callers that want the full
  // attempt (e.g. result screen) hit /api/quizzes/attempts/:id directly.
  res.json({
    items: items.map((a) => ({
      id: a.id,
      setId: a.setId,
      setTitle: a.setSnapshot?.title,
      subject: a.setSnapshot?.subject,
      grade: a.setSnapshot?.grade,
      studentId: a.studentId,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      score: a.score,
      maxScore: a.maxScore,
      timeSpentSec: a.timeSpentSec,
    })),
    total: items.length,
  });
});

// ============ ASSIGNMENTS ============
// Scope rules:
//   admin/principal   → all
//   teacher           → assignments they created OR for classes they teach
//   student           → assignments for their grade (+ section, or whole-grade)
//   parent            → assignments for any of their linked children's classes
function assignmentVisibleTo(a, req) {
  const role = req.user?.role;
  if (role === "admin" || role === "principal") return true;
  const tScope = resolveTeacherScope(req.user);
  if (tScope.scoped) {
    if (a.teacherId === tScope.teacher.id) return true;
    const classKey = a.section ? `${a.grade}-${a.section}` : null;
    return classKey
      ? tScope.classes.includes(classKey)
      : tScope.classes.some((c) => c.startsWith(`${a.grade}-`));
  }
  const sScope = resolveStudentScope(req.user);
  if (sScope.scoped) {
    if (a.grade !== sScope.student.grade) return false;
    return !a.section || a.section === sScope.student.section;
  }
  const pScope = resolveParentScope(req.user);
  if (pScope.scoped) {
    return pScope.children.some(
      (c) => c.grade === a.grade && (!a.section || a.section === c.section)
    );
  }
  return false;
}

app.get("/api/assignments", (req, res) => {
  const { grade, section, subject, teacherId, status } = req.query || {};
  let list = assignmentsData.listAssignments({ grade, section, subject, teacherId, status });
  list = list.filter((a) => assignmentVisibleTo(a, req));

  // Attach a small "mySubmission" hint for student users so the list can
  // show submission status without a second roundtrip per row.
  const sScope = resolveStudentScope(req.user);
  if (sScope.scoped) {
    list = list.map((a) => {
      const mine = assignmentsData.getSubmissionFor(a.id, sScope.student.id);
      return mine
        ? {
            ...a,
            mySubmission: {
              id: mine.id,
              status: mine.status,
              submittedAt: mine.submittedAt,
              marks: mine.marks,
            },
          }
        : a;
    });
  }

  // Parents: attach a small per-child submission digest so the list can show
  // "Aarav · Graded · 45/50" chips without a roundtrip per row.
  const pScope = resolveParentScope(req.user);
  if (pScope.scoped) {
    list = list.map((a) => {
      const eligible = pScope.children.filter(
        (c) => c.grade === a.grade && (!a.section || a.section === c.section)
      );
      if (eligible.length === 0) return a;
      const childSubmissions = eligible.map((c) => {
        const sub = assignmentsData.getSubmissionFor(a.id, c.id);
        return {
          studentId: c.id,
          studentName: c.name,
          status: sub ? sub.status : "Not yet",
          submittedAt: sub?.submittedAt || null,
          marks: sub?.marks ?? null,
        };
      });
      return { ...a, childSubmissions };
    });
  }

  res.json({
    total: list.length,
    items: list,
    subjects: assignmentsData.VALID_SUBJECTS,
  });
});

app.get("/api/assignments/:id", (req, res) => {
  const a = assignmentsData.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found" });
  if (!assignmentVisibleTo(a, req)) return res.status(403).json({ error: "Forbidden" });

  // Teacher (creator or class-owning) and admin/principal see submissions list.
  const role = req.user?.role;
  const tScope = resolveTeacherScope(req.user);
  const canSeeSubs =
    role === "admin" ||
    role === "principal" ||
    (tScope.scoped && (a.teacherId === tScope.teacher.id || tScope.classes.includes(`${a.grade}-${a.section || ""}`)));

  let submissions = null;
  let summary = null;
  if (canSeeSubs) {
    // Eligible students = roster of the target class(es)
    const eligibleStudents = db.students.filter(
      (s) => s.grade === a.grade && (!a.section || s.section === a.section)
    );
    const eligibleIds = eligibleStudents.map((s) => s.id);
    submissions = assignmentsData
      .listSubmissions({ assignmentId: a.id })
      .map((sub) => {
        const s = eligibleStudents.find((x) => x.id === sub.studentId);
        return { ...sub, studentName: s?.name || sub.studentId, studentAvatar: s?.avatar };
      });
    summary = assignmentsData.summaryForAssignment(a.id, eligibleIds);
  }

  // Student sees their own submission only.
  const sScope = resolveStudentScope(req.user);
  let mySubmission = null;
  if (sScope.scoped) {
    mySubmission = assignmentsData.getSubmissionFor(a.id, sScope.student.id);
  }

  // Parent: full per-child submission detail (text, marks, feedback) for
  // each of their linked children eligible for this assignment.
  const pScope = resolveParentScope(req.user);
  let childSubmissions = null;
  if (pScope.scoped) {
    const eligible = pScope.children.filter(
      (c) => c.grade === a.grade && (!a.section || a.section === c.section)
    );
    childSubmissions = eligible.map((c) => {
      const sub = assignmentsData.getSubmissionFor(a.id, c.id);
      return {
        studentId: c.id,
        studentName: c.name,
        studentAvatar: c.avatar,
        grade: c.grade,
        section: c.section,
        submission: sub
          ? {
              id: sub.id,
              status: sub.status,
              submittedAt: sub.submittedAt,
              text: sub.text,
              marks: sub.marks,
              feedback: sub.feedback,
            }
          : null,
      };
    });
  }

  res.json({ assignment: a, submissions, summary, mySubmission, childSubmissions });
});

app.post(
  "/api/assignments",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const role = req.user?.role;
      let teacherId = req.body?.teacherId;
      const tScope = resolveTeacherScope(req.user);
      if (role === "teacher") {
        if (!tScope.scoped) return res.status(403).json({ error: "No linked teacher record" });
        teacherId = tScope.teacher.id; // teachers always create as themselves
      }
      if (!teacherId) return res.status(400).json({ error: "teacherId required" });

      // Teachers can only post assignments for classes they teach.
      if (role === "teacher") {
        const { grade, section } = req.body || {};
        const classKey = section ? `${grade}-${section}` : null;
        const taughtGrades = new Set(
          tScope.classes.map((c) => Number(c.split("-")[0]))
        );
        const allowed = classKey
          ? tScope.classes.includes(classKey)
          : taughtGrades.has(Number(grade));
        if (!allowed) {
          return res.status(403).json({ error: "You can only post assignments for classes you teach" });
        }
      }

      const a = assignmentsData.addAssignment(req.body || {}, teacherId);
      res.status(201).json(a);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.patch(
  "/api/assignments/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const a = assignmentsData.getAssignment(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found" });
      const role = req.user?.role;
      const tScope = resolveTeacherScope(req.user);
      if (role === "teacher") {
        if (!tScope.scoped || a.teacherId !== tScope.teacher.id) {
          return res.status(403).json({ error: "You can only edit your own assignments" });
        }
      }
      const updated = assignmentsData.updateAssignment(req.params.id, req.body || {});
      res.json(updated);
    } catch (e) {
      res
        .status(e.message === "Assignment not found" ? 404 : 400)
        .json({ error: e.message });
    }
  }
);

app.delete(
  "/api/assignments/:id",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const a = assignmentsData.getAssignment(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found" });
      const role = req.user?.role;
      const tScope = resolveTeacherScope(req.user);
      if (role === "teacher") {
        if (!tScope.scoped || a.teacherId !== tScope.teacher.id) {
          return res.status(403).json({ error: "You can only delete your own assignments" });
        }
      }
      const removed = assignmentsData.removeAssignment(req.params.id);
      res.json(removed);
    } catch (e) {
      res
        .status(e.message === "Assignment not found" ? 404 : 400)
        .json({ error: e.message });
    }
  }
);

// Student submits / re-submits their own work.
app.post("/api/assignments/:id/submit", (req, res) => {
  try {
    const a = assignmentsData.getAssignment(req.params.id);
    if (!a) return res.status(404).json({ error: "Assignment not found" });
    const sScope = resolveStudentScope(req.user);
    if (!sScope.scoped) return res.status(403).json({ error: "Only students can submit" });
    if (a.grade !== sScope.student.grade)
      return res.status(403).json({ error: "Not your grade" });
    if (a.section && a.section !== sScope.student.section)
      return res.status(403).json({ error: "Not your section" });
    const sub = assignmentsData.submitAssignment(a.id, sScope.student.id, req.body || {});
    res.status(201).json(sub);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Teacher / admin grades a submission.
app.patch(
  "/api/assignments/:id/submissions/:subId",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const a = assignmentsData.getAssignment(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found" });
      const role = req.user?.role;
      const tScope = resolveTeacherScope(req.user);
      if (role === "teacher") {
        const classKey = a.section ? `${a.grade}-${a.section}` : null;
        const canGrade =
          a.teacherId === tScope.teacher?.id ||
          (classKey && tScope.classes?.includes(classKey)) ||
          (!classKey && tScope.classes?.some((c) => c.startsWith(`${a.grade}-`)));
        if (!canGrade) return res.status(403).json({ error: "Forbidden" });
      }
      const sub = assignmentsData.gradeSubmission(req.params.subId, req.body || {});
      res.json(sub);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ MESSAGES (1:1 conversations) ============
// Who can message whom:
//   parent  ↔ teacher of any of their children's classes
//   parent  ↔ admin / principal / hr
//   student ↔ teacher of any of their classes
//   student ↔ admin / principal
//   teacher ↔ parent of any student in their classes
//   teacher ↔ student in their classes
//   teacher ↔ other teachers / admin / principal / hr
//   admin / principal: can message anyone
//
// All threads are 1:1. Multi-party group chat is out of scope.

function teacherIdsForStudent(studentId) {
  const idx = getTeacherScopeIndex();
  const ids = [];
  for (const [teacherId, entry] of idx.entries()) {
    if (entry.studentIds.has(studentId)) ids.push(teacherId);
  }
  return ids;
}

// Resolve a user (auth payload) → their associated teacher id, if any.
function teacherIdForUser(user) {
  if (!user) return null;
  if (user.role !== "teacher") return null;
  const full = usersData.findById(user.sub);
  if (!full) return null;
  const linked = full.permissions?.linkedTeacherId;
  if (linked) return linked;
  const t = db.teachers.find((x) => x.name === full.name) || db.teachers[0];
  return t ? t.id : null;
}

// Resolve a user → their associated student id, if any.
function studentIdForUser(user) {
  if (!user || user.role !== "student") return null;
  const s = resolveStudentScope(user);
  return s.scoped ? s.student.id : null;
}

// Resolve a parent user → their linked children ids.
function childIdsForUser(user) {
  if (!user || user.role !== "parent") return [];
  const p = resolveParentScope(user);
  return p.scoped ? p.children.map((c) => c.id) : [];
}

function canMessage(fromUser, toUserId) {
  if (!fromUser || !toUserId) return false;
  if (fromUser.sub === toUserId) return false; // can't message yourself
  const toFull = usersData.findById(toUserId);
  if (!toFull) return false;

  const fromRole = fromUser.role;
  const toRole = toFull.role;

  // Admin/principal can reach anyone; anyone can reach admin/principal/hr.
  const STAFF_OPEN = ["admin", "principal", "hr"];
  if (STAFF_OPEN.includes(fromRole) || STAFF_OPEN.includes(toRole)) return true;

  // Teacher ↔ teacher
  if (fromRole === "teacher" && toRole === "teacher") return true;

  // Find a shared student between participants — that's the policy hinge.
  const studentsFor = (user) => {
    if (user.role === "parent") return childIdsForUser(user);
    if (user.role === "student") {
      const sid = studentIdForUser(user);
      return sid ? [sid] : [];
    }
    if (user.role === "teacher") {
      const tid = teacherIdForUser(user);
      if (!tid) return [];
      const idx = getTeacherScopeIndex();
      const entry = idx.get(tid);
      return entry ? [...entry.studentIds] : [];
    }
    return [];
  };
  const fromStudents = studentsFor({ ...fromUser, role: fromRole });
  const toUserFakeReq = { sub: toUserId, role: toRole };
  const toStudents = studentsFor(toUserFakeReq);
  if (fromStudents.length === 0 || toStudents.length === 0) return false;
  const fromSet = new Set(fromStudents);
  return toStudents.some((sid) => fromSet.has(sid));
}

// Return decorated user dicts so the frontend can render names + roles
// without a second lookup. Strips sensitive fields.
function decorateParticipants(ids) {
  return ids.map((id) => {
    const u = usersData.findById(id);
    if (!u) return { id, name: "(unknown)", role: null, avatar: null };
    return { id: u.id, name: u.name, role: u.role, avatar: u.avatar || null };
  });
}

function decorateThreadFull(t, forUserId) {
  return {
    ...t,
    participants: decorateParticipants(t.participants),
  };
}

app.get("/api/messages", (req, res) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const raw = messagesData.listThreadsFor(userId);
  res.json({
    threads: raw.map((t) => decorateThreadFull(t, userId)),
    summary: messagesData.summaryFor(userId),
  });
});

app.get("/api/messages/summary", (req, res) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  res.json(messagesData.summaryFor(userId));
});

// Resolve who the caller is allowed to start a thread with — used by the
// frontend's recipient picker.
app.get("/api/messages/contacts", (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const all = usersData.listAll();
  const filtered = all.filter((u) => canMessage(user, u.id));
  res.json({
    contacts: filtered.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      avatar: u.avatar || null,
      email: u.email,
    })),
  });
});

app.post("/api/messages", (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { toUserId, subject, studentId, context, body } = req.body || {};
    if (!toUserId) return res.status(400).json({ error: "toUserId required" });
    if (!canMessage(req.user, toUserId))
      return res.status(403).json({ error: "You can't message this user" });

    // If a studentId is provided as context, make sure both ends actually
    // relate to that student (defense-in-depth — canMessage already covers
    // most cases).
    if (studentId) {
      const toFull = usersData.findById(toUserId);
      const involves = (u) => {
        if (!u) return false;
        if (["admin", "principal", "hr"].includes(u.role)) return true;
        if (u.role === "parent") return (u.permissions?.linkedStudentIds || []).includes(studentId);
        if (u.role === "student") {
          const sc = resolveStudentScope({ sub: u.id, role: "student" });
          return sc.scoped && sc.student.id === studentId;
        }
        if (u.role === "teacher") {
          const tid = u.permissions?.linkedTeacherId
            || (db.teachers.find((x) => x.name === u.name) || db.teachers[0])?.id;
          if (!tid) return false;
          const entry = getTeacherScopeIndex().get(tid);
          return entry?.studentIds?.has(studentId) || false;
        }
        return false;
      };
      const fromFull = usersData.findById(userId);
      if (!involves(fromFull) || !involves(toFull))
        return res.status(403).json({ error: "Both participants must relate to this student" });
    }

    const { thread, message } = messagesData.startThread({
      creatorId: userId,
      participants: [userId, toUserId],
      subject,
      studentId: studentId || null,
      context,
      firstMessage: body,
    });
    res.status(201).json({
      thread: decorateThreadFull(thread, userId),
      message,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/messages/:id", (req, res) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const t = messagesData.getThread(req.params.id);
  if (!t) return res.status(404).json({ error: "Thread not found" });
  if (!t.participants.includes(userId))
    return res.status(403).json({ error: "Not a participant" });
  res.json({
    thread: decorateThreadFull(t, userId),
    messages: messagesData.listMessages(t.id),
  });
});

app.post("/api/messages/:id/messages", (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const t = messagesData.getThread(req.params.id);
    if (!t) return res.status(404).json({ error: "Thread not found" });
    if (!t.participants.includes(userId))
      return res.status(403).json({ error: "Not a participant" });
    const m = messagesData.appendMessage({
      threadId: t.id,
      fromUserId: userId,
      body: req.body?.body,
      attachmentUrl: req.body?.attachmentUrl,
    });
    res.status(201).json(m);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/messages/:id/read", (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    res.json(messagesData.markRead(req.params.id, userId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ TIMETABLE ============
app.get("/api/timetable", (req, res) => {
  let { grade = "8", section = "A", teacherId } = req.query;

  // Student-role users are pinned to their own grade/section regardless of
  // any query params they send.
  const scope = resolveStudentScope(req.user);
  if (scope.scoped) {
    grade = scope.student.grade;
    section = scope.student.section;
    teacherId = undefined;
  }

  // Teacher-role users are pinned to their own teacher view (all classes
  // they teach across the week).
  const teacherScopeTT = resolveTeacherScope(req.user);
  if (teacherScopeTT.scoped) {
    teacherId = teacherScopeTT.teacher.id;
  }

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
    scopedTo: scope.scoped
      ? { studentId: scope.student.id, grade: scope.student.grade, section: scope.student.section }
      : null,
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
      const { override, conflicts } = timetableData.setOverride(
        Number(grade),
        section,
        day,
        Number(period),
        { subject, teacherId, room }
      );
      const hasConflict =
        conflicts.teacherClashes.length > 0 || conflicts.roomClashes.length > 0;
      res.json({ ok: true, override, conflicts, hasConflict });
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

// Conflict detection (BRD 7.9): school-wide report of teacher / room
// double-bookings introduced by manual overrides.
app.get(
  "/api/timetable/conflicts",
  requireRole("admin", "principal", "teacher", "hr"),
  (req, res) => {
    const items = timetableData.conflictsReport();
    res.json({ total: items.length, items });
  }
);

// Pre-check a hypothetical assignment for clashes before saving it.
app.get(
  "/api/timetable/check",
  requireRole("admin", "principal"),
  (req, res) => {
    const { grade, section, day, period, teacherId, room } = req.query;
    const conflicts = timetableData.findClashes({
      grade: Number(grade),
      section,
      day,
      period: Number(period),
      teacherId: teacherId || undefined,
      room: room || undefined,
    });
    res.json({
      conflicts,
      hasConflict:
        conflicts.teacherClashes.length > 0 || conflicts.roomClashes.length > 0,
    });
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
        b.isbn.toLowerCase().includes(t) ||
        (b.barcode || "").toLowerCase().includes(t)
    );
  }
  res.json({ total: list.length, items: list });
});

// Barcode / ISBN scan lookup — resolves a single book for the issue desk.
app.get("/api/library/books/by-barcode/:code", (req, res) => {
  const book = libraryData.findByBarcode(req.params.code);
  if (!book) return res.status(404).json({ error: "No book matches that barcode" });
  res.json(book);
});

app.get("/api/library/issues", (req, res) => {
  const scope = studentRecordsScope(req);
  let raw = libraryData.issues;
  if (!scope.fullView) raw = raw.filter((i) => scope.studentIds.has(i.studentId));
  const enriched = raw.map((i) => {
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

// Issuing / returning books is a library-desk operation — restrict to staff
// who actually run the desk. The frontend already only shows the buttons for
// admin/principal/hr/teacher, but defend at the API too.
app.post(
  "/api/library/issue",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      const { bookId, studentId, days } = req.body || {};
      // Teachers can only issue to students they teach.
      const scope = studentRecordsScope(req);
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only issue books to students you teach" });
      }
      const rec = libraryData.issueBook({ bookId, studentId, days });
      res.status(201).json(rec);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.post(
  "/api/library/return/:issueId",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    try {
      const issue = libraryData.issues.find((i) => i.id === req.params.issueId);
      if (!issue) return res.status(404).json({ error: "Issue not found" });
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(issue.studentId))
        return res
          .status(403)
          .json({ error: "You can only return books for students you teach" });
      const rec = libraryData.returnBook({ issueId: req.params.issueId });
      res.json(rec);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ LIBRARY RESERVATIONS ============
// Hold queue: a student can reserve a book that's currently out, get a
// queue position, and is auto-promoted to "ready" with a 4-day pickup
// window when a copy is returned.

function enrichReservation(r) {
  const book = libraryData.books.find((b) => b.id === r.bookId);
  const student = db.students.find((s) => s.id === r.studentId);
  const position =
    r.status === "active" ? libraryData.queuePosition(r.bookId, r.studentId) : null;
  return {
    ...r,
    book: book
      ? { id: book.id, title: book.title, author: book.author, category: book.category }
      : null,
    student: student
      ? { id: student.id, name: student.name, avatar: student.avatar, grade: student.grade }
      : null,
    position,
  };
}

app.get("/api/library/reservations", (req, res) => {
  const scope = studentRecordsScope(req);
  const filter = {
    status: req.query.status || undefined,
    bookId: req.query.bookId || undefined,
  };
  if (req.query.studentId) {
    if (!scope.fullView && !scope.studentIds.has(req.query.studentId))
      return res.status(403).json({ error: "Out of scope" });
    filter.studentId = req.query.studentId;
  }
  let items = libraryData.listReservations(filter);
  if (!scope.fullView) {
    items = items.filter((r) => scope.studentIds.has(r.studentId));
  }
  res.json({
    total: items.length,
    items: items.map(enrichReservation),
    summary: libraryData.reservationSummary(),
  });
});

app.get("/api/library/books/:id/queue", (req, res) => {
  const queue = libraryData.activeQueueFor(req.params.id);
  res.json({
    bookId: req.params.id,
    total: queue.length,
    items: queue.map(enrichReservation),
  });
});

app.post("/api/library/reservations", (req, res) => {
  try {
    const { bookId, studentId } = req.body || {};
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(studentId)) {
      return res
        .status(403)
        .json({ error: "You can only reserve books for your own student" });
    }
    const rec = libraryData.reserve({ bookId, studentId });
    res.status(201).json(enrichReservation(rec));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/library/reservations/:id", (req, res) => {
  try {
    const rec = libraryData.listReservations().find((r) => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: "Reservation not found" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(rec.studentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }
    const updated = libraryData.cancelReservation({ id: req.params.id });
    res.json(enrichReservation(updated));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ PAYROLL ============
app.get("/api/payroll", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  const { q = "", department = "all" } = req.query;
  let list = payrollData.staff; // staff-directory-derived roster
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
    departments: staffData.CATEGORIES,
    paymentMethods: staffData.PAYMENT_METHODS,
    banks: staffData.BANKS,
  });
});

// --- Payroll runs / processing (BRD 7.8) ---
// NOTE: these (and /bulk) must be declared before "/api/payroll/:id" so the
// literal path segments aren't captured as an :id.
app.get("/api/payroll/runs", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  res.json({ items: payrollData.listRuns(), statuses: payrollData.RUN_STATUSES });
});

// Mass payroll maintenance — apply a raise %, bonus or payment method across
// many staff at once.
app.post("/api/payroll/bulk", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const { ids, category, action, value } = req.body || {};
    const out = staffData.bulkUpdatePayroll({ ids, category, action, value });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/payroll/runs", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    const run = payrollData.createRun(req.body?.month, actor?.name);
    res.status(201).json(run);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Salary advances (BRD 7.8) ---
// Lump sum paid to a staff member, recovered from future runs in installments.
// Must be declared before "/api/payroll/:id" so "advances" isn't read as an id.
app.get("/api/payroll/advances", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  const { staffId, status, q, category, sort } = req.query;
  res.json({
    items: staffData.listAdvances({ staffId, status, q, category, sort }),
    summary: staffData.advancesOverview(),
    statuses: staffData.ADVANCE_STATUSES,
    departments: staffData.CATEGORIES,
    methods: staffData.PAYMENT_METHODS,
  });
});

app.post("/api/payroll/advances", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    res.status(201).json(staffData.grantAdvance(req.body || {}, actor));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/payroll/advances/:id/cancel", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.json(staffData.cancelAdvance(req.params.id));
  } catch (e) {
    const code = e.message === "Advance not found" ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
});

app.get("/api/payroll/runs/:id", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  try {
    res.json(payrollData.getRun(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.patch("/api/payroll/runs/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    const action = req.body?.action;
    let out;
    if (action === "process") out = payrollData.processRun(req.params.id, actor?.name);
    else if (action === "pay") out = payrollData.payRun(req.params.id, actor?.name);
    else return res.status(400).json({ error: "action must be 'process' or 'pay'" });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/payroll/runs/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.json(payrollData.deleteRun(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/payroll/runs/:id/bank-report", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.json(payrollData.disbursementReport(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get("/api/payroll/runs/:id/payslip/:employeeId", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  try {
    res.json(payrollData.payslip(req.params.id, req.params.employeeId));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get("/api/payroll/:id", requireRole("admin", "principal", "accountant", "hr"), (req, res) => {
  const s = payrollData.staff.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

// Individual payroll maintenance — edit one staff member's salary structure,
// bank/UPI details and payment method (persists to the staff record).
app.patch("/api/payroll/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const updated = staffData.updatePayroll(req.params.id, req.body || {});
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
// Compute the set of grades the caller cares about for learning content.
// Returns null when the caller should see everything (admin/principal/hr/
// accountant/no-scope). Built on the same scope helpers we use elsewhere.
function learningGradesFor(req) {
  const role = req.user?.role;
  if (!role) return null;
  if (["admin", "principal", "hr", "accountant"].includes(role)) return null;
  if (role === "student") {
    const s = resolveStudentScope(req.user);
    return s.scoped ? new Set([s.student.grade]) : new Set();
  }
  if (role === "parent") {
    const p = resolveParentScope(req.user);
    return p.scoped ? new Set(p.children.map((c) => c.grade)) : new Set();
  }
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    if (!t.scoped) return new Set();
    return new Set(t.classes.map((c) => Number(c.split("-")[0])));
  }
  return null;
}

app.get("/api/learning/live", (req, res) => {
  const { status } = req.query;
  const myGrades = learningGradesFor(req);
  // recompute live/scheduled/ended based on `new Date()`
  let items = learningData.live.map((c) => {
    const start = new Date(c.startsAt);
    const end = new Date(c.endsAt);
    const now = new Date();
    let st = "Scheduled";
    if (now >= start && now <= end) st = "Live";
    else if (now > end) st = "Ended";
    return { ...c, status: st };
  });
  if (myGrades) items = items.filter((c) => myGrades.has(c.grade));
  const filtered = status ? items.filter((c) => c.status === status) : items;
  res.json({ total: filtered.length, items: filtered });
});

app.get("/api/learning/recordings", (req, res) => {
  const { q = "", subject = "all" } = req.query;
  const myGrades = learningGradesFor(req);
  let list = learningData.recordings;
  if (myGrades) list = list.filter((r) => myGrades.has(r.grade));
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
  // Materials aren't grade-tagged in the data model — they're reference
  // content shared across grades for a subject. For teacher callers we can
  // at least narrow by subjects they teach; students/parents see everything
  // until materials gain a grade tag.
  let list = learningData.materials;
  const role = req.user?.role;
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    if (t.scoped && t.subjects?.length) {
      const mine = new Set(t.subjects);
      list = list.filter((m) => mine.has(m.subject));
    }
  }
  res.json({ total: list.length, items: list });
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
  const scope = studentRecordsScope(req);
  let list = hostelData.rooms();
  if (block && block !== "all") list = list.filter((r) => r.block === block);
  if (status && status !== "all") list = list.filter((r) => r.status === status);

  if (!scope.fullView) {
    // Parents/students only see rooms that contain one of their students,
    // and even then we redact the names of other roommates — they still see
    // an anonymous "Roommate" placeholder so the room is shown as half-full
    // rather than empty.
    list = list
      .filter((r) => r.occupants?.some((o) => scope.studentIds.has(o.id)))
      .map((r) => ({
        ...r,
        occupants: r.occupants.map((o) =>
          scope.studentIds.has(o.id)
            ? o
            : { id: null, name: "Roommate", grade: o.grade }
        ),
      }));
  }
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

// --- Warden management (BRD 7.15) ---
app.get("/api/hostel/wardens", (req, res) => {
  res.json({ items: hostelData.listWardens(), blocks: hostelData.BLOCKS });
});

app.post("/api/hostel/wardens", requireRole("admin", "principal"), (req, res) => {
  try {
    res.status(201).json(hostelData.addWarden(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/hostel/wardens/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    res.json(hostelData.updateWarden(req.params.id, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/hostel/wardens/:id", requireRole("admin", "principal"), (req, res) => {
  try {
    res.json(hostelData.removeWarden(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Mess management (BRD 7.15) ---
app.get("/api/hostel/mess", (req, res) => {
  res.json({ ...hostelData.getMessMenu(), summary: hostelData.messSummary() });
});

app.patch("/api/hostel/mess", requireRole("admin", "principal"), (req, res) => {
  try {
    const { day, meal, dish } = req.body || {};
    res.json(hostelData.setMessMeal(day, meal, dish));
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

// Item-catalog management — create, edit and delete SKUs.
app.post("/api/inventory", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.status(201).json(inventoryData.addAsset(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Add a new item category. Declared before "/api/inventory/:id" so the literal
// "categories" segment isn't captured as an item id.
app.post("/api/inventory/categories", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.status(201).json(inventoryData.addCategory(req.body?.name));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/inventory/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.json(inventoryData.updateAsset(req.params.id, req.body || {}));
  } catch (e) {
    res.status(e.message === "Not found" ? 404 : 400).json({ error: e.message });
  }
});

app.delete("/api/inventory/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    res.json(inventoryData.removeAsset(req.params.id));
  } catch (e) {
    res.status(e.message === "Not found" ? 404 : 400).json({ error: e.message });
  }
});

// Vendor directory + low-stock alerts (BRD 7.16)
app.get("/api/inventory/vendors", (req, res) => {
  res.json({ items: inventoryData.vendors() });
});

app.get("/api/inventory/alerts", (req, res) => {
  const items = inventoryData.lowStockAlerts();
  res.json({ total: items.length, items });
});

// Purchase orders (BRD 7.16)
app.get("/api/inventory/purchases", requireRole("admin", "principal", "accountant"), (req, res) => {
  res.json({
    items: inventoryData.listPurchases({ status: req.query.status || "all" }),
    statuses: inventoryData.PO_STATUSES,
  });
});

app.post("/api/inventory/purchases", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    const po = inventoryData.addPurchase(req.body || {}, actor?.name);
    res.status(201).json(po);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/inventory/purchases/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const action = req.body?.action;
    let out;
    if (action === "receive") out = inventoryData.receivePurchase(req.params.id);
    else if (action === "cancel") out = inventoryData.cancelPurchase(req.params.id);
    else return res.status(400).json({ error: "action must be 'receive' or 'cancel'" });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ EXPENSES (BRD 7.17) ============
app.get("/api/expenses", requireRole("admin", "principal", "accountant"), (req, res) => {
  const { q = "", category = "all", status = "all", month } = req.query;
  const items = expensesData.list({ q, category, status, month });
  res.json({
    total: items.length,
    items,
    categories: expensesData.CATEGORIES,
    statuses: expensesData.STATUSES,
    vendors: expensesData.VENDORS,
    months: expensesData.months(),
    summary: expensesData.summary(),
  });
});

app.get("/api/expenses/report", requireRole("admin", "principal", "accountant"), (req, res) => {
  res.json(expensesData.monthlyReport(req.query.month));
});

app.get("/api/expenses/budgets", requireRole("admin", "principal", "accountant"), (req, res) => {
  res.json({ budgets: expensesData.budgets(), categories: expensesData.CATEGORIES });
});

app.put("/api/expenses/budgets/:category", requireRole("admin", "principal"), (req, res) => {
  try {
    const out = expensesData.setBudget(req.params.category, req.body?.amount);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/expenses", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const submitter = usersData.users.find((u) => u.id === req.user.sub);
    const e = expensesData.add({
      ...(req.body || {}),
      submittedBy: req.body?.submittedBy || submitter?.name || "Accounts Office",
    });
    res.status(201).json(e);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Approve / reject / pay. Approval & rejection are admin/principal only;
// marking an approved expense Paid can also be done by the accountant.
app.patch("/api/expenses/:id", requireRole("admin", "principal", "accountant"), (req, res) => {
  try {
    const status = req.body?.status;
    if (req.user.role === "accountant" && status !== "Paid") {
      return res.status(403).json({ error: "Accountants can only mark expenses paid" });
    }
    const actor = usersData.users.find((u) => u.id === req.user.sub);
    const e = expensesData.setStatus(req.params.id, status, actor?.name, req.body?.paymentRef);
    res.json(e);
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

// Build the visibility view that notifications data uses to filter the feed.
// admin/principal/hr/accountant get fullView; teacher/parent/student get the
// owners-set via the shared studentRecordsScope helper.
function notificationsViewFor(req) {
  const scope = studentRecordsScope(req);
  if (scope.fullView) return { fullView: true, role: req.user?.role };
  return {
    fullView: false,
    role: req.user?.role,
    studentIds: scope.studentIds,
  };
}

app.get("/api/notifications", (req, res) => {
  const userId = req.user?.sub || null;
  const view = notificationsViewFor(req);
  const items = notificationsData.list({
    userId,
    view,
    limit: req.query.limit,
    unread: req.query.unread === "true",
    type: req.query.type,
  });
  res.json({
    total: items.length,
    items,
    unreadCount: notificationsData.unreadCount(userId, view),
  });
});

app.get("/api/notifications/unread-count", (req, res) => {
  const userId = req.user?.sub || null;
  res.json({ unreadCount: notificationsData.unreadCount(userId, notificationsViewFor(req)) });
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
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
  const sliced = items.slice(offset, offset + limit);
  res.json({
    total: items.length,
    offset,
    limit,
    hasMore: offset + sliced.length < items.length,
    items: sliced,
    summary: auditData.summary(),
  });
});

// Distinct actors seen in the audit log — used to populate the user filter.
app.get(
  "/api/audit/actors",
  requireRole("admin", "principal"),
  (req, res) => {
    res.json({ items: auditData.distinctActors() });
  }
);

// Stream the *currently filtered* audit log as CSV. We deliberately exclude
// `limit`/`offset` here so the export reflects the full filtered view, not
// just the visible page.
app.get(
  "/api/audit/export.csv",
  requireRole("admin", "principal"),
  (req, res) => {
    const items = auditData.list(req.query);
    const cols = [
      { key: "id", label: "ID" },
      { key: "at", label: "Timestamp" },
      { key: "method", label: "Method" },
      { key: "path", label: "Path" },
      { key: "status", label: "Status" },
      { key: "userId", label: "User ID" },
      { key: "userName", label: "User" },
      { key: "role", label: "Role" },
      { key: "ip", label: "IP" },
      { key: "durationMs", label: "Duration (ms)" },
      { key: "summary", label: "Summary" },
    ];
    const rows = items.map((e) => ({
      ...e,
      summary: e.summary ? JSON.stringify(e.summary) : "",
    }));
    sendCsv(res, stampedFilename("audit-log"), buildCsv(cols, rows));
  }
);

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
  const scope = studentRecordsScope(req);
  let list = documentsData.docs().slice();
  if (!scope.fullView) list = list.filter((d) => scope.studentIds.has(d.studentId));
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
    // Summary stays as aggregate global counts for admin/hr; for narrowed
    // callers it's not load-bearing in the UI (cards drive the page).
    summary: documentsData.summary(),
  });
});

app.post("/api/documents", (req, res) => {
  try {
    const scope = studentRecordsScope(req);
    const studentId = req.body?.studentId;
    if (!scope.fullView) {
      if (!studentId || !scope.studentIds.has(studentId))
        return res
          .status(403)
          .json({ error: "You can only request documents for your own record" });
    }
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
  const scope = studentRecordsScope(req);
  let list = healthData.listProfiles({ q, condition, bloodGroup });
  if (!scope.fullView) list = list.filter((p) => scope.studentIds.has(p.studentId));
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
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
    return res.status(403).json({ error: "Forbidden" });
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
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
        return res
          .status(403)
          .json({ error: "You can only edit health for students you teach" });
      const p = healthData.updateProfile(req.params.studentId, req.body || {});
      res.json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get("/api/health/visits", (req, res) => {
  const { q, studentId, severity, sinceDays } = req.query;
  const scope = studentRecordsScope(req);
  let list = healthData.listVisits({ q, studentId, severity, sinceDays });
  if (!scope.fullView) list = list.filter((v) => scope.studentIds.has(v.studentId));
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
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only log visits for students you teach" });
      }
      const v = healthData.addVisit(req.body || {});
      res.status(201).json(v);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ VACCINATIONS ============
// Static schedule + computed per-student status. Recording a dose is
// nurse-side (admin/principal/hr — the same staff that file health
// visits).

// School-wide schedule (constant, no DB read).
app.get("/api/health/vaccinations/schedule", (req, res) => {
  res.json({
    vaccines: healthData.VACCINES,
    schedule: healthData.VACCINE_SCHEDULE,
  });
});

// Roster-wide compliance — staff only (admin/principal/hr). Returns
// per-vaccine counters + the IDs of students with at least one overdue
// dose so the UI can flag them.
app.get(
  "/api/health/vaccinations/compliance",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    const grade = req.query.grade ? Number(req.query.grade) : null;
    const students = grade
      ? db.students.filter((s) => s.grade === grade)
      : db.students;
    res.json(healthData.vaccinationCompliance({ students }));
  }
);

// Per-student detail — scope-aware. Parents/students see their own; staff
// see everyone in scope.
app.get("/api/health/vaccinations/:studentId", (req, res) => {
  const sid = req.params.studentId;
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(sid))
    return res.status(403).json({ error: "Out of scope" });
  const student = db.students.find((s) => s.id === sid);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const profile = healthData.getProfile(sid);
  if (!profile) return res.status(404).json({ error: "No health profile" });
  const status = healthData.vaccinationStatusFor(student, profile);
  res.json({
    student,
    profile: { studentId: profile.studentId, doses: profile.doses || [] },
    ...status,
  });
});

// Record a dose — nurse-side, identical role set to /api/health/visits POST.
app.post(
  "/api/health/vaccinations/:studentId/record",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const updated = healthData.recordDose(req.params.studentId, req.body || {});
      const student = db.students.find((s) => s.id === req.params.studentId);
      const status = healthData.vaccinationStatusFor(student, updated);
      res.json({
        student,
        profile: { studentId: updated.studentId, doses: updated.doses || [] },
        ...status,
      });
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
  const scope = studentRecordsScope(req);
  let list = disciplineData.list({ q, status, severity, category, studentId, sinceDays });
  if (!scope.fullView) list = list.filter((i) => scope.studentIds.has(i.studentId));
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
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
    return res.status(403).json({ error: "Forbidden" });
  const ledger = disciplineData.studentLedger(req.params.studentId);
  const s = db.students.find((x) => x.id === req.params.studentId);
  res.json({ student: s || null, ...ledger });
});

app.get("/api/discipline/:id", (req, res) => {
  const i = disciplineData.get(req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(i.studentId))
    return res.status(403).json({ error: "Forbidden" });
  const s = db.students.find((x) => x.id === i.studentId);
  res.json({ ...i, student: s || null });
});

app.post(
  "/api/discipline",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      // Teachers can only file incidents against students they teach.
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only file incidents for students you teach" });
      }
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
      const existing = disciplineData.get(req.params.id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(existing.studentId))
        return res
          .status(403)
          .json({ error: "You can only edit incidents for students you teach" });
      const inc = disciplineData.update(req.params.id, req.body || {});
      res.json(inc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ SAFE SPACE — ANONYMOUS REPORTS ============
// Safeguarding leads are admin/principal/hr. Any authenticated user can
// file a report; a tracking code is returned so anonymous reporters can
// follow up without identifying themselves.

const SAFEGUARDING_ROLES = ["admin", "principal", "hr"];

function isSafeguardingLead(req) {
  return SAFEGUARDING_ROLES.includes(req.user?.role);
}

app.post("/api/safe-reports", (req, res) => {
  try {
    const { category, severity, subject, description, anonymous } = req.body || {};
    const reporter = req.user
      ? { id: req.user.sub, name: req.user.name, role: req.user.role }
      : null;
    const rec = safeReportsData.create({
      category,
      severity,
      subject,
      description,
      anonymous: !!anonymous,
      reporter,
    });
    // Return only what the reporter should see — even *they* don't see
    // internal triage notes added later.
    res.status(201).json(safeReportsData.publicView(rec));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Public lookup by tracking code. Authenticated (anyone in the school can
// hold a code, that's the security model). Returns the redacted view.
app.get("/api/safe-reports/lookup/:code", (req, res) => {
  const r = safeReportsData.findByCode(req.params.code);
  if (!r) return res.status(404).json({ error: "No report matches that code" });
  res.json(safeReportsData.publicView(r));
});

// My-reports list — for non-anonymous reports the submitter filed.
// Anonymous submissions don't show up here by design; the reporter must
// use the tracking code to find them again.
app.get("/api/safe-reports/mine", (req, res) => {
  const out = safeReportsData
    .list({})
    .filter((r) => !r.anonymous && r.reporterUserId === req.user?.sub)
    .map(safeReportsData.publicView);
  res.json({ items: out, total: out.length });
});

// Staff list — safeguarding leads only.
app.get("/api/safe-reports", requireRole(...SAFEGUARDING_ROLES), (req, res) => {
  const items = safeReportsData.list(req.query);
  res.json({
    items,
    total: items.length,
    summary: safeReportsData.summary(),
  });
});

app.get("/api/safe-reports/:id", requireRole(...SAFEGUARDING_ROLES), (req, res) => {
  const r = safeReportsData.find(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json(r);
});

app.patch("/api/safe-reports/:id", requireRole(...SAFEGUARDING_ROLES), (req, res) => {
  try {
    const r = safeReportsData.find(req.params.id);
    if (!r) return res.status(404).json({ error: "Not found" });
    const { status, statusNote } = req.body || {};
    if (status) {
      safeReportsData.setStatus(req.params.id, status, req.user, statusNote);
    }
    res.json(safeReportsData.find(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post(
  "/api/safe-reports/:id/responses",
  requireRole(...SAFEGUARDING_ROLES),
  (req, res) => {
    try {
      const { text, audience } = req.body || {};
      const r = safeReportsData.addResponse(req.params.id, {
        text,
        audience,
        by: { id: req.user.sub, name: req.user.name, role: req.user.role },
      });
      res.json(r);
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
  const scope = studentRecordsScope(req);
  let list = achievementsData.list({ q, category, level, position, studentId, sinceDays });
  if (!scope.fullView) list = list.filter((a) => scope.studentIds.has(a.studentId));
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
  // Top-students leaderboard: leave global for admin/staff so the page header
  // stat tile still shows school-wide stars; narrow for parents/students so
  // they don't see foreign children topping the chart in their own dashboard.
  const rawTop = achievementsData.topStudents(8);
  const top = (scope.fullView
    ? rawTop
    : rawTop.filter((t) => scope.studentIds.has(t.studentId))
  ).map((t) => {
    const s = studentsById.get(t.studentId);
    return {
      ...t,
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
    topStudents: top,
  });
});

app.get("/api/achievements/students/:studentId", (req, res) => {
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
    return res.status(403).json({ error: "Forbidden" });
  const tally = achievementsData.studentTally(req.params.studentId);
  const s = db.students.find((x) => x.id === req.params.studentId);
  res.json({ student: s || null, ...tally });
});

app.get("/api/achievements/:id", (req, res) => {
  const a = achievementsData.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(a.studentId))
    return res.status(403).json({ error: "Forbidden" });
  const s = db.students.find((x) => x.id === a.studentId);
  res.json({ ...a, student: s || null });
});

app.post(
  "/api/achievements",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only file achievements for students you teach" });
      }
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
      const existing = achievementsData.get(req.params.id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(existing.studentId))
        return res
          .status(403)
          .json({ error: "You can only edit achievements for students you teach" });
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
  const scope = studentRecordsScope(req);
  const prefs = cafeteriaData.prefs();
  let students = db.students;
  if (!scope.fullView) students = students.filter((s) => scope.studentIds.has(s.id));
  const items = students.map((s) => ({
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
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
    return res.status(403).json({ error: "Forbidden" });
  const p = cafeteriaData.getPref(req.params.studentId);
  res.json(p || { mealPlan: "Veg", specialDiet: null, optedOut: [] });
});

app.patch(
  "/api/cafeteria/preferences/:studentId",
  requireRole("admin", "principal", "hr", "teacher", "parent", "student"),
  (req, res) => {
    try {
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
        return res
          .status(403)
          .json({ error: "You can only edit meal prefs for your own student" });
      const p = cafeteriaData.setPref(req.params.studentId, req.body || {});
      res.json(p);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ============ MEAL PRE-ORDERS ============
// Parents pre-book a meal for their child, students may book for themselves,
// admin/principal sees all. Kitchen staff (admin for now) mark orders served.

app.get("/api/cafeteria/orders", (req, res) => {
  const scope = studentRecordsScope(req);
  const filter = {
    date: req.query.date || undefined,
    meal: req.query.meal || undefined,
    status: req.query.status || undefined,
  };
  // If the caller asks for a specific student, honour the per-student scope.
  if (req.query.studentId) {
    if (!scope.fullView && !scope.studentIds.has(req.query.studentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }
    filter.studentId = req.query.studentId;
  }
  let items = cafeteriaData.listOrders(filter);
  // Narrow to the requester's own students if they don't have full view.
  if (!scope.fullView) {
    items = items.filter((o) => scope.studentIds.has(o.studentId));
  }
  res.json({ items, total: items.length });
});

app.get("/api/cafeteria/orders/summary", (req, res) => {
  // Headcount/revenue view is staff-only — students/parents don't need it.
  if (!["admin", "principal", "hr"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Staff only" });
  }
  res.json(cafeteriaData.ordersSummary(req.query.date));
});

app.post("/api/cafeteria/orders", (req, res) => {
  try {
    const { studentId, date, meal, notes } = req.body || {};
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(studentId)) {
      return res
        .status(403)
        .json({ error: "You can only order meals for your own student" });
    }
    const order = cafeteriaData.createOrder({
      studentId,
      date,
      meal,
      notes,
      createdBy: req.user?.sub || null,
    });
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Cancel a pending/confirmed order. Owners (parent/student) can cancel
// their own; admin/principal can cancel any.
app.delete("/api/cafeteria/orders/:id", (req, res) => {
  try {
    const o = cafeteriaData.getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found" });
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(o.studentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }
    const updated = cafeteriaData.cancelOrder(req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Mark served — kitchen staff only.
app.post(
  "/api/cafeteria/orders/:id/serve",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const updated = cafeteriaData.markServed(req.params.id);
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// Mark paid/unpaid — staff only. (A real deployment would tie this to the
// gateway capture flow used in /api/fees.)
app.post(
  "/api/cafeteria/orders/:id/payment",
  requireRole("admin", "principal", "accountant"),
  (req, res) => {
    try {
      const updated = cafeteriaData.updateOrder(req.params.id, {
        paymentStatus: req.body?.paymentStatus,
      });
      res.json(updated);
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
  const scope = studentRecordsScope(req);
  if (!scope.fullView && !scope.studentIds.has(d.studentId))
    return res.status(403).json({ error: "Forbidden" });
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
//
// Per-caller scope:
//   - admin / principal / hr / accountant: everything
//   - teacher  : all exams + leave entries (staff visibility)
//   - student  : only their own grade's exam schedule, no leave entries
//   - parent   : only their linked children's grades for exams, no leave
function calendarScopeFor(req) {
  const role = req.user?.role;
  const staffRoles = ["admin", "principal", "hr", "accountant", "teacher"];
  const scope = { staff: staffRoles.includes(role), grades: null };

  if (role === "student") {
    const s = resolveStudentScope(req.user);
    scope.grades = s.scoped ? new Set([s.student.grade]) : new Set();
  } else if (role === "parent") {
    const p = resolveParentScope(req.user);
    scope.grades = p.scoped ? new Set(p.children.map((c) => c.grade)) : new Set();
  } else if (role === "teacher") {
    // Teachers see all exams (they often invigilate across grades) — leave
    // grades undefined so the full set is returned.
    scope.grades = null;
  }
  return scope;
}

app.get("/api/calendar", (req, res) => {
  const { from, to } = req.query;
  const scope = calendarScopeFor(req);
  const entries = calendarData.getEntries({ from, to, scope });
  res.json({
    range: {
      from: from || null,
      to: to || null,
    },
    total: entries.length,
    entries,
    summary: calendarData.summary({ from, to, scope }),
    types: scope.staff
      ? ["Holiday", "Event", "Exam", "Leave"]
      : ["Holiday", "Event", "Exam"],
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

// Build the scope object that noticesData.gradeMatches() expects, based on
// the caller's role. Returns null for admin/principal/hr/accountant so they
// see everything; teachers/students/parents get narrowed.
function noticeScopeFor(req) {
  const role = req.user?.role;
  if (!role) return null;
  if (role === "admin" || role === "principal") return null;
  if (role === "student") {
    const s = resolveStudentScope(req.user);
    if (!s.scoped) return null;
    return { grade: s.student.grade, section: s.student.section };
  }
  if (role === "parent") {
    const p = resolveParentScope(req.user);
    if (!p.scoped) return null;
    return {
      grades: p.children.map((c) => ({ grade: c.grade, section: c.section })),
    };
  }
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    if (!t.scoped) return null;
    return {
      grades: t.classes.map((c) => {
        const [g, sec] = c.split("-");
        return { grade: Number(g), section: sec };
      }),
    };
  }
  return null;
}

app.get("/api/notices", (req, res) => {
  const user = currentUserFromReq(req);
  // forRole: optionally narrow to the caller's role audience.
  // If `mine=true`, force role-filtering against the caller.
  const mine = req.query.mine === "true";
  const scope = noticeScopeFor(req);
  const items = noticesData.list({
    q: req.query.q,
    category: req.query.category,
    audience: req.query.audience,
    pinned: req.query.pinned,
    includeExpired: req.query.includeExpired === "true",
    forRole: mine ? user?.role : req.query.forRole,
    scope,
    user,
  });
  res.json({
    total: items.length,
    items,
    categories: noticesData.CATEGORIES,
    audiences: noticesData.AUDIENCES,
    summary: noticesData.summary(user, scope),
  });
});

app.get("/api/notices/summary", (req, res) => {
  const user = currentUserFromReq(req);
  res.json(noticesData.summary(user, noticeScopeFor(req)));
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
// Per-caller view describing what the user owns or relates to. Used for
// every PTM read/write so non-admins can't see foreign parent contact
// details or mutate other people's bookings.
//   - mine.studentIds: students the caller "owns" (parent's children, student
//                      themselves, or all students for staff)
//   - mine.teacherId : teacher record id when role=teacher
//   - mine.role      : raw role for shortcuts
//   - mine.fullView  : true for admin/principal — no narrowing applied
function ptmViewFor(req) {
  const role = req.user?.role;
  const view = { role, fullView: false, studentIds: null, teacherId: null };
  if (!role) return view;
  if (role === "admin" || role === "principal") {
    view.fullView = true;
    return view;
  }
  if (role === "student") {
    const s = resolveStudentScope(req.user);
    if (s.scoped) view.studentIds = new Set([s.student.id]);
    return view;
  }
  if (role === "parent") {
    const p = resolveParentScope(req.user);
    if (p.scoped) view.studentIds = new Set(p.children.map((c) => c.id));
    return view;
  }
  if (role === "teacher") {
    const t = resolveTeacherScope(req.user);
    if (t.scoped) view.teacherId = t.teacher.id;
    return view;
  }
  // hr / accountant: read-only full view (no mutations protected by role gate)
  view.fullView = true;
  return view;
}

// Decide whether a given (decorated) session is visible to the caller.
function sessionVisibleTo(s, view) {
  if (view.fullView) return true;
  if (view.role === "teacher" && view.teacherId) {
    return s.teachers?.some((t) => t.id === view.teacherId);
  }
  if (view.role === "parent" || view.role === "student") {
    if (!view.studentIds) return false;
    const myGrades = new Set();
    for (const sid of view.studentIds) {
      const stu = db.students.find((x) => x.id === sid);
      if (stu) myGrades.add(stu.grade);
    }
    if (!Array.isArray(s.grades) || s.grades.length === 0) return true;
    return s.grades.some((g) => myGrades.has(g));
  }
  return true;
}

// Filter raw bookings list to what the caller is entitled to see in full
// (parent phones, notes, etc.). Anyone else's booking is reduced to a
// minimal {teacherId, slotStart, status} so the slot grid still renders
// "occupied" cells without leaking identity.
function sanitizeBookings(bookings, view) {
  if (view.fullView) return bookings;
  return bookings.map((b) => {
    let mine = false;
    if (view.role === "teacher") mine = b.teacherId === view.teacherId;
    else if (view.studentIds) mine = view.studentIds.has(b.studentId);
    if (mine) return { ...b, mine: true };
    // anonymize foreign booking
    return {
      id: b.id,
      sessionId: b.sessionId,
      teacherId: b.teacherId,
      teacherName: b.teacherName,
      teacherSubject: b.teacherSubject,
      teacherAvatar: b.teacherAvatar,
      slotStart: b.slotStart,
      slotMinutes: b.slotMinutes,
      status: b.status,
      anonymized: true,
      mine: false,
    };
  });
}

// Filter the session list for parents/students by checking which sessions
// would actually be useful — i.e. they include a relevant grade.
function filterSessionsForView(sessions, view) {
  if (view.fullView) return sessions;
  if (view.role === "teacher" && view.teacherId) {
    return sessions.filter((s) => s.teachers?.some((t) => t.id === view.teacherId));
  }
  if (view.role === "parent" || view.role === "student") {
    if (!view.studentIds) return sessions;
    // Build set of grades the caller's students are in.
    const myGrades = new Set();
    for (const sid of view.studentIds) {
      const stu = db.students.find((x) => x.id === sid);
      if (stu) myGrades.add(stu.grade);
    }
    return sessions.filter(
      (s) =>
        !Array.isArray(s.grades) ||
        s.grades.length === 0 ||
        s.grades.some((g) => myGrades.has(g))
    );
  }
  return sessions;
}

app.get("/api/ptm/sessions", (req, res) => {
  const view = ptmViewFor(req);
  let sessions = ptmData.sessions({ status: req.query.status });
  sessions = filterSessionsForView(sessions, view);
  res.json({
    sessions,
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
  const view = ptmViewFor(req);
  const s = ptmData.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  if (!sessionVisibleTo(s, view))
    return res.status(403).json({ error: "Forbidden" });
  const rawBookings = ptmData.sessionBookings(s.id);
  const bookings = sanitizeBookings(rawBookings, view);
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
    const view = ptmViewFor(req);
    const { studentId } = req.body || {};
    if (!view.fullView) {
      if (view.role === "teacher")
        return res.status(403).json({ error: "Teachers can't book PTM slots" });
      if (!view.studentIds || !studentId || !view.studentIds.has(studentId))
        return res
          .status(403)
          .json({ error: "You can only book for your own child" });
    }
    const b = ptmData.book(req.params.id, req.body || {});
    res.status(201).json(b);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Booking ownership: who is allowed to mutate a given booking?
function canMutateBooking(b, view) {
  if (view.fullView) return true;
  if (view.role === "teacher" && view.teacherId) return b.teacherId === view.teacherId;
  if (view.studentIds) return view.studentIds.has(b.studentId);
  return false;
}

app.patch("/api/ptm/bookings/:id", (req, res) => {
  try {
    const view = ptmViewFor(req);
    const raw = ptmData.raw().bookings.find((x) => x.id === req.params.id);
    if (!raw) return res.status(404).json({ error: "Booking not found" });
    if (!canMutateBooking(raw, view))
      return res.status(403).json({ error: "Not your booking" });

    // Narrow what each role may patch.
    const patch = req.body || {};
    if (!view.fullView) {
      const safe = {};
      // status transitions
      if (view.role === "teacher") {
        if (patch.status && !["completed", "no-show", "cancelled"].includes(patch.status))
          return res.status(400).json({ error: "Teachers may only set completed/no-show/cancelled" });
        if (patch.status !== undefined) safe.status = patch.status;
      } else if (view.role === "parent" || view.role === "student") {
        if (patch.status !== undefined && patch.status !== "cancelled")
          return res.status(403).json({ error: "Only teachers/admin can change status" });
        if (patch.status !== undefined) safe.status = patch.status;
      }
      if (patch.note !== undefined) safe.note = patch.note;
      const b = ptmData.updateBooking(req.params.id, safe);
      return res.json(b);
    }
    const b = ptmData.updateBooking(req.params.id, patch);
    res.json(b);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete("/api/ptm/bookings/:id", (req, res) => {
  try {
    const view = ptmViewFor(req);
    const raw = ptmData.raw().bookings.find((x) => x.id === req.params.id);
    if (!raw) return res.status(404).json({ error: "Booking not found" });
    if (!canMutateBooking(raw, view))
      return res.status(403).json({ error: "Not your booking" });
    res.json(ptmData.cancelBooking(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get("/api/ptm/students/:studentId/bookings", (req, res) => {
  const view = ptmViewFor(req);
  const sid = req.params.studentId;
  if (!view.fullView) {
    const ok =
      (view.studentIds && view.studentIds.has(sid)) ||
      (view.role === "teacher"); // teacher can look up any student's bookings — they see only their own slots below
    if (!ok) return res.status(403).json({ error: "Forbidden" });
  }
  let bookings = ptmData.studentBookings(sid);
  if (view.role === "teacher" && view.teacherId)
    bookings = bookings.filter((b) => b.teacherId === view.teacherId);
  res.json({ bookings });
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

// Scholarship applications carry sensitive financial-aid context (household
// income, reason narratives, supporting documents). Families should only see
// their own; staff with a need-to-know see everything.
app.get("/api/scholarships/applications", (req, res) => {
  const scope = studentRecordsScope(req);
  let items = scholarshipsData.listApplications(req.query || {});
  if (!scope.fullView) items = items.filter((a) => scope.studentIds.has(a.studentId));
  res.json({
    items,
    statuses: scholarshipsData.STATUSES,
  });
});

app.post(
  "/api/scholarships/applications",
  requireRole("admin", "principal", "teacher", "hr", "parent"),
  (req, res) => {
    try {
      const scope = studentRecordsScope(req);
      const studentId = req.body?.studentId;
      // Parents can only apply on behalf of their linked children. Teachers
      // can apply for students they teach. Staff with fullView are unrestricted.
      if (!scope.fullView) {
        if (!studentId || !scope.studentIds.has(studentId))
          return res
            .status(403)
            .json({ error: "You can only apply for your own student" });
      }
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
      // Withdraw is for the applicant themselves (parent / teacher / staff who
      // filed it) or admins managing the queue. Block strangers from canceling
      // someone else's application.
      const app = scholarshipsData.applications().find((a) => a.id === req.params.id);
      if (!app) return res.status(404).json({ error: "Application not found" });
      const scope = studentRecordsScope(req);
      if (!scope.fullView && !scope.studentIds.has(app.studentId))
        return res
          .status(403)
          .json({ error: "You can only withdraw your own application" });
      res.json(scholarshipsData.withdrawApplication(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

app.get(
  "/api/scholarships/students/:studentId/awarded",
  (req, res) => {
    const scope = studentRecordsScope(req);
    if (!scope.fullView && !scope.studentIds.has(req.params.studentId))
      return res.status(403).json({ error: "Forbidden" });
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
    const snap = substitutesData.snapshot(date);
    // Teachers don't need to see every gap in the school — narrow to gaps
    // that involve them: either they were the absent teacher (so they know
    // who is covering) or they're the assigned substitute (so they know
    // what they're teaching today).
    if (req.user?.role === "teacher") {
      const tScope = resolveTeacherScope(req.user);
      const myTeacherId = tScope.scoped ? tScope.teacher.id : null;
      const myClasses = new Set(tScope.scoped ? tScope.classes : []);
      const mine = snap.gaps.filter((g) => {
        if (g.originalTeacherId === myTeacherId) return true;
        if (g.assignment?.substituteTeacherId === myTeacherId) return true;
        // Surface gaps in classes the teacher normally teaches so they have
        // visibility into who's covering for them.
        const classKey = `${g.classGrade}-${g.classSection || ""}`;
        return myClasses.has(classKey);
      });
      return res.json({
        ...snap,
        gaps: mine,
        summary: {
          ...snap.summary,
          totalGaps: mine.length,
          filled: mine.filter((g) => !!g.assignment).length,
          open: mine.filter((g) => !g.assignment).length,
        },
      });
    }
    res.json(snap);
  }
);

app.get(
  "/api/substitutes/history",
  requireRole("admin", "principal", "hr", "teacher"),
  (req, res) => {
    let items = substitutesData.history(req.query);
    if (req.user?.role === "teacher") {
      const tScope = resolveTeacherScope(req.user);
      const myId = tScope.scoped ? tScope.teacher.id : null;
      items = items.filter(
        (s) =>
          s.originalTeacherId === myId ||
          s.substituteTeacherId === myId
      );
    }
    res.json({
      items,
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

// ============ REPORTS — CSV EXPORTS ============
// All exports use the standard `studentRecordsScope` so each role downloads
// only what they're allowed to see:
//   admin / principal / hr / accountant  → school-wide
//   teacher                              → students in their classes
//   parent                               → their linked children
//   student                              → themselves only
//
// Rows are returned as text/csv with a Content-Disposition so the browser
// triggers a file download instead of rendering in a tab.

// CSV value escape — RFC 4180-ish. Wraps in quotes if the value contains
// quote, comma, or newline; doubles embedded quotes.
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Build a CSV string from columns + rows.
// `cols` is an array of {key, label} or string. `rows` is an array of objects
// or arrays. Header row is always emitted.
function buildCsv(cols, rows) {
  const headers = cols.map((c) => (typeof c === "string" ? c : c.label));
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    if (Array.isArray(r)) {
      lines.push(r.map(csvEscape).join(","));
    } else {
      lines.push(
        cols
          .map((c) => csvEscape(r[typeof c === "string" ? c : c.key]))
          .join(",")
      );
    }
  }
  // Excel needs a UTF-8 BOM to render special characters correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function stampedFilename(prefix) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
}

// ----- Students roster -----
// Staff-only. Includes contact data so it's gated to admin/principal/hr.
app.get(
  "/api/reports/export/students.csv",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    const { grade, section, house } = req.query || {};
    let list = db.students.slice();
    if (grade && grade !== "all") list = list.filter((s) => String(s.grade) === String(grade));
    if (section && section !== "all") list = list.filter((s) => s.section === section);
    if (house && house !== "all") list = list.filter((s) => s.house === house);
    const cols = [
      { key: "id", label: "Student ID" },
      { key: "name", label: "Name" },
      { key: "grade", label: "Grade" },
      { key: "section", label: "Section" },
      { key: "house", label: "House" },
      { key: "gender", label: "Gender" },
      { key: "gpa", label: "GPA" },
      { key: "attendance", label: "Attendance %" },
      { key: "feeStatus", label: "Fee Status" },
      { key: "parent", label: "Parent" },
      { key: "contact", label: "Parent Contact" },
    ];
    sendCsv(res, stampedFilename("students"), buildCsv(cols, list));
  }
);

// ----- Attendance ledger -----
// Scope-aware. `?from=YYYY-MM-DD&to=YYYY-MM-DD&grade=N&section=A` filters.
app.get("/api/reports/export/attendance.csv", (req, res) => {
  const { from, to, grade, section } = req.query || {};
  const scope = studentRecordsScope(req);
  let students = db.students.slice();
  if (!scope.fullView) students = students.filter((s) => scope.studentIds.has(s.id));
  if (grade && grade !== "all") students = students.filter((s) => String(s.grade) === String(grade));
  if (section && section !== "all") students = students.filter((s) => s.section === section);

  // Walk every date:studentId entry within the window.
  const inWindow = (d) => (!from || d >= from) && (!to || d <= to);
  const allowedSet = new Set(students.map((s) => s.id));
  const rows = [];
  for (const key of Object.keys(db.attendance)) {
    const [date, sid] = key.split(":");
    if (!allowedSet.has(sid)) continue;
    if (!inWindow(date)) continue;
    const s = students.find((x) => x.id === sid);
    rows.push({
      date,
      studentId: sid,
      name: s?.name || "(unknown)",
      grade: s?.grade,
      section: s?.section,
      status: db.attendance[key],
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.studentId.localeCompare(b.studentId) : a.date < b.date ? 1 : -1));
  const cols = [
    { key: "date", label: "Date" },
    { key: "studentId", label: "Student ID" },
    { key: "name", label: "Name" },
    { key: "grade", label: "Grade" },
    { key: "section", label: "Section" },
    { key: "status", label: "Status" },
  ];
  sendCsv(res, stampedFilename("attendance"), buildCsv(cols, rows));
});

// ----- Fee payments -----
// Scope-aware. Parents/students get their own ledger; accountant/admin get all.
app.get("/api/reports/export/fees.csv", (req, res) => {
  const { from, to, status, mode } = req.query || {};
  const scope = studentRecordsScope(req);
  let list = feePaymentsData.listPayments({ status, mode });
  if (!scope.fullView) list = list.filter((p) => scope.studentIds.has(p.studentId));
  if (from) list = list.filter((p) => (p.paidAt || "").slice(0, 10) >= from);
  if (to) list = list.filter((p) => (p.paidAt || "").slice(0, 10) <= to);
  const sById = new Map(db.students.map((s) => [s.id, s]));
  const rows = list.map((p) => {
    const s = sById.get(p.studentId);
    return {
      paidAt: (p.paidAt || "").slice(0, 19).replace("T", " "),
      receiptNo: p.receiptNo,
      paymentId: p.id,
      studentId: p.studentId,
      studentName: s?.name || "(unknown)",
      grade: s?.grade,
      section: s?.section,
      amount: p.amount,
      mode: p.mode,
      status: p.status,
      headBreakup: (p.heads || []).map((h) => `${h.head}:${h.amount}`).join("; "),
      note: p.note || "",
    };
  });
  const cols = [
    { key: "paidAt", label: "Paid At" },
    { key: "receiptNo", label: "Receipt No" },
    { key: "paymentId", label: "Payment ID" },
    { key: "studentId", label: "Student ID" },
    { key: "studentName", label: "Student" },
    { key: "grade", label: "Grade" },
    { key: "section", label: "Section" },
    { key: "amount", label: "Amount" },
    { key: "mode", label: "Mode" },
    { key: "status", label: "Status" },
    { key: "headBreakup", label: "Heads" },
    { key: "note", label: "Note" },
  ];
  sendCsv(res, stampedFilename("fees"), buildCsv(cols, rows));
});

// ----- Exam marks consolidated -----
// One row per (student × paper). `?examId=` narrows to a single exam.
app.get("/api/reports/export/exams.csv", (req, res) => {
  const { examId } = req.query || {};
  const scope = studentRecordsScope(req);
  const exams = examId
    ? examsData.exams.filter((e) => e.id === examId)
    : examsData.exams;
  const rows = [];
  for (const e of exams) {
    // Eligible roster for this exam (grade match)
    let cohort = db.students.filter((s) => s.grade === e.grade);
    if (!scope.fullView) cohort = cohort.filter((s) => scope.studentIds.has(s.id));
    for (const paper of e.papers) {
      for (const s of cohort) {
        const key = `${e.id}:${paper.subject}:${s.id}`;
        const marks = examsData.marks[key];
        if (marks === undefined) continue;
        rows.push({
          examId: e.id,
          examName: e.name,
          grade: e.grade,
          subject: paper.subject,
          paperDate: paper.date,
          studentId: s.id,
          studentName: s.name,
          section: s.section,
          marks,
          max: paper.maxMarks || 100,
          gradeLetter: typeof marks === "number" ? examsData.gradeFor(marks) : "",
        });
      }
    }
  }
  rows.sort((a, b) =>
    a.examId === b.examId
      ? a.subject === b.subject
        ? a.studentId.localeCompare(b.studentId)
        : a.subject.localeCompare(b.subject)
      : a.examId.localeCompare(b.examId)
  );
  const cols = [
    { key: "examId", label: "Exam ID" },
    { key: "examName", label: "Exam" },
    { key: "grade", label: "Grade" },
    { key: "subject", label: "Subject" },
    { key: "paperDate", label: "Paper Date" },
    { key: "studentId", label: "Student ID" },
    { key: "studentName", label: "Student" },
    { key: "section", label: "Section" },
    { key: "marks", label: "Marks" },
    { key: "max", label: "Max" },
    { key: "gradeLetter", label: "Grade" },
  ];
  sendCsv(res, stampedFilename("exam-marks"), buildCsv(cols, rows));
});

// ----- Discipline incidents -----
app.get("/api/reports/export/discipline.csv", (req, res) => {
  const { from, to, status, severity, category } = req.query || {};
  const scope = studentRecordsScope(req);
  let list = disciplineData.list({ status, severity, category });
  if (!scope.fullView) list = list.filter((i) => scope.studentIds.has(i.studentId));
  if (from) list = list.filter((i) => (i.date || "") >= from);
  if (to) list = list.filter((i) => (i.date || "") <= to);
  const sById = new Map(db.students.map((s) => [s.id, s]));
  const rows = list.map((i) => {
    const s = sById.get(i.studentId);
    return {
      date: i.date,
      id: i.id,
      studentId: i.studentId,
      studentName: s?.name || "(unknown)",
      grade: s?.grade,
      section: s?.section,
      category: i.category,
      severity: i.severity,
      status: i.status,
      description: i.description,
      reportedBy: i.reportedBy,
      resolution: i.resolution || "",
    };
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const cols = [
    { key: "date", label: "Date" },
    { key: "id", label: "Incident ID" },
    { key: "studentId", label: "Student ID" },
    { key: "studentName", label: "Student" },
    { key: "grade", label: "Grade" },
    { key: "section", label: "Section" },
    { key: "category", label: "Category" },
    { key: "severity", label: "Severity" },
    { key: "status", label: "Status" },
    { key: "description", label: "Description" },
    { key: "reportedBy", label: "Reported By" },
    { key: "resolution", label: "Resolution" },
  ];
  sendCsv(res, stampedFilename("discipline"), buildCsv(cols, rows));
});

// ============ REPORTS — CSV IMPORTS (BULK UPLOAD) ============
// Counterpart to the CSV exports above. Admins paste / upload a CSV; the
// server parses, validates each row against the same rules as the manual
// create endpoints, and either reports a preview (dry-run) or commits all
// rows atomically. Validation errors are returned per-row so the user sees
// exactly which lines need fixing without losing the partial upload.

// Lightweight CSV parser. Handles quoted fields, embedded commas, doubled
// quotes, and CRLF / LF line endings. Returns array of arrays of strings.
function parseCsv(text) {
  if (!text || typeof text !== "string") return [];
  // Strip UTF-8 BOM if Excel saved one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        // swallow; the \n that follows ends the row
        i++;
      } else if (ch === "\n") {
        row.push(field);
        out.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  // Trailing field/row (no final newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  // Drop trailing empty rows
  while (out.length > 0 && out[out.length - 1].every((f) => f === "")) {
    out.pop();
  }
  return out;
}

// Parse CSV string → array of row objects keyed by lowercased headers.
// First row is treated as the header. Returns { headers, rows } or throws.
function csvToObjects(text) {
  const matrix = parseCsv(text);
  if (matrix.length === 0) throw new Error("CSV is empty");
  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate column headers");
  const rows = matrix.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (cells[i] ?? "").trim();
    return obj;
  });
  return { headers, rows };
}

// ----- Students bulk import -----
//   columns (header row, case-insensitive): name*, grade*, section, house,
//     gender, gpa, attendance, feeStatus, parent, contact, photoUrl
//   * = required
//
// Body: { csv: "<csv text>", dryRun?: boolean }
// Response: {
//   dryRun, totalRows, valid, errors:[{row, message}], created:[{id,name,...}]
// }
app.post(
  "/api/admin/import/students",
  requireRole("admin", "principal"),
  (req, res) => {
    try {
      const { csv, dryRun } = req.body || {};
      if (!csv) return res.status(400).json({ error: "csv field required" });
      const { rows } = csvToObjects(csv);

      const errors = [];
      const cleanRows = [];
      rows.forEach((r, idx) => {
        const rowNum = idx + 2; // header is row 1, first data row is row 2
        // Normalize numeric-looking fields
        const payload = {
          name: r.name,
          grade: r.grade,
          section: r.section || undefined,
          house: r.house || undefined,
          gender: r.gender || undefined,
          gpa: r.gpa || undefined,
          attendance: r.attendance || undefined,
          feeStatus: r.feestatus || r["fee status"] || undefined,
          parent: r.parent || undefined,
          contact: r.contact || r["parent contact"] || undefined,
          photoUrl: r.photourl || r["photo url"] || undefined,
        };
        try {
          validateStudentPayload(payload);
          cleanRows.push(payload);
        } catch (e) {
          errors.push({ row: rowNum, message: e.message });
        }
      });

      if (errors.length > 0) {
        return res.status(422).json({
          dryRun: !!dryRun,
          totalRows: rows.length,
          valid: cleanRows.length,
          errors,
          created: [],
        });
      }

      if (dryRun) {
        return res.json({
          dryRun: true,
          totalRows: rows.length,
          valid: cleanRows.length,
          errors: [],
          preview: cleanRows.slice(0, 20),
        });
      }

      // Commit — uses the same shape as POST /api/students.
      const created = cleanRows.map((body) => {
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
        return s;
      });
      persistStudents();
      res.status(201).json({
        dryRun: false,
        totalRows: rows.length,
        valid: cleanRows.length,
        errors: [],
        created,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ----- Attendance bulk import -----
//   columns: date* (YYYY-MM-DD), studentId*, status*  (Present/Absent/Late/Leave)
//
// Teachers can only upload entries for students in their classes — foreign
// rows are reported in `errors` and skipped (not silently swallowed).
app.post(
  "/api/admin/import/attendance",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const { csv, dryRun } = req.body || {};
      if (!csv) return res.status(400).json({ error: "csv field required" });
      const { rows } = csvToObjects(csv);
      const scope = studentRecordsScope(req);
      const studentsById = new Set(db.students.map((s) => s.id));
      const VALID = new Set(["Present", "Absent", "Late", "Leave"]);

      const errors = [];
      const writes = [];
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const date = (r.date || "").trim();
        const sid = (r.studentid || r["student id"] || "").trim();
        const status = (r.status || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ row: rowNum, message: "date must be YYYY-MM-DD" });
          return;
        }
        if (!sid) {
          errors.push({ row: rowNum, message: "studentId required" });
          return;
        }
        if (!studentsById.has(sid)) {
          errors.push({ row: rowNum, message: `unknown studentId ${sid}` });
          return;
        }
        if (!scope.fullView && !scope.studentIds.has(sid)) {
          errors.push({
            row: rowNum,
            message: `${sid} is not in a class you teach`,
          });
          return;
        }
        if (!VALID.has(status)) {
          errors.push({
            row: rowNum,
            message: `status must be one of ${[...VALID].join(", ")}`,
          });
          return;
        }
        writes.push({ date, sid, status });
      });

      if (dryRun) {
        return res.json({
          dryRun: true,
          totalRows: rows.length,
          valid: writes.length,
          errors,
          preview: writes.slice(0, 20),
        });
      }

      // Commit even partial — caller can re-upload the failed rows after
      // fixing them. Returning errors alongside the saved count gives a
      // useful "got 142 in, 3 lines need fixing" UX.
      for (const w of writes) {
        db.attendance[`${w.date}:${w.sid}`] = w.status;
      }
      if (writes.length > 0) persistAttendance();

      res.json({
        dryRun: false,
        totalRows: rows.length,
        saved: writes.length,
        errors,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ----- Teachers bulk import -----
//   columns: name*, subject*, classes, experience, rating, email, status, photoUrl
app.post(
  "/api/admin/import/teachers",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const { csv, dryRun } = req.body || {};
      if (!csv) return res.status(400).json({ error: "csv field required" });
      const { rows } = csvToObjects(csv);

      const errors = [];
      const cleanRows = [];
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const payload = {
          name: r.name,
          subject: r.subject,
          classes: r.classes || undefined,
          experience: r.experience || undefined,
          rating: r.rating || undefined,
          email: r.email || undefined,
          status: r.status || undefined,
          photoUrl: r.photourl || r["photo url"] || undefined,
        };
        try {
          validateTeacherPayload(payload);
          cleanRows.push(payload);
        } catch (e) {
          errors.push({ row: rowNum, message: e.message });
        }
      });

      if (errors.length > 0) {
        return res.status(422).json({
          dryRun: !!dryRun,
          totalRows: rows.length,
          valid: cleanRows.length,
          errors,
          created: [],
        });
      }

      if (dryRun) {
        return res.json({
          dryRun: true,
          totalRows: rows.length,
          valid: cleanRows.length,
          errors: [],
          preview: cleanRows.slice(0, 20),
        });
      }

      const created = cleanRows.map((body) => {
        const t = {
          id: nextTeacherId(),
          name: String(body.name).trim(),
          avatar: avatarFromName(body.name),
          subject: body.subject,
          classes: body.classes !== undefined ? Number(body.classes) : 0,
          experience: body.experience !== undefined ? Number(body.experience) : 0,
          rating:
            body.rating !== undefined ? Number(body.rating).toFixed(1) : "4.0",
          email: body.email || emailForTeacher(body.name),
          status: body.status || "Active",
          photoUrl: body.photoUrl || null,
        };
        db.teachers.push(t);
        return t;
      });
      persistTeachers();
      res.status(201).json({
        dryRun: false,
        totalRows: rows.length,
        valid: cleanRows.length,
        errors: [],
        created,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ----- Non-teaching staff bulk import -----
//   columns: name*, category*, designation*, department, email, phone,
//            joinedOn, status, employmentType, salary, gender,
//            address, emergencyContact, notes, photoUrl
app.post(
  "/api/admin/import/staff",
  requireRole("admin", "principal", "hr"),
  (req, res) => {
    try {
      const { csv, dryRun } = req.body || {};
      if (!csv) return res.status(400).json({ error: "csv field required" });
      const { rows } = csvToObjects(csv);

      const errors = [];
      const cleanRows = [];
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const payload = {
          name: r.name,
          category: r.category,
          designation: r.designation,
          department: r.department || undefined,
          email: r.email || undefined,
          phone: r.phone || undefined,
          joinedOn: r.joinedon || r["joined on"] || undefined,
          status: r.status || undefined,
          employmentType:
            r.employmenttype || r["employment type"] || undefined,
          salary: r.salary || undefined,
          gender: r.gender || undefined,
          address: r.address || undefined,
          emergencyContact:
            r.emergencycontact || r["emergency contact"] || undefined,
          notes: r.notes || undefined,
          photoUrl: r.photourl || r["photo url"] || undefined,
        };
        // staffData.add does its own validation + insert, but we want to
        // dry-run safely without persisting. So we validate via a synthetic
        // call: if any field is invalid, .add throws before pushing. For
        // dry-run we skip the actual commit by deferring the call until the
        // commit pass below.
        cleanRows.push({ rowNum, payload });
      });

      // First pass: validate all rows without committing. Each row goes
      // through staffData.add inside a try/catch — but to avoid persisting
      // in dry-run mode we simulate by using the underlying validate
      // contract: missing/invalid fields throw. The cleanest way without
      // exposing validate() is to do a "trial add then rollback" — but our
      // store has no transactions. Instead, we do validation by attempting
      // a partial create object and relying on the explicit field checks
      // staff.add performs.
      const validated = [];
      for (const { rowNum, payload } of cleanRows) {
        try {
          // Lean validation — required fields + enum membership.
          if (!payload.name || !String(payload.name).trim())
            throw new Error("name required");
          if (!payload.category) throw new Error("category required");
          if (!payload.designation) throw new Error("designation required");
          if (!staffData.CATEGORIES.includes(payload.category))
            throw new Error(
              `category must be one of ${staffData.CATEGORIES.join(", ")}`
            );
          if (
            payload.status &&
            !staffData.STATUSES.includes(payload.status)
          )
            throw new Error(
              `status must be one of ${staffData.STATUSES.join(", ")}`
            );
          if (
            payload.employmentType &&
            !staffData.EMPLOYMENT_TYPES.includes(payload.employmentType)
          )
            throw new Error(
              `employmentType must be one of ${staffData.EMPLOYMENT_TYPES.join(", ")}`
            );
          if (payload.salary !== undefined) {
            const n = Number(payload.salary);
            if (!Number.isFinite(n) || n < 0)
              throw new Error("salary must be a non-negative number");
            payload.salary = n;
          }
          validated.push(payload);
        } catch (e) {
          errors.push({ row: rowNum, message: e.message });
        }
      }

      if (errors.length > 0) {
        return res.status(422).json({
          dryRun: !!dryRun,
          totalRows: rows.length,
          valid: validated.length,
          errors,
          created: [],
        });
      }

      if (dryRun) {
        return res.json({
          dryRun: true,
          totalRows: rows.length,
          valid: validated.length,
          errors: [],
          preview: validated.slice(0, 20),
        });
      }

      const user = currentUserFromReq(req);
      const created = validated.map((p) => staffData.add(p, user));
      res.status(201).json({
        dryRun: false,
        totalRows: rows.length,
        valid: validated.length,
        errors: [],
        created,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ----- Exam marks bulk import -----
//   Query: ?examId=EX123 (required)
//   Body:  { csv, dryRun }
//   CSV columns: studentId*, subject*, marks*
//
// Teachers can only upload marks for subjects they teach AND students in
// their classes for the exam's grade. Same rules as POST /api/exams/:id/marks.
app.post(
  "/api/admin/import/exam-marks",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    try {
      const { csv, dryRun } = req.body || {};
      const { examId } = req.query || {};
      if (!examId) return res.status(400).json({ error: "examId query param required" });
      if (!csv) return res.status(400).json({ error: "csv field required" });
      const exam = examsData.exams.find((x) => x.id === examId);
      if (!exam) return res.status(404).json({ error: "Exam not found" });

      // Build the scope for teachers (subjects + grade-matched students).
      let allowedSubjects = null;
      let allowedStudentIds = null;
      if (req.user.role === "teacher") {
        const t = resolveTeacherScope(req.user);
        if (!t.scoped) return res.status(403).json({ error: "No linked teacher record" });
        allowedSubjects = new Set(t.subjects || []);
        allowedStudentIds = new Set(
          [...t.studentIds].filter((sid) => {
            const stu = db.students.find((s) => s.id === sid);
            return stu && stu.grade === exam.grade;
          })
        );
      }

      const validSubjects = new Set(exam.papers.map((p) => p.subject));
      // Per-subject max marks lookup for the validation range.
      const maxBySubject = Object.fromEntries(
        exam.papers.map((p) => [p.subject, p.maxMarks || 100])
      );
      const studentsInGrade = new Set(
        db.students.filter((s) => s.grade === exam.grade).map((s) => s.id)
      );

      const { rows } = csvToObjects(csv);
      const errors = [];
      const writes = [];
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const sid = (r.studentid || r["student id"] || "").trim();
        const subject = (r.subject || "").trim();
        const raw = (r.marks || "").trim();
        if (!sid) {
          errors.push({ row: rowNum, message: "studentId required" });
          return;
        }
        if (!studentsInGrade.has(sid)) {
          errors.push({
            row: rowNum,
            message: `${sid} is not enrolled in Grade ${exam.grade}`,
          });
          return;
        }
        if (allowedStudentIds && !allowedStudentIds.has(sid)) {
          errors.push({
            row: rowNum,
            message: `${sid} is not in a class you teach`,
          });
          return;
        }
        if (!subject) {
          errors.push({ row: rowNum, message: "subject required" });
          return;
        }
        if (!validSubjects.has(subject)) {
          errors.push({
            row: rowNum,
            message: `${subject} is not a paper in ${exam.name}`,
          });
          return;
        }
        if (allowedSubjects && !allowedSubjects.has(subject)) {
          errors.push({
            row: rowNum,
            message: `You don't teach ${subject}`,
          });
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors.push({ row: rowNum, message: "marks must be a number" });
          return;
        }
        const max = maxBySubject[subject];
        if (n < 0 || n > max) {
          errors.push({
            row: rowNum,
            message: `marks must be 0-${max}`,
          });
          return;
        }
        writes.push({ sid, subject, marks: n });
      });

      if (dryRun) {
        return res.json({
          dryRun: true,
          examId: exam.id,
          examName: exam.name,
          totalRows: rows.length,
          valid: writes.length,
          errors,
          preview: writes.slice(0, 20),
        });
      }

      // Commit only the valid writes — leave invalid rows for the user to fix
      // and re-upload. Same UX as attendance import.
      for (const w of writes) {
        const key = `${exam.id}:${w.sid}:${w.subject}`;
        examsData.marks[key] = w.marks;
      }
      if (writes.length > 0) examsData.persistMarks();

      res.json({
        dryRun: false,
        examId: exam.id,
        examName: exam.name,
        totalRows: rows.length,
        saved: writes.length,
        errors,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ----- Template downloads -----
// Lets the user grab a blank template with the correct header row so they
// know exactly what columns to fill in.
app.get(
  "/api/admin/import/template/:kind",
  requireRole("admin", "principal", "teacher"),
  (req, res) => {
    const { kind } = req.params;
    let header = "";
    let sample = "";
    if (kind === "students") {
      if (!["admin", "principal"].includes(req.user.role))
        return res.status(403).json({ error: "Forbidden" });
      header =
        "name,grade,section,house,gender,gpa,attendance,feeStatus,parent,contact,photoUrl";
      sample =
        '"Aarav Kumar",8,B,Azure,M,3.85,98,Paid,"Mr. Kumar","+91 9876543210",';
    } else if (kind === "attendance") {
      header = "date,studentId,status";
      sample = "2026-05-26,S0001,Present";
    } else if (kind === "teachers") {
      if (!["admin", "principal", "hr"].includes(req.user.role))
        return res.status(403).json({ error: "Forbidden" });
      header = "name,subject,classes,experience,rating,email,status,photoUrl";
      sample =
        '"Marcus Chen","Mathematics",24,8,4.5,marcus@lumina.edu,Active,';
    } else if (kind === "staff") {
      if (!["admin", "principal", "hr"].includes(req.user.role))
        return res.status(403).json({ error: "Forbidden" });
      header =
        "name,category,designation,department,email,phone,joinedOn,status,employmentType,salary,gender,address,emergencyContact,notes,photoUrl";
      sample =
        '"Suresh Kumar","Transport","Bus Driver","Transport",suresh@lumina.edu,"+91 9876500000",2024-04-01,Active,Full-time,28000,M,"12 Park Lane","+91 9876511111",,';
    } else if (kind === "exam-marks") {
      // Per-exam pre-filled grid. Caller passes ?examId=EX123; we generate
      // one row per (eligible student × paper subject) with blank marks.
      // For teachers, restrict to subjects they teach + students they teach.
      const { examId } = req.query || {};
      if (!examId)
        return res.status(400).json({ error: "examId query param required" });
      const exam = examsData.exams.find((x) => x.id === examId);
      if (!exam) return res.status(404).json({ error: "Exam not found" });
      let allowedSubjects = null;
      let allowedStudentIds = null;
      if (req.user.role === "teacher") {
        const t = resolveTeacherScope(req.user);
        if (!t.scoped) return res.status(403).json({ error: "No linked teacher record" });
        allowedSubjects = new Set(t.subjects || []);
        allowedStudentIds = new Set(t.studentIds);
      }
      const subjects = exam.papers
        .map((p) => p.subject)
        .filter((sub) => !allowedSubjects || allowedSubjects.has(sub));
      const roster = db.students
        .filter((s) => s.grade === exam.grade)
        .filter((s) => !allowedStudentIds || allowedStudentIds.has(s.id))
        .sort((a, b) =>
          a.section === b.section
            ? a.id.localeCompare(b.id)
            : (a.section || "").localeCompare(b.section || "")
        );
      const rows = [];
      for (const s of roster) {
        for (const sub of subjects) {
          rows.push([s.id, sub, ""]);
        }
      }
      const lines = ["studentId,subject,marks", ...rows.map((r) => r.join(","))];
      const csv = "﻿" + lines.join("\r\n") + "\r\n";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exam.id}-marks-template.csv"`
      );
      return res.send(csv);
    } else {
      return res.status(400).json({ error: "Unknown template kind" });
    }
    const csv = "﻿" + header + "\r\n" + sample + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kind}-template.csv"`
    );
    res.send(csv);
  }
);

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
