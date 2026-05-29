const BLOCKS = [
  { id: "A", name: "Arjuna Block", gender: "Boys", floors: 4, perFloor: 8 },
  { id: "B", name: "Bhima Block", gender: "Boys", floors: 4, perFloor: 8 },
  { id: "C", name: "Chitra Block", gender: "Girls", floors: 4, perFloor: 8 },
  { id: "D", name: "Draupadi Block", gender: "Girls", floors: 3, perFloor: 8 },
];

const FIRST = ["Aarav", "Diya", "Vivaan", "Anaya", "Arjun", "Saanvi", "Reyansh", "Aadhya", "Ishaan", "Riya", "Aryan", "Anika", "Atharv", "Navya"];
const LAST = ["Sharma", "Verma", "Iyer", "Khan", "Patel", "Reddy", "Mehta", "Singh", "Gupta"];

function pick(arr, i) { return arr[i % arr.length]; }
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function buildRooms() {
  const rooms = [];
  let seq = 1;
  BLOCKS.forEach((b) => {
    for (let f = 1; f <= b.floors; f++) {
      for (let r = 1; r <= b.perFloor; r++) {
        const id = `${b.id}-${f}${String(r).padStart(2, "0")}`;
        const cap = 2 + ((seq + f) % 3); // 2-4 beds
        const rnd = rng(seq * 41);
        const occupants = [];
        const occ = rnd() < 0.85 ? Math.min(cap, Math.floor(rnd() * (cap + 1))) : 0;
        for (let k = 0; k < occ; k++) {
          const fn = pick(FIRST, seq + k * 3);
          const ln = pick(LAST, seq * 2 + k);
          occupants.push({
            id: `STU${1000 + ((seq * 7 + k) % 60) + 1}`,
            name: `${fn} ${ln}`,
            avatar: (fn[0] + ln[0]).toUpperCase(),
            grade: 6 + ((seq + k) % 7),
          });
        }
        rooms.push({
          id,
          block: b.id,
          blockName: b.name,
          gender: b.gender,
          floor: f,
          number: r,
          capacity: cap,
          occupants,
          status:
            occupants.length === 0
              ? "Vacant"
              : occupants.length < cap
              ? "Available"
              : "Full",
          warden: b.gender === "Boys" ? "Mr. Karan Mehta" : "Mrs. Sara Kapoor",
        });
        seq++;
      }
    }
  });
  return rooms;
}

const store = require("./store");
let rooms = store.load("hostel-rooms", buildRooms);
const persistRooms = () => store.save("hostel-rooms", rooms);

function summary() {
  const totalRooms = rooms.length;
  const totalBeds = rooms.reduce((a, r) => a + r.capacity, 0);
  const occupied = rooms.reduce((a, r) => a + r.occupants.length, 0);
  const vacantBeds = totalBeds - occupied;
  const fullRooms = rooms.filter((r) => r.status === "Full").length;
  return {
    totalRooms,
    totalBeds,
    occupied,
    vacantBeds,
    fullRooms,
    occupancyPct: Math.round((occupied / totalBeds) * 100),
    blocks: BLOCKS.map((b) => ({
      ...b,
      rooms: rooms.filter((r) => r.block === b.id).length,
      occupied: rooms
        .filter((r) => r.block === b.id)
        .reduce((a, r) => a + r.occupants.length, 0),
      beds: rooms
        .filter((r) => r.block === b.id)
        .reduce((a, r) => a + r.capacity, 0),
    })),
  };
}

function assign({ roomId, studentId, name, grade }) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw new Error("Room not found");
  if (room.occupants.length >= room.capacity) throw new Error("Room is full");
  const fn = (name || "New").split(" ")[0];
  const ln = (name || "Student").split(" ").slice(1).join(" ") || "?";
  room.occupants.push({
    id: studentId || `STU${1000 + Math.floor(Math.random() * 1000)}`,
    name: name || "New Student",
    avatar: (fn[0] + (ln[0] || "?")).toUpperCase(),
    grade: grade || 8,
  });
  room.status = room.occupants.length === room.capacity ? "Full" : "Available";
  persistRooms();
  return room;
}

function evict({ roomId, studentId }) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw new Error("Room not found");
  room.occupants = room.occupants.filter((o) => o.id !== studentId);
  room.status = room.occupants.length === 0
    ? "Vacant"
    : room.occupants.length < room.capacity
    ? "Available"
    : "Full";
  persistRooms();
  return room;
}

// ============ WARDEN MANAGEMENT (BRD 7.15) ============
function buildWardens() {
  return [
    { id: "WRD01", name: "Mr. Karan Mehta", gender: "Boys", block: "A", phone: "+91 98100 11223", email: "karan.mehta@lumina.edu", shift: "Day", onDuty: true },
    { id: "WRD02", name: "Mr. Anand Iyer", gender: "Boys", block: "B", phone: "+91 98100 33445", email: "anand.iyer@lumina.edu", shift: "Night", onDuty: true },
    { id: "WRD03", name: "Mrs. Sara Kapoor", gender: "Girls", block: "C", phone: "+91 98100 55667", email: "sara.kapoor@lumina.edu", shift: "Day", onDuty: true },
    { id: "WRD04", name: "Ms. Leena Nair", gender: "Girls", block: "D", phone: "+91 98100 77889", email: "leena.nair@lumina.edu", shift: "Night", onDuty: false },
  ];
}

let wardens = store.load("hostel-wardens", buildWardens);
const persistWardens = () => store.save("hostel-wardens", wardens);

function listWardens() {
  return wardens.map((w) => ({
    ...w,
    blockName: BLOCKS.find((b) => b.id === w.block)?.name || null,
  }));
}

function addWarden(payload) {
  if (!payload.name) throw new Error("Warden name is required");
  if (payload.block && !BLOCKS.some((b) => b.id === payload.block))
    throw new Error("Invalid block");
  const w = {
    id: `WRD${String(wardens.length + 1).padStart(2, "0")}`,
    name: payload.name,
    gender: payload.gender || (BLOCKS.find((b) => b.id === payload.block)?.gender ?? "Boys"),
    block: payload.block || null,
    phone: payload.phone || "—",
    email: payload.email || "—",
    shift: payload.shift || "Day",
    onDuty: payload.onDuty !== undefined ? !!payload.onDuty : true,
  };
  wardens.unshift(w);
  persistWardens();
  return w;
}

function updateWarden(id, patch) {
  const w = wardens.find((x) => x.id === id);
  if (!w) throw new Error("Warden not found");
  if (patch.block !== undefined) {
    if (patch.block && !BLOCKS.some((b) => b.id === patch.block))
      throw new Error("Invalid block");
    w.block = patch.block || null;
  }
  for (const k of ["name", "gender", "phone", "email", "shift"]) {
    if (patch[k] !== undefined) w[k] = patch[k];
  }
  if (patch.onDuty !== undefined) w.onDuty = !!patch.onDuty;
  persistWardens();
  return w;
}

function removeWarden(id) {
  const exists = wardens.some((x) => x.id === id);
  if (!exists) throw new Error("Warden not found");
  wardens = wardens.filter((x) => x.id !== id);
  persistWardens();
  return { ok: true };
}

// ============ MESS MANAGEMENT (BRD 7.15) ============
const MESS_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MESS_MEALS = ["Breakfast", "Lunch", "Snacks", "Dinner"];

function buildMessMenu() {
  const opts = {
    Breakfast: ["Poha + Tea", "Idli Sambar", "Aloo Paratha + Curd", "Upma + Banana", "Bread Omelette", "Dosa + Chutney", "Puri Bhaji"],
    Lunch: ["Rajma Chawal", "Dal + Roti + Sabzi", "Chole + Rice", "Veg Pulao + Raita", "Paneer + Roti", "Sambar Rice", "Kadhi Chawal"],
    Snacks: ["Samosa + Tea", "Biscuits + Milk", "Sprouts Chaat", "Fruit Bowl", "Pakora + Tea", "Sandwich", "Bhel Puri"],
    Dinner: ["Roti + Mixed Veg", "Khichdi + Papad", "Veg Biryani", "Dal Fry + Rice", "Matar Paneer + Roti", "Fried Rice + Manchurian", "Roti + Egg Curry"],
  };
  return MESS_DAYS.map((day, i) => ({
    day,
    meals: MESS_MEALS.reduce((acc, meal) => {
      acc[meal] = opts[meal][i % opts[meal].length];
      return acc;
    }, {}),
  }));
}

let messMenu = store.load("hostel-mess-menu", buildMessMenu);
const persistMess = () => store.save("hostel-mess-menu", messMenu);

function getMessMenu() {
  return { days: MESS_DAYS, meals: MESS_MEALS, menu: messMenu };
}

function setMessMeal(day, meal, dish) {
  if (!MESS_DAYS.includes(day)) throw new Error("Invalid day");
  if (!MESS_MEALS.includes(meal)) throw new Error("Invalid meal");
  const row = messMenu.find((m) => m.day === day);
  if (!row) throw new Error("Day not found");
  row.meals[meal] = String(dish || "").trim() || "—";
  persistMess();
  return row;
}

function messSummary() {
  const residents = rooms.reduce((a, r) => a + r.occupants.length, 0);
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
  const mapped = dayName === "Sun" ? "Sun" : dayName;
  const todayRow = messMenu.find((m) => m.day === mapped) || messMenu[0];
  return {
    residents,
    mealsPerDay: MESS_MEALS.length,
    estDailyPlates: residents * MESS_MEALS.length,
    today: todayRow,
  };
}

module.exports = {
  BLOCKS,
  rooms: () => rooms,
  summary,
  assign,
  evict,
  // warden management
  listWardens,
  addWarden,
  updateWarden,
  removeWarden,
  // mess management
  MESS_DAYS,
  MESS_MEALS,
  getMessMenu,
  setMessMeal,
  messSummary,
};
