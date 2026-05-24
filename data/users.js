const bcrypt = require("bcryptjs");
const userPrefs = require("./user-prefs");

// Demo accounts — one per role. Password is the same for all: "lumina1234"
// (intentionally easy in dev; hashed at startup so it's never stored in plain text).
const DEMO_PASSWORD = "lumina1234";

const RAW_USERS = [
  { id: "U001", role: "admin",      email: "admin@lumina.edu",      name: "Ada Lovelace",  avatar: "AL" },
  { id: "U002", role: "principal",  email: "principal@lumina.edu",  name: "Dr. Riya Mehta", avatar: "RM" },
  { id: "U003", role: "teacher",    email: "teacher@lumina.edu",    name: "Marcus Chen",   avatar: "MC" },
  { id: "U004", role: "student",    email: "student@lumina.edu",    name: "Aarav Sharma",  avatar: "AS" },
  { id: "U005", role: "parent",     email: "parent@lumina.edu",     name: "Priya Sharma",  avatar: "PS" },
  { id: "U006", role: "accountant", email: "accountant@lumina.edu", name: "Sofia Reyes",   avatar: "SR" },
  { id: "U007", role: "hr",         email: "hr@lumina.edu",         name: "Ken Tanaka",    avatar: "KT" },
];

// Pre-hash at module load (sync is fine, runs once).
const seedUsers = RAW_USERS.map((u) => ({
  ...u,
  phone: null,
  passwordHash: bcrypt.hashSync(DEMO_PASSWORD, 10),
}));

// `users` is exposed as a getter so any code reading it sees overlays applied.
function applyOverlay(u) {
  const ov = userPrefs.getOverlay(u.id);
  if (!ov) return u;
  return {
    ...u,
    name: ov.displayName || u.name,
    phone: ov.phone !== undefined ? ov.phone : u.phone,
    avatar: ov.avatar || u.avatar,
    photoUrl: ov.photoUrl || u.photoUrl || null,
    passwordHash: ov.passwordHash || u.passwordHash,
  };
}

const usersProxy = new Proxy(seedUsers, {
  get(target, prop) {
    if (prop === "find") {
      return (fn) => {
        const raw = target.find(fn);
        return raw ? applyOverlay(raw) : raw;
      };
    }
    if (prop === "filter") {
      return (fn) => target.map(applyOverlay).filter(fn);
    }
    if (prop === "map") {
      return (fn) => target.map(applyOverlay).map(fn);
    }
    if (prop === "forEach") {
      return (fn) => target.map(applyOverlay).forEach(fn);
    }
    if (prop === Symbol.iterator) {
      return function* () {
        for (const u of target) yield applyOverlay(u);
      };
    }
    return Reflect.get(target, prop);
  },
});

function publicUser(u) {
  // strip the hash before sending to client
  const { passwordHash, ...safe } = u;
  return safe;
}

function findByEmail(email) {
  const raw = seedUsers.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase()
  );
  return raw ? applyOverlay(raw) : null;
}

function findById(id) {
  const raw = seedUsers.find((u) => u.id === id);
  return raw ? applyOverlay(raw) : null;
}

function findByRole(role) {
  const raw = seedUsers.find((u) => u.role === role);
  return raw ? applyOverlay(raw) : null;
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.passwordHash);
}

function updateProfile(userId, patch) {
  // Allow updating displayName, phone, avatar, photoUrl — anything else is rejected
  const allowed = {};
  if (patch.name !== undefined) allowed.displayName = String(patch.name).trim();
  if (patch.phone !== undefined) allowed.phone = patch.phone ? String(patch.phone).trim() : null;
  if (patch.avatar !== undefined) allowed.avatar = String(patch.avatar).slice(0, 3).toUpperCase();
  if (patch.photoUrl !== undefined) {
    const v = patch.photoUrl;
    if (v !== null && v !== "") {
      if (typeof v !== "string")
        throw new Error("photoUrl must be a string");
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v))
        throw new Error("photoUrl must be a data:image/... base64 URL");
      if (v.length > 256 * 1024)
        throw new Error("photoUrl too large (max 256 KB)");
    }
    allowed.photoUrl = v || null;
  }
  if (Object.keys(allowed).length === 0) throw new Error("Nothing to update");
  userPrefs.patchOverlay(userId, allowed);
  return findById(userId);
}

function changePassword(userId, currentPassword, newPassword) {
  const user = findById(userId);
  if (!user) throw new Error("User not found");
  if (!currentPassword || !newPassword) throw new Error("Missing password");
  if (String(newPassword).length < 6)
    throw new Error("New password must be at least 6 characters");
  if (!verifyPassword(user, currentPassword))
    throw new Error("Current password is incorrect");
  const hash = bcrypt.hashSync(newPassword, 10);
  userPrefs.setPasswordHash(userId, hash);
  return true;
}

module.exports = {
  DEMO_PASSWORD,
  users: usersProxy,
  publicUser,
  findByEmail,
  findById,
  findByRole,
  verifyPassword,
  updateProfile,
  changePassword,
};
