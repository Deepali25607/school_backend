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
      notes: null,
    };
  });
}

let items = store.load("staff", buildSeed);
const persist = () => store.save("staff", items);

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
  return out;
}

function get(id) {
  return items.find((s) => s.id === id) || null;
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

module.exports = {
  CATEGORIES,
  STATUSES,
  EMPLOYMENT_TYPES,
  DESIGNATIONS_BY_CATEGORY,
  list,
  get,
  add,
  update,
  remove,
  summary,
};
