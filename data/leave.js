const store = require("./store");

const TYPES = [
  "Sick", "Casual", "Earned", "Maternity", "Personal", "Study",
];
const STATUSES = ["Pending", "Approved", "Rejected"];

function dateOffset(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildRequests() {
  const list = [];
  let id = 1;
  const seeds = [
    // applicant info               type        from  to    status      reason
    ["STU1003", "student", "Aarav Sharma",      "Sick",     -2, 0,   "Pending",  "Viral fever — doctor's note attached"],
    ["STU1011", "student", "Diya Iyer",         "Personal", 3, 4,    "Pending",  "Family wedding"],
    ["STU1017", "student", "Reyansh Khan",      "Sick",     -5, -3,  "Approved", "Recovered from flu"],
    ["STU1024", "student", "Aanya Patel",       "Personal", -10, -8, "Approved", "Sister's marriage"],
    ["STU1030", "student", "Vihaan Verma",      "Sick",     -1, -1,  "Approved", "Dental procedure"],
    ["STU1038", "student", "Saanvi Reddy",      "Personal", 5, 7,    "Pending",  "Out of town with parents"],
    ["TCH103",  "teacher", "Marcus Chen",       "Earned",   2, 6,    "Pending",  "Pre-planned vacation"],
    ["TCH109",  "teacher", "Priya Verma",       "Sick",     0, 0,    "Approved", "Cold + headache"],
    ["TCH118",  "teacher", "Sara Kapoor",       "Earned",   -4, -2,  "Approved", "Annual leave"],
    ["TCH122",  "teacher", "Karan Mehta",       "Study",    10, 15,  "Pending",  "Workshop on STEM pedagogy"],
    ["TCH107",  "teacher", "Dr. Anand Iyer",    "Casual",   1, 1,    "Rejected", "Short-notice conflict with exam"],
    ["STU1045", "student", "Krishna Joshi",     "Personal", -12, -12,"Rejected", "Insufficient notice"],
  ];
  for (const [appId, appType, name, type, fromOff, toOff, status, reason] of seeds) {
    const fn = name.split(" ")[0];
    const ln = name.split(" ").slice(-1)[0];
    list.push({
      id: `LV${1000 + id++}`,
      applicantId: appId,
      applicantType: appType,
      applicantName: name,
      avatar: (fn[0] + (ln[0] || "?")).toUpperCase(),
      type,
      fromDate: dateOffset(fromOff),
      toDate: dateOffset(toOff),
      days: Math.max(1, toOff - fromOff + 1),
      reason,
      status,
      appliedOn: dateOffset(fromOff - 2),
      decidedBy: status === "Pending" ? null : "Dr. Riya Mehta",
      decidedOn: status === "Pending" ? null : dateOffset(fromOff - 1),
    });
  }
  return list;
}

let requests = store.load("leave-requests", buildRequests);
const persist = () => store.save("leave-requests", requests);

function add(payload) {
  const fn = (payload.applicantName || "").split(" ")[0] || "?";
  const ln = (payload.applicantName || "").split(" ").slice(-1)[0] || "?";
  const days =
    payload.fromDate && payload.toDate
      ? Math.max(
          1,
          Math.round(
            (new Date(payload.toDate) - new Date(payload.fromDate)) / 86400000
          ) + 1
        )
      : 1;
  const rec = {
    id: `LV${1000 + requests.length + 1}`,
    applicantId: payload.applicantId || "—",
    applicantType: payload.applicantType || "student",
    applicantName: payload.applicantName || "Unknown",
    avatar: (fn[0] + ln[0]).toUpperCase(),
    type: payload.type || "Casual",
    fromDate: payload.fromDate || dateOffset(0),
    toDate: payload.toDate || dateOffset(0),
    days,
    reason: payload.reason || "",
    status: "Pending",
    appliedOn: dateOffset(0),
    decidedBy: null,
    decidedOn: null,
  };
  requests.unshift(rec);
  persist();
  return rec;
}

function decide(id, status, decidedBy) {
  if (!["Approved", "Rejected"].includes(status))
    throw new Error("Invalid status");
  const r = requests.find((x) => x.id === id);
  if (!r) throw new Error("Not found");
  r.status = status;
  r.decidedBy = decidedBy || "Admin";
  r.decidedOn = dateOffset(0);
  persist();
  return r;
}

function summary() {
  return {
    pending: requests.filter((r) => r.status === "Pending").length,
    approved: requests.filter((r) => r.status === "Approved").length,
    rejected: requests.filter((r) => r.status === "Rejected").length,
    total: requests.length,
  };
}

module.exports = { TYPES, STATUSES, requests: () => requests, add, decide, summary };
