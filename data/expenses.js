const store = require("./store");

// BRD 7.17 — Expense Management: entry, approval workflow, vendor payments,
// categorization, monthly reports, budget management.

const CATEGORIES = [
  "Electricity",
  "Water",
  "Internet",
  "Staff Salaries",
  "Maintenance",
  "Transport Fuel",
  "Stationery",
  "Events",
  "Security",
  "Cleaning",
];

// Workflow: Pending → Approved → Paid, or Pending → Rejected.
const STATUSES = ["Pending", "Approved", "Paid", "Rejected"];

const VENDORS = [
  "State Electricity Board",
  "City Water Works",
  "Airtel Business",
  "In-house Payroll",
  "FixIt Facilities",
  "HP Petroleum",
  "EduMart Stationers",
  "BrightEvents Co.",
  "SecureGuard Services",
  "SparkleClean Pvt",
];

// Monthly budget per category (₹). Used for budget-vs-actual reporting.
const DEFAULT_BUDGETS = {
  Electricity: 180000,
  Water: 45000,
  Internet: 35000,
  "Staff Salaries": 3200000,
  Maintenance: 120000,
  "Transport Fuel": 160000,
  Stationery: 60000,
  Events: 150000,
  Security: 110000,
  Cleaning: 70000,
};

function ym(d) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const SEED = [
  // [title, category, vendorIdx, amount, daysAgo, statusIdx, note]
  ["Monthly grid electricity bill", "Electricity", 0, 168400, 4, 2, "Block A–C + hostel"],
  ["Borewell + municipal water", "Water", 1, 38900, 6, 2, null],
  ["Leased line 500 Mbps", "Internet", 2, 32000, 9, 2, null],
  ["April teaching staff salaries", "Staff Salaries", 3, 2980000, 12, 2, "62 staff"],
  ["Roof leak repair — library", "Maintenance", 4, 46500, 3, 1, "Awaiting payment"],
  ["Diesel — bus fleet (10 buses)", "Transport Fuel", 5, 142000, 5, 2, null],
  ["Exam answer sheets + registers", "Stationery", 6, 54300, 7, 1, null],
  ["Annual Day stage & sound", "Events", 7, 138000, 2, 0, "Quote received"],
  ["Security guard contract — Q1", "Security", 8, 102000, 8, 2, null],
  ["Housekeeping — monthly", "Cleaning", 9, 64800, 10, 2, null],
  ["AC servicing — staff rooms", "Maintenance", 4, 28800, 1, 0, "Pending approval"],
  ["Sports day refreshments", "Events", 7, 41200, 0, 0, null],
  ["Printer toner bulk order", "Stationery", 6, 23900, 14, 3, "Cancelled — wrong model"],
];

function buildExpenses() {
  return SEED.map(([title, category, vIdx, amount, daysAgo, statusIdx, note], i) => {
    const status = STATUSES[statusIdx];
    const submittedOn = dateOffset(daysAgo);
    return {
      id: `EXP${String(5000 + i + 1)}`,
      title,
      category,
      vendor: VENDORS[vIdx],
      amount,
      status,
      note: note || null,
      submittedBy: "Accounts Office",
      submittedOn,
      month: submittedOn.slice(0, 7),
      approvedBy: statusIdx >= 1 && statusIdx !== 3 ? "Principal" : null,
      approvedOn: statusIdx >= 1 && statusIdx !== 3 ? dateOffset(Math.max(0, daysAgo - 1)) : null,
      paidOn: status === "Paid" ? dateOffset(Math.max(0, daysAgo - 2)) : null,
      paymentRef: status === "Paid" ? `UTR${hashRef(i)}` : null,
    };
  });
}

function hashRef(i) {
  return String(100000000 + i * 7654321).slice(0, 9);
}

let expenses = store.load("expenses", buildExpenses);
let budgets = store.load("expense-budgets", () => ({ ...DEFAULT_BUDGETS }));
const persist = () => store.save("expenses", expenses);
const persistBudgets = () => store.save("expense-budgets", budgets);

function list({ category = "all", status = "all", month, q = "" } = {}) {
  let out = expenses;
  if (category !== "all") out = out.filter((e) => e.category === category);
  if (status !== "all") out = out.filter((e) => e.status === status);
  if (month) out = out.filter((e) => e.month === month);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (e) =>
        e.title.toLowerCase().includes(t) ||
        e.vendor.toLowerCase().includes(t) ||
        e.id.toLowerCase().includes(t)
    );
  }
  // newest first
  return [...out].sort((a, b) => (a.submittedOn < b.submittedOn ? 1 : -1));
}

function add(payload) {
  const amount = Number(payload.amount);
  if (!payload.title || !String(payload.title).trim())
    throw new Error("Title is required");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Amount must be a positive number");
  if (payload.category && !CATEGORIES.includes(payload.category))
    throw new Error("Invalid category");
  const submittedOn = dateOffset(0);
  const e = {
    id: `EXP${String(5000 + expenses.length + 1)}`,
    title: String(payload.title).trim(),
    category: payload.category || "Maintenance",
    vendor: payload.vendor || "—",
    amount,
    status: "Pending",
    note: payload.note || null,
    submittedBy: payload.submittedBy || "Accounts Office",
    submittedOn,
    month: submittedOn.slice(0, 7),
    approvedBy: null,
    approvedOn: null,
    paidOn: null,
    paymentRef: null,
  };
  expenses.unshift(e);
  persist();
  return e;
}

// Advance an expense through the approval / payment workflow.
function setStatus(id, status, actor, paymentRef) {
  const e = expenses.find((x) => x.id === id);
  if (!e) throw new Error("Not found");
  if (!STATUSES.includes(status)) throw new Error("Invalid status");

  if (status === "Approved") {
    if (e.status !== "Pending") throw new Error("Only pending expenses can be approved");
    e.status = "Approved";
    e.approvedBy = actor || "Admin";
    e.approvedOn = dateOffset(0);
  } else if (status === "Rejected") {
    if (e.status === "Paid") throw new Error("Paid expenses cannot be rejected");
    e.status = "Rejected";
    e.approvedBy = actor || "Admin";
    e.approvedOn = dateOffset(0);
    e.paidOn = null;
    e.paymentRef = null;
  } else if (status === "Paid") {
    if (e.status !== "Approved") throw new Error("Only approved expenses can be paid");
    e.status = "Paid";
    e.paidOn = dateOffset(0);
    e.paymentRef = paymentRef || `UTR${Date.now().toString().slice(-9)}`;
  } else if (status === "Pending") {
    e.status = "Pending";
    e.approvedBy = null;
    e.approvedOn = null;
    e.paidOn = null;
    e.paymentRef = null;
  }
  persist();
  return e;
}

function setBudget(category, amount) {
  if (!CATEGORIES.includes(category)) throw new Error("Invalid category");
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error("Budget must be a non-negative number");
  budgets[category] = n;
  persistBudgets();
  return { category, amount: n };
}

function summary() {
  const thisMonth = ym(new Date());
  const totalPaid = expenses.filter((e) => e.status === "Paid").reduce((a, e) => a + e.amount, 0);
  const pendingCount = expenses.filter((e) => e.status === "Pending").length;
  const pendingValue = expenses.filter((e) => e.status === "Pending").reduce((a, e) => a + e.amount, 0);
  const approvedUnpaid = expenses
    .filter((e) => e.status === "Approved")
    .reduce((a, e) => a + e.amount, 0);
  const monthSpend = expenses
    .filter((e) => e.month === thisMonth && e.status !== "Rejected")
    .reduce((a, e) => a + e.amount, 0);
  const monthBudget = Object.values(budgets).reduce((a, b) => a + b, 0);
  return {
    totalPaid,
    pendingCount,
    pendingValue,
    approvedUnpaid,
    monthSpend,
    monthBudget,
    month: thisMonth,
  };
}

// Monthly report: per-category actual (non-rejected) vs budget, plus totals.
function monthlyReport(month) {
  const m = month || ym(new Date());
  const rows = CATEGORIES.map((category) => {
    const items = expenses.filter((e) => e.month === m && e.category === category && e.status !== "Rejected");
    const actual = items.reduce((a, e) => a + e.amount, 0);
    const budget = budgets[category] || 0;
    return {
      category,
      budget,
      actual,
      variance: budget - actual,
      count: items.length,
    };
  });
  return {
    month: m,
    rows,
    totals: {
      budget: rows.reduce((a, r) => a + r.budget, 0),
      actual: rows.reduce((a, r) => a + r.actual, 0),
      variance: rows.reduce((a, r) => a + r.variance, 0),
    },
  };
}

// Distinct months present in the data (newest first) for the report selector.
function months() {
  return [...new Set(expenses.map((e) => e.month))].sort().reverse();
}

module.exports = {
  CATEGORIES,
  STATUSES,
  VENDORS,
  list,
  add,
  setStatus,
  setBudget,
  budgets: () => budgets,
  summary,
  monthlyReport,
  months,
};
