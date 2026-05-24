// Sports Fixtures & Tournaments.
//
// A Tournament has:
//   - a sport, format (League | Knockout | Round Robin), date window, status
//   - a set of participating Teams (typically the 4 houses, or class teams)
//   - a set of Matches between teams with venue/time/scores
//
// Standings derive from match results. For league/round-robin:
//   - Win = 3 pts (default), Draw = 1 pt, Loss = 0 pts. Configurable per sport.
//   - Tracks goals/points-for, goals/points-against, goal-difference.
// For knockout: we don't compute standings — just show fixtures by round.
//
// Live scoring: matches walk Scheduled → Live → Completed (or Cancelled).
// Completed matches can record an MVP (studentId) and a notable moment.
//
// Teams in this app are HOUSE teams (Crimson/Azure/Emerald/Amber). This keeps
// rostering simple (every student already has a house) and ties naturally into
// the House Points system.

const store = require("./store");
const seed = require("./seed");

const HOUSES = ["Crimson", "Azure", "Emerald", "Amber"];
const SPORTS = [
  "Football",
  "Cricket",
  "Basketball",
  "Volleyball",
  "Athletics",
  "Swimming",
  "Chess",
  "Table Tennis",
  "Badminton",
  "Kabaddi",
];
const FORMATS = ["League", "Knockout", "Round Robin"];
const STATUSES = ["Upcoming", "Ongoing", "Completed", "Cancelled"];
const MATCH_STATUSES = ["Scheduled", "Live", "Completed", "Cancelled"];

const VENUES = [
  "Main Football Ground",
  "Cricket Pitch",
  "Sports Hall · Court 1",
  "Sports Hall · Court 2",
  "Swimming Pool",
  "Chess Arena",
  "Athletics Track",
  "Outdoor Courts",
];

function dateOffset(days, hours = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function buildSeed() {
  // 3 tournaments — one Completed, one Ongoing, one Upcoming.
  const tournaments = [
    {
      id: "TRN6001",
      name: "Inter-House Football Cup · 2026",
      sport: "Football",
      format: "League",
      startDate: dateOffset(-2),
      endDate: dateOffset(12),
      status: "Ongoing",
      organizer: "Sports Department",
      description:
        "Round-robin league across the four houses. Top two advance to the final. Winning team earns 200 house points + the rolling Lumina Cup.",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
    },
    {
      id: "TRN6002",
      name: "Inter-House Cricket Premier · 2026",
      sport: "Cricket",
      format: "League",
      startDate: dateOffset(15),
      endDate: dateOffset(35),
      status: "Upcoming",
      organizer: "Sports Department",
      description:
        "T20-format league. Each house plays every other house once. Winner faces last year's champion in the showcase final.",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
    },
    {
      id: "TRN6000",
      name: "Inter-House Basketball Cup · Q1",
      sport: "Basketball",
      format: "Knockout",
      startDate: dateOffset(-45),
      endDate: dateOffset(-30),
      status: "Completed",
      organizer: "Sports Department",
      description:
        "Single-elimination knockout. Quarter-finals → semis → final. Amber House lifted the cup with a tight 42-38 victory over Azure.",
      pointsWin: 0,
      pointsDraw: 0,
      pointsLoss: 0,
    },
  ];

  // Helpers
  function pick(arr, ...parts) {
    return arr[hash(...parts) % arr.length];
  }

  // Pre-pick MVP candidates by house
  const studentsByHouse = HOUSES.reduce((acc, h) => {
    acc[h] = seed.students.filter((s) => s.house === h);
    return acc;
  }, {});

  function mvpFor(house, idx) {
    const pool = studentsByHouse[house] || [];
    if (pool.length === 0) return null;
    const s = pool[hash("mvp", idx, house) % pool.length];
    return {
      studentId: s.id,
      studentName: s.name,
      studentAvatar: s.avatar,
    };
  }

  // Football league fixtures (6 matches: 4 teams × 3 rounds in round-robin)
  // Round 1: Crimson vs Azure, Emerald vs Amber
  // Round 2: Crimson vs Emerald, Azure vs Amber
  // Round 3: Crimson vs Amber, Azure vs Emerald
  const footballPairs = [
    ["Crimson", "Azure"],
    ["Emerald", "Amber"],
    ["Crimson", "Emerald"],
    ["Azure", "Amber"],
    ["Crimson", "Amber"],
    ["Azure", "Emerald"],
  ];

  const matches = [];
  let matchSeq = 1;
  function pushMatch(m) {
    matches.push({ id: `MTH${7000 + matchSeq++}`, ...m });
  }

  // Football — 3 completed, 1 live, 2 scheduled
  footballPairs.forEach(([a, b], i) => {
    let status, scoreA, scoreB, mvp, moment;
    if (i < 3) {
      // Completed games
      status = "Completed";
      scoreA = hash("sa", i) % 4;
      scoreB = hash("sb", i) % 4;
      // Avoid silly 0-0 → bias scoreA upward sometimes
      if (scoreA === 0 && scoreB === 0) scoreA = 1;
      const winner = scoreA > scoreB ? a : scoreB > scoreA ? b : null;
      mvp = winner ? mvpFor(winner, i) : null;
      moment =
        scoreA === scoreB
          ? "Tightly contested draw"
          : `${winner} sealed it in the 2nd half`;
    } else if (i === 3) {
      // Live game
      status = "Live";
      scoreA = hash("la", i) % 3;
      scoreB = hash("lb", i) % 3;
      mvp = null;
      moment = null;
    } else {
      status = "Scheduled";
      scoreA = 0;
      scoreB = 0;
      mvp = null;
      moment = null;
    }
    pushMatch({
      tournamentId: "TRN6001",
      round: `Round ${Math.floor(i / 2) + 1}`,
      teamA: a,
      teamB: b,
      date: dateOffset(-2 + i, 14 + (i % 3)),
      venue: i % 2 === 0 ? "Main Football Ground" : "Athletics Track",
      scoreA,
      scoreB,
      status,
      mvp,
      moment,
      notes: null,
    });
  });

  // Cricket — all Scheduled (upcoming tournament)
  const cricketPairs = [
    ["Crimson", "Emerald"],
    ["Azure", "Amber"],
    ["Crimson", "Azure"],
    ["Emerald", "Amber"],
    ["Crimson", "Amber"],
    ["Azure", "Emerald"],
  ];
  cricketPairs.forEach(([a, b], i) => {
    pushMatch({
      tournamentId: "TRN6002",
      round: `Match ${i + 1}`,
      teamA: a,
      teamB: b,
      date: dateOffset(15 + i * 3, 10),
      venue: "Cricket Pitch",
      scoreA: 0,
      scoreB: 0,
      status: "Scheduled",
      mvp: null,
      moment: null,
      notes: null,
    });
  });

  // Basketball knockout — all Completed
  // QF1: Crimson vs Emerald (Crimson wins), QF2: Azure vs Amber (Azure wins) — actually with 4 teams it's semis directly
  pushMatch({
    tournamentId: "TRN6000",
    round: "Semi-final",
    teamA: "Crimson",
    teamB: "Emerald",
    date: dateOffset(-44, 15),
    venue: "Sports Hall · Court 1",
    scoreA: 34,
    scoreB: 41,
    status: "Completed",
    mvp: mvpFor("Emerald", 100),
    moment: "Emerald's late surge sealed the semi",
    notes: null,
  });
  pushMatch({
    tournamentId: "TRN6000",
    round: "Semi-final",
    teamA: "Azure",
    teamB: "Amber",
    date: dateOffset(-43, 15),
    venue: "Sports Hall · Court 1",
    scoreA: 39,
    scoreB: 44,
    status: "Completed",
    mvp: mvpFor("Amber", 101),
    moment: "Amber's pivot dominated rebounds",
    notes: null,
  });
  pushMatch({
    tournamentId: "TRN6000",
    round: "3rd-place",
    teamA: "Crimson",
    teamB: "Azure",
    date: dateOffset(-32, 16),
    venue: "Sports Hall · Court 1",
    scoreA: 38,
    scoreB: 36,
    status: "Completed",
    mvp: mvpFor("Crimson", 102),
    moment: "Crimson took bronze in a tight finish",
    notes: null,
  });
  pushMatch({
    tournamentId: "TRN6000",
    round: "Final",
    teamA: "Emerald",
    teamB: "Amber",
    date: dateOffset(-30, 17),
    venue: "Sports Hall · Court 1",
    scoreA: 38,
    scoreB: 42,
    status: "Completed",
    mvp: mvpFor("Amber", 103),
    moment: "Amber lifted the Cup — Final score 42-38",
    notes: null,
  });

  return { tournaments, matches };
}

let state = store.load("sports", buildSeed);
const persist = () => store.save("sports", state);

// ---------- helpers ----------

function decorateMatch(m) {
  const isFinished = m.status === "Completed";
  const isDraw = isFinished && m.scoreA === m.scoreB;
  const winner =
    isFinished && !isDraw ? (m.scoreA > m.scoreB ? m.teamA : m.teamB) : null;
  return { ...m, winner, isDraw };
}

function tournamentStanding(tournamentId) {
  const trn = state.tournaments.find((t) => t.id === tournamentId);
  if (!trn) return [];
  if (trn.format === "Knockout") return []; // not applicable
  const teams = new Set();
  const matches = state.matches.filter(
    (m) => m.tournamentId === tournamentId && m.status === "Completed"
  );
  for (const m of state.matches.filter((m) => m.tournamentId === tournamentId)) {
    teams.add(m.teamA);
    teams.add(m.teamB);
  }
  const rows = {};
  for (const t of teams) {
    rows[t] = {
      team: t,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
    };
  }
  for (const m of matches) {
    const a = rows[m.teamA];
    const b = rows[m.teamB];
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.goalsFor += m.scoreA;
    a.goalsAgainst += m.scoreB;
    b.goalsFor += m.scoreB;
    b.goalsAgainst += m.scoreA;
    if (m.scoreA > m.scoreB) {
      a.won++;
      b.lost++;
      a.points += trn.pointsWin || 3;
      b.points += trn.pointsLoss || 0;
    } else if (m.scoreA < m.scoreB) {
      b.won++;
      a.lost++;
      b.points += trn.pointsWin || 3;
      a.points += trn.pointsLoss || 0;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += trn.pointsDraw || 1;
      b.points += trn.pointsDraw || 1;
    }
  }
  for (const r of Object.values(rows)) {
    r.goalDiff = r.goalsFor - r.goalsAgainst;
  }
  return Object.values(rows).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    return b.goalsFor - a.goalsFor;
  });
}

function decorateTournament(t) {
  const matches = state.matches.filter((m) => m.tournamentId === t.id);
  const completed = matches.filter((m) => m.status === "Completed").length;
  const live = matches.filter((m) => m.status === "Live").length;
  const scheduled = matches.filter((m) => m.status === "Scheduled").length;
  // Champion: for completed knockout = winner of the Final; for league = top of table
  let champion = null;
  if (t.status === "Completed") {
    if (t.format === "Knockout") {
      // Match exactly "Final" (or "Grand Final" etc.) but not "Semi-final" / "Quarter-final" / "3rd-place"
      const finalMatch = matches.find(
        (m) =>
          m.status === "Completed" &&
          /^(grand\s+)?final$/i.test((m.round || "").trim())
      );
      if (finalMatch && finalMatch.scoreA !== finalMatch.scoreB) {
        champion =
          finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamA : finalMatch.teamB;
      }
    } else {
      const standings = tournamentStanding(t.id);
      if (standings.length > 0) champion = standings[0].team;
    }
  }
  return {
    ...t,
    matchesCount: matches.length,
    completed,
    live,
    scheduled,
    champion,
  };
}

// ---------- queries ----------

function listTournaments({ status, sport, q } = {}) {
  let out = state.tournaments.slice();
  if (status && status !== "all") out = out.filter((t) => t.status === status);
  if (sport && sport !== "all") out = out.filter((t) => t.sport === sport);
  if (q) {
    const term = String(q).toLowerCase();
    out = out.filter(
      (t) =>
        t.id.toLowerCase().includes(term) ||
        t.name.toLowerCase().includes(term) ||
        t.sport.toLowerCase().includes(term) ||
        (t.organizer || "").toLowerCase().includes(term)
    );
  }
  out.sort((a, b) => {
    const rank = { Ongoing: 0, Upcoming: 1, Completed: 2, Cancelled: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return new Date(b.startDate) - new Date(a.startDate);
  });
  return out.map(decorateTournament);
}

function getTournament(id) {
  const t = state.tournaments.find((x) => x.id === id);
  return t ? decorateTournament(t) : null;
}

function listMatches({ tournamentId, status, team, limit = 200 } = {}) {
  let out = state.matches.slice();
  if (tournamentId) out = out.filter((m) => m.tournamentId === tournamentId);
  if (status && status !== "all") out = out.filter((m) => m.status === status);
  if (team) out = out.filter((m) => m.teamA === team || m.teamB === team);
  return out
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, limit)
    .map(decorateMatch);
}

function getMatch(id) {
  const m = state.matches.find((x) => x.id === id);
  return m ? decorateMatch(m) : null;
}

// ---------- mutations ----------

function addTournament(payload, user) {
  if (!payload.name) throw new Error("name required");
  if (!SPORTS.includes(payload.sport)) throw new Error("invalid sport");
  if (!FORMATS.includes(payload.format)) throw new Error("invalid format");
  if (!payload.startDate || !payload.endDate)
    throw new Error("startDate and endDate required");

  const next = state.tournaments.length + 1;
  const t = {
    id: `TRN${6000 + next}`,
    name: String(payload.name).trim(),
    sport: payload.sport,
    format: payload.format,
    startDate: payload.startDate,
    endDate: payload.endDate,
    status: "Upcoming",
    organizer: payload.organizer || user?.name || "Sports Department",
    description: String(payload.description || "").trim(),
    pointsWin: Number(payload.pointsWin) || 3,
    pointsDraw: Number(payload.pointsDraw) || 1,
    pointsLoss: Number(payload.pointsLoss) || 0,
  };
  state.tournaments.unshift(t);
  persist();
  return decorateTournament(t);
}

function updateTournament(id, patch) {
  const t = state.tournaments.find((x) => x.id === id);
  if (!t) throw new Error("Tournament not found");
  const ALLOWED = [
    "name",
    "sport",
    "format",
    "startDate",
    "endDate",
    "status",
    "organizer",
    "description",
    "pointsWin",
    "pointsDraw",
    "pointsLoss",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) t[k] = patch[k];
  if (patch.pointsWin !== undefined) t.pointsWin = Number(t.pointsWin);
  if (patch.pointsDraw !== undefined) t.pointsDraw = Number(t.pointsDraw);
  if (patch.pointsLoss !== undefined) t.pointsLoss = Number(t.pointsLoss);
  if (patch.status && !STATUSES.includes(t.status)) t.status = "Upcoming";
  persist();
  return decorateTournament(t);
}

function removeTournament(id) {
  const idx = state.tournaments.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Tournament not found");
  const [removed] = state.tournaments.splice(idx, 1);
  state.matches = state.matches.filter((m) => m.tournamentId !== id);
  persist();
  return removed;
}

function addMatch(payload) {
  const { tournamentId, teamA, teamB, date, venue, round } = payload || {};
  if (!tournamentId) throw new Error("tournamentId required");
  if (!HOUSES.includes(teamA) || !HOUSES.includes(teamB))
    throw new Error("teams must be houses");
  if (teamA === teamB) throw new Error("teams must differ");
  if (!date) throw new Error("date required");
  if (!state.tournaments.find((t) => t.id === tournamentId))
    throw new Error("Tournament not found");

  const next = state.matches.length + 1;
  const m = {
    id: `MTH${7000 + next}`,
    tournamentId,
    round: round || "Match",
    teamA,
    teamB,
    date,
    venue: venue || "TBD",
    scoreA: 0,
    scoreB: 0,
    status: "Scheduled",
    mvp: null,
    moment: null,
    notes: null,
  };
  state.matches.push(m);
  persist();
  return decorateMatch(m);
}

function updateMatch(id, patch) {
  const m = state.matches.find((x) => x.id === id);
  if (!m) throw new Error("Match not found");
  const ALLOWED = [
    "scoreA",
    "scoreB",
    "status",
    "date",
    "venue",
    "round",
    "moment",
    "notes",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) m[k] = patch[k];
  if (patch.scoreA !== undefined) m.scoreA = Math.max(0, Number(m.scoreA));
  if (patch.scoreB !== undefined) m.scoreB = Math.max(0, Number(m.scoreB));
  if (patch.status && !MATCH_STATUSES.includes(m.status)) m.status = "Scheduled";

  // MVP handling: { mvp: { studentId } } looks up student
  if (patch.mvp !== undefined) {
    if (patch.mvp === null) {
      m.mvp = null;
    } else if (patch.mvp.studentId) {
      const s = seed.students.find((x) => x.id === patch.mvp.studentId);
      if (!s) throw new Error("MVP student not found");
      m.mvp = {
        studentId: s.id,
        studentName: s.name,
        studentAvatar: s.avatar,
      };
    }
  }
  persist();
  return decorateMatch(m);
}

function removeMatch(id) {
  const idx = state.matches.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Match not found");
  const [removed] = state.matches.splice(idx, 1);
  persist();
  return removed;
}

function summary() {
  const live = state.matches.filter((m) => m.status === "Live");
  const upcoming = state.matches.filter(
    (m) => m.status === "Scheduled" && new Date(m.date).getTime() > Date.now()
  );
  const ongoingTournaments = state.tournaments.filter((t) => t.status === "Ongoing");
  // Next scheduled match
  const nextScheduled = state.matches
    .filter((m) => m.status === "Scheduled" && new Date(m.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  // MVPs this season
  const mvps = state.matches
    .filter((m) => m.status === "Completed" && m.mvp)
    .map((m) => ({
      matchId: m.id,
      tournamentId: m.tournamentId,
      house: m.scoreA > m.scoreB ? m.teamA : m.teamB,
      ...m.mvp,
    }));
  return {
    tournaments: state.tournaments.length,
    ongoingTournaments: ongoingTournaments.length,
    completedTournaments: state.tournaments.filter((t) => t.status === "Completed")
      .length,
    upcomingMatches: upcoming.length,
    liveMatches: live.length,
    nextMatch: nextScheduled ? decorateMatch(nextScheduled) : null,
    mvps,
  };
}

module.exports = {
  SPORTS,
  FORMATS,
  STATUSES,
  MATCH_STATUSES,
  HOUSES,
  VENUES,
  tournaments: () => state.tournaments,
  matches: () => state.matches,
  listTournaments,
  getTournament,
  listMatches,
  getMatch,
  tournamentStanding,
  addTournament,
  updateTournament,
  removeTournament,
  addMatch,
  updateMatch,
  removeMatch,
  summary,
};
