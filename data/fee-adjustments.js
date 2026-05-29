// Fee adjustments — discounts, fines and refunds (BRD 7.7).
// Kept separate from fee-payments.js so the payment/receipt flow stays
// untouched. Each adjustment references a student and carries a type-specific
// workflow status.

const store = require("./store");
const seed = require("./seed");

const TYPES = ["Discount", "Fine", "Refund"];

const REASONS = {
  Discount: ["Sibling", "Merit", "Staff ward", "Need-based", "Early payment"],
  Fine: ["Late fee", "Library overdue", "Property damage", "Other"],
  Refund: ["Overpayment", "Withdrawal", "Cancelled service", "Duplicate payment"],
};

// Allowed statuses per type. The first entry is the initial status on create.
const STATUS_FLOW = {
  Discount: ["Active", "Revoked"],
  Fine: ["Pending", "Paid", "Waived"],
  Refund: ["Requested", "Approved", "Paid", "Rejected"],
};

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function studentName(id) {
  return seed.students.find((s) => s.id === id)?.name || id;
}

function buildSeed() {
  const withStudent = seed.students.slice(0, 8);
  const rows = [
    ["Discount", "Sibling", 6000, "Active", 20],
    ["Discount", "Merit", 10000, "Active", 18],
    ["Fine", "Late fee", 500, "Pending", 3],
    ["Fine", "Library overdue", 120, "Paid", 9],
    ["Fine", "Property damage", 1500, "Pending", 1],
    ["Refund", "Overpayment", 4000, "Approved", 5],
    ["Refund", "Withdrawal", 18000, "Paid", 25],
    ["Discount", "Staff ward", 12000, "Active", 30],
  ];
  return rows.map(([type, reason, amount, status, daysAgo], i) => {
    const stu = withStudent[i % withStudent.length];
    return {
      id: `ADJ${String(6000 + i + 1)}`,
      studentId: stu.id,
      studentName: stu.name,
      type,
      reason,
      amount,
      status,
      note: null,
      createdBy: "Accounts Office",
      createdOn: dateOffset(daysAgo),
      updatedOn: dateOffset(daysAgo),
    };
  });
}

let items = store.load("fee-adjustments", buildSeed);
const persist = () => store.save("fee-adjustments", items);

function list({ type = "all", status = "all", q = "", studentId } = {}) {
  let out = items;
  if (type !== "all") out = out.filter((a) => a.type === type);
  if (status !== "all") out = out.filter((a) => a.status === status);
  if (studentId) out = out.filter((a) => a.studentId === studentId);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (a) =>
        a.studentName.toLowerCase().includes(t) ||
        a.studentId.toLowerCase().includes(t) ||
        a.reason.toLowerCase().includes(t) ||
        a.id.toLowerCase().includes(t)
    );
  }
  return [...out].sort((a, b) => (a.createdOn < b.createdOn ? 1 : -1));
}

function add(payload, actor) {
  const { studentId, type, reason } = payload;
  const amount = Number(payload.amount);
  if (!TYPES.includes(type)) throw new Error("Invalid adjustment type");
  if (!studentId || !seed.students.some((s) => s.id === studentId))
    throw new Error("Valid studentId required");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Amount must be a positive number");
  if (reason && !REASONS[type].includes(reason))
    throw new Error("Invalid reason for this type");
  const now = dateOffset(0);
  const rec = {
    id: `ADJ${String(6000 + items.length + 1)}`,
    studentId,
    studentName: studentName(studentId),
    type,
    reason: reason || REASONS[type][0],
    amount,
    status: STATUS_FLOW[type][0],
    note: payload.note || null,
    createdBy: actor || "Accounts Office",
    createdOn: now,
    updatedOn: now,
  };
  items.unshift(rec);
  persist();
  return rec;
}

function setStatus(id, status) {
  const a = items.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  if (!STATUS_FLOW[a.type].includes(status))
    throw new Error(`Invalid status '${status}' for a ${a.type}`);
  a.status = status;
  a.updatedOn = dateOffset(0);
  persist();
  return a;
}

function remove(id) {
  const exists = items.some((x) => x.id === id);
  if (!exists) throw new Error("Not found");
  items = items.filter((x) => x.id !== id);
  persist();
  return { ok: true };
}

// Net ledger effect for a student:
//   discounts (Active) reduce payable, fines (Pending) increase payable.
// Paid/Waived fines and refunds don't change current outstanding.
function netEffectFor(studentId) {
  const own = items.filter((a) => a.studentId === studentId);
  const discount = own.filter((a) => a.type === "Discount" && a.status === "Active").reduce((s, a) => s + a.amount, 0);
  const fine = own.filter((a) => a.type === "Fine" && a.status === "Pending").reduce((s, a) => s + a.amount, 0);
  return { discount, fine, net: fine - discount, items: own };
}

function summary() {
  const activeDiscounts = items.filter((a) => a.type === "Discount" && a.status === "Active");
  const pendingFines = items.filter((a) => a.type === "Fine" && a.status === "Pending");
  const openRefunds = items.filter((a) => a.type === "Refund" && ["Requested", "Approved"].includes(a.status));
  return {
    discountTotal: activeDiscounts.reduce((s, a) => s + a.amount, 0),
    discountCount: activeDiscounts.length,
    fineOutstanding: pendingFines.reduce((s, a) => s + a.amount, 0),
    fineCount: pendingFines.length,
    refundPending: openRefunds.reduce((s, a) => s + a.amount, 0),
    refundCount: openRefunds.length,
  };
}

module.exports = {
  TYPES,
  REASONS,
  STATUS_FLOW,
  list,
  add,
  setStatus,
  remove,
  netEffectFor,
  summary,
};
