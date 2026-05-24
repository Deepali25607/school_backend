// Donations & Fundraising Campaigns.
//
// A Campaign is a named drive with a goal (₹), a deadline, an optional
// beneficiary, a category, and a story. People pledge donations against
// campaigns. Donors can be:
//   - linked alumni (alumnusId), pulled from `data/alumni.js`
//   - named parents/staff/anyone (donorName)
//   - or fully anonymous
//
// State machine: Active → Closed (auto-closes when raised >= goal OR deadline passed).
// Donations are append-only (no editing amounts) — once recorded, only adminscan refund (cancel) them, and cancellation keeps the row but excludes it
// from totals.

const store = require("./store");
const alumniData = require("./alumni");

const CATEGORIES = [
  "Infrastructure",
  "Scholarships",
  "Sports",
  "Arts & Culture",
  "Library",
  "Technology",
  "Welfare",
  "Alumni Initiative",
  "Other",
];

const STATUSES = ["Active", "Closed", "Draft"];

const PAYMENT_MODES = ["UPI", "Card", "Net banking", "Cheque", "Cash"];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function buildSeed() {
  const campaigns = [
    {
      id: "FR9001",
      title: "New Senior Science Lab",
      story:
        "Funding cutting-edge equipment for the Senior Science Lab — including new spectrometers, electronics kits, and a renewable-energy demonstration setup for Grades 11 and 12. Every contribution is matched 1:1 by the Lumina Endowment Fund.",
      category: "Infrastructure",
      goal: 1500000,
      startDate: dateOffset(-30),
      deadline: dateOffset(45),
      status: "Active",
      coverColor: "from-brand-500/30 to-accent-violet/20",
      beneficiary: "Senior Science Department",
      visible: true,
      taxBenefit: true,
      createdBy: "Principal's Office",
      createdAt: dateOffset(-30),
    },
    {
      id: "FR9002",
      title: "Need-based Scholarship Pool",
      story:
        "Bring deserving students from low-income households to Lumina. Your contribution sponsors tuition, books, and uniforms for a full academic year. We commit to publishing an impact report at year-end.",
      category: "Scholarships",
      goal: 1000000,
      startDate: dateOffset(-60),
      deadline: dateOffset(20),
      status: "Active",
      coverColor: "from-emerald-500/30 to-teal-500/20",
      beneficiary: "Lumina Need-based Aid Trust",
      visible: true,
      taxBenefit: true,
      createdBy: "Accounts Department",
      createdAt: dateOffset(-60),
    },
    {
      id: "FR9003",
      title: "Inter-school Sports Travel Fund",
      story:
        "Support our teams travelling to nationals — football, athletics, swimming, and chess. Cover travel, lodging, gear, and registration fees so no student is left behind due to cost.",
      category: "Sports",
      goal: 350000,
      startDate: dateOffset(-15),
      deadline: dateOffset(60),
      status: "Active",
      coverColor: "from-amber-500/30 to-orange-500/20",
      beneficiary: "Lumina Sports Council",
      visible: true,
      taxBenefit: false,
      createdBy: "Sports Department",
      createdAt: dateOffset(-15),
    },
    {
      id: "FR9004",
      title: "Library Refresh · 1,000 new titles",
      story:
        "Help us add 1,000 carefully curated new titles spanning fiction, science, history, and competitive-exam prep. Each ₹500 donation sponsors one book — with the donor's name on the inside flap.",
      category: "Library",
      goal: 500000,
      startDate: dateOffset(-90),
      deadline: dateOffset(-5),
      status: "Closed",
      coverColor: "from-accent-pink/30 to-rose-500/20",
      beneficiary: "Lumina Central Library",
      visible: true,
      taxBenefit: true,
      createdBy: "Library Committee",
      createdAt: dateOffset(-90),
    },
    {
      id: "FR9005",
      title: "Music Room Instruments",
      story:
        "Replace and add to our music room — new acoustic guitars, a digital piano, percussion sets, and a sound recording setup. Drive started by the Class of 2014 alumni.",
      category: "Arts & Culture",
      goal: 600000,
      startDate: dateOffset(-7),
      deadline: dateOffset(75),
      status: "Active",
      coverColor: "from-accent-violet/30 to-accent-pink/20",
      beneficiary: "Music & Performing Arts",
      visible: true,
      taxBenefit: true,
      createdBy: "Cultural Committee",
      createdAt: dateOffset(-7),
    },
  ];

  // Seed donations — mix of alumni-linked, named, and anonymous.
  // Pull a handful of alumni IDs for realism.
  const alumni = alumniData.alumni().slice(0, 30);
  const donations = [];

  function add(campaignId, opts) {
    const i = donations.length + 1;
    donations.push({
      id: `DON${String(8000 + i)}`,
      campaignId,
      amount: opts.amount,
      donorName: opts.donorName || null,
      alumnusId: opts.alumnusId || null,
      anonymous: !!opts.anonymous,
      message: opts.message || null,
      paymentMode:
        PAYMENT_MODES[hash("mode", i, campaignId) % PAYMENT_MODES.length],
      txnRef: `TXN${(hash("txn", i, campaignId) % 999999)
        .toString()
        .padStart(6, "0")}`,
      donatedAt: opts.donatedAt,
      panNo: opts.panNo || null,
      receiptIssued: opts.receiptIssued !== false,
      status: opts.status || "Confirmed", // Confirmed | Cancelled
    });
  }

  const donationPlans = [
    // Science Lab — heavy support
    {
      campaign: "FR9001",
      donors: [
        { alumnus: 0, amount: 250000, msg: "Backing my alma mater's STEM push." },
        { alumnus: 1, amount: 100000 },
        { alumnus: 2, amount: 75000, msg: "Inspired by Mr. Iyer's chemistry lectures from 2003." },
        { alumnus: 3, amount: 50000 },
        { alumnus: 4, amount: 50000 },
        { name: "Ravi & Deepali Gupta (Parents)", amount: 30000, msg: "For our daughter Riya in Grade 11." },
        { name: "Anonymous well-wisher", amount: 25000, anonymous: true },
        { alumnus: 5, amount: 25000 },
        { name: "PTA Committee", amount: 100000 },
        { alumnus: 6, amount: 20000 },
        { alumnus: 7, amount: 15000, msg: "Match my donation, Lumina!" },
        { name: "Anonymous", amount: 10000, anonymous: true },
      ],
    },
    // Scholarship pool
    {
      campaign: "FR9002",
      donors: [
        { alumnus: 8, amount: 200000, msg: "For one full year of education for a deserving child." },
        { alumnus: 9, amount: 100000 },
        { alumnus: 10, amount: 50000 },
        { name: "Anonymous", amount: 50000, anonymous: true },
        { name: "Mehta Family Trust", amount: 150000 },
        { alumnus: 11, amount: 25000 },
        { alumnus: 12, amount: 15000 },
        { name: "Anonymous", amount: 20000, anonymous: true },
        { alumnus: 13, amount: 10000, msg: "Wish I could give more this year." },
        { alumnus: 14, amount: 25000 },
      ],
    },
    // Sports travel
    {
      campaign: "FR9003",
      donors: [
        { alumnus: 15, amount: 50000, msg: "Go Lumina! Hope we win nationals again." },
        { alumnus: 16, amount: 25000 },
        { name: "Lumina Cricket Team Parents", amount: 30000 },
        { alumnus: 17, amount: 15000 },
        { alumnus: 18, amount: 10000 },
        { name: "Anonymous", amount: 5000, anonymous: true },
        { name: "Anonymous", amount: 5000, anonymous: true },
      ],
    },
    // Library — fully funded, now Closed
    {
      campaign: "FR9004",
      donors: [
        { alumnus: 19, amount: 100000, msg: "Books changed my life." },
        { alumnus: 20, amount: 75000 },
        { alumnus: 21, amount: 50000 },
        { name: "Reading Circle (Parents)", amount: 100000 },
        { alumnus: 22, amount: 50000 },
        { alumnus: 23, amount: 25000 },
        { name: "Anonymous", amount: 50000, anonymous: true },
        { alumnus: 24, amount: 25000 },
        { name: "Anonymous", amount: 25000, anonymous: true },
        { alumnus: 25, amount: 10000 },
      ],
    },
    // Music — early, light support
    {
      campaign: "FR9005",
      donors: [
        { alumnus: 26, amount: 50000, msg: "Founding the music room — Class of 2014 here!" },
        { alumnus: 27, amount: 25000 },
        { name: "Anonymous parent", amount: 15000, anonymous: true },
      ],
    },
  ];

  for (const plan of donationPlans) {
    const campaign = campaigns.find((c) => c.id === plan.campaign);
    plan.donors.forEach((d, idx) => {
      const a = d.alumnus != null ? alumni[d.alumnus] : null;
      const offsetDays =
        Math.max(0,
          (new Date(campaign.startDate).getTime() - Date.now()) / -86400000
        ) - (idx * 1.5 + 1);
      add(plan.campaign, {
        amount: d.amount,
        alumnusId: a?.id || null,
        donorName: d.name || a?.name || null,
        anonymous: d.anonymous,
        message: d.msg || null,
        donatedAt: dateOffset(-Math.max(1, Math.round(offsetDays))),
        panNo:
          d.anonymous || !d.name
            ? null
            : `ABCDE${String(idx + 1).padStart(4, "0")}F`,
      });
    });
  }

  return { campaigns, donations };
}

let state = store.load("fundraising", buildSeed);
const persist = () => store.save("fundraising", state);

// ---------- helpers ----------

function autoCloseExpired() {
  let changed = false;
  for (const c of state.campaigns) {
    if (c.status === "Active") {
      const raised = totalRaised(c.id);
      const past = new Date(c.deadline).getTime() < Date.now();
      if (raised >= c.goal || past) {
        c.status = "Closed";
        changed = true;
      }
    }
  }
  if (changed) persist();
}

function totalRaised(campaignId) {
  return state.donations
    .filter((d) => d.campaignId === campaignId && d.status === "Confirmed")
    .reduce((s, d) => s + d.amount, 0);
}

function donorCount(campaignId) {
  return state.donations.filter(
    (d) => d.campaignId === campaignId && d.status === "Confirmed"
  ).length;
}

function decorateCampaign(c) {
  const raised = totalRaised(c.id);
  const count = donorCount(c.id);
  const goal = c.goal || 1;
  const pct = Math.min(100, Math.round((raised / goal) * 100));
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400000)
  );
  const avgDonation = count > 0 ? Math.round(raised / count) : 0;
  return {
    ...c,
    raised,
    donorCount: count,
    progressPct: pct,
    daysLeft,
    averageDonation: avgDonation,
    expired: new Date(c.deadline).getTime() < Date.now(),
  };
}

function decorateDonation(d) {
  let label, sublabel;
  if (d.anonymous) {
    label = "Anonymous donor";
    sublabel = null;
  } else if (d.alumnusId) {
    const a = alumniData.get(d.alumnusId);
    label = a ? a.name : d.donorName || "Alumnus";
    sublabel = a
      ? `Alumni · Class of ${a.gradYear}${a.city ? ` · ${a.city}` : ""}`
      : null;
  } else {
    label = d.donorName || "Anonymous";
    sublabel = null;
  }
  return {
    ...d,
    donorLabel: label,
    donorSublabel: sublabel,
    isAlumni: !!d.alumnusId,
  };
}

// ---------- queries ----------

function listCampaigns({ status, category, q, includeDraft } = {}) {
  autoCloseExpired();
  let out = state.campaigns.slice();
  if (!includeDraft) out = out.filter((c) => c.status !== "Draft" || c.visible);
  if (status && status !== "all") out = out.filter((c) => c.status === status);
  if (category && category !== "all")
    out = out.filter((c) => c.category === category);
  if (q) {
    const t = String(q).toLowerCase();
    out = out.filter(
      (c) =>
        c.id.toLowerCase().includes(t) ||
        c.title.toLowerCase().includes(t) ||
        c.story.toLowerCase().includes(t) ||
        c.beneficiary.toLowerCase().includes(t) ||
        c.category.toLowerCase().includes(t)
    );
  }
  // Active first, then by progress %, then closed
  out.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "Active") return -1;
      if (b.status === "Active") return 1;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return out.map(decorateCampaign);
}

function getCampaign(id) {
  autoCloseExpired();
  const c = state.campaigns.find((x) => x.id === id);
  return c ? decorateCampaign(c) : null;
}

function listDonations({ campaignId, alumnusId, status, limit = 50 } = {}) {
  let out = state.donations.slice();
  if (campaignId) out = out.filter((d) => d.campaignId === campaignId);
  if (alumnusId) out = out.filter((d) => d.alumnusId === alumnusId);
  if (status) out = out.filter((d) => d.status === status);
  return out
    .sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt))
    .slice(0, limit)
    .map(decorateDonation);
}

function topDonors({ campaignId, limit = 10 } = {}) {
  const pool = state.donations.filter(
    (d) => d.status === "Confirmed" && !d.anonymous && (!campaignId || d.campaignId === campaignId)
  );
  const tally = new Map();
  for (const d of pool) {
    const key = d.alumnusId
      ? `alumni:${d.alumnusId}`
      : `name:${d.donorName || "Anonymous"}`;
    const cur = tally.get(key) || { total: 0, count: 0, sample: d };
    cur.total += d.amount;
    cur.count++;
    tally.set(key, cur);
  }
  return [...tally.entries()]
    .map(([key, v]) => ({
      key,
      total: v.total,
      count: v.count,
      ...decorateDonation(v.sample),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// ---------- mutations ----------

function addCampaign(payload, user) {
  if (!payload.title) throw new Error("title required");
  if (!(Number(payload.goal) > 0)) throw new Error("goal must be positive");
  if (!payload.deadline) throw new Error("deadline required");

  const category = CATEGORIES.includes(payload.category)
    ? payload.category
    : "Other";

  const next = state.campaigns.length + 1;
  const c = {
    id: `FR${9000 + next}`,
    title: String(payload.title).trim(),
    story: String(payload.story || "").trim(),
    category,
    goal: Math.round(Number(payload.goal)),
    startDate: payload.startDate || new Date().toISOString(),
    deadline: payload.deadline,
    status: payload.status === "Draft" ? "Draft" : "Active",
    coverColor: payload.coverColor || "from-brand-500/30 to-accent-violet/20",
    beneficiary: payload.beneficiary || "Lumina School",
    visible: payload.visible !== false,
    taxBenefit: payload.taxBenefit === true,
    createdBy: payload.createdBy || user?.name || "Administration",
    createdAt: new Date().toISOString(),
  };
  state.campaigns.unshift(c);
  persist();
  return decorateCampaign(c);
}

function updateCampaign(id, patch) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) throw new Error("Campaign not found");
  const ALLOWED = [
    "title",
    "story",
    "category",
    "goal",
    "startDate",
    "deadline",
    "status",
    "coverColor",
    "beneficiary",
    "visible",
    "taxBenefit",
  ];
  for (const k of ALLOWED) if (patch[k] !== undefined) c[k] = patch[k];
  if (patch.goal !== undefined) c.goal = Math.round(Number(c.goal));
  persist();
  return decorateCampaign(c);
}

function closeCampaign(id) {
  return updateCampaign(id, { status: "Closed" });
}

function removeCampaign(id) {
  const idx = state.campaigns.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Campaign not found");
  if (state.donations.some((d) => d.campaignId === id)) {
    throw new Error("Cannot remove a campaign with donations — close it instead");
  }
  const [removed] = state.campaigns.splice(idx, 1);
  persist();
  return removed;
}

function donate(payload, user) {
  const { campaignId, amount, donorName, alumnusId, anonymous, message, paymentMode, panNo } =
    payload || {};
  const c = state.campaigns.find((x) => x.id === campaignId);
  if (!c) throw new Error("Campaign not found");
  if (c.status !== "Active")
    throw new Error("Campaign is not accepting donations");
  if (!(Number(amount) > 0)) throw new Error("amount must be positive");

  // If alumnusId is provided, verify it
  if (alumnusId) {
    const a = alumniData.get(alumnusId);
    if (!a) throw new Error("Alumnus not found");
  }

  const next = state.donations.length + 1;
  const d = {
    id: `DON${8000 + next}`,
    campaignId,
    amount: Math.round(Number(amount)),
    donorName: anonymous
      ? null
      : donorName || (alumnusId ? alumniData.get(alumnusId)?.name : null) || user?.name || null,
    alumnusId: anonymous ? null : alumnusId || null,
    anonymous: !!anonymous,
    message: message ? String(message).slice(0, 280) : null,
    paymentMode: PAYMENT_MODES.includes(paymentMode) ? paymentMode : "UPI",
    txnRef: `TXN${Date.now().toString().slice(-6)}`,
    donatedAt: new Date().toISOString(),
    panNo: anonymous ? null : panNo || null,
    receiptIssued: !anonymous,
    status: "Confirmed",
  };
  state.donations.unshift(d);

  // Update sponsoring alumnus's donationTotal in alumni store (for non-anonymous)
  if (d.alumnusId) {
    try {
      const a = alumniData.get(d.alumnusId);
      if (a) {
        alumniData.update(d.alumnusId, {
          donor: true,
          donationTotal: (a.donationTotal || 0) + d.amount,
        });
      }
    } catch (e) {
      // best-effort sync — don't fail the donation if alumni update fails
    }
  }

  persist();
  autoCloseExpired();
  return decorateDonation(d);
}

function cancelDonation(id) {
  const d = state.donations.find((x) => x.id === id);
  if (!d) throw new Error("Donation not found");
  if (d.status === "Cancelled") return decorateDonation(d);
  d.status = "Cancelled";

  // roll back the alumnus's donationTotal
  if (d.alumnusId) {
    try {
      const a = alumniData.get(d.alumnusId);
      if (a) {
        alumniData.update(d.alumnusId, {
          donationTotal: Math.max(0, (a.donationTotal || 0) - d.amount),
        });
      }
    } catch (e) {
      // ignore
    }
  }

  persist();
  return decorateDonation(d);
}

function summary() {
  autoCloseExpired();
  const active = state.campaigns.filter((c) => c.status === "Active");
  const closed = state.campaigns.filter((c) => c.status === "Closed");
  const confirmed = state.donations.filter((d) => d.status === "Confirmed");
  const totalRaisedAll = confirmed.reduce((s, d) => s + d.amount, 0);
  const distinctDonors = new Set();
  for (const d of confirmed) {
    if (d.alumnusId) distinctDonors.add("alumni:" + d.alumnusId);
    else if (d.donorName) distinctDonors.add("name:" + d.donorName);
    else distinctDonors.add("anon:" + d.id);
  }
  // Closing soon: deadline within 14 days
  const closingSoon = active.filter((c) => {
    const days = Math.ceil(
      (new Date(c.deadline).getTime() - Date.now()) / 86400000
    );
    return days <= 14;
  });
  return {
    campaigns: state.campaigns.length,
    activeCampaigns: active.length,
    closedCampaigns: closed.length,
    closingSoon: closingSoon.length,
    totalRaised: totalRaisedAll,
    donations: confirmed.length,
    distinctDonors: distinctDonors.size,
  };
}

module.exports = {
  CATEGORIES,
  STATUSES,
  PAYMENT_MODES,
  campaigns: () => state.campaigns,
  donations: () => state.donations,
  listCampaigns,
  getCampaign,
  listDonations,
  topDonors,
  addCampaign,
  updateCampaign,
  closeCampaign,
  removeCampaign,
  donate,
  cancelDonation,
  totalRaised,
  summary,
};
