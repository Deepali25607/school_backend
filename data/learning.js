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

function mins(h, m) {
  return new Date(new Date().setHours(h, m, 0, 0));
}

function buildLive() {
  // Live classes for today and tomorrow
  const list = [];
  let idx = 0;
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    TEACHERS.forEach((t, i) => {
      if ((i + dayOffset) % 2 !== 0) return; // not every teacher every day
      const start = new Date();
      start.setDate(start.getDate() + dayOffset);
      start.setHours(9 + ((idx * 2) % 8), (idx * 15) % 60, 0, 0);
      const end = new Date(start.getTime() + 45 * 60 * 1000);
      list.push({
        id: `LC${1000 + ++idx}`,
        title: `${t.subject} · Grade ${6 + (idx % 7)}`,
        subject: t.subject,
        grade: 6 + (idx % 7),
        teacher: t,
        platform: PLATFORMS[idx % PLATFORMS.length],
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        joinUrl: `https://meet.lumina.edu/${t.id}-${idx}`,
        attendees: 18 + (idx % 14),
        status:
          start <= new Date() && new Date() <= end
            ? "Live"
            : start > new Date()
            ? "Scheduled"
            : "Ended",
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
      });
    }
  });
  return list;
}

function buildMaterials() {
  const types = ["PDF", "Slide deck", "Worksheet", "Notes", "Video"];
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
      });
    }
  });
  return list;
}

const live = buildLive();
const recordings = buildRecordings();
const materials = buildMaterials();

module.exports = { live, recordings, materials, SUBJECTS };
