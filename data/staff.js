// Staff Directory — every non-faculty staff member with a full profile.
//
// This is deliberately separate from the Teachers module: teachers carry
// academic-specific fields (subject, classes-per-week, rating). Everyone else
// who works at the school — accountants, drivers, security, maintenance, lab
// assistants, the IT desk, the nurse, the receptionist — lives here.
//
// Each record has a category that drives the colored chip on the directory
// card, and a free-text designation for the actual job title.

const store = require("./store");

const CATEGORIES = [
  "Academic Support",
  "Finance",
  "Administration",
  "Operations",
  "Transport",
  "Security",
  "Maintenance",
  "IT",
  "Medical",
  "HR",
  "Other",
];

const STATUSES = ["Active", "On leave", "Resigned", "Probation"];

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Intern"];

// Payroll: how each staff member's salary is paid out (BRD 7.8 / 7.7).
const PAYMENT_METHODS = ["Bank Transfer", "Cash", "UPI"];
const BANKS = ["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank", "Kotak Mahindra"];

const DESIGNATIONS_BY_CATEGORY = {
  "Academic Support": ["Lab Assistant", "Librarian", "Sports Coach", "Music Teacher", "Special Educator"],
  Finance: ["Senior Accountant", "Junior Accountant", "Fee Collector", "Auditor"],
  Administration: ["Receptionist", "Office Assistant", "Records Officer", "Coordinator"],
  Operations: ["Operations Manager", "Facility Supervisor", "Inventory Manager"],
  Transport: ["Senior Driver", "Driver", "Bus Helper", "Transport Coordinator"],
  Security: ["Head of Security", "Security Guard", "Gate Officer"],
  Maintenance: ["Electrician", "Plumber", "Gardener", "Carpenter", "Painter"],
  IT: ["IT Manager", "System Admin", "Network Engineer", "Helpdesk"],
  Medical: ["School Nurse", "First-Aid Officer", "Counsellor"],
  HR: ["HR Manager", "HR Executive", "Recruiter"],
  Other: ["General Staff"],
};

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, ...parts) {
  return arr[hash(...parts) % arr.length];
}

const FIRST_NAMES = [
  "Anand", "Suresh", "Mahesh", "Vijay", "Rajan", "Kishore", "Pankaj", "Hari",
  "Sunita", "Pooja", "Asha", "Ramesh", "Rajesh", "Deepak", "Ankur", "Sanjay",
  "Geeta", "Lata", "Neha", "Priya", "Vikram", "Manoj", "Arvind", "Kavita",
];
const LAST_NAMES = [
  "Rao", "Iyer", "Patel", "Singh", "Sharma", "Verma", "Mehta", "Kumar",
  "Nair", "Joshi", "Reddy", "Khan", "Bose", "Gupta", "Chowdhury",
];

const ADDRESSES = [
  "5th Cross, Indiranagar", "Banashankari 3rd Stage", "HSR Layout Sector 4",
  "Whitefield · ITPL Main", "BTM Layout · 2nd Stage", "Koramangala · 5th Block",
  "Jayanagar · 9th Block", "Marathahalli · ECC Road", "Hebbal · CBI Road",
  "Yelahanka New Town", "Kalyan Nagar · HRBR", "Electronic City Phase 1",
];

function avatarFromName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  const a = (parts[0] || "?")[0];
  const b = (parts[parts.length - 1] || "?")[0];
  return ((a || "?") + (b || "?")).toUpperCase();
}

function seedDateAgo(years, months) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Build a full salary structure from a headline monthly salary. `base` tracks
// the headline figure; allowances/deductions are derived with conventional
// Indian-payroll ratios (HRA 40%, PF 12%, ESI for low earners, TDS slab).
function buildPayrollFor(salary, i) {
  const base = Math.max(0, Math.round(Number(salary) || 25000));
  const hra = Math.round(base * 0.4);
  const transport = 2400;
  const special = Math.round(base * 0.1);
  const overtime = i % 3 === 0 ? 2000 : 0;
  const bonus = i % 5 === 0 ? 3000 : 0;
  const pf = Math.round(base * 0.12);
  const esi = base < 25000 ? Math.round((base + hra + transport + special) * 0.0075) : 0;
  const tax = base > 50000 ? Math.round((base - 50000) * 0.1) : 0;
  const loan = i % 7 === 0 ? 2500 : 0;
  // Mostly bank transfers, with a realistic mix of UPI and cash for variety.
  const method = i % 4 === 0 ? "UPI" : i % 9 === 0 ? "Cash" : "Bank Transfer";
  const slug = String(i);
  return {
    paymentMethod: method,
    bank: method === "Bank Transfer" ? BANKS[i % BANKS.length] : null,
    account: method === "Bank Transfer" ? `XXXX${String(1000 + ((i * 91 + 7) % 8999)).slice(-4)}` : null,
    upiId: method === "UPI" ? `pay${slug}${(hash("upi", i) % 9000) + 1000}@okicici` : null,
    components: { base, hra, transport, special, overtime, bonus },
    // `advance` is the monthly recovery of any outstanding salary advance; it is
    // derived from the advances ledger (see below), not edited directly.
    deductions: { pf, esi, tax, loan, advance: 0 },
  };
}

function computePayroll(p) {
  const c = p.components || {};
  const d = p.deductions || {};
  const gross =
    (c.base || 0) + (c.hra || 0) + (c.transport || 0) + (c.special || 0) + (c.overtime || 0) + (c.bonus || 0);
  const totalDeductions =
    (d.pf || 0) + (d.esi || 0) + (d.tax || 0) + (d.loan || 0) + (d.advance || 0);
  return { ...p, gross, totalDeductions, net: gross - totalDeductions };
}

function withPayroll(s) {
  if (!s) return s;
  if (!s.payroll) return { ...s, payroll: null };
  return { ...s, payroll: { ...computePayroll(s.payroll), advances: advanceSummary(s.id) } };
}

function buildSeed() {
  // Curated mix so every category has a few members.
  const seed = [
    // ---- Finance ----
    { cat: "Finance", des: "Senior Accountant", name: "Sofia Reyes", yrs: 8, salary: 75000, gender: "F" },
    { cat: "Finance", des: "Junior Accountant", name: "Ankur Singh", yrs: 2, salary: 38000 },
    { cat: "Finance", des: "Fee Collector", name: "Pooja Rao", yrs: 4, salary: 32000, gender: "F" },
    // ---- Administration ----
    { cat: "Administration", des: "Receptionist", name: "Neha Kapoor", yrs: 3, salary: 28000, gender: "F" },
    { cat: "Administration", des: "Office Assistant", name: "Arvind Joshi", yrs: 6, salary: 30000 },
    { cat: "Administration", des: "Records Officer", name: "Geeta Iyer", yrs: 12, salary: 48000, gender: "F" },
    // ---- Operations ----
    { cat: "Operations", des: "Operations Manager", name: "Sanjay Verma", yrs: 11, salary: 95000 },
    { cat: "Operations", des: "Facility Supervisor", name: "Vikram Bose", yrs: 7, salary: 52000 },
    // ---- Transport ----
    { cat: "Transport", des: "Senior Driver", name: "Anand Rao", yrs: 15, salary: 35000 },
    { cat: "Transport", des: "Driver", name: "Suresh Kumar", yrs: 6, salary: 28000 },
    { cat: "Transport", des: "Driver", name: "Mahesh Patel", yrs: 4, salary: 26000 },
    { cat: "Transport", des: "Bus Helper", name: "Ramesh Singh", yrs: 9, salary: 18000 },
    // ---- Security ----
    { cat: "Security", des: "Head of Security", name: "Vijay Sharma", yrs: 10, salary: 42000 },
    { cat: "Security", des: "Security Guard", name: "Rajan Mehta", yrs: 5, salary: 22000 },
    { cat: "Security", des: "Gate Officer", name: "Kishore Nair", yrs: 3, salary: 20000 },
    // ---- Maintenance ----
    { cat: "Maintenance", des: "Electrician", name: "Pankaj Reddy", yrs: 8, salary: 32000 },
    { cat: "Maintenance", des: "Plumber", name: "Hari Khan", yrs: 5, salary: 28000 },
    { cat: "Maintenance", des: "Gardener", name: "Manoj Gupta", yrs: 14, salary: 22000 },
    // ---- IT ----
    { cat: "IT", des: "IT Manager", name: "Deepak Chowdhury", yrs: 9, salary: 88000 },
    { cat: "IT", des: "Helpdesk", name: "Priya Bose", yrs: 2, salary: 35000, gender: "F", emp: "Contract" },
    // ---- Medical ----
    { cat: "Medical", des: "School Nurse", name: "Sunita Joshi", yrs: 11, salary: 55000, gender: "F" },
    { cat: "Medical", des: "Counsellor", name: "Lata Sharma", yrs: 7, salary: 62000, gender: "F", emp: "Part-time" },
    // ---- Academic Support ----
    { cat: "Academic Support", des: "Lab Assistant", name: "Asha Verma", yrs: 6, salary: 30000, gender: "F" },
    { cat: "Academic Support", des: "Librarian", name: "Rajesh Iyer", yrs: 13, salary: 48000 },
    { cat: "Academic Support", des: "Sports Coach", name: "Kavita Patel", yrs: 4, salary: 38000, gender: "F" },
    // ---- HR ----
    { cat: "HR", des: "HR Manager", name: "Ken Tanaka", yrs: 10, salary: 92000 },
    { cat: "HR", des: "HR Executive", name: "Neha Reddy", yrs: 3, salary: 42000, gender: "F" },
  ];

  return seed.map((row, i) => {
    const id = `STF${String(2000 + i + 1)}`;
    const employeeCode = `EMP-${String(1000 + i + 1).padStart(4, "0")}`;
    const yrsMonths = hash("jm", i) % 12;
    const joinedOn = seedDateAgo(row.yrs, yrsMonths);
    const namePart = row.name.toLowerCase().replace(/[^a-z]+/g, ".");
    return {
      id,
      employeeCode,
      name: row.name,
      avatar: avatarFromName(row.name),
      category: row.cat,
      designation: row.des,
      department: row.cat,
      email: `${namePart}@lumina.edu`,
      phone: `+91 9${(80000000 + hash("ph", i) % 19999999).toString().slice(0, 9)}`,
      joinedOn,
      status: hash("st", i) % 100 < 8 ? "On leave" : "Active",
      employmentType: row.emp || (hash("etp", i) % 100 < 12 ? "Contract" : "Full-time"),
      salary: row.salary,
      gender: row.gender || (hash("g", i) % 2 === 0 ? "M" : "F"),
      address: pick(ADDRESSES, "addr", i),
      emergencyContact: {
        name: `${pick(FIRST_NAMES, "ec", i)} ${pick(LAST_NAMES, "ecl", i)}`,
        relation: ["Spouse", "Parent", "Sibling", "Friend"][hash("er", i) % 4],
        phone: `+91 9${(70000000 + hash("ecp", i) % 19999999).toString().slice(0, 9)}`,
      },
      payroll: buildPayrollFor(row.salary, i),
      notes: null,
    };
  });
}

let items = store.load("staff", buildSeed);
const persist = () => store.save("staff", items);

// Backfill payroll for staff records seeded before payroll support existed.
let _payrollBackfilled = false;
items.forEach((s, i) => {
  if (!s.payroll) {
    s.payroll = buildPayrollFor(s.salary, i);
    _payrollBackfilled = true;
  }
});
if (_payrollBackfilled) persist();

// ---- helpers ----

function nextId() {
  let max = 2000;
  for (const s of items) {
    const n = parseInt(String(s.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `STF${max + 1}`;
}

function nextEmpCode() {
  let max = 1000;
  for (const s of items) {
    const n = parseInt(String(s.employeeCode || "").replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}

function validate(payload, { partial = false } = {}) {
  if (payload.photoUrl !== undefined) {
    const v = payload.photoUrl;
    if (v !== null && v !== "") {
      if (typeof v !== "string")
        throw new Error("photoUrl must be a string");
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v))
        throw new Error("photoUrl must be a data:image/... base64 URL");
      if (v.length > 256 * 1024)
        throw new Error("photoUrl too large (max 256 KB)");
    }
  }
  if (!partial) {
    if (!payload.name || !String(payload.name).trim())
      throw new Error("name required");
    if (!payload.category) throw new Error("category required");
    if (!payload.designation) throw new Error("designation required");
  }
  if (payload.category !== undefined && !CATEGORIES.includes(payload.category))
    throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  if (payload.status !== undefined && !STATUSES.includes(payload.status))
    throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  if (
    payload.employmentType !== undefined &&
    !EMPLOYMENT_TYPES.includes(payload.employmentType)
  )
    throw new Error(
      `employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}`
    );
  if (payload.salary !== undefined && payload.salary !== null) {
    const n = Number(payload.salary);
    if (!Number.isFinite(n) || n < 0 || n > 10000000)
      throw new Error("salary must be 0-10000000");
  }
  if (
    payload.joinedOn !== undefined &&
    payload.joinedOn !== null &&
    payload.joinedOn !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.joinedOn)
  )
    throw new Error("joinedOn must be YYYY-MM-DD");
  if (payload.email !== undefined && payload.email !== null && payload.email !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))
      throw new Error("email is invalid");
  }
}

// ---- list / read ----

function list({ q, category, status, employmentType, sort = "name" } = {}) {
  let out = items.slice();
  if (category && category !== "all")
    out = out.filter((s) => s.category === category);
  if (status && status !== "all")
    out = out.filter((s) => s.status === status);
  if (employmentType && employmentType !== "all")
    out = out.filter((s) => s.employmentType === employmentType);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (s) =>
        s.name.toLowerCase().includes(t) ||
        s.id.toLowerCase().includes(t) ||
        (s.employeeCode || "").toLowerCase().includes(t) ||
        s.designation.toLowerCase().includes(t) ||
        (s.email || "").toLowerCase().includes(t) ||
        (s.phone || "").toLowerCase().includes(t)
    );
  }
  if (sort === "joined")
    out.sort((a, b) => (b.joinedOn || "").localeCompare(a.joinedOn || ""));
  else if (sort === "salary")
    out.sort((a, b) => (Number(b.salary) || 0) - (Number(a.salary) || 0));
  else out.sort((a, b) => a.name.localeCompare(b.name));
  return out.map(withPayroll);
}

function get(id) {
  const s = items.find((s) => s.id === id);
  return s ? withPayroll(s) : null;
}

function summary() {
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  let active = 0;
  let onLeave = 0;
  let payroll = 0;
  for (const s of items) {
    byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    if (s.status === "Active") active++;
    if (s.status === "On leave") onLeave++;
    payroll += Number(s.salary) || 0;
  }
  return {
    total: items.length,
    active,
    onLeave,
    payroll,
    byCategory,
  };
}

// ---- mutations ----

function add(payload, user) {
  validate(payload);
  const name = String(payload.name).trim();
  const rec = {
    id: nextId(),
    employeeCode: payload.employeeCode || nextEmpCode(),
    name,
    avatar: avatarFromName(name),
    category: payload.category,
    designation: String(payload.designation).trim(),
    department: payload.department || payload.category,
    email: payload.email || null,
    phone: payload.phone || null,
    joinedOn: payload.joinedOn || new Date().toISOString().slice(0, 10),
    status: payload.status || "Active",
    employmentType: payload.employmentType || "Full-time",
    salary: payload.salary !== undefined ? Number(payload.salary) : null,
    gender: payload.gender || null,
    address: payload.address || null,
    emergencyContact: payload.emergencyContact || null,
    notes: payload.notes || null,
    photoUrl: payload.photoUrl || null,
    createdAt: new Date().toISOString(),
    createdBy: user?.name || "system",
  };
  items.unshift(rec);
  persist();
  return rec;
}

const ALLOWED_FIELDS = [
  "name",
  "category",
  "designation",
  "department",
  "email",
  "phone",
  "joinedOn",
  "status",
  "employmentType",
  "salary",
  "gender",
  "address",
  "emergencyContact",
  "notes",
  "photoUrl",
];

function update(id, patch) {
  const s = items.find((x) => x.id === id);
  if (!s) throw new Error("Staff not found");
  validate(patch, { partial: true });
  for (const k of ALLOWED_FIELDS) {
    if (patch[k] === undefined) continue;
    if (k === "salary") s[k] = patch[k] === null ? null : Number(patch[k]);
    else s[k] = patch[k];
  }
  if (patch.name !== undefined) {
    s.name = String(patch.name).trim();
    s.avatar = avatarFromName(s.name);
  }
  persist();
  return s;
}

function remove(id) {
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Staff not found");
  const [removed] = items.splice(idx, 1);
  persist();
  return removed;
}

// ---- payroll maintenance (BRD 7.8) ----

function sanitizeAmounts(obj, allowed) {
  const out = {};
  for (const k of allowed) {
    if (obj[k] === undefined) continue;
    const n = Number(obj[k]);
    if (!Number.isFinite(n) || n < 0 || n > 10000000)
      throw new Error(`${k} must be a number between 0 and 1,00,00,000`);
    out[k] = Math.round(n);
  }
  return out;
}

const COMPONENT_FIELDS = ["base", "hra", "transport", "special", "overtime", "bonus"];
const DEDUCTION_FIELDS = ["pf", "esi", "tax", "loan"];

// Maintain ONE staff member's payroll. Editing `base` keeps the headline
// `salary` field in sync so the directory card stays consistent.
function updatePayroll(id, patch) {
  const s = items.find((x) => x.id === id);
  if (!s) throw new Error("Staff not found");
  const p = s.payroll || buildPayrollFor(s.salary, 0);
  if (patch.components) p.components = { ...p.components, ...sanitizeAmounts(patch.components, COMPONENT_FIELDS) };
  if (patch.deductions) p.deductions = { ...p.deductions, ...sanitizeAmounts(patch.deductions, DEDUCTION_FIELDS) };
  if (patch.paymentMethod !== undefined) {
    if (!PAYMENT_METHODS.includes(patch.paymentMethod))
      throw new Error(`paymentMethod must be one of ${PAYMENT_METHODS.join(", ")}`);
    p.paymentMethod = patch.paymentMethod;
  }
  if (patch.bank !== undefined) p.bank = patch.bank || null;
  if (patch.account !== undefined) p.account = patch.account ? String(patch.account).trim() : null;
  if (patch.upiId !== undefined) p.upiId = patch.upiId ? String(patch.upiId).trim() : null;
  s.payroll = p;
  s.salary = p.components.base;
  persist();
  return withPayroll(s);
}

// Maintain payroll for MANY staff at once (BRD: mass payroll feature).
// actions: raisePercent (value=%), setBonus (value=₹), setMethod (value=method).
function bulkUpdatePayroll({ ids, category, action, value }) {
  const targets = items.filter((s) => {
    if (Array.isArray(ids) && ids.length) return ids.includes(s.id);
    if (category && category !== "all") return s.category === category;
    return true;
  });
  if (targets.length === 0) throw new Error("No staff matched the selection");
  for (const s of targets) {
    if (!s.payroll) s.payroll = buildPayrollFor(s.salary, 0);
    const p = s.payroll;
    if (action === "raisePercent") {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct < -100 || pct > 200)
        throw new Error("Increment % must be between -100 and 200");
      p.components.base = Math.round(p.components.base * (1 + pct / 100));
      p.components.hra = Math.round(p.components.base * 0.4);
      p.components.special = Math.round(p.components.base * 0.1);
      p.deductions.pf = Math.round(p.components.base * 0.12);
      s.salary = p.components.base;
    } else if (action === "setBonus") {
      const b = Number(value);
      if (!Number.isFinite(b) || b < 0) throw new Error("Bonus must be a non-negative number");
      p.components.bonus = Math.round(b);
    } else if (action === "setMethod") {
      if (!PAYMENT_METHODS.includes(value))
        throw new Error(`method must be one of ${PAYMENT_METHODS.join(", ")}`);
      p.paymentMethod = value;
    } else {
      throw new Error("Unknown bulk action");
    }
  }
  persist();
  return { updated: targets.length, action };
}

// ---- salary advances (BRD 7.8) ----
// A salary advance is a lump sum paid out to a staff member and recovered from
// future payroll runs in equal monthly installments. The recovery installment
// shows up as the `advance` deduction on the payslip; once fully recovered the
// advance is marked Cleared and the deduction drops to zero automatically.

const ADVANCE_STATUSES = ["Active", "Cleared", "Cancelled"];

let advances = store.load("staff-advances", () => []);
const persistAdvances = () => store.save("staff-advances", advances);

function nextAdvanceId() {
  let max = 0;
  for (const a of advances) {
    const n = parseInt(String(a.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ADV${String(max + 1).padStart(4, "0")}`;
}

const advanceBalance = (a) => Math.max(0, (a.amount || 0) - (a.recovered || 0));

// Total recovery to deduct this month across a staff member's active advances.
function advanceMonthlyRecovery(staffId) {
  return advances
    .filter((a) => a.staffId === staffId && a.status === "Active")
    .reduce((sum, a) => sum + Math.min(a.perInstallment, advanceBalance(a)), 0);
}

// Compact summary attached to each staff payroll record for the UI.
function advanceSummary(staffId) {
  const active = advances.filter((a) => a.staffId === staffId && a.status === "Active");
  return {
    outstanding: active.reduce((s, a) => s + advanceBalance(a), 0),
    monthly: advanceMonthlyRecovery(staffId),
    activeCount: active.length,
  };
}

// Re-derive the `advance` deduction on a staff member's payroll from the ledger.
function syncStaffAdvanceDeduction(staffId) {
  const s = items.find((x) => x.id === staffId);
  if (!s) return;
  if (!s.payroll) s.payroll = buildPayrollFor(s.salary, 0);
  s.payroll.deductions.advance = advanceMonthlyRecovery(staffId);
}

// Filterable advances list for the dedicated Salary Advances page. Each item
// is joined to its staff record (role / department / avatar) so the page can
// filter by department and render rich rows.
function listAdvances({ staffId, status, q, category, sort = "recent" } = {}) {
  const byId = new Map(items.map((s) => [s.id, s]));
  let out = advances.map((a) => {
    const s = byId.get(a.staffId);
    return {
      ...a,
      balance: advanceBalance(a),
      role: s ? s.designation : null,
      department: s ? s.category : null,
      avatar: s ? s.avatar : avatarFromName(a.staffName),
    };
  });
  if (staffId) out = out.filter((a) => a.staffId === staffId);
  if (status && status !== "all") out = out.filter((a) => a.status === status);
  if (category && category !== "all") out = out.filter((a) => a.department === category);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (a) =>
        (a.staffName || "").toLowerCase().includes(t) ||
        (a.staffId || "").toLowerCase().includes(t) ||
        (a.id || "").toLowerCase().includes(t) ||
        (a.reason || "").toLowerCase().includes(t)
    );
  }
  if (sort === "outstanding") out.sort((a, b) => b.balance - a.balance);
  else if (sort === "amount") out.sort((a, b) => b.amount - a.amount);
  else if (sort === "name") out.sort((a, b) => (a.staffName || "").localeCompare(b.staffName || ""));
  else
    out.sort((a, b) =>
      a.grantedOn === b.grantedOn ? (a.id < b.id ? 1 : -1) : a.grantedOn < b.grantedOn ? 1 : -1
    );
  return out;
}

// Roll-up totals for the Salary Advances page KPI cards.
function advancesOverview() {
  const active = advances.filter((a) => a.status === "Active");
  return {
    total: advances.length,
    activeCount: active.length,
    clearedCount: advances.filter((a) => a.status === "Cleared").length,
    cancelledCount: advances.filter((a) => a.status === "Cancelled").length,
    outstanding: active.reduce((s, a) => s + advanceBalance(a), 0),
    monthlyRecovery: active.reduce((s, a) => s + Math.min(a.perInstallment, advanceBalance(a)), 0),
    disbursed: advances
      .filter((a) => a.status !== "Cancelled")
      .reduce((s, a) => s + (a.amount || 0), 0),
    recovered: advances.reduce((s, a) => s + (a.recovered || 0), 0),
  };
}

function grantAdvance(payload, actor) {
  const { staffId, amount, installments, reason, disbursementMethod } = payload || {};
  const s = items.find((x) => x.id === staffId);
  if (!s) throw new Error("Staff not found");
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0 || amt > 10000000)
    throw new Error("amount must be between 1 and 1,00,00,000");
  const inst = Math.round(Number(installments));
  if (!Number.isFinite(inst) || inst < 1 || inst > 60)
    throw new Error("installments must be between 1 and 60");
  const method = disbursementMethod || s.payroll?.paymentMethod || "Bank Transfer";
  if (!PAYMENT_METHODS.includes(method))
    throw new Error(`disbursementMethod must be one of ${PAYMENT_METHODS.join(", ")}`);
  // Guard against over-lending: total outstanding shouldn't exceed 6x net pay.
  const net = s.payroll ? computePayroll(s.payroll).net : Number(s.salary) || 0;
  const outstanding = advanceSummary(staffId).outstanding;
  if (net > 0 && outstanding + amt > net * 6)
    throw new Error("Total outstanding advance would exceed 6× monthly net pay");
  const rec = {
    id: nextAdvanceId(),
    staffId: s.id,
    staffName: s.name,
    amount: amt,
    installments: inst,
    perInstallment: Math.ceil(amt / inst),
    recovered: 0,
    reason: reason ? String(reason).trim().slice(0, 200) : null,
    disbursementMethod: method,
    status: "Active",
    grantedOn: new Date().toISOString().slice(0, 10),
    grantedBy: actor?.name || "Admin",
    recoveries: [],
  };
  advances.unshift(rec);
  persistAdvances();
  syncStaffAdvanceDeduction(s.id);
  persist();
  return { ...rec, balance: advanceBalance(rec) };
}

function cancelAdvance(id) {
  const a = advances.find((x) => x.id === id);
  if (!a) throw new Error("Advance not found");
  if (a.status !== "Active") throw new Error("Only active advances can be cancelled");
  a.status = "Cancelled";
  a.closedOn = new Date().toISOString().slice(0, 10);
  persistAdvances();
  syncStaffAdvanceDeduction(a.staffId);
  persist();
  return { ...a, balance: advanceBalance(a) };
}

// Recover one installment from every active advance when a run is paid. Called
// by payroll.payRun with the run's employee ids.
function recoverAdvancesForRun(staffIds, runId, month) {
  const ids = new Set(staffIds);
  const day = new Date().toISOString().slice(0, 10);
  let touched = false;
  for (const a of advances) {
    if (a.status !== "Active" || !ids.has(a.staffId)) continue;
    const bal = advanceBalance(a);
    if (bal <= 0) {
      a.status = "Cleared";
      a.closedOn = day;
      touched = true;
      continue;
    }
    const take = Math.min(a.perInstallment, bal);
    a.recovered += take;
    a.recoveries.push({ date: day, amount: take, runId, month });
    if (advanceBalance(a) <= 0) {
      a.status = "Cleared";
      a.closedOn = day;
    }
    touched = true;
  }
  if (touched) {
    persistAdvances();
    for (const staffId of ids) syncStaffAdvanceDeduction(staffId);
    persist();
  }
}

function payrollSummary() {
  const list = items.filter((s) => s.payroll).map((s) => computePayroll(s.payroll));
  const gross = list.reduce((a, p) => a + p.gross, 0);
  const deductions = list.reduce((a, p) => a + p.totalDeductions, 0);
  const net = list.reduce((a, p) => a + p.net, 0);
  const byMethod = {};
  for (const m of PAYMENT_METHODS) byMethod[m] = list.filter((p) => p.paymentMethod === m).length;
  const advancesOutstanding = advances
    .filter((a) => a.status === "Active")
    .reduce((s, a) => s + advanceBalance(a), 0);
  return {
    headcount: list.length,
    gross,
    deductions,
    net,
    avg: list.length ? Math.round(net / list.length) : 0,
    byMethod,
    advancesOutstanding,
  };
}

// Roster shaped for the payroll module / page.
function payrollRoster() {
  const now = Date.now();
  return list({ sort: "name" })
    .filter((s) => s.payroll)
    .map((s) => {
      const yos = s.joinedOn
        ? Math.max(0, Math.floor((now - new Date(s.joinedOn).getTime()) / (365 * 86400000)))
        : 0;
      return {
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        role: s.designation,
        department: s.category,
        status: s.status,
        joinedOn: s.joinedOn,
        yearsOfService: yos,
        paymentMethod: s.payroll.paymentMethod,
        bank: s.payroll.bank,
        account: s.payroll.account,
        upiId: s.payroll.upiId || null,
        components: s.payroll.components,
        deductions: s.payroll.deductions,
        gross: s.payroll.gross,
        totalDeductions: s.payroll.totalDeductions,
        net: s.payroll.net,
        advances: s.payroll.advances || advanceSummary(s.id),
      };
    });
}

module.exports = {
  CATEGORIES,
  STATUSES,
  EMPLOYMENT_TYPES,
  DESIGNATIONS_BY_CATEGORY,
  PAYMENT_METHODS,
  BANKS,
  list,
  get,
  add,
  update,
  remove,
  summary,
  // payroll
  updatePayroll,
  bulkUpdatePayroll,
  payrollSummary,
  payrollRoster,
  // salary advances
  ADVANCE_STATUSES,
  listAdvances,
  advancesOverview,
  grantAdvance,
  cancelAdvance,
  recoverAdvancesForRun,
  advanceSummary,
};
