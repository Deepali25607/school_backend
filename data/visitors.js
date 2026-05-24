const store = require("./store");

const PURPOSES = [
  "Parent meeting",
  "Delivery",
  "Vendor",
  "Interview",
  "Inspection",
  "Maintenance",
  "Guest lecture",
  "Other",
];

const ID_TYPES = ["Aadhaar", "Driving license", "Passport", "Voter ID", "Company ID"];

const SEED_VISITORS = [
  // [name, purpose, host, hostRole, phone, idType, idLast4, hours_ago, checked_out_hours_ago_or_null]
  ["Ramesh Kumar", "Parent meeting", "Dr. Riya Mehta", "Principal", "+91 9874512300", "Aadhaar", "4521", 5, 4],
  ["Priya Sharma", "Parent meeting", "Marcus Chen", "Teacher", "+91 9912345678", "Aadhaar", "8732", 3, 1],
  ["Suresh Iyer", "Vendor", "Operations", "Admin", "+91 9988776655", "Driving license", "2014", 2, null],
  ["Dr. Anita Rao", "Guest lecture", "Sara Kapoor", "Teacher", "+91 9001231234", "Aadhaar", "1188", 1, null],
  ["BlueDart courier", "Delivery", "Reception", "Staff", "+91 9876123456", "Company ID", "9921", 1, 1],
  ["Karan Joshi", "Interview", "Ken Tanaka", "HR Staff", "+91 9123456780", "Aadhaar", "3344", 0, null],
  ["Inspector Tiwari", "Inspection", "Dr. Riya Mehta", "Principal", "+91 9234567812", "Voter ID", "5510", 28, 26],
  ["Anil Reddy", "Maintenance", "Operations", "Admin", "+91 9345678123", "Aadhaar", "7720", 24, 22],
  ["Meena Patel", "Parent meeting", "Marcus Chen", "Teacher", "+91 9456781234", "Aadhaar", "8821", 48, 47],
  ["Aakash Nair", "Vendor", "Library Desk", "Librarian", "+91 9567812345", "Driving license", "1090", 72, 71],
];

function isoMinusHours(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function buildVisitors() {
  return SEED_VISITORS.map((v, i) => {
    const [name, purpose, host, hostRole, phone, idType, idLast4, hoursAgo, outAgo] = v;
    return {
      id: `VIS${String(5000 + i + 1)}`,
      pass: `LP-${String(1000 + i * 13).slice(-4)}`,
      name,
      phone,
      purpose,
      host,
      hostRole,
      idType,
      idLast4,
      photoSeed: ((i + 1) * 37) % 360, // hue for avatar gradient
      checkInAt: isoMinusHours(hoursAgo),
      checkOutAt: outAgo === null ? null : isoMinusHours(outAgo),
    };
  });
}

let visitors = store.load("visitors", buildVisitors);
const persist = () => store.save("visitors", visitors);

function checkIn(payload) {
  const i = visitors.length;
  const rec = {
    id: `VIS${String(5000 + i + 1)}`,
    pass: `LP-${String(1000 + i * 13 + Date.now() % 100).slice(-4)}`,
    name: payload.name || "(unknown)",
    phone: payload.phone || "",
    purpose: payload.purpose || "Other",
    host: payload.host || "—",
    hostRole: payload.hostRole || "—",
    idType: payload.idType || "Aadhaar",
    idLast4: payload.idLast4 || "0000",
    photoSeed: Math.floor(Math.random() * 360),
    checkInAt: new Date().toISOString(),
    checkOutAt: null,
  };
  visitors.unshift(rec);
  persist();
  return rec;
}

function checkOut(id) {
  const v = visitors.find((x) => x.id === id);
  if (!v) throw new Error("Not found");
  if (v.checkOutAt) throw new Error("Already checked out");
  v.checkOutAt = new Date().toISOString();
  persist();
  return v;
}

function summary() {
  const inside = visitors.filter((v) => !v.checkOutAt).length;
  const today = new Date().toISOString().slice(0, 10);
  const todays = visitors.filter((v) => v.checkInAt.slice(0, 10) === today);
  return {
    inside,
    todayCheckIns: todays.length,
    total: visitors.length,
    purposes: PURPOSES.map((p) => ({
      purpose: p,
      count: visitors.filter((v) => v.purpose === p).length,
    })).filter((x) => x.count > 0),
  };
}

module.exports = {
  PURPOSES,
  ID_TYPES,
  visitors: () => visitors,
  checkIn,
  checkOut,
  summary,
};
