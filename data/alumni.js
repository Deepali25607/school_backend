// Alumni Network — past students directory.
//
// Distinct from the active student roster (`seed.students`): alumni records
// freeze the student's identity at graduation and capture post-school life:
// where they went (college / employer), what they're doing, contact prefs,
// notable accomplishments, and whether they've consented to mentor current
// students. Engagement chips ("Verified", "Mentor", "Donor") drive filters.
//
// Records are seeded by hashing a few `seed.firstNames`/`lastNames` combos so
// the directory looks like a real school's growing alumni base — ~80 records
// spanning graduation years from (currentYear - 25) → (currentYear - 1).

const store = require("./store");
const seed = require("./seed");

const STREAMS = ["Science", "Commerce", "Arts", "General"];

const DESTINATION_TYPES = [
  "College",
  "Employed",
  "Entrepreneur",
  "Higher Studies Abroad",
  "Gap Year",
  "Defence Services",
];

const INDIAN_COLLEGES = [
  "IIT Bombay",
  "IIT Delhi",
  "IIT Madras",
  "IIT Kanpur",
  "IIT Kharagpur",
  "BITS Pilani",
  "Delhi University · St. Stephen's",
  "Delhi University · Lady Shri Ram",
  "Delhi University · Hindu College",
  "Christ University, Bangalore",
  "Loyola College, Chennai",
  "Symbiosis Pune",
  "NIFT Delhi",
  "AIIMS Delhi",
  "NLSIU Bangalore",
  "JIPMER Pondicherry",
  "Manipal Institute of Technology",
  "VIT Vellore",
  "SRM Chennai",
  "Ashoka University",
  "FLAME University",
  "St. Xavier's Mumbai",
  "Jamia Millia Islamia",
  "Jawaharlal Nehru University",
];

const ABROAD_COLLEGES = [
  "MIT",
  "Stanford University",
  "Harvard University",
  "University of Oxford",
  "University of Cambridge",
  "ETH Zurich",
  "National University of Singapore",
  "University of Toronto",
  "University of Melbourne",
  "Imperial College London",
  "UC Berkeley",
  "Carnegie Mellon",
  "Cornell University",
  "University of Edinburgh",
];

const EMPLOYERS = [
  "Tata Consultancy Services",
  "Infosys",
  "Wipro",
  "Reliance Industries",
  "Mahindra Group",
  "Flipkart",
  "Zomato",
  "Swiggy",
  "Razorpay",
  "Freshworks",
  "Zoho",
  "Paytm",
  "PhonePe",
  "Byju's",
  "Cred",
  "Goldman Sachs (Bangalore)",
  "Deloitte India",
  "McKinsey & Company",
  "Accenture",
  "Google India",
  "Microsoft India",
  "Amazon India",
  "Indian Army",
  "Indian Air Force",
  "Indian Navy",
  "Independent Consultant",
];

const ROLES_BY_FIELD = {
  tech: [
    "Software Engineer",
    "Product Manager",
    "Data Scientist",
    "ML Engineer",
    "Frontend Developer",
    "Backend Engineer",
    "Site Reliability Engineer",
    "Designer · UX",
  ],
  business: [
    "Business Analyst",
    "Investment Banker",
    "Management Consultant",
    "Marketing Manager",
    "Operations Lead",
    "Strategy Associate",
  ],
  creative: [
    "Architect",
    "Journalist",
    "Filmmaker",
    "Graphic Designer",
    "Author",
    "Music Producer",
  ],
  service: [
    "Doctor (Resident)",
    "Lawyer (Associate)",
    "Chartered Accountant",
    "Teacher",
    "Civil Servant",
    "Defence Officer",
  ],
  founder: [
    "Founder · D2C brand",
    "Co-founder · SaaS startup",
    "Founder · NGO",
    "Founder · Edtech",
    "Founder · Climate-tech",
  ],
};

const CITIES = [
  "Bengaluru",
  "Mumbai",
  "Delhi NCR",
  "Pune",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
  "Gurgaon",
  "Noida",
  "Jaipur",
  "Lucknow",
  "Chandigarh",
  "Kochi",
  "London",
  "New York",
  "San Francisco",
  "Singapore",
  "Toronto",
  "Sydney",
  "Berlin",
  "Dubai",
];

const ACHIEVEMENT_BLURBS = [
  "Forbes 30 Under 30 · 2024 (Tech)",
  "TEDx speaker · IIM-A",
  "Published author · debut novel longlisted for Crossword Award",
  "Olympic medallist · Shooting (Bronze, mixed team)",
  "Patent holder · low-cost prosthetics",
  "Chevening Scholar · LSE",
  "Rhodes Scholar nominee · 2023",
  "National-level chess Grandmaster",
  "Founded an NGO providing menstrual health education in rural Bihar",
  "Lead engineer on payment infrastructure used by 200M+ Indians",
  "Awarded the Pravasi Bharatiya Samman",
  "Selected for ISRO summer internship · IIT-B",
  "Toured globally with a contemporary dance ensemble",
];

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, ...parts) {
  return arr[hash(...parts) % arr.length];
}

function destinationFor(i, gradYear) {
  const r = hash("dest", i) % 100;
  if (r < 5) return "Defence Services";
  if (r < 10) return "Gap Year";
  if (r < 18) return "Entrepreneur";
  if (r < 28) return "Higher Studies Abroad";
  // college years 0-4 after graduation, employment after that
  const yearsOut = new Date().getFullYear() - gradYear;
  if (yearsOut <= 4 && r < 80) return "College";
  return "Employed";
}

function roleFor(i, destination) {
  if (destination === "Defence Services") return pick(["Captain", "Major", "Lieutenant", "Squadron Leader", "Flight Lieutenant"], "rank", i);
  if (destination === "Entrepreneur") return pick(ROLES_BY_FIELD.founder, "role", i);
  if (destination === "College" || destination === "Higher Studies Abroad" || destination === "Gap Year") return null;
  // Employed — pick a field bucket by hash, then a role
  const field = pick(["tech", "tech", "business", "service", "creative"], "field", i);
  return pick(ROLES_BY_FIELD[field], "role", i, field);
}

function destinationLabelFor(i, destination, gradYear) {
  if (destination === "Defence Services") return pick(["Indian Army", "Indian Air Force", "Indian Navy"], "armed", i);
  if (destination === "Gap Year") return null;
  if (destination === "Higher Studies Abroad") return pick(ABROAD_COLLEGES, "abroad", i);
  if (destination === "College") return pick(INDIAN_COLLEGES, "college", i);
  // Entrepreneur / Employed → company
  return pick(EMPLOYERS, "employer", i);
}

function emailFor(first, last, i) {
  const dom = pick(["gmail.com", "outlook.com", "yahoo.com", "proton.me"], "dom", i);
  return `${first.toLowerCase()}.${last.toLowerCase()}${(i % 90) + 10}@${dom}`;
}

function phoneFor(i) {
  // Stable 10-digit Indian phone
  const n = (8000000000 + (hash("ph", i) % 1999999999)).toString();
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

function buildSeed() {
  const list = [];
  const currentYear = new Date().getFullYear();
  const COUNT = 80;

  for (let i = 0; i < COUNT; i++) {
    const fn = pick(seed.firstNames || [], "fn", i) || "Alex";
    const ln = pick(seed.lastNames || [], "ln", i) || "Kumar";

    // Spread graduation years from (currentYear - 25) to (currentYear - 1).
    const yearsBack = 1 + (hash("yr", i) % 25);
    const gradYear = currentYear - yearsBack;

    const destination = destinationFor(i, gradYear);
    const destinationLabel = destinationLabelFor(i, destination, gradYear);
    const role = roleFor(i, destination);
    const city = pick(CITIES, "city", i);
    const stream = STREAMS[hash("stream", i) % STREAMS.length];
    const house = pick(seed.houses || ["Crimson", "Azure", "Emerald", "Amber"], "house", i);

    const verified = hash("verif", i) % 100 < 70; // 70% verified
    const mentor = verified && hash("mentor", i) % 100 < 35; // ~25% mentor
    const donor = verified && hash("donor", i) % 100 < 20; // ~14% donor

    // Some alumni have a notable accomplishment blurb
    const hasBlurb = hash("blurb", i) % 100 < 28;
    const blurb = hasBlurb ? pick(ACHIEVEMENT_BLURBS, "ach", i) : null;

    list.push({
      id: `ALM${String(2000 + i + 1)}`,
      name: `${fn} ${ln}`,
      avatar: (fn[0] + ln[0]).toUpperCase(),
      gradYear,
      stream,
      house,
      // Roll number from Lumina (not in active roster — purely historical)
      formerRollNo: `STU${1000 + ((hash("former", i) % 900) + 100)}`,
      destination,
      destinationLabel,
      role,
      city,
      email: emailFor(fn, ln, i),
      phone: phoneFor(i),
      linkedIn: hash("li", i) % 100 < 60
        ? `linkedin.com/in/${fn.toLowerCase()}-${ln.toLowerCase()}-${(i % 90) + 10}`
        : null,
      verified,
      mentor,
      donor,
      donationTotal: donor ? (hash("dontot", i) % 8 + 1) * 25000 : 0, // ₹25k..₹200k
      mentorAreas: mentor
        ? pick(
            [
              ["JEE prep", "Tech career"],
              ["NEET prep"],
              ["Liberal arts", "Study abroad"],
              ["Civil services", "Public policy"],
              ["Startups", "Fundraising"],
              ["Design & creative careers"],
              ["Sports scholarships"],
            ],
            "marea",
            i
          )
        : [],
      blurb,
      notes: null,
      consent: {
        contact: verified,
        directory: true, // they all show up in directory
      },
      lastContactedAt: hash("lc", i) % 100 < 40
        ? new Date(Date.now() - (hash("lcd", i) % 365) * 86400000)
            .toISOString()
            .slice(0, 10)
        : null,
    });
  }

  // Sort newest grad first by default
  return list.sort((a, b) => b.gradYear - a.gradYear);
}

let items = store.load("alumni", buildSeed);
const persist = () => store.save("alumni", items);

function list({
  q,
  gradYear,
  destination,
  stream,
  city,
  mentor,
  donor,
  verified,
  sort = "recent",
} = {}) {
  let out = items.slice();
  if (gradYear && gradYear !== "all") out = out.filter((a) => String(a.gradYear) === String(gradYear));
  if (destination && destination !== "all") out = out.filter((a) => a.destination === destination);
  if (stream && stream !== "all") out = out.filter((a) => a.stream === stream);
  if (city && city !== "all") out = out.filter((a) => a.city === city);
  if (mentor === "true") out = out.filter((a) => a.mentor);
  if (donor === "true") out = out.filter((a) => a.donor);
  if (verified === "true") out = out.filter((a) => a.verified);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (a) =>
        a.id.toLowerCase().includes(t) ||
        a.name.toLowerCase().includes(t) ||
        a.email.toLowerCase().includes(t) ||
        (a.destinationLabel || "").toLowerCase().includes(t) ||
        (a.role || "").toLowerCase().includes(t) ||
        a.city.toLowerCase().includes(t) ||
        String(a.gradYear).includes(t) ||
        a.formerRollNo.toLowerCase().includes(t) ||
        (a.blurb || "").toLowerCase().includes(t)
    );
  }
  if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "oldest") out.sort((a, b) => a.gradYear - b.gradYear);
  else out.sort((a, b) => b.gradYear - a.gradYear);
  return out;
}

function get(id) {
  return items.find((a) => a.id === id) || null;
}

const ALLOWED = [
  "name",
  "gradYear",
  "stream",
  "house",
  "destination",
  "destinationLabel",
  "role",
  "city",
  "email",
  "phone",
  "linkedIn",
  "verified",
  "mentor",
  "donor",
  "mentorAreas",
  "blurb",
  "notes",
  "consent",
  "donationTotal",
  "lastContactedAt",
];

function add(payload) {
  if (!payload.name) throw new Error("name required");
  if (!payload.gradYear) throw new Error("gradYear required");
  const fn = String(payload.name).trim().split(/\s+/)[0] || "A";
  const ln = String(payload.name).trim().split(/\s+/).slice(-1)[0] || "Z";
  const next = items.length + 1;
  const a = {
    id: `ALM${String(2000 + next)}`,
    name: payload.name,
    avatar: (fn[0] + ln[0]).toUpperCase(),
    gradYear: Number(payload.gradYear),
    stream: STREAMS.includes(payload.stream) ? payload.stream : "General",
    house: payload.house || "Crimson",
    formerRollNo: payload.formerRollNo || null,
    destination: DESTINATION_TYPES.includes(payload.destination)
      ? payload.destination
      : "Employed",
    destinationLabel: payload.destinationLabel || null,
    role: payload.role || null,
    city: payload.city || "Bengaluru",
    email: payload.email || `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
    phone: payload.phone || null,
    linkedIn: payload.linkedIn || null,
    verified: payload.verified === true,
    mentor: payload.mentor === true,
    donor: payload.donor === true,
    donationTotal: Number(payload.donationTotal) || 0,
    mentorAreas: Array.isArray(payload.mentorAreas) ? payload.mentorAreas : [],
    blurb: payload.blurb || null,
    notes: payload.notes || null,
    consent: {
      contact: payload.consent?.contact === true,
      directory: payload.consent?.directory !== false,
    },
    lastContactedAt: payload.lastContactedAt || null,
  };
  items.unshift(a);
  persist();
  return a;
}

function update(id, patch) {
  const a = items.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  for (const k of ALLOWED) if (patch[k] !== undefined) a[k] = patch[k];
  if (patch.gradYear !== undefined) a.gradYear = Number(a.gradYear);
  persist();
  return a;
}

function logContact(id, by, channel = "email") {
  const a = items.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  a.lastContactedAt = new Date().toISOString().slice(0, 10);
  a.lastContactBy = by || null;
  a.lastContactChannel = channel;
  persist();
  return a;
}

function remove(id) {
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = items.splice(idx, 1);
  persist();
  return removed;
}

function summary() {
  const total = items.length;
  const verified = items.filter((a) => a.verified).length;
  const mentors = items.filter((a) => a.mentor).length;
  const donors = items.filter((a) => a.donor).length;
  const donationTotal = items.reduce((s, a) => s + (a.donationTotal || 0), 0);

  const byDestination = DESTINATION_TYPES.reduce((acc, d) => {
    acc[d] = items.filter((a) => a.destination === d).length;
    return acc;
  }, {});

  // Graduations per year (last 10 years inclusive)
  const currentYear = new Date().getFullYear();
  const byGradYear = [];
  for (let y = currentYear - 10; y < currentYear; y++) {
    byGradYear.push({
      year: y,
      count: items.filter((a) => a.gradYear === y).length,
    });
  }

  const cityCounts = {};
  items.forEach((a) => {
    cityCounts[a.city] = (cityCounts[a.city] || 0) + 1;
  });
  const topCities = Object.entries(cityCounts)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Featured mentors (verified + mentor + maybe a blurb)
  const featuredMentors = items
    .filter((a) => a.mentor && a.verified)
    .slice(0, 6);

  // Top donors
  const topDonors = items
    .filter((a) => a.donor)
    .sort((a, b) => (b.donationTotal || 0) - (a.donationTotal || 0))
    .slice(0, 5);

  return {
    total,
    verified,
    mentors,
    donors,
    donationTotal,
    byDestination,
    byGradYear,
    topCities,
    featuredMentors,
    topDonors,
  };
}

module.exports = {
  STREAMS,
  DESTINATION_TYPES,
  alumni: () => items,
  list,
  get,
  add,
  update,
  remove,
  logContact,
  summary,
};
