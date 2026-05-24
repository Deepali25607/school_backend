// Unified Academic Calendar — pulls dates from across the platform and
// normalises them into a single timeline.
//
// Sources (currently): events, exam papers, leave requests, public holidays.
// Each entry returns the shape:
//   { date, type, title, sublabel, link, color, meta }

const seed = require("./seed");
const eventsData = require("./events");
const examsData = require("./exams");
const leaveData = require("./leave");

// Indian school-year national + cultural holidays. Dates are pinned for the
// current calendar year (and the next one) so the rolling view stays useful.
function buildHolidays() {
  const year = new Date().getFullYear();
  const out = [];
  const pairs = [
    ["01-26", "Republic Day", "National holiday"],
    ["03-08", "Holi", "Festival of Colors"],
    ["04-14", "Ambedkar Jayanti", "National observance"],
    ["05-01", "Labour Day", "National holiday"],
    ["08-15", "Independence Day", "National holiday"],
    ["10-02", "Gandhi Jayanti", "National holiday"],
    ["10-24", "Dussehra", "Festival"],
    ["11-12", "Diwali (Day 1)", "Festival of Lights"],
    ["11-13", "Diwali (Day 2)", "Festival of Lights"],
    ["12-25", "Christmas Day", "National holiday"],
    ["12-26", "Winter break begins", "School holiday"],
  ];
  for (const [mmdd, title, sub] of pairs) {
    out.push({ date: `${year}-${mmdd}`, title, sublabel: sub });
    out.push({ date: `${year + 1}-${mmdd}`, title, sublabel: sub });
  }
  return out;
}

const HOLIDAYS = buildHolidays();

const TYPE_COLORS = {
  Holiday: "rose",
  Event: "violet",
  Exam: "gold",
  Leave: "amber",
};

function getEntries({ from, to } = {}) {
  // Parse range (default = current month + next month to be useful)
  const fromTs = from ? new Date(from).getTime() : Date.now() - 30 * 86400000;
  const toTs = to ? new Date(to).getTime() : Date.now() + 60 * 86400000;

  const inRange = (dateStr) => {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    return !isNaN(t) && t >= fromTs && t <= toTs;
  };

  const out = [];

  // -- Holidays --
  for (const h of HOLIDAYS) {
    if (!inRange(h.date)) continue;
    out.push({
      date: h.date,
      type: "Holiday",
      title: h.title,
      sublabel: h.sublabel,
      link: null,
      color: TYPE_COLORS.Holiday,
      meta: {},
    });
  }

  // -- Events --
  for (const e of eventsData.events()) {
    if (!inRange(e.date)) continue;
    out.push({
      date: e.date,
      type: "Event",
      title: e.title,
      sublabel: `${e.where || "—"} · ${e.category}`,
      link: `/app/events`,
      color: TYPE_COLORS.Event,
      meta: { id: e.id, category: e.category, where: e.where },
    });
  }

  // -- Exam papers (per paper, per grade) --
  for (const exam of examsData.exams) {
    if (exam.status === "Completed") continue;
    for (const paper of exam.papers) {
      if (!inRange(paper.date)) continue;
      out.push({
        date: paper.date,
        type: "Exam",
        title: `${paper.subject} · Grade ${exam.grade}`,
        sublabel: `${exam.name} · ${paper.startTime}–${paper.endTime} · ${paper.room}`,
        link: `/app/exams/${exam.id}`,
        color: TYPE_COLORS.Exam,
        meta: {
          examId: exam.id,
          grade: exam.grade,
          subject: paper.subject,
          startTime: paper.startTime,
          endTime: paper.endTime,
          room: paper.room,
        },
      });
    }
  }

  // -- Approved leave (range entries) --
  for (const l of leaveData.requests()) {
    if (l.status !== "Approved") continue;
    // Walk the range day-by-day so multi-day leaves show on every covered day
    const start = new Date(l.fromDate);
    const end = new Date(l.toDate);
    if (isNaN(start) || isNaN(end)) continue;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (!inRange(dateStr)) continue;
      out.push({
        date: dateStr,
        type: "Leave",
        title: `${l.applicantName} · ${l.type}`,
        sublabel: `${l.applicantType} · ${l.days} day${l.days === 1 ? "" : "s"} ${l.reason ? `· ${l.reason}` : ""}`,
        link: `/app/leave`,
        color: TYPE_COLORS.Leave,
        meta: {
          applicantId: l.applicantId,
          applicantType: l.applicantType,
          fromDate: l.fromDate,
          toDate: l.toDate,
        },
      });
    }
  }

  // Sort by date, then type for stable ordering
  out.sort((a, b) => {
    const t = new Date(a.date) - new Date(b.date);
    if (t !== 0) return t;
    return a.type.localeCompare(b.type);
  });

  return out;
}

function summary({ from, to } = {}) {
  const entries = getEntries({ from, to });
  const counts = { total: entries.length };
  for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
  // Next holiday / next exam — useful for the page header
  const todayTs = Date.now();
  const upcoming = entries.filter((e) => new Date(e.date).getTime() >= todayTs);
  return {
    ...counts,
    nextHoliday: upcoming.find((e) => e.type === "Holiday") || null,
    nextExam: upcoming.find((e) => e.type === "Exam") || null,
    nextEvent: upcoming.find((e) => e.type === "Event") || null,
  };
}

module.exports = {
  TYPE_COLORS,
  getEntries,
  summary,
  holidays: () => HOLIDAYS,
};
