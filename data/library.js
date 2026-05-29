const TITLES = [
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", category: "Fiction" },
  { title: "A Brief History of Time", author: "Stephen Hawking", category: "Science" },
  { title: "Sapiens", author: "Yuval Noah Harari", category: "History" },
  { title: "Mathematics for Class 10", author: "NCERT", category: "Textbook" },
  { title: "Chemistry Concepts", author: "P. Bahadur", category: "Textbook" },
  { title: "The Hobbit", author: "J. R. R. Tolkien", category: "Fiction" },
  { title: "Wings of Fire", author: "A. P. J. Abdul Kalam", category: "Biography" },
  { title: "Origin", author: "Dan Brown", category: "Fiction" },
  { title: "Cosmos", author: "Carl Sagan", category: "Science" },
  { title: "The Diary of a Young Girl", author: "Anne Frank", category: "Biography" },
  { title: "Atomic Habits", author: "James Clear", category: "Self-help" },
  { title: "Physics Galaxy", author: "Ashish Arora", category: "Textbook" },
  { title: "Pride and Prejudice", author: "Jane Austen", category: "Fiction" },
  { title: "The Selfish Gene", author: "Richard Dawkins", category: "Science" },
  { title: "Steve Jobs", author: "Walter Isaacson", category: "Biography" },
  { title: "Indian History — Spectrum", author: "Rajiv Ahir", category: "History" },
  { title: "Animal Farm", author: "George Orwell", category: "Fiction" },
  { title: "Brief Answers to the Big Questions", author: "Stephen Hawking", category: "Science" },
  { title: "Wonder", author: "R. J. Palacio", category: "Fiction" },
  { title: "The Power of Now", author: "Eckhart Tolle", category: "Self-help" },
];

// Deterministic EAN-13-style numeric barcode for a book (BRD 7.13).
function barcodeFor(idx) {
  return String(890123400000 + idx * 7);
}

function buildBooks() {
  const list = [];
  TITLES.forEach((t, idx) => {
    const copies = 4 + (idx % 5);
    const issued = idx % 4 === 0 ? 1 + (idx % 3) : idx % 3;
    list.push({
      id: `BK${String(10000 + idx + 1)}`,
      isbn: `978-0-${String(140000 + idx * 31).slice(0, 6)}-${10 + (idx % 89)}-${idx % 9}`,
      barcode: barcodeFor(idx),
      title: t.title,
      author: t.author,
      category: t.category,
      shelf: `${String.fromCharCode(65 + (idx % 6))}-${10 + (idx % 12)}`,
      copies,
      available: Math.max(0, copies - issued),
      issued,
    });
  });
  return list;
}

const store = require("./store");

function seedLibrary() {
  const books = buildBooks();
  const issues = [];
  const now = new Date();
  [0, 2, 4, 6, 8, 10, 12].forEach((i) => {
    const book = books[i];
    if (!book || book.available <= 0) return;
    const issuedOn = new Date(now);
    issuedOn.setDate(now.getDate() - (3 + i * 2));
    const dueOn = new Date(issuedOn);
    dueOn.setDate(issuedOn.getDate() + 14);
    issues.push({
      id: `IS${String(900 + i)}`,
      bookId: book.id,
      studentId: `STU${1000 + (i + 1)}`,
      issuedOn: issuedOn.toISOString().slice(0, 10),
      dueOn: dueOn.toISOString().slice(0, 10),
      returnedOn: null,
      fine: 0,
    });
    book.available = Math.max(0, book.available - 1);
    book.issued += 1;
  });
  return { books, issues, seq: issues.length + 1 };
}

const state = store.load("library", seedLibrary);
const books = state.books;
const issues = state.issues;
// Backfill barcodes for libraries seeded before barcode support existed.
let _barcodeBackfilled = false;
books.forEach((b, idx) => {
  if (!b.barcode) {
    b.barcode = barcodeFor(idx);
    _barcodeBackfilled = true;
  }
});
// Reservations live in the same library bundle so a backup snapshot stays
// consistent with the books/issues they reference.
const reservations = Array.isArray(state.reservations) ? state.reservations : [];
let _issueSeq = state.seq || issues.length + 1;
let _resSeq = state.resSeq || reservations.length + 1;
function persist() {
  store.save("library", {
    books,
    issues,
    reservations,
    seq: _issueSeq,
    resSeq: _resSeq,
  });
}

// Persist any barcodes we backfilled above (deferred until persist() and all
// its referenced state are initialised).
if (_barcodeBackfilled) persist();

function findByBarcode(code) {
  if (!code) return null;
  const c = String(code).trim();
  return books.find((b) => b.barcode === c || b.isbn === c || b.id === c) || null;
}

// Holds expire 4 days after being marked "ready" — covers the weekend
// pickup window without indefinitely tying up a book.
const HOLD_PICKUP_DAYS = 4;
const RES_STATUSES = ["active", "ready", "fulfilled", "cancelled", "expired"];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function issueBook({ bookId, studentId, days = 14 }) {
  const book = books.find((b) => b.id === bookId);
  if (!book) throw new Error("Book not found");
  // If this student has a "ready" hold, redeem it first — the hold has been
  // sitting on a reserved copy, so we release that back to `available` so
  // the standard decrement below works without double-counting.
  fulfillReservationOnIssue(bookId, studentId);
  if (book.available <= 0) throw new Error("No copies available");
  const issuedOn = new Date();
  const dueOn = new Date();
  dueOn.setDate(issuedOn.getDate() + days);
  const rec = {
    id: `IS${String(1000 + _issueSeq++)}`,
    bookId,
    studentId,
    issuedOn: issuedOn.toISOString().slice(0, 10),
    dueOn: dueOn.toISOString().slice(0, 10),
    returnedOn: null,
    fine: 0,
  };
  issues.push(rec);
  book.available -= 1;
  book.issued += 1;
  persist();
  return rec;
}

function returnBook({ issueId }) {
  const rec = issues.find((i) => i.id === issueId);
  if (!rec) throw new Error("Issue not found");
  if (rec.returnedOn) throw new Error("Already returned");
  rec.returnedOn = new Date().toISOString().slice(0, 10);
  const overdueDays = Math.max(
    0,
    Math.floor((new Date() - new Date(rec.dueOn)) / 86400000)
  );
  rec.fine = overdueDays * 5;
  const book = books.find((b) => b.id === rec.bookId);
  if (book) {
    book.available += 1;
    book.issued = Math.max(0, book.issued - 1);
  }
  // Promote the next waiting hold (if any) for this book. We only promote
  // when there's at least one available copy, which we just incremented.
  const promoted = promoteNextHoldFor(rec.bookId);
  persist();
  return { ...rec, promotedReservation: promoted || null };
}

// =========================================================================
// RESERVATIONS / HOLD QUEUE
// =========================================================================

function expireOverdueHolds() {
  const today = isoToday();
  let dirty = false;
  for (const r of reservations) {
    if (r.status === "ready" && r.expiresAt && r.expiresAt < today) {
      r.status = "expired";
      dirty = true;
      // Free the held copy so the next caller can pick it up.
      const book = books.find((b) => b.id === r.bookId);
      if (book && (book.heldCopies || 0) > 0) {
        book.heldCopies -= 1;
        book.available += 1;
      }
      // Cascade: promote the next active hold for this book.
      promoteNextHoldFor(r.bookId);
    }
  }
  if (dirty) persist();
}

function activeQueueFor(bookId) {
  return reservations
    .filter(
      (r) => r.bookId === bookId && (r.status === "active" || r.status === "ready")
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

function queuePosition(bookId, studentId) {
  const q = activeQueueFor(bookId);
  const idx = q.findIndex((r) => r.studentId === studentId);
  return idx === -1 ? null : idx + 1;
}

function promoteNextHoldFor(bookId) {
  const book = books.find((b) => b.id === bookId);
  if (!book || book.available <= 0) return null;
  // The next person waiting is the oldest still-active reservation.
  const next = reservations
    .filter((r) => r.bookId === bookId && r.status === "active")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
  if (!next) return null;
  // Mark them "ready" and reserve one of the available copies so a
  // walk-in patron can't grab it before the queued student.
  next.status = "ready";
  next.readyAt = new Date().toISOString();
  next.expiresAt = isoIn(HOLD_PICKUP_DAYS);
  book.available -= 1;
  book.heldCopies = (book.heldCopies || 0) + 1;
  return { ...next };
}

function reserve({ bookId, studentId }) {
  expireOverdueHolds();
  const book = books.find((b) => b.id === bookId);
  if (!book) throw new Error("Book not found");
  if (!studentId) throw new Error("studentId required");
  // Can't reserve a book you've already borrowed and not returned.
  const openIssue = issues.find(
    (i) => i.bookId === bookId && i.studentId === studentId && !i.returnedOn
  );
  if (openIssue)
    throw new Error("You already have this book checked out");
  // Refuse duplicate active reservations.
  const dupe = reservations.find(
    (r) =>
      r.bookId === bookId &&
      r.studentId === studentId &&
      (r.status === "active" || r.status === "ready")
  );
  if (dupe) {
    throw new Error(
      `You're already in the queue for this title (${dupe.status})`
    );
  }
  const now = new Date().toISOString();
  // If the book has free copies *and* no existing queue, fast-track to ready.
  const queue = activeQueueFor(bookId);
  const startsReady = book.available > 0 && queue.length === 0;
  const rec = {
    id: `RES${String(1000 + _resSeq++)}`,
    bookId,
    studentId,
    requestedAt: now,
    status: startsReady ? "ready" : "active",
    readyAt: startsReady ? now : null,
    expiresAt: startsReady ? isoIn(HOLD_PICKUP_DAYS) : null,
    cancelledAt: null,
    fulfilledAt: null,
  };
  reservations.push(rec);
  if (startsReady) {
    book.available -= 1;
    book.heldCopies = (book.heldCopies || 0) + 1;
  }
  persist();
  return rec;
}

function cancelReservation({ id }) {
  const rec = reservations.find((r) => r.id === id);
  if (!rec) throw new Error("Reservation not found");
  if (rec.status === "fulfilled" || rec.status === "cancelled" || rec.status === "expired")
    throw new Error("Reservation is no longer active");
  const wasReady = rec.status === "ready";
  rec.status = "cancelled";
  rec.cancelledAt = new Date().toISOString();
  if (wasReady) {
    const book = books.find((b) => b.id === rec.bookId);
    if (book && (book.heldCopies || 0) > 0) {
      book.heldCopies -= 1;
      book.available += 1;
    }
    // Cascade to the next waiting hold.
    promoteNextHoldFor(rec.bookId);
  }
  persist();
  return rec;
}

function fulfillReservationOnIssue(bookId, studentId) {
  const rec = reservations.find(
    (r) =>
      r.bookId === bookId &&
      r.studentId === studentId &&
      r.status === "ready"
  );
  if (!rec) return null;
  rec.status = "fulfilled";
  rec.fulfilledAt = new Date().toISOString();
  const book = books.find((b) => b.id === bookId);
  if (book && (book.heldCopies || 0) > 0) {
    book.heldCopies -= 1;
    // available was already deducted when we put the hold on it, so we
    // don't decrement it again here. issueBook below will handle that.
    book.available += 1; // restore so issueBook decrements once cleanly
  }
  persist();
  return rec;
}

function listReservations({ studentId, status, bookId } = {}) {
  expireOverdueHolds();
  let out = reservations;
  if (studentId) out = out.filter((r) => r.studentId === studentId);
  if (status) out = out.filter((r) => r.status === status);
  if (bookId) out = out.filter((r) => r.bookId === bookId);
  return [...out].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

function reservationSummary() {
  expireOverdueHolds();
  const counts = { active: 0, ready: 0, fulfilled: 0, cancelled: 0, expired: 0 };
  for (const r of reservations) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

// (legacy unused seed — kept for reference)
function _seedIssuesLegacy() {
  const now = new Date();
  [0, 2, 4, 6, 8, 10, 12].forEach((i) => {
    const book = books[i];
    if (!book || book.available <= 0) return;
    const issuedOn = new Date(now);
    issuedOn.setDate(now.getDate() - (3 + i * 2));
    const dueOn = new Date(issuedOn);
    dueOn.setDate(issuedOn.getDate() + 14);
    issues.push({
      id: `IS${String(900 + i)}`,
      bookId: book.id,
      studentId: `STU${1000 + (i + 1)}`,
      issuedOn: issuedOn.toISOString().slice(0, 10),
      dueOn: dueOn.toISOString().slice(0, 10),
      returnedOn: null,
      fine: 0,
    });
    book.available = Math.max(0, book.available - 1);
    book.issued += 1;
  });
}

module.exports = {
  books,
  issues,
  reservations,
  issueBook,
  returnBook,
  reserve,
  cancelReservation,
  listReservations,
  reservationSummary,
  queuePosition,
  activeQueueFor,
  expireOverdueHolds,
  findByBarcode,
  HOLD_PICKUP_DAYS,
};
