// Self-service password reset tokens.
//
// Flow:
//   1. User requests reset by email → createToken(email) generates a
//      single-use 32-char token with a 30-minute TTL.
//   2. User submits token + new password → consumeToken(token, newPassword)
//      validates and marks the token used.
//
// Notes:
//   - Tokens never reveal whether the email is registered (the route always
//     returns ok=true).
//   - Used / expired tokens are pruned lazily on every access so the file
//     doesn't grow without bound.
//   - We log the issued token to stdout in dev so manual testing is easy
//     (real systems would email it instead).

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const store = require("./store");
const usersExtra = require("./users-extra");
const userPrefs = require("./user-prefs");

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TOKENS_PER_USER = 3; // older active tokens for the same user get invalidated

let tokens = store.load("password-resets", () => []);
const persist = () => store.save("password-resets", tokens);

function now() {
  return Date.now();
}

function pruneExpired() {
  const cutoff = now();
  const before = tokens.length;
  tokens = tokens.filter((t) => !t.usedAt && t.expiresAt > cutoff);
  if (tokens.length !== before) persist();
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex"); // 48-char hex
}

/**
 * Create a single-use reset token for the given user. Older active tokens
 * for the same user are invalidated so the most recent request wins (and
 * limits the window of any leaked older link).
 */
function createTokenFor(userId, email) {
  pruneExpired();
  // invalidate older active tokens for the same user
  tokens = tokens.map((t) =>
    t.userId === userId && !t.usedAt
      ? { ...t, usedAt: now(), usedReason: "superseded" }
      : t
  );
  const token = generateToken();
  tokens.push({
    token,
    userId,
    email,
    createdAt: now(),
    expiresAt: now() + TOKEN_TTL_MS,
    usedAt: null,
  });
  // keep file small
  if (tokens.length > MAX_TOKENS_PER_USER * 20) {
    tokens = tokens.slice(-MAX_TOKENS_PER_USER * 20);
  }
  persist();
  return token;
}

function findActive(token) {
  pruneExpired();
  const t = tokens.find((x) => x.token === token);
  if (!t) return null;
  if (t.usedAt) return null;
  if (t.expiresAt <= now()) return null;
  return t;
}

/**
 * Mark a token used and return the userId so the caller can rotate the
 * password. Returns null if the token is missing/expired/used.
 */
function consume(token) {
  const t = findActive(token);
  if (!t) return null;
  t.usedAt = now();
  persist();
  return { userId: t.userId, email: t.email };
}

function setPasswordHash(userId, hash) {
  if (usersExtra.isExtra(userId)) {
    usersExtra.setPasswordHash(userId, hash);
  } else {
    userPrefs.setPasswordHash(userId, hash);
  }
}

function resetPassword(token, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    throw new Error("New password must be at least 6 characters");
  }
  const entry = consume(token);
  if (!entry) throw new Error("Token is invalid or has expired");
  const hash = bcrypt.hashSync(String(newPassword), 10);
  setPasswordHash(entry.userId, hash);
  return entry;
}

module.exports = {
  TOKEN_TTL_MS,
  createTokenFor,
  findActive,
  resetPassword,
};
