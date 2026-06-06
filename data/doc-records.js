// Personal document records ("the file cabinet") for any person in the system —
// students and teachers/staff. These are the *actual papers on file* (Birth
// Certificate, Aadhaar, Marksheets, Degree certificates, etc.), each tracked
// with an uploaded / verified state — distinct from data/documents.js, which is
// the certificate *issuance* workflow (TC, Bonafide, ID cards the school emits).
//
// Records are keyed by (ownerType, ownerId) so the same store backs every kind
// of profile. Persistence: file-backed JSON via data/store, like every other
// module.

const store = require("./store");

const OWNER_TYPES = ["student", "teacher"];

// Suggested document checklist per owner type — surfaced as quick-add chips in
// the UI. Not enforced; staff can add any custom-named document.
const SUGGESTED = {
  student: [
    "Birth Certificate",
    "Previous Marksheet",
    "Transfer Certificate",
    "Aadhaar",
    "Passport Photo",
    "Medical Certificate",
    "Address Proof",
  ],
  teacher: [
    "Resume / CV",
    "Degree Certificate",
    "Aadhaar",
    "PAN Card",
    "Experience Letter",
    "Address Proof",
    "Passport Photo",
    "Police Verification",
  ],
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

let records = store.load("doc-records", () => []);
const persist = () => store.save("doc-records", records);

function nextId() {
  let max = 1000;
  for (const r of records) {
    const n = parseInt(String(r.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DR${max + 1}`;
}

function listFor(ownerType, ownerId) {
  return records.filter((r) => r.ownerType === ownerType && r.ownerId === ownerId);
}

function summaryFor(ownerType, ownerId) {
  const list = listFor(ownerType, ownerId);
  return {
    total: list.length,
    uploaded: list.filter((r) => r.uploaded).length,
    verified: list.filter((r) => r.verified).length,
    missing: list.filter((r) => !r.uploaded).length,
  };
}

function get(id) {
  return records.find((r) => r.id === id) || null;
}

function add({ ownerType, ownerId, name, uploaded, verified, fileName, note }) {
  if (!OWNER_TYPES.includes(ownerType)) throw new Error("Invalid ownerType");
  if (!ownerId) throw new Error("ownerId required");
  const clean = String(name || "").trim();
  if (!clean) throw new Error("document name required");
  // Avoid duplicate same-named documents for the same owner.
  const existing = listFor(ownerType, ownerId).find(
    (r) => r.name.toLowerCase() === clean.toLowerCase()
  );
  if (existing) throw new Error("A document with that name already exists");
  const rec = {
    id: nextId(),
    ownerType,
    ownerId,
    name: clean,
    uploaded: !!uploaded,
    verified: !!verified,
    fileName: fileName || null,
    note: note || "",
    updatedOn: today(),
  };
  if (rec.verified) rec.uploaded = true;
  if (!rec.uploaded) rec.verified = false;
  records.unshift(rec);
  persist();
  return rec;
}

function update(id, patch) {
  const r = get(id);
  if (!r) throw new Error("Not found");
  if (patch.name !== undefined) {
    const clean = String(patch.name).trim();
    if (!clean) throw new Error("document name cannot be empty");
    r.name = clean;
  }
  if (patch.note !== undefined) r.note = patch.note;
  if (patch.fileName !== undefined) r.fileName = patch.fileName || null;
  if (patch.uploaded !== undefined) {
    r.uploaded = !!patch.uploaded;
    if (!r.uploaded) {
      r.verified = false; // a missing doc can't stay verified
      r.fileName = null;
    }
  }
  if (patch.verified !== undefined) {
    r.verified = !!patch.verified;
    if (r.verified) r.uploaded = true; // verifying implies the doc was received
  }
  r.updatedOn = today();
  persist();
  return r;
}

function remove(id) {
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("Not found");
  const [removed] = records.splice(idx, 1);
  persist();
  return removed;
}

// Carry a freshly-enrolled applicant's enquiry documents into their new student
// record. Skips owners that already have records so it stays idempotent.
function seedFromApplicant(studentId, applicantDocs) {
  if (listFor("student", studentId).length > 0) return [];
  const created = [];
  for (const d of applicantDocs || []) {
    if (!d || !d.name) continue;
    created.push(
      add({
        ownerType: "student",
        ownerId: studentId,
        name: d.name,
        uploaded: !!d.uploaded,
        verified: !!d.verified,
      })
    );
  }
  return created;
}

module.exports = {
  OWNER_TYPES,
  SUGGESTED,
  listFor,
  summaryFor,
  get,
  add,
  update,
  remove,
  seedFromApplicant,
};
