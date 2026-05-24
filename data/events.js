const store = require("./store");

const CATEGORIES = [
  { key: "Academic", color: "#5b81ff" },
  { key: "Sports", color: "#ff5ec4" },
  { key: "Cultural", color: "#9b5cff" },
  { key: "Holiday", color: "#5cf2c4" },
  { key: "Meeting", color: "#ffd166" },
  { key: "Exam", color: "#ff8b5c" },
];

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function buildEvents() {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let seq = 1;
  const seeds = [
    [-15, "Republic Day Assembly",        "Cultural", "08:30", "10:00", "Main Auditorium", "Mandatory for grades 5+"],
    [-7,  "Mid-term Exam Begins",         "Exam",     "09:30", "12:30", "Exam halls",      "Grades 6 – 10"],
    [-3,  "PTM — Grades 11-12",           "Meeting",  "14:00", "17:00", "Block A",         "Counselor available"],
    [0,   "Today's Morning Assembly",     "Academic", "08:00", "08:30", "Quadrangle",      "All grades"],
    [0,   "Football Trials",              "Sports",   "15:00", "17:00", "Sports field",    "Grades 7-12, signups required"],
    [1,   "Annual Sports Day",            "Sports",   "07:30", "13:00", "Sports field",    "All students, parents welcome"],
    [2,   "Inter-house Debate Final",     "Cultural", "10:00", "13:00", "Auditorium",      "Audience seating in gallery"],
    [3,   "Chemistry Lab Open House",     "Academic", "11:00", "13:00", "Lab 2",           "Hosted by Science Club"],
    [5,   "Parent-Teacher Meeting",       "Meeting",  "09:00", "13:00", "Various rooms",   "Slot booking via portal"],
    [6,   "Holi Celebration",             "Holiday",  "10:00", "12:00", "Quadrangle",      "Eco-friendly colors only"],
    [8,   "Inter-school Math Olympiad",   "Academic", "09:00", "12:00", "Conference Hall", "Selected students"],
    [10,  "Annual Art Exhibition",        "Cultural", "10:00", "16:00", "Block B Gallery", "Open to families"],
    [12,  "Mid-term Results Published",   "Academic", "00:00", "23:59", "Portal",          "Check student portal"],
    [14,  "Founder's Day",                "Holiday",  "00:00", "23:59", "School-wide",     "Holiday for students"],
    [16,  "Robotics Workshop",            "Academic", "10:00", "15:00", "Lab 3",           "Bring laptop & charger"],
    [18,  "Inter-house Basketball",       "Sports",   "14:00", "17:00", "Sports field",    "Houses to confirm rosters"],
    [21,  "Career Counseling Session",    "Meeting",  "11:00", "13:00", "Auditorium",      "Grades 11-12, guest speakers"],
    [24,  "Music Concert",                "Cultural", "17:00", "20:00", "Auditorium",      "Tickets at front office"],
    [27,  "Maths Quiz Final",             "Academic", "10:00", "12:00", "Conference Hall", "Top 16 teams"],
    [30,  "Term-end Holidays Begin",      "Holiday",  "00:00", "23:59", "School-wide",     "School closes after 2pm"],
  ];

  seeds.forEach(([offset, title, category, start, end, location, notes]) => {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dateStr = isoDay(d);
    out.push({
      id: `EV${1000 + seq++}`,
      title,
      category,
      date: dateStr,
      startTime: start,
      endTime: end,
      location,
      notes,
      attendees: 30 + Math.floor(Math.random() * 350),
      organizer: ["Dr. Riya Mehta", "Marcus Chen", "Sara Kapoor", "Karan Mehta"][seq % 4],
      color: CATEGORIES.find((c) => c.key === category)?.color || "#888",
    });
  });

  return out;
}

let events = store.load("events", buildEvents);
const persist = () => store.save("events", events);

function add(payload) {
  const cat = CATEGORIES.find((c) => c.key === payload.category) || CATEGORIES[0];
  const ev = {
    id: `EV${1000 + events.length + 1}`,
    title: payload.title || "(untitled)",
    category: cat.key,
    color: cat.color,
    date: payload.date,
    startTime: payload.startTime || "09:00",
    endTime: payload.endTime || "10:00",
    location: payload.location || "—",
    notes: payload.notes || "",
    attendees: 0,
    organizer: payload.organizer || "Admin",
  };
  events.push(ev);
  persist();
  return ev;
}

function remove(id) {
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = events.splice(idx, 1);
  persist();
  return removed;
}

module.exports = { CATEGORIES, events: () => events, add, remove };
