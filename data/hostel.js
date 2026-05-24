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

module.exports = { BLOCKS, rooms: () => rooms, summary, assign, evict };
