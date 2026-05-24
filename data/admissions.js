const STAGES = ["Enquiry", "Application", "Verification", "Interview", "Approved", "Enrolled", "Rejected"];

const FIRST = [
  "Aanya", "Vihaan", "Saanvi", "Aarush", "Ishita", "Devansh", "Myra", "Atharv",
  "Tara", "Reyansh", "Anaya", "Kabir", "Diya", "Arnav", "Pari", "Ayaan",
  "Riya", "Vivaan", "Anvi", "Krishna",
];
const LAST = [
  "Sharma", "Verma", "Iyer", "Khan", "Patel", "Reddy", "Mehta", "Singh",
  "Gupta", "Joshi", "Kapoor", "Nair", "Chowdhury",
];

const SOURCES = ["Website", "Referral", "Walk-in", "Newspaper Ad", "School Fair", "Social Media"];
const DOCS = ["Birth Certificate", "Previous Marksheet", "Transfer Certificate", "Aadhaar", "Passport Photo", "Medical Certificate"];

function pick(arr, i) { return arr[i % arr.length]; }
function rand(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function buildApplicants() {
  const list = [];
  let id = 1;
  for (let i = 0; i < 32; i++) {
    const r = rand(7919 + i);
    const fn = pick(FIRST, i * 7);
    const ln = pick(LAST, i * 11);
    const stageIdx = Math.floor(r() * STAGES.length);
    const stage = STAGES[stageIdx];
    const grade = 1 + Math.floor(r() * 12);
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(r() * 30));
    list.push({
      id: `ADM${2000 + id++}`,
      name: `${fn} ${ln}`,
      avatar: (fn[0] + ln[0]).toUpperCase(),
      gradeApplied: grade,
      previousSchool: pick(["Delhi Public School", "St. Xavier's", "Kendriya Vidyalaya", "Modern School", "Bishop Cotton"], i),
      parentName: `${pick(FIRST, i * 13)} ${ln}`,
      parentContact: `+91 9${Math.floor(100000000 + r() * 899999999)}`,
      parentEmail: `parent${i + 1}@gmail.com`,
      source: pick(SOURCES, i),
      stage,
      dob: `${2026 - (5 + grade)}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`,
      appliedOn: date.toISOString().slice(0, 10),
      documents: DOCS.map((d, k) => ({
        name: d,
        uploaded: r() > 0.3,
        verified: stageIdx >= 2 && r() > 0.2,
      })),
      notes: stageIdx >= 3
        ? "Strong academic record; interview scheduled."
        : stageIdx >= 1
        ? "Awaiting document submission."
        : "Initial enquiry received.",
      score: stageIdx >= 3 ? Math.floor(60 + r() * 40) : null,
      interviewSlot: stageIdx >= 3 ? `${date.toISOString().slice(0, 10)} · 10:30 AM` : null,
    });
  }
  return list;
}

const store = require("./store");
let applicants = store.load("admissions", buildApplicants);

function persist() {
  store.save("admissions", applicants);
}

function move(id, toStage) {
  const a = applicants.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  if (!STAGES.includes(toStage)) throw new Error("Invalid stage");
  a.stage = toStage;
  persist();
  return a;
}

function add(payload) {
  const id = `ADM${2000 + applicants.length + 1}`;
  const fn = payload.name?.split(" ")[0] || "New";
  const ln = payload.name?.split(" ").slice(1).join(" ") || "Applicant";
  const a = {
    id,
    name: payload.name || `${fn} ${ln}`,
    avatar: (fn[0] + (ln[0] || "?")).toUpperCase(),
    gradeApplied: payload.gradeApplied || 1,
    previousSchool: payload.previousSchool || "—",
    parentName: payload.parentName || "—",
    parentContact: payload.parentContact || "",
    parentEmail: payload.parentEmail || "",
    source: payload.source || "Website",
    stage: "Enquiry",
    dob: payload.dob || "",
    appliedOn: new Date().toISOString().slice(0, 10),
    documents: DOCS.map((d) => ({ name: d, uploaded: false, verified: false })),
    notes: "New enquiry.",
    score: null,
    interviewSlot: null,
  };
  applicants.unshift(a);
  persist();
  return a;
}

module.exports = { STAGES, applicants: () => applicants, move, add };
