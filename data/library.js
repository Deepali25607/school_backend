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

function buildBooks() {
  const list = [];
  TITLES.forEach((t, idx) => {
    const copies = 4 + (idx % 5);
    const issued = idx % 4 === 0 ? 1 + (idx % 3) : idx % 3;
    list.push({
      id: `BK${String(10000 + idx + 1)}`,
      isbn: `978-0-${String(140000 + idx * 31).slice(0, 6)}-${10 + (idx % 89)}-${idx % 9}`,
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
let _issueSeq = state.seq || issues.length + 1;
function persist() {
  store.save("library", { books, issues, seq: _issueSeq });
}

function issueBook({ bookId, studentId, days = 14 }) {
  const book = books.find((b) => b.id === bookId);
  if (!book) throw new Error("Book not found");
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
  persist();
  return rec;
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

module.exports = { books, issues, issueBook, returnBook };
