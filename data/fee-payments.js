// Fee payments & receipts.
//
// Two responsibilities:
//   1. Compute each student's expected fees by component (tuition, transport,
//      hostel, exam, library) — driven by grade and a per-component table.
//   2. Track payment transactions and generate receipt numbers.
//
// The student's `feeStatus` field (existing on the seed) is updated as
// payments are recorded so the ledger view stays consistent.

const store = require("./store");
const seed = require("./seed");

const PAYMENT_MODES = [
  "UPI",
  "Card",
  "Net Banking",
  "Cash",
  "Cheque",
];

const PAYMENT_STATUSES = ["Success", "Pending", "Failed"];

// Fee components per term (annual) — grade-dependent
// These represent ANNUAL totals per component. The fee status field on the
// seed (`Paid` / `Partial` / `Pending`) drives the initial outstanding.
function annualFeesFor(grade) {
  const base = 35000 + grade * 1500; // tuition rises with grade
  return {
    tuition: base,
    transport: 12000,
    hostel: 0, // overridden per student if they have a hostel assignment
    exam: 3000 + grade * 200,
    library: 1500,
  };
}

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function newReceiptNo(seq) {
  const yr = new Date().getFullYear();
  return `RCP/${yr}/${String(1000 + seq).padStart(5, "0")}`;
}

// Build initial payment history. Students with status "Paid" or "Partial"
// have at least one historical payment so the ledger ties out.
function buildSeed() {
  const out = [];
  let seq = 1;
  for (const s of seed.students) {
    const fees = annualFeesFor(s.grade);
    const total =
      fees.tuition + fees.transport + fees.exam + fees.library + fees.hostel;
    if (s.feeStatus === "Paid") {
      out.push({
        id: `PAY${String(3000 + seq).padStart(5, "0")}`,
        studentId: s.id,
        amount: total,
        mode: PAYMENT_MODES[hash(s.id, "mode") % PAYMENT_MODES.length],
        paidOn: dateOffset(30 + (hash(s.id, "d") % 120)),
        receiptNo: newReceiptNo(seq++),
        breakdown: { ...fees },
        paidBy: s.parent,
        txnRef: `TXN${hash(s.id, "txn") % 10000000}`,
        status: "Success",
        notes: "Full annual payment received",
      });
    } else if (s.feeStatus === "Partial") {
      const half = Math.floor(total / 2);
      out.push({
        id: `PAY${String(3000 + seq).padStart(5, "0")}`,
        studentId: s.id,
        amount: half,
        mode: PAYMENT_MODES[hash(s.id, "mode") % PAYMENT_MODES.length],
        paidOn: dateOffset(60 + (hash(s.id, "d") % 90)),
        receiptNo: newReceiptNo(seq++),
        breakdown: {
          tuition: Math.floor(fees.tuition / 2),
          transport: 0,
          hostel: 0,
          exam: 0,
          library: 0,
        },
        paidBy: s.parent,
        txnRef: `TXN${hash(s.id, "txn") % 10000000}`,
        status: "Success",
        notes: "First installment",
      });
    }
  }
  return out.sort((a, b) => new Date(b.paidOn) - new Date(a.paidOn));
}

let payments = store.load("fee-payments", buildSeed);
const persist = () => store.save("fee-payments", payments);

// Pending payment orders — Razorpay-style two-step flow. The parent (or
// other authed user) creates an order; the mock "gateway" then captures it
// which materialises into an actual Payment record above. Pending orders
// expire after ORDER_TTL_MS so a parent who closes the modal mid-flow
// doesn't leave hanging orders that block re-paying.
let orders = store.load("fee-orders", () => []);
const persistOrders = () => store.save("fee-orders", orders);
const ORDER_TTL_MS = 15 * 60 * 1000;

const ORDER_STATUSES = ["pending", "captured", "failed", "cancelled", "expired"];

function nextOrderId() {
  let max = 0;
  for (const o of orders) {
    const n = parseInt(String(o.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ORD${String(max + 1).padStart(6, "0")}`;
}

// Mark stale pending orders as expired. Called on every read path so the
// status is always up-to-date without a background sweeper.
function expireStaleOrders() {
  const now = Date.now();
  let changed = false;
  for (const o of orders) {
    if (o.status === "pending" && new Date(o.expiresAt).getTime() < now) {
      o.status = "expired";
      changed = true;
    }
  }
  if (changed) persistOrders();
}

function createOrder(payload, user) {
  if (!payload.studentId) throw new Error("studentId required");
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) throw new Error("Valid amount required");
  if (amount > 10_00_000) throw new Error("Amount exceeds single-payment limit");
  if (payload.mode && !PAYMENT_MODES.includes(payload.mode))
    throw new Error("Invalid payment mode");
  const student = seed.students.find((s) => s.id === payload.studentId);
  if (!student) throw new Error("Student not found");

  // Don't allow a second pending order for the same student+amount inside
  // the TTL — protect against accidental double-creation when a user
  // double-clicks "Pay Now".
  expireStaleOrders();
  const dup = orders.find(
    (o) =>
      o.status === "pending" &&
      o.studentId === student.id &&
      o.amount === amount
  );
  if (dup) return dup;

  const now = Date.now();
  const order = {
    id: nextOrderId(),
    studentId: student.id,
    amount,
    mode: payload.mode || "UPI",
    breakdown:
      payload.breakdown && typeof payload.breakdown === "object"
        ? payload.breakdown
        : { tuition: amount },
    notes: payload.notes || null,
    paidBy: payload.paidBy || student.parent || user?.name || "—",
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ORDER_TTL_MS).toISOString(),
    createdBy: user?.sub || user?.id || null,
    capturedAt: null,
    paymentId: null,
    gatewayRefId: null,
  };
  orders.unshift(order);
  persistOrders();
  return order;
}

function getOrder(orderId) {
  expireStaleOrders();
  return orders.find((o) => o.id === orderId) || null;
}

function listOrders({ studentId, status } = {}) {
  expireStaleOrders();
  let out = orders.slice();
  if (studentId) out = out.filter((o) => o.studentId === studentId);
  if (status) out = out.filter((o) => o.status === status);
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Capture an order — simulates the gateway success callback. In a real
// integration this would verify a signed payload (Razorpay's hmac of
// order_id|payment_id with the key secret). Here we accept an optional
// gatewayRefId or generate one; if `forceFail` is true we route through the
// failure path for testing.
function captureOrder(orderId, { gatewayRefId, forceFail } = {}) {
  expireStaleOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "captured")
    throw new Error("Order has already been captured");
  if (order.status !== "pending")
    throw new Error(`Order is ${order.status}`);

  const ref =
    gatewayRefId ||
    `pay_${(hash(order.id, Date.now()) % 1e10).toString(36)}`;

  if (forceFail) {
    order.status = "failed";
    order.gatewayRefId = ref;
    persistOrders();
    return { order, payment: null };
  }

  // Create the Payment record by reusing recordPayment with status forced
  // to Success — this is the gateway-confirmed path, no probabilistic
  // success/fail simulation.
  const payment = recordPayment({
    studentId: order.studentId,
    amount: order.amount,
    mode: order.mode,
    breakdown: order.breakdown,
    paidBy: order.paidBy,
    notes: order.notes,
    txnRef: ref,
    status: "Success",
  });

  order.status = "captured";
  order.capturedAt = new Date().toISOString();
  order.paymentId = payment.id;
  order.gatewayRefId = ref;
  persistOrders();
  return { order, payment };
}

function cancelOrder(orderId) {
  expireStaleOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "pending")
    throw new Error(`Cannot cancel an order in status ${order.status}`);
  order.status = "cancelled";
  persistOrders();
  return order;
}

function nextSeq() {
  return payments.length + 1;
}

function listPayments({ q, mode, status, studentId, sinceDays } = {}) {
  let out = payments.slice();
  if (mode && mode !== "all") out = out.filter((p) => p.mode === mode);
  if (status && status !== "all") out = out.filter((p) => p.status === status);
  if (studentId) out = out.filter((p) => p.studentId === studentId);
  if (sinceDays) {
    const cutoff = Date.now() - Number(sinceDays) * 86400000;
    out = out.filter((p) => new Date(p.paidOn).getTime() >= cutoff);
  }
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (p) =>
        p.id.toLowerCase().includes(t) ||
        p.studentId.toLowerCase().includes(t) ||
        p.receiptNo.toLowerCase().includes(t) ||
        (p.txnRef || "").toLowerCase().includes(t)
    );
  }
  return out;
}

function getPayment(id) {
  return payments.find((p) => p.id === id) || null;
}

function studentBilling(student) {
  if (!student) return null;
  const fees = annualFeesFor(student.grade);
  const totalExpected =
    fees.tuition + fees.transport + fees.exam + fees.library + fees.hostel;
  const own = payments
    .filter((p) => p.studentId === student.id && p.status === "Success")
    .sort((a, b) => new Date(b.paidOn) - new Date(a.paidOn));
  const totalPaid = own.reduce((a, p) => a + p.amount, 0);
  const outstanding = Math.max(0, totalExpected - totalPaid);
  let status;
  if (outstanding === 0 && totalPaid > 0) status = "Paid";
  else if (totalPaid > 0) status = "Partial";
  else status = "Pending";
  return {
    structure: fees,
    totalExpected,
    totalPaid,
    outstanding,
    status,
    payments: own,
  };
}

function recordPayment(payload) {
  if (!payload.studentId) throw new Error("studentId required");
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) throw new Error("Valid amount required");
  if (payload.mode && !PAYMENT_MODES.includes(payload.mode))
    throw new Error("Invalid payment mode");

  const student = seed.students.find((s) => s.id === payload.studentId);
  if (!student) throw new Error("Student not found");

  // Simulate gateway — small chance to land "Pending" or "Failed" for non-cash,
  // but default to Success. The frontend can also pass `status` explicitly.
  let status = payload.status;
  if (!status) {
    if (payload.mode === "Cash" || payload.mode === "Cheque") {
      status = "Success";
    } else {
      const roll = hash(student.id, Date.now()) % 100;
      // 92% success / 5% pending / 3% failed for realism
      status = roll < 92 ? "Success" : roll < 97 ? "Pending" : "Failed";
    }
  }

  const seq = nextSeq();
  const rec = {
    id: `PAY${String(3000 + seq).padStart(5, "0")}`,
    studentId: student.id,
    amount,
    mode: payload.mode || "UPI",
    paidOn: new Date().toISOString(),
    receiptNo: status === "Success" ? newReceiptNo(seq) : null,
    breakdown:
      payload.breakdown && typeof payload.breakdown === "object"
        ? payload.breakdown
        : { tuition: amount },
    paidBy: payload.paidBy || student.parent || "—",
    txnRef:
      payload.txnRef ||
      `TXN${(hash(student.id, Date.now()) % 10000000)
        .toString()
        .padStart(7, "0")}`,
    status,
    notes: payload.notes || null,
  };
  payments.unshift(rec);
  persist();

  // Update the student's feeStatus to reflect the new state.
  if (status === "Success") {
    const billing = studentBilling(student);
    student.feeStatus = billing.status;
  }

  return rec;
}

function summary() {
  const today = new Date().toISOString().slice(0, 10);
  const last7 = Date.now() - 7 * 86400000;
  const success = payments.filter((p) => p.status === "Success");
  const pending = payments.filter((p) => p.status === "Pending");
  const failed = payments.filter((p) => p.status === "Failed");
  return {
    total: payments.length,
    success: success.length,
    pending: pending.length,
    failed: failed.length,
    todayCount: payments.filter(
      (p) => p.paidOn.slice(0, 10) === today && p.status === "Success"
    ).length,
    todayAmount: payments
      .filter(
        (p) => p.paidOn.slice(0, 10) === today && p.status === "Success"
      )
      .reduce((a, p) => a + p.amount, 0),
    last7dAmount: success
      .filter((p) => new Date(p.paidOn).getTime() >= last7)
      .reduce((a, p) => a + p.amount, 0),
    totalCollected: success.reduce((a, p) => a + p.amount, 0),
    byMode: PAYMENT_MODES.reduce((acc, m) => {
      acc[m] = success.filter((p) => p.mode === m).length;
      return acc;
    }, {}),
  };
}

module.exports = {
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  ORDER_STATUSES,
  ORDER_TTL_MS,
  annualFeesFor,
  listPayments,
  getPayment,
  studentBilling,
  recordPayment,
  summary,
  payments: () => payments,
  // order/capture flow
  createOrder,
  getOrder,
  listOrders,
  captureOrder,
  cancelOrder,
};
