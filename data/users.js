const bcrypt = require("bcryptjs");
const userPrefs = require("./user-prefs");
const usersExtra = require("./users-extra");

// Demo accounts — one per role. Password is the same for all: "lumina1234"
// (intentionally easy in dev; hashed at startup so it's never stored in plain text).
const DEMO_PASSWORD = "lumina1234";

const VALID_ROLES = [
  "admin",
  "principal",
  "teacher",
  "student",
  "parent",
  "accountant",
  "hr",
];

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
  source: "seed",
}));

// `users` is exposed as a getter so any code reading it sees overlays applied.
function applyOverlay(u) {
  const ov = userPrefs.getOverlay(u.id) || {};
  return {
    ...u,
    name: ov.displayName || u.name,
    phone: ov.phone !== undefined ? ov.phone : u.phone,
    avatar: ov.avatar || u.avatar,
    photoUrl: ov.photoUrl || u.photoUrl || null,
    passwordHash: ov.passwordHash || u.passwordHash,
    twoFactor: ov.twoFactor || u.twoFactor || null,
    permissions: {
      hiddenPaths:      Array.isArray(ov.hiddenPaths)      ? ov.hiddenPaths      : [],
      hiddenWidgets:    Array.isArray(ov.hiddenWidgets)    ? ov.hiddenWidgets    : [],
      linkedStudentIds: Array.isArray(ov.linkedStudentIds) ? ov.linkedStudentIds : [],
      linkedTeacherId:  ov.linkedTeacherId || u.linkedTeacherId || null,
    },
    scopeStudentId: ov.scopeStudentId || u.scopeStudentId || null,
  };
}

// Combined view: seed users (with overlay) + admin-created users.
// Always rebuilt on access so it reflects current usersExtra state.
function combined() {
  const seedView = seedUsers.map((u) => applyOverlay(u));
  const extraView = usersExtra.all().map((u) => {
    const { hiddenPaths, hiddenWidgets, linkedStudentIds, linkedTeacherId, ...rest } = u;
    return {
      ...rest,
      source: "admin",
      permissions: {
        hiddenPaths:      Array.isArray(hiddenPaths)      ? hiddenPaths      : [],
        hiddenWidgets:    Array.isArray(hiddenWidgets)    ? hiddenWidgets    : [],
        linkedStudentIds: Array.isArray(linkedStudentIds) ? linkedStudentIds : [],
        linkedTeacherId:  linkedTeacherId || null,
      },
    };
  });
  return [...seedView, ...extraView];
}

const usersProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const arr = combined();
      if (prop === "length") return arr.length;
      if (prop === "find") return (fn) => arr.find(fn);
      if (prop === "filter") return (fn) => arr.filter(fn);
      if (prop === "map") return (fn) => arr.map(fn);
      if (prop === "forEach") return (fn) => arr.forEach(fn);
      if (prop === "some") return (fn) => arr.some(fn);
      if (prop === Symbol.iterator) {
        return function* () {
          for (const u of arr) yield u;
        };
      }
      return Reflect.get(arr, prop);
    },
  }
);

function publicUser(u) {
  // strip the hash + raw 2FA secret before sending to client
  const { passwordHash, twoFactor, ...safe } = u;
  safe.twoFactorEnabled = !!(twoFactor && twoFactor.enabled);
  safe.twoFactorPending = !!(twoFactor && twoFactor.pending && !twoFactor.enabled);
  return safe;
}

// ---------- two-factor authentication (TOTP) ----------

function setTwoFactor(userId, tf) {
  if (usersExtra.isExtra(userId)) usersExtra.update(userId, { twoFactor: tf });
  else userPrefs.patchOverlay(userId, { twoFactor: tf });
}

// Begin enrolment: store the secret as `pending` (not yet active). The user
// must confirm a code from their authenticator before it is enabled.
function startTwoFactorSetup(userId, secret) {
  const u = findById(userId);
  if (!u) throw new Error("User not found");
  setTwoFactor(userId, { enabled: false, secret: null, pending: secret });
  return true;
}

function enableTwoFactor(userId) {
  const u = findById(userId);
  if (!u) throw new Error("User not found");
  const pending = u.twoFactor?.pending;
  if (!pending) throw new Error("No pending 2FA setup — start setup first");
  setTwoFactor(userId, { enabled: true, secret: pending, pending: null });
  return true;
}

function disableTwoFactor(userId) {
  const u = findById(userId);
  if (!u) throw new Error("User not found");
  setTwoFactor(userId, { enabled: false, secret: null, pending: null });
  return true;
}

// Returns the active secret for login verification, or the pending secret for
// enrolment confirmation. Internal use only — never sent to the client.
function getTwoFactorSecret(userId, { pending = false } = {}) {
  const u = findById(userId);
  if (!u || !u.twoFactor) return null;
  return pending ? u.twoFactor.pending : u.twoFactor.secret;
}

function isTwoFactorEnabled(user) {
  return !!(user && user.twoFactor && user.twoFactor.enabled);
}

function wrapExtra(u) {
  if (!u) return null;
  const { hiddenPaths, hiddenWidgets, linkedStudentIds, linkedTeacherId, ...rest } = u;
  return {
    ...rest,
    source: "admin",
    permissions: {
      hiddenPaths:      Array.isArray(hiddenPaths)      ? hiddenPaths      : [],
      hiddenWidgets:    Array.isArray(hiddenWidgets)    ? hiddenWidgets    : [],
      linkedStudentIds: Array.isArray(linkedStudentIds) ? linkedStudentIds : [],
      linkedTeacherId:  linkedTeacherId || null,
    },
  };
}

function findByEmail(email) {
  const key = String(email).toLowerCase();
  const seed = seedUsers.find((u) => u.email.toLowerCase() === key);
  if (seed) return applyOverlay(seed);
  return wrapExtra(usersExtra.findByEmail(email));
}

function findById(id) {
  const seed = seedUsers.find((u) => u.id === id);
  if (seed) return applyOverlay(seed);
  return wrapExtra(usersExtra.findById(id));
}

function findByRole(role) {
  // Used by the demo-mode login fallback (role-picker without password).
  // Prefer the seeded user so the demo flow keeps its predictable behaviour.
  const seed = seedUsers.find((u) => u.role === role);
  if (seed) return applyOverlay(seed);
  return wrapExtra(usersExtra.all().find((u) => u.role === role));
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

  // Admin-created users live in usersExtra and own their fields directly
  // (no overlay needed since the file is mutable). Seed users still go
  // through the overlay so the seed array stays immutable.
  if (usersExtra.isExtra(userId)) {
    const map = {};
    if (allowed.displayName !== undefined) map.name = allowed.displayName;
    if (allowed.phone !== undefined) map.phone = allowed.phone;
    if (allowed.avatar !== undefined) map.avatar = allowed.avatar;
    if (allowed.photoUrl !== undefined) map.photoUrl = allowed.photoUrl;
    usersExtra.update(userId, map);
  } else {
    userPrefs.patchOverlay(userId, allowed);
  }
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
  if (usersExtra.isExtra(userId)) {
    usersExtra.setPasswordHash(userId, hash);
  } else {
    userPrefs.setPasswordHash(userId, hash);
  }
  return true;
}

// ---------- admin operations ----------

function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

function countAdmins() {
  return combined().filter((u) => u.role === "admin").length;
}

function adminCreate({ role, email, name, password, avatar, phone, sourceType, sourceId, createdBy }) {
  if (!isValidRole(role)) throw new Error(`role must be one of ${VALID_ROLES.join(", ")}`);
  if (findByEmail(email)) throw new Error("email already in use");
  return usersExtra.add({
    role,
    email,
    name,
    password,
    avatar,
    phone,
    sourceType,
    sourceId,
    createdBy,
  });
}

function adminUpdate(id, patch) {
  if (patch.role !== undefined && !isValidRole(patch.role))
    throw new Error(`role must be one of ${VALID_ROLES.join(", ")}`);
  // Safety: don't allow demoting the last admin via role change.
  if (patch.role && patch.role !== "admin") {
    const current = findById(id);
    if (current?.role === "admin" && countAdmins() <= 1) {
      throw new Error("Cannot demote the last admin");
    }
  }
  if (usersExtra.isExtra(id)) {
    return usersExtra.update(id, patch);
  }
  // For seed users we only allow display fields to change — role/email are fixed.
  if (patch.role !== undefined || patch.email !== undefined) {
    throw new Error("Seed accounts (U001-U007) cannot have role or email changed");
  }
  return updateProfile(id, patch);
}

function adminDelete(id, callerId) {
  if (id === callerId) throw new Error("You cannot delete your own account");
  const u = findById(id);
  if (!u) throw new Error("User not found");
  if (u.role === "admin" && countAdmins() <= 1) {
    throw new Error("Cannot delete the last admin");
  }
  if (!usersExtra.isExtra(id)) {
    throw new Error("Seed accounts (U001-U007) cannot be deleted");
  }
  return usersExtra.remove(id);
}

function adminResetPassword(id, newPassword) {
  if (!newPassword || String(newPassword).length < 6)
    throw new Error("New password must be at least 6 characters");
  const user = findById(id);
  if (!user) throw new Error("User not found");
  const hash = bcrypt.hashSync(String(newPassword), 10);
  if (usersExtra.isExtra(id)) {
    usersExtra.setPasswordHash(id, hash);
  } else {
    userPrefs.setPasswordHash(id, hash);
  }
  return true;
}

function adminSetPermissions(
  id,
  hiddenPaths,
  scopeStudentId,
  hiddenWidgets,
  linkedStudentIds,
  linkedTeacherId
) {
  const user = findById(id);
  if (!user) throw new Error("User not found");
  const cleanedPaths = Array.isArray(hiddenPaths)
    ? hiddenPaths.filter((p) => typeof p === "string").slice(0, 200)
    : null;
  const cleanedWidgets = Array.isArray(hiddenWidgets)
    ? hiddenWidgets.filter((p) => typeof p === "string").slice(0, 200)
    : null;
  const cleanedLinks = Array.isArray(linkedStudentIds)
    ? Array.from(
        new Set(linkedStudentIds.filter((p) => typeof p === "string"))
      ).slice(0, 20)
    : null;
  if (usersExtra.isExtra(id)) {
    const patch = {};
    if (cleanedPaths) patch.hiddenPaths = cleanedPaths;
    if (cleanedWidgets) patch.hiddenWidgets = cleanedWidgets;
    if (cleanedLinks) patch.linkedStudentIds = cleanedLinks;
    if (scopeStudentId !== undefined)
      patch.scopeStudentId = scopeStudentId || null;
    if (linkedTeacherId !== undefined)
      patch.linkedTeacherId = linkedTeacherId || null;
    if (Object.keys(patch).length) usersExtra.update(id, patch);
  } else {
    if (cleanedPaths) userPrefs.setHiddenPaths(id, cleanedPaths);
    if (cleanedWidgets) userPrefs.setHiddenWidgets(id, cleanedWidgets);
    if (cleanedLinks) userPrefs.setLinkedStudentIds(id, cleanedLinks);
    if (scopeStudentId !== undefined)
      userPrefs.setScopeStudentId(id, scopeStudentId || null);
    if (linkedTeacherId !== undefined)
      userPrefs.setLinkedTeacherId(id, linkedTeacherId || null);
  }
  return findById(id);
}

function listAll() {
  return combined().map(publicUser);
}

module.exports = {
  DEMO_PASSWORD,
  VALID_ROLES,
  users: usersProxy,
  publicUser,
  findByEmail,
  findById,
  findByRole,
  verifyPassword,
  updateProfile,
  changePassword,
  isValidRole,
  // two-factor
  startTwoFactorSetup,
  enableTwoFactor,
  disableTwoFactor,
  getTwoFactorSecret,
  isTwoFactorEnabled,
  // admin ops
  listAll,
  adminCreate,
  adminUpdate,
  adminDelete,
  adminResetPassword,
  adminSetPermissions,
};
