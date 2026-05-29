// Notifications log — a rolling list of "interesting" things that have
// happened in the system that users should know about.
//
// Design:
//   - The audit middleware calls `recordFromEvent(...)` for every mutation,
//     and this module decides whether the event is worth surfacing as a
//     notification (most aren't — `GET`s and noisy writes are filtered out).
//   - Read state is per-user (Set of userIds in `readBy`).
//   - Persists to disk, capped at MAX entries to keep file size bounded.

const store = require("./store");

const MAX = 500;

const SEVERITIES = ["info", "success", "warning", "alert"];

// Per-type audience class. Drives the /api/notifications scope filter:
//   "all"    → every authed user can see it (broadcasts, events, generic)
//   "staff"  → admin / principal / teacher / hr / accountant only
//   "owners" → only users related to the notification.studentId
//              (the student themselves, their linked parents, or teachers
//              of their classes — staff with fullView still see it)
const TYPE_AUDIENCE = {
  "admissions.new": "staff",
  "admissions.enrolled": "staff",
  "admissions.rejected": "staff",
  "maintenance.critical": "staff",
  "maintenance.resolved": "staff",
  "visitors.checkin": "staff",
  "documents.requested": "owners",
  "documents.issued": "owners",
  "leave.applied": "staff",
  "leave.decided": "staff",
  "broadcasts.sent": "all",
  "health.urgent": "owners",
  "inventory.lowstock": "staff",
  "discipline.major": "owners",
  "discipline.escalated": "owners",
  "achievement.added": "owners",
  "events.added": "all",
  "fees.recorded": "owners",
  "fees.payment": "owners",
  "fees.failed": "owners",
};

// type → { severity, icon, link, summarise(payload) } meta
// (icon strings are lucide-react component names — the frontend looks them up)
const TYPE_META = {
  "admissions.new": {
    severity: "info",
    icon: "UserPlus",
    link: "/app/admissions",
    titleFor: (e) => `New admission · ${e.title || "Applicant"}`,
  },
  "admissions.enrolled": {
    severity: "success",
    icon: "GraduationCap",
    link: "/app/admissions",
    titleFor: (e) => `Enrolled · ${e.title || "Student"}`,
  },
  "admissions.rejected": {
    severity: "warning",
    icon: "UserPlus",
    link: "/app/admissions",
    titleFor: (e) => `Application rejected · ${e.title || ""}`,
  },
  "maintenance.critical": {
    severity: "alert",
    icon: "AlertOctagon",
    link: "/app/maintenance",
    titleFor: (e) => `Critical maintenance · ${e.title || ""}`,
  },
  "maintenance.resolved": {
    severity: "success",
    icon: "Wrench",
    link: "/app/maintenance",
    titleFor: (e) => `Ticket resolved · ${e.title || ""}`,
  },
  "visitors.checkin": {
    severity: "info",
    icon: "IdCard",
    link: "/app/visitors",
    titleFor: (e) => `Visitor arrived · ${e.title || ""}`,
  },
  "documents.requested": {
    severity: "info",
    icon: "FileText",
    link: "/app/documents",
    titleFor: (e) => `Document requested · ${e.title || ""}`,
  },
  "documents.issued": {
    severity: "success",
    icon: "BadgeCheck",
    link: "/app/documents",
    titleFor: (e) => `Document issued · ${e.title || ""}`,
  },
  "leave.applied": {
    severity: "info",
    icon: "ClipboardCheck",
    link: "/app/leave",
    titleFor: (e) => `Leave applied · ${e.title || ""}`,
  },
  "leave.decided": {
    severity: "info",
    icon: "ClipboardCheck",
    link: "/app/leave",
    titleFor: (e) => `Leave ${e.statusLabel || "decided"} · ${e.title || ""}`,
  },
  "broadcasts.sent": {
    severity: "info",
    icon: "Megaphone",
    link: "/app/communications",
    titleFor: (e) => `Announcement · ${e.title || ""}`,
  },
  "health.urgent": {
    severity: "alert",
    icon: "HeartPulse",
    link: "/app/health",
    titleFor: (e) => `Urgent sickbay visit · ${e.title || ""}`,
  },
  "inventory.lowstock": {
    severity: "warning",
    icon: "Package",
    link: "/app/inventory",
    titleFor: (e) => `Low stock · ${e.title || ""}`,
  },
  "discipline.major": {
    severity: "alert",
    icon: "ShieldAlert",
    link: "/app/discipline",
    titleFor: (e) => `Major incident · ${e.title || ""}`,
  },
  "discipline.escalated": {
    severity: "alert",
    icon: "ShieldAlert",
    link: "/app/discipline",
    titleFor: (e) => `Escalated · ${e.title || ""}`,
  },
  "achievement.added": {
    severity: "success",
    icon: "Trophy",
    link: "/app/achievements",
    titleFor: (e) => `Achievement · ${e.title || ""}`,
  },
  "events.added": {
    severity: "info",
    icon: "Calendar",
    link: "/app/events",
    titleFor: (e) => `New event · ${e.title || ""}`,
  },
  "fees.recorded": {
    severity: "success",
    icon: "Wallet",
    link: "/app/fees",
    titleFor: (e) => `Fee recorded · ${e.title || ""}`,
  },
  "fees.payment": {
    severity: "success",
    icon: "Wallet",
    link: "/app/fees",
    titleFor: (e) => `Payment received · ${e.title || ""}`,
  },
  "fees.failed": {
    severity: "warning",
    icon: "Wallet",
    link: "/app/fees",
    titleFor: (e) => `Payment failed · ${e.title || ""}`,
  },
};

function buildSeed() {
  // Seed with a few diverse notifications so the UI isn't empty on first run
  return [
    seedNotif({
      type: "admissions.new",
      title: "Anaya Khan",
      body: "Applied for Grade 7 — auto-routed to Interview stage",
      minutesAgo: 8,
    }),
    seedNotif({
      type: "maintenance.critical",
      title: "Projector won't power on (Lab 2)",
      body: "Marcus Chen reported · awaiting assignment",
      minutesAgo: 22,
    }),
    seedNotif({
      type: "documents.issued",
      title: "Bonafide for Tara Patel",
      body: "Certificate LUM/BONAFIDE/2026/1000 issued by Principal's Office",
      minutesAgo: 45,
    }),
    seedNotif({
      type: "broadcasts.sent",
      title: "Parent–Teacher meeting Saturday",
      body: "Sent to 12 audiences via Email + SMS",
      minutesAgo: 95,
    }),
    seedNotif({
      type: "visitors.checkin",
      title: "Mr. Ramesh Iyer",
      body: "Here to meet HR · Pass V-1042",
      minutesAgo: 130,
    }),
    seedNotif({
      type: "health.urgent",
      title: "Dhruv Bose · Nausea",
      body: "Urgent severity logged by Nurse on duty",
      minutesAgo: 240,
    }),
    seedNotif({
      type: "leave.decided",
      title: "Suresh Kumar · Approved",
      body: "HR approved 2-day casual leave",
      minutesAgo: 410,
      statusLabel: "approved",
    }),
  ];
}

function seedNotif({ type, title, body, minutesAgo, statusLabel }) {
  const meta = TYPE_META[type] || {};
  const id =
    "NTF" +
    String(9000 + Math.floor(Math.random() * 999)).padStart(4, "0") +
    Math.random().toString(36).slice(2, 5);
  return {
    id,
    type,
    title: meta.titleFor ? meta.titleFor({ title, statusLabel }) : title,
    body,
    severity: meta.severity || "info",
    icon: meta.icon || "Bell",
    link: meta.link || null,
    ts: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    readBy: [],
  };
}

let items = store.load("notifications", buildSeed);
// Sanity: ensure readBy is always an array (older saves may be missing it),
// and forward-fill audience + studentId so the visibility filter has data.
items = items.map((n) => ({
  ...n,
  readBy: Array.isArray(n.readBy) ? n.readBy : [],
  audience: n.audience || TYPE_AUDIENCE[n.type] || "all",
  studentId: n.studentId || null,
}));
const persist = () => store.save("notifications", items);

let nextSeq = items.length;
function nextId() {
  nextSeq++;
  return `NTF${String(9000 + nextSeq).padStart(4, "0")}`;
}

/** Manually push a notification (used by background jobs / cron). */
function record({ type, title, body, link, severity, icon, studentId }) {
  const meta = TYPE_META[type] || {};
  const n = {
    id: nextId(),
    type,
    title: title || (meta.titleFor && meta.titleFor({})) || "Notification",
    body: body || "",
    severity: severity || meta.severity || "info",
    icon: icon || meta.icon || "Bell",
    link: link || meta.link || null,
    studentId: studentId || null,
    audience: TYPE_AUDIENCE[type] || "all",
    ts: new Date().toISOString(),
    readBy: [],
  };
  items.unshift(n);
  if (items.length > MAX) items = items.slice(0, MAX);
  persist();
  return n;
}

/** Filter the audit-middleware mutation into a notification (or null to skip). */
function recordFromEvent({ method, path, statusCode, body, user, response }) {
  if (statusCode < 200 || statusCode >= 400) return null;
  if (method === "GET" || method === "HEAD") return null;

  const u = user?.email || user?.role || "system";

  // /api/admissions  POST   → new applicant
  if (path === "/api/admissions" && method === "POST") {
    const name = response?.name || body?.name || "Applicant";
    return record({
      type: "admissions.new",
      title: `New admission · ${name}`,
      body: `Auto-routed by ${u}`,
    });
  }
  // /api/admissions/:id/move  PATCH  → stage transition (Enrolled/Rejected only)
  if (/^\/api\/admissions\/[^/]+\/move$/.test(path) && method === "PATCH") {
    const stage = body?.stage || response?.stage;
    if (stage === "Enrolled" || stage === "Rejected") {
      return record({
        type: stage === "Enrolled" ? "admissions.enrolled" : "admissions.rejected",
        title: `${stage} · ${response?.name || ""}`,
        body: `${u} moved this application to ${stage}`,
      });
    }
    return null;
  }
  // /api/maintenance POST → only notify if Critical
  if (path === "/api/maintenance" && method === "POST") {
    if (response?.priority === "Critical") {
      return record({
        type: "maintenance.critical",
        title: `Critical · ${response.title}`,
        body: `${response.location} · reported by ${response.reportedBy}`,
      });
    }
    return null;
  }
  // /api/maintenance/:id PATCH → notify only on Resolved / Closed transitions
  if (/^\/api\/maintenance\/[^/]+$/.test(path) && method === "PATCH") {
    const stage = body?.stage;
    if (stage === "Resolved" || stage === "Closed") {
      return record({
        type: "maintenance.resolved",
        title: `Resolved · ${response?.title || ""}`,
        body: `${u} marked ${response?.id} as ${stage}`,
      });
    }
    return null;
  }
  // /api/visitors POST → new check-in
  if (path === "/api/visitors" && method === "POST") {
    return record({
      type: "visitors.checkin",
      title: `Visitor · ${response?.name || ""}`,
      body: `Here to meet ${response?.host || "—"} · pass ${response?.pass || "?"}`,
    });
  }
  // /api/documents POST → request
  if (path === "/api/documents" && method === "POST") {
    return record({
      type: "documents.requested",
      title: `Requested · ${response?.type || "Document"}`,
      body: `For ${response?.studentId} · purpose: ${response?.purpose || "—"}`,
      studentId: response?.studentId || null,
    });
  }
  // /api/documents/:id PATCH → notify on Issued/Rejected
  if (/^\/api\/documents\/[^/]+$/.test(path) && method === "PATCH") {
    const status = body?.status || response?.status;
    if (status === "Issued") {
      return record({
        type: "documents.issued",
        title: `Issued · ${response?.type}`,
        body: `${response?.certificateNo || ""} for ${response?.studentId}`,
        studentId: response?.studentId || null,
      });
    }
    return null;
  }
  // /api/leave POST → new application
  if (path === "/api/leave" && method === "POST") {
    return record({
      type: "leave.applied",
      title: `Leave applied · ${response?.name || ""}`,
      body: `${response?.kind || "Leave"} · ${response?.from} → ${response?.to}`,
    });
  }
  // /api/leave/:id PATCH → decided
  if (/^\/api\/leave\/[^/]+$/.test(path) && method === "PATCH") {
    const s = body?.status;
    if (s === "Approved" || s === "Rejected") {
      return record({
        type: "leave.decided",
        title: `Leave ${s.toLowerCase()} · ${response?.name || ""}`,
        body: `${u} ${s.toLowerCase()} the request`,
      });
    }
    return null;
  }
  // /api/communications/broadcasts POST → new broadcast
  if (path === "/api/communications/broadcasts" && method === "POST") {
    return record({
      type: "broadcasts.sent",
      title: `Announcement · ${response?.subject || ""}`,
      body: `Sent to ${response?.audienceLabel || "selected audiences"}`,
    });
  }
  // /api/health/visits POST → urgent only
  if (path === "/api/health/visits" && method === "POST") {
    if (response?.severity === "Urgent") {
      return record({
        type: "health.urgent",
        title: `Urgent sickbay · ${response.studentId}`,
        body: `${response.complaint} · attended by ${response.attendedBy}`,
        studentId: response.studentId || null,
      });
    }
    return null;
  }
  // /api/events POST → new event
  if (path === "/api/events" && method === "POST") {
    return record({
      type: "events.added",
      title: `New event · ${response?.title || ""}`,
      body: `${response?.date} · ${response?.where || ""}`,
    });
  }
  // /api/inventory/:id/adjust → trigger lowstock when crossing threshold
  if (/^\/api\/inventory\/[^/]+\/adjust$/.test(path) && method === "POST") {
    if (response && response.qty <= response.reorder) {
      return record({
        type: "inventory.lowstock",
        title: `Low stock · ${response.name}`,
        body: `Only ${response.qty} left (reorder at ${response.reorder})`,
      });
    }
    return null;
  }
  // /api/discipline POST → notify only on Major severity
  if (path === "/api/discipline" && method === "POST") {
    if (response?.severity === "Major") {
      return record({
        type: "discipline.major",
        title: `Major · ${response.studentId} · ${response.category}`,
        body: response.description,
        studentId: response.studentId || null,
      });
    }
    return null;
  }
  // /api/fees/payments POST → notify on success and failure
  if (path === "/api/fees/payments" && method === "POST") {
    const r = response || {};
    if (r.status === "Success") {
      return record({
        type: "fees.payment",
        title: `${r.studentId} · ₹${(r.amount || 0).toLocaleString()}`,
        body: `${r.mode} · ${r.receiptNo || ""}`,
        studentId: r.studentId || null,
      });
    } else if (r.status === "Failed") {
      return record({
        type: "fees.failed",
        title: `${r.studentId} · ₹${(r.amount || 0).toLocaleString()}`,
        body: `${r.mode} declined`,
        studentId: r.studentId || null,
      });
    }
    return null;
  }
  // /api/discipline/:id PATCH → notify on Escalated transitions
  if (/^\/api\/discipline\/[^/]+$/.test(path) && method === "PATCH") {
    if (body?.status === "Escalated") {
      return record({
        type: "discipline.escalated",
        title: `Escalated · ${response?.studentId} · ${response?.category}`,
        body: response?.description || "",
        studentId: response?.studentId || null,
      });
    }
    return null;
  }
  // /api/achievements POST → notify only on State+ level wins (1st/2nd/3rd)
  if (path === "/api/achievements" && method === "POST") {
    const r = response || {};
    const significantLevel =
      r.level === "State" ||
      r.level === "National" ||
      r.level === "International";
    const podium = r.position === "1st" || r.position === "2nd" || r.position === "3rd";
    if (significantLevel && podium) {
      return record({
        type: "achievement.added",
        title: `${r.position} · ${r.studentId} · ${r.category}`,
        body: `${r.event} (${r.level} level)`,
        studentId: r.studentId || null,
      });
    }
    return null;
  }
  return null;
}

// Visibility check: given a notification and a caller's view (role +
// allowedStudentIds Set), should this notification be shown?
//   - role admin/principal/hr/accountant (fullView) → see everything
//   - audience "all"    → everyone sees it
//   - audience "staff"  → admin/principal/teacher/hr/accountant only
//   - audience "owners" → only callers whose scope includes n.studentId
function isVisibleTo(n, view) {
  if (!view) return true;
  if (view.fullView) return true;
  const aud = n.audience || TYPE_AUDIENCE[n.type] || "all";
  if (aud === "all") return true;
  if (aud === "staff") {
    return ["teacher", "hr", "accountant"].includes(view.role);
  }
  if (aud === "owners") {
    if (!n.studentId) return false; // owners-audience with no student tag → hide
    return view.studentIds?.has(n.studentId) || false;
  }
  return false;
}

function list({ userId, view, limit = 50, unread = false, type = "all" } = {}) {
  let res = items.slice();
  if (view) res = res.filter((n) => isVisibleTo(n, view));
  if (type && type !== "all") res = res.filter((n) => n.type === type);
  if (unread && userId) res = res.filter((n) => !n.readBy.includes(userId));
  res = res.slice(0, Number(limit) || 50);
  if (userId) {
    res = res.map((n) => ({ ...n, read: n.readBy.includes(userId) }));
  }
  return res;
}

function unreadCount(userId, view) {
  if (!userId) return items.length;
  return items.filter(
    (n) => isVisibleTo(n, view) && !n.readBy.includes(userId)
  ).length;
}

function markRead(id, userId) {
  const n = items.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  if (!n.readBy.includes(userId)) {
    n.readBy.push(userId);
    persist();
  }
  return { ...n, read: true };
}

function markAllRead(userId) {
  let changed = 0;
  for (const n of items) {
    if (!n.readBy.includes(userId)) {
      n.readBy.push(userId);
      changed++;
    }
  }
  if (changed) persist();
  return { changed };
}

module.exports = {
  TYPE_META,
  list,
  unreadCount,
  markRead,
  markAllRead,
  record,
  recordFromEvent,
};
