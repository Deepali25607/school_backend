// Direct 1:1 messages between platform users.
//
// Schema:
//   threads:  { id, participants:[userId,userId], subject?, studentId?,
//               context: "general"|"assignment"|"ptm"|"discipline"|"health",
//               createdAt, createdBy, lastMessageAt }
//   messages: { id, threadId, fromUserId, body, attachmentUrl?, createdAt,
//               readBy:[userId] }
//
// Threads are de-duplicated by (sorted participants + studentId + context)
// — starting a "new" conversation with the same teacher about the same
// student reuses the existing thread instead of creating a parallel one.

const store = require("./store");

let threads = store.load("message_threads", () => []);
let messages = store.load("message_messages", () => []);

const persistT = () => store.save("message_threads", threads);
const persistM = () => store.save("message_messages", messages);

const VALID_CONTEXTS = ["general", "assignment", "ptm", "discipline", "health"];

function nextThreadId() {
  let max = 0;
  for (const t of threads) {
    const n = parseInt(String(t.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `MT${String(max + 1).padStart(4, "0")}`;
}
function nextMessageId() {
  let max = 0;
  for (const m of messages) {
    const n = parseInt(String(m.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `MM${String(max + 1).padStart(5, "0")}`;
}

function threadKey(participantIds, studentId, context) {
  return [...participantIds].sort().join(",") + "|" + (studentId || "") + "|" + (context || "general");
}

// ---------- thread ops ----------

function listThreadsFor(userId) {
  const myThreads = threads.filter((t) => t.participants.includes(userId));
  return myThreads
    .map(decorateThread.bind(null, userId))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

function getThread(id) {
  return threads.find((t) => t.id === id) || null;
}

function decorateThread(forUserId, t) {
  const threadMessages = messages.filter((m) => m.threadId === t.id);
  const lastMsg = threadMessages[threadMessages.length - 1] || null;
  const unread = threadMessages.filter(
    (m) => m.fromUserId !== forUserId && !m.readBy.includes(forUserId)
  ).length;
  return {
    ...t,
    lastMessage: lastMsg
      ? { id: lastMsg.id, body: lastMsg.body, fromUserId: lastMsg.fromUserId, createdAt: lastMsg.createdAt }
      : null,
    unread,
    messageCount: threadMessages.length,
  };
}

function startThread({ creatorId, participants, subject, studentId, context, firstMessage }) {
  if (!creatorId) throw new Error("creatorId required");
  if (!Array.isArray(participants) || participants.length < 2)
    throw new Error("At least two participants required");
  const unique = [...new Set(participants.filter(Boolean))];
  if (unique.length !== 2)
    throw new Error("Threads must have exactly two distinct participants");
  if (!unique.includes(creatorId))
    throw new Error("Creator must be one of the participants");
  const ctx = VALID_CONTEXTS.includes(context) ? context : "general";

  // De-dup: reuse existing thread for the same (participants, student, ctx).
  const key = threadKey(unique, studentId, ctx);
  let t = threads.find((x) => threadKey(x.participants, x.studentId, x.context) === key);
  if (!t) {
    t = {
      id: nextThreadId(),
      participants: unique,
      subject: subject ? String(subject).trim().slice(0, 200) : null,
      studentId: studentId || null,
      context: ctx,
      createdAt: new Date().toISOString(),
      createdBy: creatorId,
      lastMessageAt: new Date().toISOString(),
    };
    threads.unshift(t);
    persistT();
  }

  if (firstMessage) {
    const m = appendMessage({
      threadId: t.id,
      fromUserId: creatorId,
      body: firstMessage,
    });
    return { thread: t, message: m };
  }
  return { thread: t, message: null };
}

// ---------- message ops ----------

function listMessages(threadId) {
  return messages
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function appendMessage({ threadId, fromUserId, body, attachmentUrl }) {
  const t = getThread(threadId);
  if (!t) throw new Error("Thread not found");
  if (!t.participants.includes(fromUserId))
    throw new Error("Not a participant");
  const trimmed = String(body || "").trim();
  if (!trimmed) throw new Error("Message body required");
  if (trimmed.length > 4000) throw new Error("Message too long (max 4000 chars)");
  const m = {
    id: nextMessageId(),
    threadId,
    fromUserId,
    body: trimmed,
    attachmentUrl: attachmentUrl || null,
    createdAt: new Date().toISOString(),
    readBy: [fromUserId],
  };
  messages.push(m);
  t.lastMessageAt = m.createdAt;
  persistM();
  persistT();
  return m;
}

function markRead(threadId, userId) {
  const t = getThread(threadId);
  if (!t) throw new Error("Thread not found");
  if (!t.participants.includes(userId)) throw new Error("Not a participant");
  let changed = false;
  for (const m of messages) {
    if (m.threadId !== threadId) continue;
    if (!m.readBy.includes(userId)) {
      m.readBy.push(userId);
      changed = true;
    }
  }
  if (changed) persistM();
  return { threadId, userId, ok: true };
}

function summaryFor(userId) {
  let total = 0;
  let unread = 0;
  for (const t of threads) {
    if (!t.participants.includes(userId)) continue;
    total++;
    const myUnread = messages.filter(
      (m) => m.threadId === t.id && m.fromUserId !== userId && !m.readBy.includes(userId)
    ).length;
    if (myUnread > 0) unread++;
  }
  return { threads: total, threadsWithUnread: unread };
}

module.exports = {
  VALID_CONTEXTS,
  listThreadsFor,
  getThread,
  startThread,
  listMessages,
  appendMessage,
  markRead,
  summaryFor,
  threads: () => threads,
  messages: () => messages,
};
