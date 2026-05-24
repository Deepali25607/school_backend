// Parent-Teacher Meeting (PTM) Scheduling.
//
// A PTM "session" is a scheduled day where parents book individual time slots
// with teachers. Each session has:
//   - a date and a window (e.g. Sat 9 AM → 1 PM)
//   - a slot duration in minutes (e.g. 10 min)
//   - a set of participating teachers (subset of the teacher roster)
//   - bookings: { teacherId, studentId, parentName, slotStart, status, note }
//
// Slot validation:
//   - Slot must fall within the session window
//   - Slot must align to the duration grid
//   - No double-booking the same teacher at the same slot
//   - A parent can book multiple teachers in the same session (covering all
//     subject teachers for their child), but only ONE slot per teacher per child
//
// Status machine: confirmed → (cancelled | completed | no-show)
// Realtime: every booking change broadcasts `ptm.changed`.

const store = require("./store");
const seed = require("./seed");

const STATUSES = ["confirmed", "cancelled", "completed", "no-show"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fromMinutes(mins) {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSeed() {
  // Two upcoming sessions + one past completed session for history.
  // For each, pick a sensible subset of teachers (Class teachers + subject leads)
  // and seed a handful of confirmed parent bookings drawn from the student roster.

  const teacherIds = seed.teachers.map((t) => t.id);
  const upcomingTeachers = teacherIds.slice(0, 12);
  const pastTeachers = teacherIds.slice(0, 10);

  const sessions = [
    {
      id: "PTM9001",
      name: "Mid-Term Parent-Teacher Meeting · Grades 6–10",
      date: dateOffset(6),
      startTime: "09:00",
      endTime: "13:00",
      slotMinutes: 10,
      grades: [6, 7, 8, 9, 10],
      teacherIds: upcomingTeachers,
      mode: "In-person",
      location: "Main Block · Classrooms 101-115",
      status: "upcoming",
      notes:
        "Subject teachers will rotate between assigned rooms. Class teachers stay in their homerooms. Parents are requested to bring the printed PTM token.",
    },
    {
      id: "PTM9002",
      name: "PTM · Grades 11 & 12 (Boards prep)",
      date: dateOffset(14),
      startTime: "10:00",
      endTime: "13:30",
      slotMinutes: 12,
      grades: [11, 12],
      teacherIds: teacherIds.slice(8, 18),
      mode: "Hybrid",
      location: "Auditorium · Hall A",
      status: "upcoming",
      notes:
        "Focus on Boards exam preparation. Subject teachers will share grade-level performance and improvement areas.",
    },
    {
      id: "PTM9000",
      name: "PTM · End of Quarter 1",
      date: dateOffset(-21),
      startTime: "09:00",
      endTime: "12:00",
      slotMinutes: 10,
      grades: [6, 7, 8, 9, 10, 11, 12],
      teacherIds: pastTeachers,
      mode: "In-person",
      location: "Main Block · Classrooms 101-110",
      status: "completed",
      notes: "Quarter 1 review session. Most attended PTM of the year.",
    },
  ];

  function seedBookingsFor(session, count) {
    const out = [];
    const dur = session.slotMinutes;
    const startM = toMinutes(session.startTime);
    const endM = toMinutes(session.endTime);
    const totalSlots = Math.floor((endM - startM) / dur);
    const status = session.status === "completed" ? "completed" : "confirmed";
    let id = 1;
    for (let i = 0; i < count; i++) {
      const student =
        seed.students[
          (i * 7 + (session.id.charCodeAt(3) || 0)) % seed.students.length
        ];
      if (!session.grades.includes(student.grade)) continue;
      const teacherId =
        session.teacherIds[(i * 3) % session.teacherIds.length];
      const slotIndex = (i * 5 + 1) % totalSlots;
      const slotStart = fromMinutes(startM + slotIndex * dur);
      // Avoid double-booking same teacher+slot
      if (out.some((b) => b.teacherId === teacherId && b.slotStart === slotStart))
        continue;
      // Avoid same parent booking same teacher twice
      if (
        out.some((b) => b.studentId === student.id && b.teacherId === teacherId)
      )
        continue;
      out.push({
        id: `${session.id}-B${pad2(id++)}`,
        sessionId: session.id,
        teacherId,
        studentId: student.id,
        parentName: student.parent,
        parentPhone: student.contact,
        slotStart,
        slotMinutes: dur,
        status,
        note: null,
        bookedAt: new Date(Date.now() - i * 3600000).toISOString(),
      });
    }
    return out;
  }

  return {
    sessions,
    bookings: [
      ...seedBookingsFor(sessions[0], 22),
      ...seedBookingsFor(sessions[1], 14),
      ...seedBookingsFor(sessions[2], 28),
    ],
  };
}

let state = store.load("ptm", buildSeed);
const persist = () => store.save("ptm", state);

// ---------- helpers ----------

function teacherById(id) {
  return seed.teachers.find((t) => t.id === id) || null;
}
function studentById(id) {
  return seed.students.find((s) => s.id === id) || null;
}

function buildSlots(session) {
  const out = [];
  const startM = toMinutes(session.startTime);
  const endM = toMinutes(session.endTime);
  const dur = session.slotMinutes;
  for (let m = startM; m + dur <= endM; m += dur) {
    out.push(fromMinutes(m));
  }
  return out;
}

function decorateSession(s) {
  const teachers = (s.teacherIds || [])
    .map((id) => teacherById(id))
    .filter(Boolean);
  const allSlots = buildSlots(s);
  const bookings = state.bookings.filter(
    (b) => b.sessionId === s.id && b.status !== "cancelled"
  );
  const confirmed = bookings.length;
  const capacity = teachers.length * allSlots.length;
  const fillPct = capacity > 0 ? Math.round((confirmed / capacity) * 100) : 0;
  return {
    ...s,
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.name,
      avatar: t.avatar,
      subject: t.subject,
    })),
    slotTimes: allSlots,
    capacity,
    confirmed,
    cancelled: state.bookings.filter(
      (b) => b.sessionId === s.id && b.status === "cancelled"
    ).length,
    completed: state.bookings.filter(
      (b) => b.sessionId === s.id && b.status === "completed"
    ).length,
    noShow: state.bookings.filter(
      (b) => b.sessionId === s.id && b.status === "no-show"
    ).length,
    fillPct,
  };
}

function decorateBooking(b) {
  const t = teacherById(b.teacherId);
  const s = studentById(b.studentId);
  return {
    ...b,
    teacherName: t?.name || b.teacherId,
    teacherSubject: t?.subject || "—",
    teacherAvatar: t?.avatar || "T",
    studentName: s?.name || b.studentId,
    studentGrade: s?.grade,
    studentSection: s?.section,
  };
}

// ---------- queries ----------

function sessions({ status } = {}) {
  let out = state.sessions.slice();
  if (status && status !== "all") {
    if (status === "upcoming") {
      const today = new Date().toISOString().slice(0, 10);
      out = out.filter((s) => s.date >= today && s.status !== "completed");
    } else {
      out = out.filter((s) => s.status === status);
    }
  }
  // newest dates first for upcoming, oldest first for completed list
  out.sort((a, b) => {
    if (a.status === b.status) {
      return a.status === "completed"
        ? new Date(b.date) - new Date(a.date)
        : new Date(a.date) - new Date(b.date);
    }
    // upcoming first, then completed
    return a.status === "completed" ? 1 : -1;
  });
  return out.map(decorateSession);
}

function getSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  return s ? decorateSession(s) : null;
}

function sessionBookings(sessionId) {
  return state.bookings
    .filter((b) => b.sessionId === sessionId)
    .map(decorateBooking);
}

function studentBookings(studentId) {
  return state.bookings
    .filter((b) => b.studentId === studentId)
    .map(decorateBooking);
}

// ---------- mutations ----------

function addSession(payload) {
  if (!payload.name) throw new Error("name required");
  if (!payload.date) throw new Error("date required");
  if (!payload.startTime || !payload.endTime)
    throw new Error("startTime and endTime required");
  if (!Array.isArray(payload.teacherIds) || payload.teacherIds.length === 0)
    throw new Error("at least one teacher required");

  const dur = Math.max(5, Math.min(60, Number(payload.slotMinutes) || 10));
  // sanity: window must fit at least one slot
  if (toMinutes(payload.endTime) - toMinutes(payload.startTime) < dur)
    throw new Error("window too small for slot duration");

  const next = state.sessions.length + 1;
  const s = {
    id: `PTM${9000 + next}`,
    name: String(payload.name).trim(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    slotMinutes: dur,
    grades: Array.isArray(payload.grades) && payload.grades.length
      ? payload.grades.map(Number)
      : [6, 7, 8, 9, 10, 11, 12],
    teacherIds: payload.teacherIds,
    mode: ["In-person", "Online", "Hybrid"].includes(payload.mode)
      ? payload.mode
      : "In-person",
    location: payload.location || "Main Block",
    status: "upcoming",
    notes: payload.notes || null,
  };
  state.sessions.unshift(s);
  persist();
  return decorateSession(s);
}

function updateSession(id, patch) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) throw new Error("Session not found");
  const ALLOWED = [
    "name",
    "date",
    "startTime",
    "endTime",
    "slotMinutes",
    "grades",
    "teacherIds",
    "mode",
    "location",
    "status",
    "notes",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) s[k] = patch[k];
  if (patch.slotMinutes) s.slotMinutes = Math.max(5, Math.min(60, Number(patch.slotMinutes)));
  persist();
  return decorateSession(s);
}

function removeSession(id) {
  const idx = state.sessions.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Session not found");
  const [removed] = state.sessions.splice(idx, 1);
  // also drop bookings tied to it
  state.bookings = state.bookings.filter((b) => b.sessionId !== id);
  persist();
  return removed;
}

function book(sessionId, payload) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error("Session not found");
  if (s.status === "completed")
    throw new Error("Session has already been completed");
  const { teacherId, studentId, slotStart, parentName, parentPhone, note } =
    payload;
  if (!teacherId || !studentId || !slotStart)
    throw new Error("teacherId, studentId, slotStart required");
  if (!s.teacherIds.includes(teacherId))
    throw new Error("Teacher is not part of this session");

  // Validate slot fits the grid
  const validSlots = buildSlots(s);
  if (!validSlots.includes(slotStart))
    throw new Error("Slot does not align to the session grid");

  // Validate student grade matches the session
  const student = studentById(studentId);
  if (!student) throw new Error("Student not found");
  if (!s.grades.includes(student.grade))
    throw new Error("Student grade is not in this session's audience");

  // No double-booking the same teacher+slot
  const conflict = state.bookings.find(
    (b) =>
      b.sessionId === sessionId &&
      b.teacherId === teacherId &&
      b.slotStart === slotStart &&
      b.status !== "cancelled"
  );
  if (conflict) throw new Error("This slot is already booked");

  // Same student can't book the same teacher twice in one session
  const dup = state.bookings.find(
    (b) =>
      b.sessionId === sessionId &&
      b.teacherId === teacherId &&
      b.studentId === studentId &&
      b.status !== "cancelled"
  );
  if (dup) throw new Error("This student already has a slot with this teacher");

  const sessionBookingIds = state.bookings.filter(
    (b) => b.sessionId === sessionId
  );
  const b = {
    id: `${sessionId}-B${pad2(sessionBookingIds.length + 1)}`,
    sessionId,
    teacherId,
    studentId,
    parentName: parentName || student.parent,
    parentPhone: parentPhone || student.contact,
    slotStart,
    slotMinutes: s.slotMinutes,
    status: "confirmed",
    note: note || null,
    bookedAt: new Date().toISOString(),
  };
  state.bookings.push(b);
  persist();
  return decorateBooking(b);
}

function updateBooking(bookingId, patch) {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) throw new Error("Booking not found");
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status))
      throw new Error("Invalid status");
    b.status = patch.status;
  }
  if (patch.note !== undefined) b.note = patch.note;
  persist();
  return decorateBooking(b);
}

function cancelBooking(bookingId) {
  return updateBooking(bookingId, { status: "cancelled" });
}

function summary() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.sessions.filter(
    (s) => s.date >= today && s.status !== "completed"
  );
  const next = upcoming.sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  )[0];
  const totalBookings = state.bookings.filter(
    (b) => b.status === "confirmed"
  ).length;
  const cancelled = state.bookings.filter(
    (b) => b.status === "cancelled"
  ).length;
  const completedCount = state.bookings.filter(
    (b) => b.status === "completed"
  ).length;
  return {
    upcomingSessions: upcoming.length,
    completedSessions: state.sessions.filter((s) => s.status === "completed")
      .length,
    confirmedBookings: totalBookings,
    cancelled,
    completedBookings: completedCount,
    nextSession: next ? decorateSession(next) : null,
  };
}

module.exports = {
  STATUSES,
  sessions,
  getSession,
  sessionBookings,
  studentBookings,
  addSession,
  updateSession,
  removeSession,
  book,
  updateBooking,
  cancelBooking,
  summary,
  // for search aggregator
  raw: () => state,
};
