// Admin-created login accounts.
// The 7 demo users in users.js stay as fixed seed accounts; anything created
// through the Users & Access admin page lives here, persisted via store.js.
//
// Each entry shape:
//   {
//     id, role, email, name, avatar, phone, photoUrl, passwordHash,
//     createdAt, createdBy,
//     // optional link to a domain record this account was created for:
//     sourceType: "student" | "teacher" | "staff" | null,
//     sourceId:   "STU0001" | "TCH101"  | "STF001" | null,
//   }

const bcrypt = require("bcryptjs");
const store = require("./store");

let extras = store.load("users-extra", () => []);
const persist = () => store.save("users-extra", extras);

function all() {
  return extras;
}

function findByEmail(email) {
  const key = String(email).toLowerCase();
  return extras.find((u) => u.email.toLowerCase() === key) || null;
}

function findById(id) {
  return extras.find((u) => u.id === id) || null;
}

function nextId() {
  // U001-U007 are seeded; admin-created start at U100 so the two ranges
  // are visually distinguishable in any future debug dump.
  const used = new Set(extras.map((u) => u.id));
  let n = 100;
  while (used.has(`U${String(n).padStart(3, "0")}`)) n += 1;
  return `U${String(n).padStart(3, "0")}`;
}

function add({
  role,
  email,
  name,
  password,
  avatar,
  phone,
  photoUrl,
  sourceType,
  sourceId,
  createdBy,
}) {
  if (!role) throw new Error("role required");
  if (!email) throw new Error("email required");
  if (!name) throw new Error("name required");
  if (!password || String(password).length < 6)
    throw new Error("password must be at least 6 characters");
  if (findByEmail(email)) throw new Error("email already in use");
  const entry = {
    id: nextId(),
    role,
    email: String(email).trim(),
    name: String(name).trim(),
    avatar:
      (avatar && String(avatar).slice(0, 3).toUpperCase()) ||
      String(name)
        .split(/\s+/)
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    phone: phone ? String(phone).trim() : null,
    photoUrl: photoUrl || null,
    passwordHash: bcrypt.hashSync(String(password), 10),
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    sourceType: sourceType || null,
    sourceId: sourceId || null,
  };
  extras.push(entry);
  persist();
  return entry;
}

function update(id, patch) {
  const u = findById(id);
  if (!u) return null;
  if (patch.role !== undefined) u.role = patch.role;
  if (patch.name !== undefined) u.name = String(patch.name).trim();
  if (patch.email !== undefined) {
    const newEmail = String(patch.email).trim();
    const clash = findByEmail(newEmail);
    if (clash && clash.id !== id) throw new Error("email already in use");
    u.email = newEmail;
  }
  if (patch.phone !== undefined)
    u.phone = patch.phone ? String(patch.phone).trim() : null;
  if (patch.avatar !== undefined)
    u.avatar = String(patch.avatar).slice(0, 3).toUpperCase();
  if (patch.photoUrl !== undefined) u.photoUrl = patch.photoUrl || null;
  if (patch.hiddenPaths !== undefined) {
    u.hiddenPaths = Array.isArray(patch.hiddenPaths)
      ? patch.hiddenPaths.filter((p) => typeof p === "string").slice(0, 200)
      : [];
  }
  if (patch.hiddenWidgets !== undefined) {
    u.hiddenWidgets = Array.isArray(patch.hiddenWidgets)
      ? patch.hiddenWidgets.filter((p) => typeof p === "string").slice(0, 200)
      : [];
  }
  if (patch.linkedStudentIds !== undefined) {
    u.linkedStudentIds = Array.isArray(patch.linkedStudentIds)
      ? Array.from(
          new Set(patch.linkedStudentIds.filter((p) => typeof p === "string"))
        ).slice(0, 20)
      : [];
  }
  if (patch.linkedTeacherId !== undefined) {
    u.linkedTeacherId = patch.linkedTeacherId
      ? String(patch.linkedTeacherId)
      : null;
  }
  if (patch.scopeStudentId !== undefined) {
    u.scopeStudentId = patch.scopeStudentId
      ? String(patch.scopeStudentId)
      : null;
  }
  if (patch.sourceType !== undefined) u.sourceType = patch.sourceType || null;
  if (patch.sourceId !== undefined) u.sourceId = patch.sourceId || null;
  if (patch.twoFactor !== undefined) u.twoFactor = patch.twoFactor || null;
  persist();
  return u;
}

function remove(id) {
  const i = extras.findIndex((u) => u.id === id);
  if (i === -1) return false;
  extras.splice(i, 1);
  persist();
  return true;
}

function setPasswordHash(id, hash) {
  const u = findById(id);
  if (!u) return false;
  u.passwordHash = hash;
  persist();
  return true;
}

function isExtra(id) {
  return !!findById(id);
}

module.exports = {
  all,
  findByEmail,
  findById,
  add,
  update,
  remove,
  setPasswordHash,
  isExtra,
};
