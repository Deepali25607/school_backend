// Online Learning — live (virtual) classes, recorded session library, and
// downloadable study material. Originally read-only seed data; now file-backed
// via data/store so staff can create classes, publish recordings and upload
// material that students immediately see.

const store = require("./store");

const SUBJECTS = [
  "Mathematics", "Physics", "Chemistry", "Biology", "English",
  "History", "Geography", "Computer Sci",
];

const TEACHERS = [
  { id: "TCH101", name: "Marcus Chen", subject: "Mathematics" },
  { id: "TCH105", name: "Priya Verma", subject: "Physics" },
  { id: "TCH108", name: "Dr. Anand Iyer", subject: "Chemistry" },
  { id: "TCH112", name: "Maya Singh", subject: "Biology" },
  { id: "TCH114", name: "Sara Kapoor", subject: "English" },
  { id: "TCH118", name: "Rohan Bose", subject: "History" },
  { id: "TCH120", name: "Diya Patel", subject: "Geography" },
  { id: "TCH123", name: "Karan Mehta", subject: "Computer Sci" },
];

const PLATFORMS = ["Zoom", "Google Meet", "MS Teams"];
const MATERIAL_TYPES = ["PDF", "Slide deck", "Worksheet", "Notes", "Video"];

function buildLive() {
  // Live classes for today and the next couple of days.
  const list = [];
  let idx = 0;
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    TEACHERS.forEach((t, i) => {
      if ((i + dayOffset) % 2 !== 0) return; // not every teacher every day
      const start = new Date();
      start.setDate(start.getDate() + dayOffset);
      start.setHours(9 + ((idx * 2) % 8), (idx * 15) % 60, 0, 0);
      const end = new Date(start.getTime() + 45 * 60 * 1000);
      idx++;
      list.push({
        id: `LC${1000 + idx}`,
        title: `${t.subject} · Grade ${6 + (idx % 7)}`,
        subject: t.subject,
        grade: 6 + (idx % 7),
        teacher: t,
        platform: PLATFORMS[idx % PLATFORMS.length],
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        joinUrl: `https://meet.lumina.edu/${t.id}-${idx}`,
        attendees: 18 + (idx % 14),
      });
    });
  }
  return list;
}

function buildRecordings() {
  const list = [];
  let idx = 0;
  TEACHERS.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      idx++;
      const ago = idx * 2 + k;
      const date = new Date();
      date.setDate(date.getDate() - ago);
      list.push({
        id: `REC${2000 + idx}`,
        title: `${t.subject} — ${["Chapter Recap", "Problem Set Walkthrough", "Lab Demo", "Concept Deep-dive"][idx % 4]}`,
        subject: t.subject,
        grade: 6 + ((i + k) % 7),
        teacher: t,
        recordedOn: date.toISOString().slice(0, 10),
        durationMin: 32 + ((idx * 7) % 28),
        views: 60 + ((idx * 17) % 240),
        thumbHue: (idx * 37) % 360,
        tags: ["NCERT", k === 0 ? "Beginner" : k === 1 ? "Advanced" : "Practice"],
        videoUrl: "",
      });
    }
  });
  return list;
}

function buildMaterials() {
  const types = MATERIAL_TYPES;
  const list = [];
  let idx = 0;
  TEACHERS.forEach((t) => {
    for (let k = 0; k < 2; k++) {
      idx++;
      list.push({
        id: `MAT${3000 + idx}`,
        title: `${t.subject} · ${["Practice Set", "Reference Sheet", "Glossary", "Exam Tips"][idx % 4]} ${k + 1}`,
        subject: t.subject,
        teacher: t,
        type: types[idx % types.length],
        sizeKb: 120 + ((idx * 53) % 4800),
        uploadedOn: new Date(Date.now() - idx * 86400000 * 3)
          .toISOString()
          .slice(0, 10),
        downloads: 30 + ((idx * 11) % 180),
        fileName: "",
        url: "",
        grade: null,
      });
    }
  });
  return list;
}

let live = store.load("learning_live", buildLive);
let recordings = store.load("learning_recordings", buildRecordings);
let materials = store.load("learning_materials", buildMaterials);

const persistLive = () => store.save("learning_live", live);
const persistRecordings = () => store.save("learning_recordings", recordings);
const persistMaterials = () => store.save("learning_materials", materials);

function nextId(listVal, prefix, base) {
  let max = base;
  for (const x of listVal) {
    const n = parseInt(String(x.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Resolve a teacher reference from a payload — either a known teacher id, or a
// free-text name (so a logged-in teacher not in the demo roster still works).
function resolveTeacher(payload) {
  if (payload.teacherId) {
    const t = TEACHERS.find((x) => x.id === payload.teacherId);
    if (t) return t;
  }
  if (payload.teacherName) {
    return {
      id: payload.teacherId || "TCHX",
      name: payload.teacherName,
      subject: payload.subject || "",
    };
  }
  return null;
}

function validGrade(g) {
  const n = Number(g);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

// ---------- Live classes ----------
function addLive(payload) {
  const subject = payload.subject;
  if (!subject) throw new Error("subject required");
  const grade = validGrade(payload.grade);
  if (grade === null) throw new Error("grade must be 1-12");
  const teacher = resolveTeacher(payload);
  if (!teacher) throw new Error("teacher required");
  const platform = PLATFORMS.includes(payload.platform) ? payload.platform : PLATFORMS[0];

  // Combine date + time into a start instant; default to "now + 1h" if absent.
  let start;
  if (payload.date && payload.time) {
    start = new Date(`${payload.date}T${payload.time}:00`);
  } else if (payload.startsAt) {
    start = new Date(payload.startsAt);
  } else {
    start = new Date(Date.now() + 60 * 60 * 1000);
  }
  if (isNaN(start.getTime())) throw new Error("invalid date/time");
  const durationMin = Number(payload.durationMin) > 0 ? Number(payload.durationMin) : 45;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  const id = nextId(live, "LC", 1000);
  const cls = {
    id,
    title: payload.title?.trim() || `${subject} · Grade ${grade}`,
    subject,
    grade,
    teacher,
    platform,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    joinUrl: payload.joinUrl?.trim() || `https://meet.lumina.edu/${teacher.id}-${id}`,
    attendees: 0,
  };
  live.unshift(cls);
  persistLive();
  return cls;
}

function removeLive(id) {
  const idx = live.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = live.splice(idx, 1);
  persistLive();
  return removed;
}

// ---------- Recordings ----------
function addRecording(payload) {
  const subject = payload.subject;
  if (!subject) throw new Error("subject required");
  const grade = validGrade(payload.grade);
  if (grade === null) throw new Error("grade must be 1-12");
  const teacher = resolveTeacher(payload);
  if (!teacher) throw new Error("teacher required");
  if (!payload.title?.trim()) throw new Error("title required");

  const id = nextId(recordings, "REC", 2000);
  const num = parseInt(id.replace(/\D+/g, ""), 10);
  const rec = {
    id,
    title: payload.title.trim(),
    subject,
    grade,
    teacher,
    recordedOn: payload.recordedOn || today(),
    durationMin: Number(payload.durationMin) > 0 ? Number(payload.durationMin) : 40,
    views: 0,
    thumbHue: (num * 37) % 360,
    tags: Array.isArray(payload.tags)
      ? payload.tags
      : String(payload.tags || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
    videoUrl: payload.videoUrl?.trim() || "",
  };
  recordings.unshift(rec);
  persistRecordings();
  return rec;
}

function removeRecording(id) {
  const idx = recordings.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = recordings.splice(idx, 1);
  persistRecordings();
  return removed;
}

function viewRecording(id) {
  const r = recordings.find((x) => x.id === id);
  if (!r) throw new Error("Not found");
  r.views = (r.views || 0) + 1;
  persistRecordings();
  return r;
}

// ---------- Materials ----------
function addMaterial(payload) {
  const subject = payload.subject;
  if (!subject) throw new Error("subject required");
  const teacher = resolveTeacher(payload);
  if (!teacher) throw new Error("teacher required");
  if (!payload.title?.trim()) throw new Error("title required");
  const type = MATERIAL_TYPES.includes(payload.type) ? payload.type : MATERIAL_TYPES[0];

  const id = nextId(materials, "MAT", 3000);
  const mat = {
    id,
    title: payload.title.trim(),
    subject,
    teacher,
    type,
    sizeKb: Number(payload.sizeKb) >= 0 ? Math.round(Number(payload.sizeKb)) : 0,
    uploadedOn: today(),
    downloads: 0,
    fileName: payload.fileName || "",
    url: payload.url?.trim() || "",
    grade: validGrade(payload.grade), // null = all grades
  };
  materials.unshift(mat);
  persistMaterials();
  return mat;
}

function removeMaterial(id) {
  const idx = materials.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = materials.splice(idx, 1);
  persistMaterials();
  return removed;
}

function downloadMaterial(id) {
  const m = materials.find((x) => x.id === id);
  if (!m) throw new Error("Not found");
  m.downloads = (m.downloads || 0) + 1;
  persistMaterials();
  return m;
}

module.exports = {
  SUBJECTS,
  TEACHERS,
  PLATFORMS,
  MATERIAL_TYPES,
  live: () => live,
  recordings: () => recordings,
  materials: () => materials,
  addLive,
  removeLive,
  addRecording,
  removeRecording,
  viewRecording,
  addMaterial,
  removeMaterial,
  downloadMaterial,
};
