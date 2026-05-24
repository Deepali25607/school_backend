// Student documents & certificates — Transfer Certificates, Bonafide letters,
// Character certificates, ID cards. Each "request" walks through a small state
// machine (Requested → Approved → Issued / Rejected) so the office can track
// what's outstanding and who issued what.
//
// Persistence model: same as other modules — file-backed JSON via data/store.

const store = require("./store");

const TYPES = [
  {
    code: "TC",
    label: "Transfer Certificate",
    description: "Issued when a student leaves the school",
    icon: "ArrowRightLeft",
    requiresReason: true,
  },
  {
    code: "BONAFIDE",
    label: "Bonafide Certificate",
    description: "Proof of current enrollment — for visa, bank, scholarship",
    icon: "BadgeCheck",
    requiresReason: true,
  },
  {
    code: "CHARACTER",
    label: "Character Certificate",
    description: "Conduct certificate for higher studies / job",
    icon: "Award",
    requiresReason: false,
  },
  {
    code: "ID_CARD",
    label: "ID Card",
    description: "Photo identification card for the current session",
    icon: "IdCard",
    requiresReason: false,
  },
];

const STATUSES = ["Requested", "Approved", "Issued", "Rejected"];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Pull a few sample requests so the page isn't blank on first run.
function buildSeed() {
  const seedStudents = ["STU1001", "STU1004", "STU1007", "STU1012", "STU1019", "STU1025"];
  const samples = [
    { studentId: seedStudents[0], type: "BONAFIDE", status: "Issued", purpose: "Passport application", daysAgo: 12, issuedDays: 9 },
    { studentId: seedStudents[1], type: "ID_CARD", status: "Issued", purpose: "Lost previous card", daysAgo: 21, issuedDays: 18 },
    { studentId: seedStudents[2], type: "CHARACTER", status: "Approved", purpose: "College admission", daysAgo: 4, issuedDays: null },
    { studentId: seedStudents[3], type: "BONAFIDE", status: "Requested", purpose: "Bank account opening", daysAgo: 1, issuedDays: null },
    { studentId: seedStudents[4], type: "TC", status: "Rejected", purpose: "Withdrawal", daysAgo: 30, issuedDays: null, reason: "Outstanding fee balance" },
    { studentId: seedStudents[5], type: "ID_CARD", status: "Requested", purpose: "First-year issue", daysAgo: 0, issuedDays: null },
  ];
  return samples.map((s, i) => ({
    id: `DOC${String(7000 + i + 1)}`,
    studentId: s.studentId,
    type: s.type,
    status: s.status,
    purpose: s.purpose,
    requestedOn: dateOffset(s.daysAgo),
    issuedOn: s.issuedDays !== null ? dateOffset(s.issuedDays) : null,
    issuedBy: s.issuedDays !== null ? "Principal's Office" : null,
    certificateNo:
      s.status === "Issued"
        ? `LUM/${s.type}/${new Date().getFullYear()}/${String(1000 + i)}`
        : null,
    rejectionReason: s.reason || null,
    notes: null,
  }));
}

let docs = store.load("documents", buildSeed);
const persist = () => store.save("documents", docs);

function nextId() {
  return `DOC${String(7000 + docs.length + 1)}`;
}

function add(payload) {
  if (!payload.studentId) throw new Error("studentId required");
  if (!payload.type || !TYPES.find((t) => t.code === payload.type))
    throw new Error("Invalid document type");
  const d = {
    id: nextId(),
    studentId: payload.studentId,
    type: payload.type,
    status: "Requested",
    purpose: payload.purpose || "—",
    requestedOn: dateOffset(0),
    issuedOn: null,
    issuedBy: null,
    certificateNo: null,
    rejectionReason: null,
    notes: payload.notes || null,
  };
  docs.unshift(d);
  persist();
  return d;
}

function updateStatus(id, patch, actor) {
  const d = docs.find((x) => x.id === id);
  if (!d) throw new Error("Not found");
  if (patch.status) {
    if (!STATUSES.includes(patch.status)) throw new Error("Invalid status");
    d.status = patch.status;
    if (patch.status === "Issued") {
      d.issuedOn = dateOffset(0);
      d.issuedBy = actor || "Principal's Office";
      if (!d.certificateNo) {
        d.certificateNo = `LUM/${d.type}/${new Date().getFullYear()}/${String(1000 + docs.indexOf(d))}`;
      }
    } else if (patch.status === "Rejected") {
      d.rejectionReason = patch.reason || "Not specified";
      d.issuedOn = null;
      d.certificateNo = null;
    } else if (patch.status === "Requested" || patch.status === "Approved") {
      // moving backwards — clear issuance metadata
      if (patch.status === "Requested") {
        d.issuedOn = null;
        d.certificateNo = null;
        d.issuedBy = null;
      }
    }
  }
  if (patch.notes !== undefined) d.notes = patch.notes;
  persist();
  return d;
}

function get(id) {
  return docs.find((d) => d.id === id) || null;
}

function summary() {
  const out = { total: docs.length };
  STATUSES.forEach((s) => (out[s] = docs.filter((d) => d.status === s).length));
  out.pending = out.Requested + out.Approved;
  return out;
}

module.exports = {
  TYPES,
  STATUSES,
  docs: () => docs,
  get,
  add,
  updateStatus,
  summary,
};
