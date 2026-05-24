// Tiny file-backed persistence layer.
// - Each "collection" lives in its own JSON file under DB_DIR
// - load(name, seed) reads from disk on boot; if absent, seeds it
// - save(name, value) writes immediately and atomically (tmp + rename)
//
// Pure-JS, no native deps, ships fine in Alpine.

const fs = require("fs");
const path = require("path");

const DB_DIR = process.env.DB_DIR || path.join(__dirname, "..", "db");

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function fileFor(name) {
  return path.join(DB_DIR, `${name}.json`);
}

/**
 * Load a named collection from disk. If the file doesn't exist, runs `seed()`
 * to generate initial data, persists it, and returns it.
 *
 * @param {string} name        Collection name (file stem)
 * @param {() => any} seed     Factory function returning initial data
 */
function load(name, seed) {
  ensureDir();
  const file = fileFor(name);
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn(`[store] failed to read ${name}: ${e.message}; reseeding`);
  }
  const initial = seed();
  save(name, initial);
  return initial;
}

/** Atomically write JSON to disk (tmp file + rename). */
function save(name, value) {
  ensureDir();
  const file = fileFor(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** Snapshot every JSON collection under DB_DIR as a plain object. */
function snapshot() {
  ensureDir();
  const entries = {};
  for (const f of fs.readdirSync(DB_DIR)) {
    if (!f.endsWith(".json") || f.endsWith(".tmp")) continue;
    const name = f.slice(0, -5); // strip .json
    try {
      entries[name] = JSON.parse(fs.readFileSync(path.join(DB_DIR, f), "utf8"));
    } catch (e) {
      console.warn(`[store] skipped corrupt file ${f}: ${e.message}`);
    }
  }
  return entries;
}

/** Replace all collections from a snapshot (created by snapshot()).
 *  Returns the list of collection names written. */
function restore(snapshotData) {
  if (!snapshotData || typeof snapshotData !== "object") {
    throw new Error("snapshot must be an object of { collection: data }");
  }
  const names = Object.keys(snapshotData);
  for (const name of names) save(name, snapshotData[name]);
  return names;
}

module.exports = { load, save, snapshot, restore, DB_DIR };
