const store = require("./store");

const STAGES = ["Open", "Assigned", "In Progress", "Resolved", "Closed"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const CATEGORIES = [
  "Electrical",
  "Plumbing",
  "Furniture",
  "Computer/IT",
  "Classroom",
  "Transport",
  "HVAC",
  "Cleaning",
];

const TECHNICIANS = [
  { id: "TEC101", name: "Suresh Kumar", skill: "Electrical" },
  { id: "TEC102", name: "Ramesh P.", skill: "Plumbing" },
  { id: "TEC103", name: "Vikram S.", skill: "Computer/IT" },
  { id: "TEC104", name: "Anita K.", skill: "Furniture" },
  { id: "TEC105", name: "Manoj T.", skill: "HVAC" },
  { id: "TEC106", name: "Pooja R.", skill: "Cleaning" },
];

const SEED_TICKETS = [
  // [title, category, priority, location, reportedBy, stageIdx, days_ago, assignedTo, resolutionNote]
  ["Tube light flickering in classroom 7B", "Electrical", "Medium", "Block A · 7B", "Ms. Sara Kapoor", 1, 2, "TEC101", null],
  ["Boys' washroom tap not closing", "Plumbing", "High", "Block B · Ground", "Security desk", 2, 4, "TEC102", null],
  ["Projector won't power on", "Computer/IT", "Critical", "Lab 2", "Marcus Chen", 0, 0, null, null],
  ["Desk hinge broken in 9A", "Furniture", "Low", "Block A · 9A", "Class teacher 9A", 0, 1, null, null],
  ["AC not cooling in staff room", "HVAC", "Medium", "Admin · Staff room", "Principal's office", 3, 8, "TEC105", "Compressor refilled. Monitoring."],
  ["Computer lab WiFi dropping", "Computer/IT", "High", "Block C · Lab 3", "IT Coordinator", 2, 3, "TEC103", null],
  ["Stagnant water near canteen", "Cleaning", "Medium", "Quadrangle", "Hostel warden", 4, 14, "TEC106", "Drainage cleared. Closed."],
  ["School bus #4 brake noise", "Transport", "Critical", "Garage", "Driver Anand", 2, 1, "TEC101", null],
  ["Whiteboard cracked in 11B", "Classroom", "Low", "Block A · 11B", "Karan Mehta", 3, 6, "TEC104", "Replaced. Awaiting feedback."],
  ["Power outage in chemistry lab", "Electrical", "Critical", "Block C · Lab 1", "Dr. Anand Iyer", 3, 10, "TEC101", "Fuse replaced + load rebalanced."],
  ["Leaking ceiling near library", "Plumbing", "High", "Block B · Library entry", "Librarian", 1, 5, "TEC102", null],
  ["AC remote not pairing 12A", "HVAC", "Low", "Block A · 12A", "Diya Patel", 4, 20, "TEC105", "Replaced remote."],
];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildTickets() {
  return SEED_TICKETS.map(([title, category, priority, location, reportedBy, stageIdx, daysAgo, assignedTo, resolutionNote], i) => {
    const stage = STAGES[stageIdx];
    return {
      id: `TKT${String(4000 + i + 1)}`,
      title,
      category,
      priority,
      location,
      reportedBy,
      stage,
      assignedTo,
      reportedOn: dateOffset(daysAgo),
      lastUpdate: dateOffset(Math.max(0, daysAgo - 1)),
      resolutionNote,
      resolvedOn:
        stageIdx >= 3 ? dateOffset(Math.max(0, daysAgo - 2)) : null,
    };
  });
}

let tickets = store.load("maintenance", buildTickets);
const persist = () => store.save("maintenance", tickets);

function add(payload) {
  const t = {
    id: `TKT${String(4000 + tickets.length + 1)}`,
    title: payload.title || "(no title)",
    category: payload.category || "Classroom",
    priority: payload.priority || "Medium",
    location: payload.location || "—",
    reportedBy: payload.reportedBy || "—",
    stage: "Open",
    assignedTo: null,
    reportedOn: dateOffset(0),
    lastUpdate: dateOffset(0),
    resolutionNote: null,
    resolvedOn: null,
  };
  tickets.unshift(t);
  persist();
  return t;
}

function update(id, patch) {
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error("Not found");
  if (patch.stage && !STAGES.includes(patch.stage))
    throw new Error("Invalid stage");
  if (patch.stage) t.stage = patch.stage;
  if (patch.assignedTo !== undefined) {
    t.assignedTo = patch.assignedTo || null;
    if (t.assignedTo && t.stage === "Open") t.stage = "Assigned";
  }
  if (patch.resolutionNote !== undefined) t.resolutionNote = patch.resolutionNote;
  if (t.stage === "Resolved" || t.stage === "Closed") {
    if (!t.resolvedOn) t.resolvedOn = dateOffset(0);
  } else {
    t.resolvedOn = null;
  }
  t.lastUpdate = dateOffset(0);
  persist();
  return t;
}

function summary() {
  const out = { total: tickets.length };
  STAGES.forEach((s) => (out[s] = tickets.filter((t) => t.stage === s).length));
  out.critical = tickets.filter(
    (t) => t.priority === "Critical" && !["Resolved", "Closed"].includes(t.stage)
  ).length;
  return out;
}

module.exports = {
  STAGES,
  PRIORITIES,
  CATEGORIES,
  TECHNICIANS,
  tickets: () => tickets,
  add,
  update,
  summary,
};
