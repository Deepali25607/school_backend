const CHANNELS = ["SMS", "Email", "Push"];
const AUDIENCES = [
  { key: "all", label: "Everyone", count: 4200 },
  { key: "students", label: "All students", count: 1842 },
  { key: "parents", label: "All parents", count: 1620 },
  { key: "teachers", label: "All teachers", count: 124 },
  { key: "staff", label: "Non-teaching staff", count: 86 },
  { key: "grade-1-5", label: "Grades 1–5", count: 720 },
  { key: "grade-6-10", label: "Grades 6–10", count: 880 },
  { key: "grade-11-12", label: "Grades 11–12", count: 242 },
];

const SAMPLE_BROADCASTS = [
  {
    subject: "Parent–Teacher Meeting reminder",
    body: "Dear parents, the PTM scheduled for this Saturday will be held in two slots…",
    channels: ["SMS", "Email", "Push"],
    audience: "parents",
    sentBy: "Dr. Riya Mehta",
    delta: 14,
  },
  {
    subject: "Mid-term schedule published",
    body: "Mid-term exams for grades 6–10 begin on June 12. Hall tickets available in the portal.",
    channels: ["Email", "Push"],
    audience: "grade-6-10",
    sentBy: "Marcus Chen",
    delta: 27,
  },
  {
    subject: "Bus 12 delayed",
    body: "Bus 12 on route 5 is delayed by 8 minutes today due to traffic.",
    channels: ["SMS", "Push"],
    audience: "parents",
    sentBy: "Operations",
    delta: 80,
  },
  {
    subject: "Annual sports day sign-ups",
    body: "Sign up for track, field & e-sports events. Registrations close Friday.",
    channels: ["Email"],
    audience: "students",
    sentBy: "Dr. Riya Mehta",
    delta: 120,
  },
  {
    subject: "Library digital catalog live",
    body: "Browse, reserve and renew books from the new portal.",
    channels: ["Email", "Push"],
    audience: "all",
    sentBy: "Library Desk",
    delta: 240,
  },
];

let _seq = 1000;
function makeRecord(b, deltaMin) {
  const aud = AUDIENCES.find((a) => a.key === b.audience) || AUDIENCES[0];
  const recipients = aud.count;
  // synthetic stats
  const delivered = Math.floor(recipients * (0.95 + Math.random() * 0.04));
  const opened = Math.floor(delivered * (0.5 + Math.random() * 0.4));
  const failed = recipients - delivered;
  return {
    id: `BRD${++_seq}`,
    subject: b.subject,
    body: b.body,
    channels: b.channels,
    audience: b.audience,
    audienceLabel: aud.label,
    recipients,
    delivered,
    opened,
    failed,
    sentBy: b.sentBy,
    sentAt: new Date(Date.now() - deltaMin * 60_000).toISOString(),
    status: "Sent",
  };
}

const store = require("./store");
let broadcasts = store.load("broadcasts", () =>
  SAMPLE_BROADCASTS.map((b) => makeRecord(b, b.delta))
);
// keep _seq above the largest persisted id
broadcasts.forEach((b) => {
  const n = parseInt(String(b.id).replace(/\D/g, ""), 10);
  if (!Number.isNaN(n) && n > _seq) _seq = n;
});

function send(payload) {
  const rec = makeRecord(
    {
      subject: payload.subject || "(no subject)",
      body: payload.body || "",
      channels: Array.isArray(payload.channels) && payload.channels.length
        ? payload.channels
        : ["Email"],
      audience: payload.audience || "all",
      sentBy: payload.sentBy || "System",
    },
    0
  );
  broadcasts.unshift(rec);
  store.save("broadcasts", broadcasts);
  return rec;
}

module.exports = { CHANNELS, AUDIENCES, broadcasts: () => broadcasts, send };
