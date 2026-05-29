// Safe-space / anonymous reporting channel.
//
// Students, parents or staff can file a report. If the submitter opts in
// to anonymity, we never persist their userId — only a tracking code that
// they can use to follow the case. Safeguarding leads (admin / principal /
// HR) triage, respond and resolve.
//
// Shape:
//   {
//     id            "SR000123",
//     code          "8K3R-2N9F"   ← public tracking code; shown to reporter
//     category      one of CATEGORIES
//     severity      "low" | "medium" | "high" | "critical"
//     subject       short title
//     description   free-form body
//     anonymous     true if reporterUserId/etc redacted
//     reporterUserId   null when anonymous, otherwise the auth subject
//     reporterRole     mirror of user.role (kept even when anonymous so
//                      counsellors know "a student / parent / staff" submitted —
//                      this is NOT identifying because every role has many users)
//     status        "received" | "investigating" | "resolved" | "closed"
//     responses     [{ id, at, byUserId, byName, byRole, text, audience: "reporter"|"internal" }]
//     statusHistory [{ at, by, fromStatus, toStatus, note }]
//     createdAt
//   }
//
// `responses[]` carries BOTH reporter-visible replies (audience="reporter")
// and internal triage notes (audience="internal"). The public lookup API
// strips the "internal" entries before returning so anonymous reporters
// only see the conversation, not the casework.

const crypto = require("crypto");
const store = require("./store");

const CATEGORIES = [
  "Bullying",
  "Safety concern",
  "Harassment",
  "Mental health",
  "Academic stress",
  "Facilities issue",
  "Other",
];

const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["received", "investigating", "resolved", "closed"];

let reports = store.load("safe-reports", () => []);
const persist = () => store.save("safe-reports", reports);

function nowIso() {
  return new Date().toISOString();
}

function nextId() {
  let max = 0;
  for (const r of reports) {
    const n = parseInt(String(r.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `SR${String(max + 1).padStart(6, "0")}`;
}

// Tracking codes are short, friendly-to-type, and globally unique within
// the file. Format: XXXX-XXXX hex chars uppercase.
function nextCode() {
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    if (!reports.some((r) => r.code === code)) return code;
  }
  // Vanishingly unlikely fallback if we hit eight collisions in a row.
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function find(id) {
  return reports.find((r) => r.id === id) || null;
}

function findByCode(code) {
  if (!code) return null;
  const norm = String(code).trim().toUpperCase();
  return reports.find((r) => r.code === norm) || null;
}

function create({
  category,
  severity = "medium",
  subject,
  description,
  anonymous = false,
  reporter = null,
}) {
  if (!CATEGORIES.includes(category)) throw new Error("Invalid category");
  if (!SEVERITIES.includes(severity)) throw new Error("Invalid severity");
  if (!subject || !String(subject).trim()) throw new Error("Subject is required");
  if (!description || !String(description).trim())
    throw new Error("Description is required");

  const now = nowIso();
  const rec = {
    id: nextId(),
    code: nextCode(),
    category,
    severity,
    subject: String(subject).trim().slice(0, 140),
    description: String(description).trim().slice(0, 4000),
    anonymous: !!anonymous,
    // Only the role lingers when anonymous — never the user id / name.
    reporterRole: reporter?.role || null,
    reporterUserId: anonymous ? null : reporter?.id || null,
    reporterName: anonymous ? null : reporter?.name || null,
    status: "received",
    responses: [],
    statusHistory: [
      {
        at: now,
        by: anonymous ? null : reporter?.id || null,
        byRole: reporter?.role || null,
        fromStatus: null,
        toStatus: "received",
        note: "Filed",
      },
    ],
    createdAt: now,
  };
  reports.unshift(rec);
  persist();
  return rec;
}

function list({ status, category, severity, q } = {}) {
  let out = reports;
  if (status && status !== "all") out = out.filter((r) => r.status === status);
  if (category && category !== "all")
    out = out.filter((r) => r.category === category);
  if (severity && severity !== "all")
    out = out.filter((r) => r.severity === severity);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (r) =>
        r.subject.toLowerCase().includes(t) ||
        r.description.toLowerCase().includes(t) ||
        r.code.toLowerCase().includes(t)
    );
  }
  return out;
}

function summary() {
  const counts = STATUSES.reduce((a, s) => ((a[s] = 0), a), {});
  let critical = 0;
  for (const r of reports) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.severity === "critical" && r.status !== "closed" && r.status !== "resolved")
      critical++;
  }
  return {
    total: reports.length,
    byStatus: counts,
    openCritical: critical,
  };
}

function setStatus(id, nextStatus, by, note) {
  if (!STATUSES.includes(nextStatus)) throw new Error("Invalid status");
  const r = find(id);
  if (!r) throw new Error("Report not found");
  if (r.status === nextStatus) return r;
  r.statusHistory.push({
    at: nowIso(),
    by: by?.id || null,
    byRole: by?.role || null,
    fromStatus: r.status,
    toStatus: nextStatus,
    note: note ? String(note).slice(0, 280) : null,
  });
  r.status = nextStatus;
  persist();
  return r;
}

function addResponse(id, { text, audience, by }) {
  const r = find(id);
  if (!r) throw new Error("Report not found");
  if (!text || !String(text).trim()) throw new Error("Response text is required");
  if (audience !== "reporter" && audience !== "internal")
    throw new Error("audience must be 'reporter' or 'internal'");
  const entry = {
    id: `RSP${String(r.responses.length + 1).padStart(4, "0")}`,
    at: nowIso(),
    byUserId: by?.id || null,
    byName: by?.name || null,
    byRole: by?.role || null,
    text: String(text).trim().slice(0, 4000),
    audience,
  };
  r.responses.push(entry);
  persist();
  return r;
}

/**
 * Strips the internal triage notes and minimal personal-data so the
 * lookup-by-code API safely returns it to whoever has the code.
 */
function publicView(r) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    category: r.category,
    severity: r.severity,
    subject: r.subject,
    description: r.description,
    anonymous: r.anonymous,
    status: r.status,
    createdAt: r.createdAt,
    statusHistory: r.statusHistory.map((h) => ({
      at: h.at,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      byRole: h.byRole,
    })),
    responses: r.responses
      .filter((rsp) => rsp.audience === "reporter")
      .map((rsp) => ({
        id: rsp.id,
        at: rsp.at,
        byName: rsp.byName,
        byRole: rsp.byRole,
        text: rsp.text,
      })),
  };
}

module.exports = {
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  create,
  list,
  find,
  findByCode,
  setStatus,
  addResponse,
  summary,
  publicView,
};
