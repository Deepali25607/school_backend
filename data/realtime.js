// Tiny WebSocket broker.
//  - One server on /api/realtime
//  - Clients authenticate via `?token=...` (JWT)
//  - broadcast(event) sends to every connected client
//  - heartbeat ping/pong drops dead connections within ~60s
//
// Pure JS, ~80 LOC, no external deps beyond `ws`.

const { WebSocketServer, WebSocket } = require("ws");
const jwt = require("jsonwebtoken");

const clients = new Set();
let started = false;
let pingTimer = null;

function attach(server, jwtSecret) {
  if (started) return;
  started = true;

  const wss = new WebSocketServer({ server, path: "/api/realtime" });

  wss.on("connection", (ws, req) => {
    let payload = null;
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      payload = jwt.verify(token, jwtSecret);
    } catch (e) {
      ws.close(1008, "unauthorized");
      return;
    }

    ws.isAlive = true;
    ws.meta = { userId: payload.sub, role: payload.role, since: Date.now() };
    clients.add(ws);

    ws.send(
      JSON.stringify({
        type: "hello",
        userId: payload.sub,
        role: payload.role,
        ts: Date.now(),
        connections: clients.size,
      })
    );

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  // heartbeat — terminate dead sockets every 30s
  pingTimer = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(ws);
        continue;
      }
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);

  console.log("[realtime] WebSocket broker live on /api/realtime");
}

function broadcast(event) {
  if (!started || clients.size === 0) return;
  const msg = JSON.stringify({ ts: Date.now(), ...event });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

function stats() {
  return { connections: clients.size, started };
}

// Map a mutation path → semantic event topic.
// Returning null suppresses the broadcast (e.g. for audit-log queries).
function eventTypeFor(path, method) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (path.startsWith("/api/auth/")) return null;
  if (path.startsWith("/api/audit")) return null; // handled separately below
  if (path.startsWith("/api/admin/")) return "admin.changed";
  if (path.startsWith("/api/admissions")) return "admissions.changed";
  if (path.startsWith("/api/students")) return "students.changed";
  if (path.startsWith("/api/teachers")) return "teachers.changed";
  if (path.startsWith("/api/attendance")) return "attendance.changed";
  if (path.startsWith("/api/fees")) return "fees.changed";
  if (path.startsWith("/api/exams") && /\/marks/.test(path)) return "marks.changed";
  if (path.startsWith("/api/timetable")) return "timetable.changed";
  if (path.startsWith("/api/library")) return "library.changed";
  if (path.startsWith("/api/transport")) return "transport.changed";
  if (path.startsWith("/api/hostel")) return "hostel.changed";
  if (path.startsWith("/api/payroll")) return "payroll.changed";
  if (path.startsWith("/api/learning")) return "learning.changed";
  if (path.startsWith("/api/communications")) return "broadcasts.changed";
  if (path.startsWith("/api/events")) return "events.changed";
  if (path.startsWith("/api/inventory")) return "inventory.changed";
  if (path.startsWith("/api/expenses")) return "expenses.changed";
  if (path.startsWith("/api/leave")) return "leave.changed";
  if (path.startsWith("/api/maintenance")) return "maintenance.changed";
  if (path.startsWith("/api/visitors")) return "visitors.changed";
  if (path.startsWith("/api/documents")) return "documents.changed";
  if (path.startsWith("/api/health")) return "health.changed";
  if (path.startsWith("/api/discipline")) return "discipline.changed";
  if (path.startsWith("/api/safe-reports")) return "safe-reports.changed";
  if (path.startsWith("/api/quizzes")) return "quizzes.changed";
  if (path.startsWith("/api/achievements")) return "achievements.changed";
  if (path.startsWith("/api/cafeteria")) return "cafeteria.changed";
  if (path.startsWith("/api/alumni")) return "alumni.changed";
  if (path.startsWith("/api/notices")) return "notices.changed";
  if (path.startsWith("/api/ptm")) return "ptm.changed";
  if (path.startsWith("/api/polls")) return "polls.changed";
  if (path.startsWith("/api/scholarships")) return "scholarships.changed";
  if (path.startsWith("/api/housepoints")) return "housepoints.changed";
  if (path.startsWith("/api/fundraising")) return "fundraising.changed";
  if (path.startsWith("/api/sports")) return "sports.changed";
  if (path.startsWith("/api/careers")) return "careers.changed";
  if (path.startsWith("/api/suggestions")) return "suggestions.changed";
  if (path.startsWith("/api/promotion")) return "promotion.changed";
  if (path.startsWith("/api/substitutes")) return "substitutes.changed";
  if (path.startsWith("/api/staff")) return "staff.changed";
  if (path.startsWith("/api/users")) return "users.changed";
  if (path.startsWith("/api/assignments")) return "assignments.changed";
  if (path.startsWith("/api/messages")) return "messages.changed";
  if (path.startsWith("/api/reports")) return null;
  return null;
}

module.exports = { attach, broadcast, stats, eventTypeFor };
