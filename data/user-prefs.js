// Per-user persistent preferences layered on top of the hardcoded demo
// accounts in `data/users.js`. Saving here lets users update their own
// profile / password without us mutating the seed accounts.
//
// Shape: { [userId]: { phone?, displayName?, avatar?, passwordHash? } }

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

module.exports = { getOverlay, patchOverlay, setPasswordHash };
