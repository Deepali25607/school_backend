// RFC 6238 TOTP / RFC 4226 HOTP implemented on top of Node's built-in crypto.
// No external dependency — works with any standard authenticator app
// (Google Authenticator, Authy, 1Password, etc.). BRD §12 two-factor auth.

const crypto = require("crypto");

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

// Generate a random base32 secret (default 20 bytes → 32 base32 chars).
function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret) {
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

function generate(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

// Verify a token, tolerating ±`window` time-steps for clock drift.
function verify(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let w = -window; w <= window; w++) {
    if (hotp(secretBuf, counter + w) === clean) return true;
  }
  return false;
}

// Build an otpauth:// URI the user can scan or paste into an authenticator app.
function otpauthURL({ secret, label, issuer = "Lumina School" }) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = { generateSecret, generate, verify, otpauthURL };
