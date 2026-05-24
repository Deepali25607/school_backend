// Substitute Teacher Assignment
//
// Every day the school office runs the same loop:
//   "Which teachers are on leave today, and for each of their periods,
//    who should we slot in as a substitute?"
//
// This module computes the answer end-to-end. Given a date it:
//   1. Walks the deterministic timetable grid and indexes every cell by
//      teacher → (day, period) → class.
//   2. Filters leave-requests for approved entries that cover that date and
//      belong to a teacher.
//   3. For every period the on-leave teacher was scheduled to take, surfaces
//      a "gap" — a row the admin must fill.
//   4. For each gap, scores every other teacher and returns the top
//      candidates. Score combines subject match, current sub load that day,
//      and a small experience bias for class continuity.
//
// Confirmed assignments persist to `substitutes.json` and are keyed by
// (date, period, classGrade, classSection) so re-assigning is idempotent.

const store = require("./store");
const seed = require("./seed");
const timetableData = require("./timetable");
const leaveData = require("./leave");

const SECTIONS = ["A", "B", "C", "D"];
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

// JS getDay() → "Sun"-"Sat"; the timetable only covers Mon-Sat.
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let items = store.load("substitutes", () => []);
const persist = () => store.save("substitutes", items);

// -------- timetable index (computed once, cached for process lifetime) --------

let teacherIndex = null;
function buildTeacherIndex() {
  // teacherId → array of { day, period, grade, section, subject, room }
  const idx = new Map();
  for (const g of GRADES) {
    for (const s of SECTIONS) {
      const grid = timetableData.buildGrid(g, s);
      for (const dayRow of grid) {
        for (const cell of dayRow.periods) {
          const arr = idx.get(cell.teacherId) || [];
          arr.push({
            day: dayRow.day,
            period: cell.p,
            grade: g,
            section: s,
            subject: cell.subject,
            room: cell.room,
            start: cell.start,
            end: cell.end,
          });
          idx.set(cell.teacherId, arr);
        }
      }
    }
  }
  return idx;
}
function getTeacherIndex() {
  if (!teacherIndex) teacherIndex = buildTeacherIndex();
  return teacherIndex;
}

// Rebuild the cached index whenever the timetable mutates (cell override
// added / cleared). Without this we'd serve stale gaps after admins edit
// the grid.
timetableData.onChange(() => {
  teacherIndex = null;
});

function teacherSlotsOnDay(teacherId, day) {
  const idx = getTeacherIndex();
  return (idx.get(teacherId) || []).filter((c) => c.day === day);
}

function teacherTeachingAt(teacherId, day, period) {
  return teacherSlotsOnDay(teacherId, day).some((s) => s.period === period);
}

// -------- leave lookup --------

function teachersOnLeave(date) {
  const target = new Date(date).getTime();
  return leaveData
    .requests()
    .filter(
      (r) =>
        r.applicantType === "teacher" &&
        r.status === "Approved" &&
        new Date(r.fromDate).getTime() <= target &&
        new Date(r.toDate).getTime() >= target
    );
}

// -------- gap detection --------

function gapKey(date, period, grade, section) {
  return `${date}::${period}::${grade}::${section}`;
}

function dayLabelFor(date) {
  const d = new Date(date);
  return WEEKDAY_LABELS[d.getDay()];
}

function gapsFor(date) {
  const day = dayLabelFor(date);
  if (day === "Sun") return { day, dayIsSchoolDay: false, items: [] };

  const onLeave = teachersOnLeave(date);
  const teachersById = new Map(seed.teachers.map((t) => [t.id, t]));
  const gaps = [];
  for (const lv of onLeave) {
    const slots = teacherSlotsOnDay(lv.applicantId, day);
    for (const slot of slots) {
      const teacher = teachersById.get(lv.applicantId);
      gaps.push({
        key: gapKey(date, slot.period, slot.grade, slot.section),
        date,
        day,
        period: slot.period,
        start: slot.start,
        end: slot.end,
        classGrade: slot.grade,
        classSection: slot.section,
        subject: slot.subject,
        room: slot.room,
        originalTeacherId: lv.applicantId,
        originalTeacherName: teacher?.name || lv.applicantName,
        originalSubject: teacher?.subject || slot.subject,
        leaveId: lv.id,
        leaveType: lv.type,
      });
    }
  }
  gaps.sort((a, b) => a.period - b.period || a.classGrade - b.classGrade);
  return { day, dayIsSchoolDay: true, items: gaps };
}

// -------- suggestion scoring --------

function subLoadOnDate(teacherId, date) {
  return items.filter(
    (s) =>
      s.status === "confirmed" &&
      s.date === date &&
      s.substituteTeacherId === teacherId
  ).length;
}

function suggestionsFor(gap, date) {
  const day = gap.day;
  const onLeaveIds = new Set(
    teachersOnLeave(date).map((l) => l.applicantId)
  );
  const ranked = [];
  for (const t of seed.teachers) {
    if (t.id === gap.originalTeacherId) continue;
    if (onLeaveIds.has(t.id)) continue;
    if (t.status === "On leave") continue; // permanent flag from seed
    if (teacherTeachingAt(t.id, day, gap.period)) continue;

    let score = 50;
    const reasons = [];
    if (t.subject === gap.subject) {
      score += 30;
      reasons.push(`Teaches ${t.subject}`);
    } else if (
      // light heuristic — sciences / humanities clustering
      ({ Physics: 1, Chemistry: 1, Biology: 1, Mathematics: 1 }[t.subject] &&
        { Physics: 1, Chemistry: 1, Biology: 1, Mathematics: 1 }[gap.subject]) ||
      ({ History: 1, Geography: 1, English: 1 }[t.subject] &&
        { History: 1, Geography: 1, English: 1 }[gap.subject])
    ) {
      score += 12;
      reasons.push("Cognate subject");
    }
    const load = subLoadOnDate(t.id, date);
    score -= load * 8;
    if (load === 0) reasons.push("Free of subs today");
    else reasons.push(`${load} sub${load === 1 ? "" : "s"} already today`);

    // experience bias — keeps recommendations sticky between equal candidates
    score += Math.min(10, t.experience || 0);

    ranked.push({
      teacherId: t.id,
      name: t.name,
      avatar: t.avatar,
      subject: t.subject,
      experience: t.experience,
      rating: t.rating,
      score,
      load,
      reason: reasons.join(" · "),
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 5);
}

// -------- public read API --------

function snapshot(date) {
  const { day, dayIsSchoolDay, items: gaps } = gapsFor(date);
  const onLeave = teachersOnLeave(date).map((lv) => {
    const t = seed.teachers.find((x) => x.id === lv.applicantId);
    return {
      teacherId: lv.applicantId,
      name: t?.name || lv.applicantName,
      avatar: t?.avatar || lv.avatar,
      subject: t?.subject || null,
      leaveId: lv.id,
      leaveType: lv.type,
      fromDate: lv.fromDate,
      toDate: lv.toDate,
      reason: lv.reason,
    };
  });

  const assignmentsByKey = new Map(
    items
      .filter((s) => s.date === date && s.status === "confirmed")
      .map((s) => [
        gapKey(s.date, s.period, s.classGrade, s.classSection),
        s,
      ])
  );

  const enriched = gaps.map((g) => {
    const a = assignmentsByKey.get(g.key);
    return {
      ...g,
      assignment: a
        ? {
            id: a.id,
            substituteTeacherId: a.substituteTeacherId,
            substituteTeacherName: a.substituteTeacherName,
            substituteAvatar: a.substituteAvatar,
            note: a.note,
            assignedBy: a.assignedBy,
            assignedAt: a.assignedAt,
          }
        : null,
      suggestions: a ? [] : suggestionsFor(g, date),
    };
  });

  const totalGaps = enriched.length;
  const filled = enriched.filter((g) => !!g.assignment).length;
  const open = totalGaps - filled;

  return {
    date,
    day,
    dayIsSchoolDay,
    teachersOnLeave: onLeave,
    gaps: enriched,
    summary: {
      totalGaps,
      filled,
      open,
      teachersOnLeave: onLeave.length,
    },
  };
}

function history({ from, to, teacherId } = {}) {
  let out = items.slice();
  if (from) out = out.filter((s) => s.date >= from);
  if (to) out = out.filter((s) => s.date <= to);
  if (teacherId)
    out = out.filter(
      (s) =>
        s.substituteTeacherId === teacherId ||
        s.originalTeacherId === teacherId
    );
  out.sort((a, b) =>
    a.date === b.date ? a.period - b.period : b.date.localeCompare(a.date)
  );
  return out;
}

function summary() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    todayFilled: items.filter((s) => s.date === today && s.status === "confirmed").length,
    last30: items.filter((s) => {
      const d = new Date(s.date).getTime();
      return d >= Date.now() - 30 * 86400000;
    }).length,
    total: items.filter((s) => s.status === "confirmed").length,
    cancelled: items.filter((s) => s.status === "cancelled").length,
  };
}

// -------- mutations --------

let nextId = items.length
  ? Math.max(...items.map((s) => parseInt(s.id.slice(3), 10))) + 1
  : 1;

function validate(payload) {
  if (!payload.date) throw new Error("date required");
  if (!payload.period) throw new Error("period required");
  if (!payload.classGrade) throw new Error("classGrade required");
  if (!payload.classSection) throw new Error("classSection required");
  if (!payload.originalTeacherId) throw new Error("originalTeacherId required");
  if (!payload.substituteTeacherId) throw new Error("substituteTeacherId required");
  if (payload.originalTeacherId === payload.substituteTeacherId)
    throw new Error("Substitute cannot be the same teacher");

  const day = dayLabelFor(payload.date);
  if (
    teacherTeachingAt(
      payload.substituteTeacherId,
      day,
      Number(payload.period)
    )
  ) {
    throw new Error("Substitute is already teaching another class at this period");
  }
}

function assign(payload, user) {
  validate(payload);
  const sub = seed.teachers.find((t) => t.id === payload.substituteTeacherId);
  const orig = seed.teachers.find((t) => t.id === payload.originalTeacherId);
  const key = gapKey(
    payload.date,
    Number(payload.period),
    Number(payload.classGrade),
    payload.classSection
  );

  // Idempotent: replace any prior confirmed assignment for the same slot.
  for (const s of items) {
    if (
      s.status === "confirmed" &&
      gapKey(s.date, s.period, s.classGrade, s.classSection) === key
    ) {
      s.status = "cancelled";
      s.cancelledAt = new Date().toISOString();
      s.cancelledBy = user?.name || "system";
      s.cancelReason = "Replaced by new assignment";
    }
  }

  const rec = {
    id: `SUB${String(nextId++).padStart(5, "0")}`,
    date: payload.date,
    period: Number(payload.period),
    classGrade: Number(payload.classGrade),
    classSection: payload.classSection,
    subject: payload.subject || null,
    originalTeacherId: payload.originalTeacherId,
    originalTeacherName: orig?.name || null,
    substituteTeacherId: payload.substituteTeacherId,
    substituteTeacherName: sub?.name || null,
    substituteAvatar: sub?.avatar || null,
    note: payload.note || null,
    status: "confirmed",
    assignedAt: new Date().toISOString(),
    assignedBy: user?.name || "system",
    assignedByRole: user?.role || null,
  };
  items.unshift(rec);
  persist();
  return rec;
}

function cancel(id, user, reason) {
  const s = items.find((x) => x.id === id);
  if (!s) throw new Error("Assignment not found");
  if (s.status !== "confirmed") throw new Error("Already cancelled");
  s.status = "cancelled";
  s.cancelledAt = new Date().toISOString();
  s.cancelledBy = user?.name || "system";
  s.cancelReason = reason || null;
  persist();
  return s;
}

function autoFill(date, user) {
  const snap = snapshot(date);
  const created = [];
  const skipped = [];
  for (const gap of snap.gaps) {
    if (gap.assignment) continue;
    const pick = gap.suggestions[0];
    if (!pick) {
      skipped.push({ key: gap.key, reason: "No available substitute" });
      continue;
    }
    try {
      created.push(
        assign(
          {
            date,
            period: gap.period,
            classGrade: gap.classGrade,
            classSection: gap.classSection,
            subject: gap.subject,
            originalTeacherId: gap.originalTeacherId,
            substituteTeacherId: pick.teacherId,
            note: `Auto-assigned (score ${pick.score})`,
          },
          user
        )
      );
    } catch (e) {
      skipped.push({ key: gap.key, reason: e.message });
    }
  }
  return { created, skipped };
}

module.exports = {
  snapshot,
  history,
  summary,
  assign,
  cancel,
  autoFill,
  // for tests
  _buildTeacherIndex: buildTeacherIndex,
  _teacherSlotsOnDay: teacherSlotsOnDay,
};
