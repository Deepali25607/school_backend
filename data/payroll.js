const ROLES = [
  { role: "Principal", base: 150000 },
  { role: "Vice Principal", base: 120000 },
  { role: "Senior Teacher", base: 75000 },
  { role: "Teacher", base: 55000 },
  { role: "Lab Assistant", base: 32000 },
  { role: "Librarian", base: 38000 },
  { role: "Accountant", base: 48000 },
  { role: "Clerk", base: 28000 },
  { role: "Driver", base: 24000 },
  { role: "Security", base: 22000 },
  { role: "Cleaner", base: 18000 },
];

const FIRST = [
  "Ada", "Marcus", "Sofia", "Ken", "Riya", "Arjun", "Maya", "Neel",
  "Anya", "Ravi", "Priya", "Karan", "Isha", "Rohan", "Tara", "Diya",
  "Aman", "Sara", "Vikram", "Leena", "Devansh", "Naina", "Aarush",
];
const LAST = [
  "Iyer", "Khan", "Patel", "Mehta", "Sharma", "Reddy", "Singh", "Joshi",
  "Verma", "Gupta", "Kapoor", "Nair", "Chowdhury",
];

const BANKS = ["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank", "Kotak"];
const PAY_FREQ = ["Monthly"];

function pick(arr, i) {
  return arr[i % arr.length];
}

function buildStaff() {
  const list = [];
  let idx = 0;
  ROLES.forEach((r, ri) => {
    const count = r.base >= 100000 ? 1 : r.base >= 70000 ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const fn = pick(FIRST, idx * 7 + i * 3);
      const ln = pick(LAST, idx * 11 + i * 5);
      const yos = 1 + ((idx * 13 + i * 7) % 18);
      const base = r.base + yos * 800;
      const hra = Math.floor(base * 0.4);
      const transport = 2400;
      const special = Math.floor(base * 0.1);
      const overtime = (i % 3 === 0) ? 2000 : 0;
      const bonus = i % 5 === 0 ? 3000 : 0;
      const gross = base + hra + transport + special + overtime + bonus;
      const pf = Math.floor(base * 0.12);
      const esi = base < 25000 ? Math.floor(gross * 0.0075) : 0;
      const tax = base > 50000 ? Math.floor((base - 50000) * 0.1) : 0;
      const loan = i % 7 === 0 ? 2500 : 0;
      const deductions = pf + esi + tax + loan;
      const net = gross - deductions;
      list.push({
        id: `EMP${String(2000 + ++idx)}`,
        name: `${fn} ${ln}`,
        avatar: (fn[0] + ln[0]).toUpperCase(),
        role: r.role,
        department:
          r.role.includes("Teacher") || r.role.includes("Principal")
            ? "Academics"
            : r.role === "Lab Assistant"
            ? "Academics"
            : r.role === "Librarian"
            ? "Academics"
            : r.role === "Accountant"
            ? "Finance"
            : r.role === "Driver"
            ? "Transport"
            : "Operations",
        joinedOn: `${2026 - yos}-0${1 + (i % 9)}-1${i % 9}`,
        yearsOfService: yos,
        bank: pick(BANKS, idx + i),
        account: `XXXX${String(1000 + idx * 91 + i * 7).slice(-4)}`,
        components: {
          base,
          hra,
          transport,
          special,
          overtime,
          bonus,
        },
        deductions: {
          pf,
          esi,
          tax,
          loan,
        },
        gross,
        totalDeductions: deductions,
        net,
        status: idx % 11 === 0 ? "On leave" : "Active",
        frequency: pick(PAY_FREQ, idx),
      });
    }
  });
  return list;
}

const staff = buildStaff();

function summary() {
  const gross = staff.reduce((a, s) => a + s.gross, 0);
  const deductions = staff.reduce((a, s) => a + s.totalDeductions, 0);
  const net = staff.reduce((a, s) => a + s.net, 0);
  return {
    headcount: staff.length,
    gross,
    deductions,
    net,
    avg: Math.round(net / staff.length),
  };
}

module.exports = { staff, summary };
