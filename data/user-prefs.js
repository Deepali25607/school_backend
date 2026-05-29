// Per-user persistent preferences layered on top of the hardcoded demo
// accounts in `data/users.js`. Saving here lets users update their own
// profile / password without us mutating the seed accounts.
//
// Shape: { [userId]: {
//   phone?, displayName?, avatar?, photoUrl?, passwordHash?,
//   hiddenPaths?: string[], // admin-imposed sidebar hides (server-enforced)
//   scopeStudentId?: string,// admin-set link to a Student record (overrides default)
// } }

const store = require("./store");

let prefs = store.load("user-prefs", () => ({}));
const persist = () => store.save("user-prefs", prefs);

function getOverlay(userId) {
  return prefs[userId] || null;
}

function patchOverlay(userId, patch) {
  if (!userId) throw new Error("userId required");
  const next = { ...(prefs[userId] || {}) };
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue;
    next[k] = patch[k];
  }
  prefs[userId] = next;
  persist();
  return next;
}

function setPasswordHash(userId, hash) {
  return patchOverlay(userId, { passwordHash: hash });
}

function setHiddenPaths(userId, paths) {
  const arr = Array.isArray(paths)
    ? paths.filter((p) => typeof p === "string").slice(0, 200)
    : [];
  return patchOverlay(userId, { hiddenPaths: arr });
}

function setHiddenWidgets(userId, widgets) {
  const arr = Array.isArray(widgets)
    ? widgets.filter((p) => typeof p === "string").slice(0, 200)
    : [];
  return patchOverlay(userId, { hiddenWidgets: arr });
}

function setScopeStudentId(userId, studentId) {
  return patchOverlay(userId, {
    scopeStudentId: studentId ? String(studentId) : null,
  });
}

function setLinkedStudentIds(userId, ids) {
  const arr = Array.isArray(ids)
    ? Array.from(new Set(ids.filter((p) => typeof p === "string"))).slice(0, 20)
    : [];
  return patchOverlay(userId, { linkedStudentIds: arr });
}

function setLinkedTeacherId(userId, teacherId) {
  return patchOverlay(userId, {
    linkedTeacherId: teacherId ? String(teacherId) : null,
  });
}

module.exports = {
  getOverlay,
  patchOverlay,
  setPasswordHash,
  setHiddenPaths,
  setHiddenWidgets,
  setScopeStudentId,
  setLinkedStudentIds,
  setLinkedTeacherId,
};
