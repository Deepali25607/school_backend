// Payroll is driven by the staff directory (data/staff.js): every staff member
// carries a salary structure, bank/UPI details and a payment method. This
// module layers the monthly payroll-run workflow (BRD 7.8) on top of that
// roster, and snapshots payslips so historical runs stay immutable.

const store = require("./store");
const staffData = require("./staff");

// Live roster, shaped for the payroll page. Reads current staff payroll.
function roster() {
  return staffData.payrollRoster();
}

function summary() {
  return staffData.payrollSummary();
}

// Expose `staff` as a getter so existing callers (payrollData.staff) keep
// working while the underlying source is now the staff directory.
const api = {
  get staff() {
    return roster();
  },
  summary,
};

// ============ PAYROLL PROCESSING (BRD 7.8) ============
const RUN_STATUSES = ["Draft", "Processed", "Paid"];

let runs = store.load("payroll-runs", () => []);
const persistRuns = () => store.save("payroll-runs", runs);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function payslipFromStaff(s, month) {
  return {
    employeeId: s.id,
    name: s.name,
    role: s.role,
    department: s.department,
    paymentMethod: s.paymentMethod,
    bank: s.bank,
    account: s.account,
    upiId: s.upiId || null,
    month,
    components: { ...s.components },
    deductions: { ...s.deductions },
    gross: s.gross,
    totalDeductions: s.totalDeductions,
    net: s.net,
    paymentRef: null,
    paidOn: null,
  };
}

function runListItem(r) {
  return {
    id: r.id,
    month: r.month,
    status: r.status,
    headcount: r.payslips.length,
    gross: r.totals.gross,
    deductions: r.totals.deductions,
    net: r.totals.net,
    createdOn: r.createdOn,
    processedOn: r.processedOn,
    paidOn: r.paidOn,
  };
}

function listRuns() {
  return [...runs].sort((a, b) => (a.month < b.month ? 1 : -1)).map(runListItem);
}

function getRun(id) {
  const r = runs.find((x) => x.id === id);
  if (!r) throw new Error("Run not found");
  return r;
}

function createRun(month, actor) {
  if (!/^\d{4}-\d{2}$/.test(String(month || "")))
    throw new Error("month must be in YYYY-MM format");
  if (runs.some((r) => r.month === month))
    throw new Error(`A payroll run for ${month} already exists`);
  const employees = roster();
  if (employees.length === 0) throw new Error("No staff with payroll set up yet");
  const payslips = employees.map((s) => payslipFromStaff(s, month));
  const totals = {
    gross: payslips.reduce((a, p) => a + p.gross, 0),
    deductions: payslips.reduce((a, p) => a + p.totalDeductions, 0),
    net: payslips.reduce((a, p) => a + p.net, 0),
  };
  const run = {
    id: `RUN${month.replace("-", "")}`,
    month,
    status: "Draft",
    createdBy: actor || "Admin",
    createdOn: today(),
    processedOn: null,
    paidOn: null,
    payslips,
    totals,
  };
  runs.unshift(run);
  persistRuns();
  return runListItem(run);
}

function processRun(id, actor) {
  const r = getRun(id);
  if (r.status !== "Draft") throw new Error("Only draft runs can be processed");
  r.status = "Processed";
  r.processedBy = actor || "Admin";
  r.processedOn = today();
  persistRuns();
  return runListItem(r);
}

// Pay out a processed run. Each payslip is disbursed via the employee's chosen
// method (bank transfer / cash / UPI) and stamped with a method-specific
// reference.
function payRun(id, actor) {
  const r = getRun(id);
  if (r.status !== "Processed") throw new Error("Only processed runs can be paid");
  r.status = "Paid";
  r.paidBy = actor || "Admin";
  r.paidOn = today();
  const ymd = r.month.replace("-", "");
  r.payslips.forEach((p, i) => {
    p.paidOn = r.paidOn;
    const prefix =
      p.paymentMethod === "Cash" ? "CASH" : p.paymentMethod === "UPI" ? "UPI" : "NEFT";
    p.paymentRef = `${prefix}${ymd}${String(1000 + i)}`;
  });
  // Recover one installment of any outstanding salary advance from each paid
  // employee, so the deduction shown on the payslip is reflected in the ledger.
  staffData.recoverAdvancesForRun(r.payslips.map((p) => p.employeeId), r.id, r.month);
  persistRuns();
  return runListItem(r);
}

function deleteRun(id) {
  const r = getRun(id);
  if (r.status !== "Draft") throw new Error("Only draft runs can be deleted");
  runs = runs.filter((x) => x.id !== id);
  persistRuns();
  return { ok: true };
}

function payslip(runId, employeeId) {
  const r = getRun(runId);
  const p = r.payslips.find((x) => x.employeeId === employeeId);
  if (!p) throw new Error("Payslip not found");
  return { ...p, runId: r.id, runStatus: r.status };
}

// Disbursement report grouped by payment method. Bank transfers carry bank +
// account; UPI carries the VPA; cash is a simple list. Ready for the bank
// portal upload (bank-transfer group) or cash/UPI reconciliation.
function disbursementReport(runId) {
  const r = getRun(runId);
  const groups = {};
  for (const p of r.payslips) {
    const m = p.paymentMethod || "Bank Transfer";
    if (!groups[m]) groups[m] = { method: m, count: 0, total: 0, lines: [] };
    groups[m].count += 1;
    groups[m].total += p.net;
    groups[m].lines.push({
      employeeId: p.employeeId,
      name: p.name,
      amount: p.net,
      ref: p.paymentRef,
      bank: p.bank,
      account: p.account,
      upiId: p.upiId,
    });
  }
  return {
    runId: r.id,
    month: r.month,
    status: r.status,
    grandTotal: r.totals.net,
    methods: Object.values(groups).sort((a, b) => b.total - a.total),
  };
}

module.exports = Object.assign(api, {
  roster,
  summary,
  RUN_STATUSES,
  listRuns,
  getRun,
  createRun,
  processRun,
  payRun,
  deleteRun,
  payslip,
  disbursementReport,
});
