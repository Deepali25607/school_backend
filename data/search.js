// Cross-module search aggregator.
//
// Given a query string `q`, scan a curated set of collections and return up to
// LIMIT_PER_CATEGORY hits per category. Hits are normalised to a common shape
// so the frontend can render them uniformly:
//
//   { category, id, label, sublabel, link, icon }
//
// Search is case-insensitive substring match on a small set of "searchable"
// fields per collection. Not a full-text engine — just good enough that any
// item visible in any module can be found by name / ID / obvious metadata.

const seed = require("./seed");
const admissionsData = require("./admissions");
const documentsData = require("./documents");
const libraryData = require("./library");
const visitorsData = require("./visitors");
const maintenanceData = require("./maintenance");
const inventoryData = require("./inventory");
const eventsData = require("./events");
const hostelData = require("./hostel");
const healthData = require("./health");
const disciplineData = require("./discipline");
const achievementsData = require("./achievements");
const feePaymentsData = require("./fee-payments");
const alumniData = require("./alumni");
const noticesData = require("./notices");
const pollsData = require("./polls");
const scholarshipsData = require("./scholarships");
const fundraisingData = require("./fundraising");
const suggestionsData = require("./suggestions");

const LIMIT_PER_CATEGORY = 5;

function matches(term, ...fields) {
  if (!term) return false;
  for (const f of fields) {
    if (f && String(f).toLowerCase().includes(term)) return true;
  }
  return false;
}

function search(rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase();
  if (q.length < 1) return { q, total: 0, groups: [] };

  const groups = [];

  // -- Students --
  const studentHits = [];
  for (const s of seed.students) {
    if (
      matches(q, s.name, s.id, s.parent, s.contact, `grade ${s.grade}`, s.house)
    ) {
      studentHits.push({
        category: "Students",
        id: s.id,
        label: s.name,
        sublabel: `${s.id} · Grade ${s.grade}-${s.section} · ${s.house}`,
        link: `/app/students/${s.id}`,
        icon: "Users",
        avatar: s.avatar,
      });
      if (studentHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (studentHits.length) groups.push({ category: "Students", items: studentHits });

  // -- Teachers --
  const teacherHits = [];
  for (const t of seed.teachers) {
    if (matches(q, t.name, t.id, t.email, t.subject)) {
      teacherHits.push({
        category: "Teachers",
        id: t.id,
        label: t.name,
        sublabel: `${t.id} · ${t.subject} · ${t.status}`,
        link: `/app/teachers/${t.id}`,
        icon: "GraduationCap",
        avatar: t.avatar,
      });
      if (teacherHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (teacherHits.length) groups.push({ category: "Teachers", items: teacherHits });

  // -- Admissions --
  const admHits = [];
  for (const a of admissionsData.applicants()) {
    if (matches(q, a.name, a.id, a.parent, a.phone)) {
      admHits.push({
        category: "Admissions",
        id: a.id,
        label: a.name,
        sublabel: `${a.id} · Grade ${a.grade} · ${a.stage}`,
        link: `/app/admissions`,
        icon: "UserPlus",
      });
      if (admHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (admHits.length) groups.push({ category: "Admissions", items: admHits });

  // -- Documents --
  const docHits = [];
  const studentsById = new Map(seed.students.map((s) => [s.id, s]));
  for (const d of documentsData.docs()) {
    const student = studentsById.get(d.studentId);
    if (
      matches(q, d.id, d.certificateNo, d.type, d.purpose, d.studentId, student?.name)
    ) {
      docHits.push({
        category: "Documents",
        id: d.id,
        label: `${d.type} · ${student?.name || d.studentId}`,
        sublabel: `${d.id} · ${d.status}${d.certificateNo ? ` · ${d.certificateNo}` : ""}`,
        link: `/app/documents`,
        icon: "FileText",
      });
      if (docHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (docHits.length) groups.push({ category: "Documents", items: docHits });

  // -- Library books --
  // libraryData.books is exposed as an array (not a function) — see library.js
  const bookHits = [];
  for (const b of libraryData.books) {
    if (matches(q, b.title, b.author, b.isbn, b.category)) {
      bookHits.push({
        category: "Library",
        id: b.id,
        label: b.title,
        sublabel: `${b.author} · ${b.category} · ${b.available}/${b.copies} avail`,
        link: `/app/library`,
        icon: "Library",
      });
      if (bookHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (bookHits.length) groups.push({ category: "Library", items: bookHits });

  // -- Visitors --
  const visHits = [];
  for (const v of visitorsData.visitors()) {
    if (matches(q, v.name, v.phone, v.pass, v.host, v.purpose)) {
      visHits.push({
        category: "Visitors",
        id: v.id,
        label: v.name,
        sublabel: `${v.pass} · for ${v.host} · ${v.checkOutAt ? "checked out" : "on premises"}`,
        link: `/app/visitors`,
        icon: "IdCard",
      });
      if (visHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (visHits.length) groups.push({ category: "Visitors", items: visHits });

  // -- Maintenance tickets --
  const mxHits = [];
  for (const t of maintenanceData.tickets()) {
    if (matches(q, t.id, t.title, t.location, t.category, t.reportedBy, t.assignedTo)) {
      mxHits.push({
        category: "Maintenance",
        id: t.id,
        label: t.title,
        sublabel: `${t.id} · ${t.priority} · ${t.stage} · ${t.location}`,
        link: `/app/maintenance`,
        icon: "Wrench",
      });
      if (mxHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (mxHits.length) groups.push({ category: "Maintenance", items: mxHits });

  // -- Inventory --
  const invHits = [];
  for (const item of inventoryData.assets()) {
    if (matches(q, item.id, item.name, item.sku, item.category)) {
      invHits.push({
        category: "Inventory",
        id: item.id,
        label: item.name,
        sublabel: `${item.sku} · ${item.category} · ${item.qty} in stock`,
        link: `/app/inventory`,
        icon: "Package",
      });
      if (invHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (invHits.length) groups.push({ category: "Inventory", items: invHits });

  // -- Events --
  const eventHits = [];
  for (const e of eventsData.events()) {
    if (matches(q, e.title, e.where, e.category, e.id)) {
      eventHits.push({
        category: "Events",
        id: e.id,
        label: e.title,
        sublabel: `${e.date} · ${e.where} · ${e.category}`,
        link: `/app/events`,
        icon: "Calendar",
      });
      if (eventHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (eventHits.length) groups.push({ category: "Events", items: eventHits });

  // -- Hostel rooms --
  const hostHits = [];
  for (const r of hostelData.rooms()) {
    if (
      matches(q, r.id, r.block, `${r.number}`, `room ${r.number}`, ...(r.occupants || []).map((o) => o.studentId))
    ) {
      hostHits.push({
        category: "Hostel",
        id: r.id,
        label: `${r.block} · Room ${r.number}`,
        sublabel: `${r.occupants.length}/${r.capacity} occupied · ${r.gender}`,
        link: `/app/hostel`,
        icon: "Building2",
      });
      if (hostHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (hostHits.length) groups.push({ category: "Hostel", items: hostHits });

  // -- Health profiles (only by allergy/condition + student lookup) --
  const healthHits = [];
  for (const p of healthData.profiles()) {
    const student = studentsById.get(p.studentId);
    if (
      matches(
        q,
        p.studentId,
        student?.name,
        ...(p.allergies || []),
        ...(p.chronicConditions || []),
        p.bloodGroup
      )
    ) {
      healthHits.push({
        category: "Health",
        id: p.studentId,
        label: student?.name || p.studentId,
        sublabel: `${p.bloodGroup}${p.allergies.length ? " · " + p.allergies.length + " allergies" : ""}${p.chronicConditions.length ? " · " + p.chronicConditions.length + " conditions" : ""}`,
        link: `/app/health`,
        icon: "HeartPulse",
      });
      if (healthHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (healthHits.length) groups.push({ category: "Health", items: healthHits });

  // -- Fee payments --
  const payHits = [];
  for (const p of feePaymentsData.payments()) {
    const student = studentsById.get(p.studentId);
    if (
      matches(
        q,
        p.id,
        p.studentId,
        student?.name,
        p.receiptNo,
        p.txnRef,
        p.mode
      )
    ) {
      payHits.push({
        category: "Payments",
        id: p.id,
        label: `${student?.name || p.studentId} · ₹${p.amount.toLocaleString()}`,
        sublabel: `${p.receiptNo || p.id} · ${p.mode} · ${p.status}`,
        link: `/app/fees`,
        icon: "Wallet",
      });
      if (payHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (payHits.length) groups.push({ category: "Payments", items: payHits });

  // -- Achievements --
  const achHits = [];
  for (const a of achievementsData.achievements()) {
    const student = studentsById.get(a.studentId);
    if (
      matches(
        q,
        a.id,
        a.studentId,
        student?.name,
        a.title,
        a.category,
        a.event,
        a.level
      )
    ) {
      achHits.push({
        category: "Achievements",
        id: a.id,
        label: `${a.position} · ${student?.name || a.studentId}`,
        sublabel: `${a.event} · ${a.level} · ${a.date}`,
        link: `/app/achievements`,
        icon: "Trophy",
      });
      if (achHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (achHits.length) groups.push({ category: "Achievements", items: achHits });

  // -- Discipline incidents --
  const incHits = [];
  for (const inc of disciplineData.incidents()) {
    const student = studentsById.get(inc.studentId);
    if (
      matches(
        q,
        inc.id,
        inc.studentId,
        student?.name,
        inc.category,
        inc.description,
        inc.resolution
      )
    ) {
      incHits.push({
        category: "Discipline",
        id: inc.id,
        label: `${inc.category} · ${student?.name || inc.studentId}`,
        sublabel: `${inc.id} · ${inc.severity} · ${inc.status} · ${inc.reportedOn}`,
        link: `/app/discipline`,
        icon: "ShieldAlert",
      });
      if (incHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (incHits.length) groups.push({ category: "Discipline", items: incHits });

  // -- Alumni --
  const almHits = [];
  for (const a of alumniData.alumni()) {
    if (
      matches(
        q,
        a.id,
        a.name,
        a.email,
        a.city,
        a.role,
        a.destinationLabel,
        String(a.gradYear),
        a.formerRollNo,
        a.blurb
      )
    ) {
      almHits.push({
        category: "Alumni",
        id: a.id,
        label: a.name,
        sublabel: `${a.id} · Class of ${a.gradYear} · ${a.destination}${a.destinationLabel ? " · " + a.destinationLabel : ""}`,
        link: `/app/alumni`,
        icon: "Award",
        avatar: a.avatar,
      });
      if (almHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (almHits.length) groups.push({ category: "Alumni", items: almHits });

  // -- Notices --
  const notHits = [];
  for (const n of noticesData.notices()) {
    if (matches(q, n.id, n.title, n.body, n.category, n.postedBy)) {
      notHits.push({
        category: "Notices",
        id: n.id,
        label: n.title,
        sublabel: `${n.id} · ${n.category} · for ${n.audience}${n.pinned ? " · pinned" : ""}`,
        link: `/app/notices`,
        icon: "Megaphone",
      });
      if (notHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (notHits.length) groups.push({ category: "Notices", items: notHits });

  // -- Polls --
  const pollHits = [];
  for (const p of pollsData.polls()) {
    if (matches(q, p.id, p.title, p.description, p.createdBy)) {
      pollHits.push({
        category: "Polls",
        id: p.id,
        label: p.title,
        sublabel: `${p.id} · ${p.status} · ${p.audience}${p.anonymous ? " · anonymous" : ""}`,
        link: `/app/polls`,
        icon: "Vote",
      });
      if (pollHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (pollHits.length) groups.push({ category: "Polls", items: pollHits });

  // -- Scholarships --
  const schHits = [];
  for (const s of scholarshipsData.schemes()) {
    if (matches(q, s.id, s.name, s.type, s.sponsor, s.criteria)) {
      schHits.push({
        category: "Scholarships",
        id: s.id,
        label: s.name,
        sublabel: `${s.id} · ${s.type} · ${s.slots} slots`,
        link: `/app/scholarships`,
        icon: "Landmark",
      });
      if (schHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (schHits.length) groups.push({ category: "Scholarships", items: schHits });

  // -- Campaigns --
  const camHits = [];
  for (const c of fundraisingData.campaigns()) {
    if (matches(q, c.id, c.title, c.story, c.category, c.beneficiary)) {
      camHits.push({
        category: "Campaigns",
        id: c.id,
        label: c.title,
        sublabel: `${c.id} · ${c.category} · ${c.status}`,
        link: `/app/fundraising`,
        icon: "Target",
      });
      if (camHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (camHits.length) groups.push({ category: "Campaigns", items: camHits });

  // -- Suggestions --
  const sugHits = [];
  for (const i of suggestionsData.ideas()) {
    if (matches(q, i.id, i.title, i.body, i.category, i.submittedBy)) {
      sugHits.push({
        category: "Ideas",
        id: i.id,
        label: i.title,
        sublabel: `${i.id} · ${i.category} · ${i.status} · ${i.upvoterIds.length} votes`,
        link: `/app/suggestions`,
        icon: "Lightbulb",
      });
      if (sugHits.length >= LIMIT_PER_CATEGORY) break;
    }
  }
  if (sugHits.length) groups.push({ category: "Ideas", items: sugHits });

  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return { q: rawQuery, total, groups };
}

module.exports = { search };
