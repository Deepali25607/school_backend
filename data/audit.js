const store = require("./store");

const MAX_ENTRIES = 2000;

// Endpoints whose mutation noise we don't need in the audit log.
const SKIP = [
  /^\/api\/auth\/me$/,
  /^\/api\/admin\/backup$/,
  /^\/api\/dashboard\//,
  // pure reads are excluded via method filter — keep this for read-with-side-effect
];

let entries = store.load("audit-log", () => []);
let nextId = entries.length
  ? Math.max(...entries.map((e) => parseInt(e.id.slice(2), 10))) + 1
  : 1;

function record({ userId, userName, role, method, path, status, durationMs, summary, ip }) {
  const entry = {
    id: `AU${String(nextId++).padStart(6, "0")}`,
    at: new Date().toISOString(),
    userId: userId || null,
    userName: userName || "anonymous",
    role: role || "anonymous",
    method,
    path,
    status,
    durationMs,
    summary: summary || null,
    ip: ip || null,
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  store.save("audit-log", entries);
  return entry;
}

function shouldSkip(path, method) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (SKIP.some((re) => re.test(path))) return true;
  return false;
}

function list({ q = "", method = "all", role = "all", status = "all" } = {}) {
  let out = entries;
  if (method !== "all") out = out.filter((e) => e.method === method);
  if (role !== "all") out = out.filter((e) => e.role === role);
  if (status !== "all") {
    if (status === "ok") out = out.filter((e) => e.status >= 200 && e.status < 300);
    else if (status === "error") out = out.filter((e) => e.status >= 400);
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (e) =>
        e.path.toLowerCase().includes(t) ||
        (e.userName || "").toLowerCase().includes(t) ||
        (e.summary || "").toLowerCase().includes(t)
    );
  }
  return out;
}

function summary() {
  const now = Date.now();
  const last24h = entries.filter(
    (e) => now - new Date(e.at).getTime() < 86_400_000
  );
  return {
    total: entries.length,
    last24h: last24h.length,
    failures: entries.filter((e) => e.status >= 400).length,
    actors: new Set(entries.map((e) => e.userId).filter(Boolean)).size,
  };
}

module.exports = { record, shouldSkip, list, summary, MAX_ENTRIES };
