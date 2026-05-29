// Cafeteria & Mess — weekly menu + per-student dietary preferences.
//
// Two collections:
//   1. menu      — keyed by day (Mon..Sun), each holds 4 meal slots
//                   { items[], vegetarian, allergens[], calories, cost }
//   2. prefs     — keyed by studentId: mealPlan, specialDiet, optedOut[]
//
// Allergy detection: at request time we cross-reference each student's
// allergies (from the health module) against the day's menu allergens to
// produce a list of "at-risk" warnings.

const store = require("./store");
const seed = require("./seed");
const healthData = require("./health");

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEALS = ["Breakfast", "Lunch", "Snack", "Dinner"];

const MEAL_PLANS = [
  "Veg",
  "Non-veg",
  "Eggetarian",
  "Jain",
  "Vegan",
  "None",
];

const COMMON_ALLERGENS = [
  "Peanuts",
  "Tree nuts",
  "Dairy",
  "Eggs",
  "Wheat / Gluten",
  "Soy",
  "Shellfish",
  "Sesame",
  "Mustard",
];

const SPECIAL_DIETS = [
  "Gluten-free",
  "Diabetic-friendly",
  "Lactose-free",
  "Low-sodium",
  "High-protein",
  "Halal only",
];

// Hand-curated weekly menu — feels like a real school cafeteria
const SEED_MENU = {
  Mon: {
    Breakfast: {
      items: ["Poha", "Boiled eggs", "Sliced fruit", "Milk / Chai"],
      vegetarian: false,
      allergens: ["Eggs", "Dairy"],
      calories: 420,
      cost: 35,
    },
    Lunch: {
      items: ["Chapati", "Dal tadka", "Aloo gobi", "Steamed rice", "Curd", "Salad"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 680,
      cost: 60,
    },
    Snack: {
      items: ["Vegetable sandwich", "Apple", "Lemonade"],
      vegetarian: true,
      allergens: ["Wheat / Gluten"],
      calories: 280,
      cost: 25,
    },
    Dinner: {
      items: ["Rajma chawal", "Chapati", "Bhindi masala", "Buttermilk"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 620,
      cost: 55,
    },
  },
  Tue: {
    Breakfast: {
      items: ["Upma", "Sambar", "Coconut chutney", "Banana", "Coffee / Milk"],
      vegetarian: true,
      allergens: ["Dairy", "Tree nuts"],
      calories: 380,
      cost: 35,
    },
    Lunch: {
      items: ["Chapati", "Chicken curry", "Veg pulao", "Cucumber raita", "Pickle"],
      vegetarian: false,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 720,
      cost: 75,
    },
    Snack: {
      items: ["Vada pav", "Tomato ketchup", "Tea"],
      vegetarian: true,
      allergens: ["Wheat / Gluten"],
      calories: 320,
      cost: 25,
    },
    Dinner: {
      items: ["Mixed veg paratha", "Yogurt", "Pickle", "Kheer"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten", "Tree nuts"],
      calories: 560,
      cost: 50,
    },
  },
  Wed: {
    Breakfast: {
      items: ["Idli", "Sambar", "Tomato chutney", "Fruit bowl", "Milk"],
      vegetarian: true,
      allergens: ["Dairy"],
      calories: 360,
      cost: 35,
    },
    Lunch: {
      items: ["Chapati", "Paneer butter masala", "Jeera rice", "Dal", "Salad"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 700,
      cost: 65,
    },
    Snack: {
      items: ["Pasta arrabiata", "Garlic bread", "Iced tea"],
      vegetarian: true,
      allergens: ["Wheat / Gluten", "Dairy"],
      calories: 380,
      cost: 35,
    },
    Dinner: {
      items: ["Vegetable biryani", "Boondi raita", "Papad", "Gulab jamun"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten", "Tree nuts"],
      calories: 640,
      cost: 60,
    },
  },
  Thu: {
    Breakfast: {
      items: ["Aloo paratha", "Curd", "Pickle", "Tea / Milk"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 460,
      cost: 35,
    },
    Lunch: {
      items: ["Chapati", "Fish curry", "Rice", "Sautéed beans", "Lemon wedge"],
      vegetarian: false,
      allergens: ["Wheat / Gluten", "Shellfish"],
      calories: 700,
      cost: 80,
    },
    Snack: {
      items: ["Bhel puri", "Sweet lime juice"],
      vegetarian: true,
      allergens: ["Peanuts"],
      calories: 260,
      cost: 20,
    },
    Dinner: {
      items: ["Chole bhature", "Onion salad", "Lassi"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 700,
      cost: 60,
    },
  },
  Fri: {
    Breakfast: {
      items: ["Bread + butter + jam", "Scrambled eggs", "Fruit", "Tea / Milk"],
      vegetarian: false,
      allergens: ["Eggs", "Dairy", "Wheat / Gluten"],
      calories: 420,
      cost: 35,
    },
    Lunch: {
      items: ["Chapati", "Dal makhani", "Veg jalfrezi", "Steamed rice", "Salad"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 660,
      cost: 60,
    },
    Snack: {
      items: ["Pizza margherita", "Iced tea"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 380,
      cost: 40,
    },
    Dinner: {
      items: ["Curd rice", "Pickle", "Pomegranate", "Mango pickle"],
      vegetarian: true,
      allergens: ["Dairy"],
      calories: 480,
      cost: 45,
    },
  },
  Sat: {
    Breakfast: {
      items: ["Masala dosa", "Sambar", "Coconut chutney", "Filter coffee"],
      vegetarian: true,
      allergens: ["Dairy", "Tree nuts"],
      calories: 440,
      cost: 40,
    },
    Lunch: {
      items: ["Chapati", "Egg curry", "Veg curry", "Pulao", "Salad"],
      vegetarian: false,
      allergens: ["Eggs", "Wheat / Gluten"],
      calories: 720,
      cost: 70,
    },
    Snack: {
      items: ["Samosa", "Mint chutney", "Hot chocolate"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 340,
      cost: 25,
    },
    Dinner: {
      items: ["Hakka noodles", "Manchurian", "Sweet corn soup"],
      vegetarian: true,
      allergens: ["Wheat / Gluten", "Soy"],
      calories: 640,
      cost: 60,
    },
  },
  Sun: {
    Breakfast: {
      items: ["Pancakes", "Maple syrup", "Fruit salad", "Milk / Coffee"],
      vegetarian: true,
      allergens: ["Dairy", "Eggs", "Wheat / Gluten"],
      calories: 460,
      cost: 45,
    },
    Lunch: {
      items: ["Chapati", "Mutton curry", "Veg biryani", "Raita", "Salad"],
      vegetarian: false,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 780,
      cost: 90,
    },
    Snack: {
      items: ["Pav bhaji", "Onion", "Lime"],
      vegetarian: true,
      allergens: ["Dairy", "Wheat / Gluten"],
      calories: 380,
      cost: 30,
    },
    Dinner: {
      items: ["Light khichdi", "Papad", "Pickle", "Banana"],
      vegetarian: true,
      allergens: [],
      calories: 460,
      cost: 40,
    },
  },
};

function hash(...parts) {
  let h = 17;
  const s = parts.map(String).join(":");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Build per-student dietary preferences deterministically — feels like the
// school has captured each student's choice on intake.
function buildPrefs() {
  const out = {};
  for (const s of seed.students) {
    const r = hash(s.id, "diet") % 100;
    let mealPlan;
    if (r < 60) mealPlan = "Veg";
    else if (r < 75) mealPlan = "Non-veg";
    else if (r < 85) mealPlan = "Eggetarian";
    else if (r < 92) mealPlan = "Jain";
    else if (r < 97) mealPlan = "Vegan";
    else mealPlan = "None";
    const specialRoll = hash(s.id, "special") % 12;
    out[s.id] = {
      mealPlan,
      specialDiet:
        specialRoll < 3 ? SPECIAL_DIETS[specialRoll % SPECIAL_DIETS.length] : null,
      optedOut: [], // explicit dish opt-outs
    };
  }
  return out;
}

let menu = store.load("cafeteria-menu", () => JSON.parse(JSON.stringify(SEED_MENU)));
let prefs = store.load("cafeteria-prefs", buildPrefs);
let orders = store.load("cafeteria-orders", () => []);
const persistMenu = () => store.save("cafeteria-menu", menu);
const persistPrefs = () => store.save("cafeteria-prefs", prefs);
const persistOrders = () => store.save("cafeteria-orders", orders);

function todayKey() {
  // JS Sunday=0..Saturday=6 → map to our Mon-first ordering
  const jsDay = new Date().getDay();
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  return DAYS[idx];
}

function getDay(day) {
  return menu[day] || null;
}

function getWeek() {
  return DAYS.map((d) => ({ day: d, meals: menu[d] || {} }));
}

function updateMeal(day, meal, payload) {
  if (!DAYS.includes(day)) throw new Error("Invalid day");
  if (!MEALS.includes(meal)) throw new Error("Invalid meal");
  if (!menu[day]) menu[day] = {};
  const cur = menu[day][meal] || {};
  menu[day][meal] = {
    items: Array.isArray(payload.items) ? payload.items : cur.items || [],
    vegetarian:
      payload.vegetarian !== undefined ? !!payload.vegetarian : !!cur.vegetarian,
    allergens: Array.isArray(payload.allergens)
      ? payload.allergens
      : cur.allergens || [],
    calories:
      typeof payload.calories === "number" ? payload.calories : cur.calories || 0,
    cost: typeof payload.cost === "number" ? payload.cost : cur.cost || 0,
  };
  persistMenu();
  return menu[day][meal];
}

function getPref(studentId) {
  return prefs[studentId] || null;
}

function setPref(studentId, patch) {
  const cur = prefs[studentId] || { mealPlan: "Veg", specialDiet: null, optedOut: [] };
  const next = {
    mealPlan: MEAL_PLANS.includes(patch.mealPlan) ? patch.mealPlan : cur.mealPlan,
    specialDiet: patch.specialDiet !== undefined ? patch.specialDiet : cur.specialDiet,
    optedOut: Array.isArray(patch.optedOut) ? patch.optedOut : cur.optedOut || [],
  };
  prefs[studentId] = next;
  persistPrefs();
  return next;
}

// Find students whose health-module allergies intersect a given meal's
// allergen list. Cross-references with the Health profile dataset.
function atRiskForMeal(day, meal) {
  const m = menu[day]?.[meal];
  if (!m || !m.allergens || m.allergens.length === 0) return [];
  const profiles = healthData.profiles();
  const profByStudent = new Map(profiles.map((p) => [p.studentId, p]));
  const out = [];
  for (const s of seed.students) {
    const p = profByStudent.get(s.id);
    if (!p || !p.allergies?.length) continue;
    // Match by substring either direction — "Peanuts" matches "Peanut oil"
    const hits = m.allergens.filter((a) =>
      p.allergies.some(
        (pa) =>
          a.toLowerCase().includes(pa.toLowerCase()) ||
          pa.toLowerCase().includes(a.toLowerCase())
      )
    );
    if (hits.length > 0) {
      out.push({
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        studentSection: s.section,
        studentAllergies: p.allergies,
        flaggedAllergens: hits,
      });
    }
  }
  return out;
}

function summary() {
  const today = todayKey();
  const counts = MEAL_PLANS.reduce((acc, p) => {
    acc[p] = 0;
    return acc;
  }, {});
  let specialDietCount = 0;
  for (const s of seed.students) {
    const p = prefs[s.id];
    if (p) {
      counts[p.mealPlan] = (counts[p.mealPlan] || 0) + 1;
      if (p.specialDiet) specialDietCount++;
    }
  }
  const todayMenu = menu[today] || {};
  const todayMeals = MEALS.filter((m) => todayMenu[m]).length;
  const todayCalories = MEALS.reduce(
    (sum, m) => sum + (todayMenu[m]?.calories || 0),
    0
  );
  // At-risk count for today's meals
  let atRiskToday = 0;
  for (const m of MEALS) {
    atRiskToday += atRiskForMeal(today, m).length;
  }
  return {
    today,
    todayMeals,
    todayCalories,
    atRiskToday,
    byMealPlan: counts,
    specialDietCount,
    totalStudents: seed.students.length,
  };
}

// =========================================================================
// MEAL PRE-ORDERS
//
// A simple booking flow: a parent (or the student themselves) reserves a
// meal for a specific calendar date. The cost is locked from the menu at
// order time. Orders can't be placed in the past, and existing orders
// can only be cancelled before they're marked served by kitchen staff.
// =========================================================================

const ORDER_STATUSES = ["pending", "confirmed", "served", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "paid"];

function dayKeyFor(isoDate) {
  // Map YYYY-MM-DD → our Mon-first day key
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const jsDay = d.getDay();
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  return DAYS[idx];
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function nextOrderId() {
  let max = 0;
  for (const o of orders) {
    const n = parseInt(String(o.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ORD${String(max + 1).padStart(6, "0")}`;
}

function listOrders({ studentId, date, meal, status } = {}) {
  let out = orders;
  if (studentId) out = out.filter((o) => o.studentId === studentId);
  if (date) out = out.filter((o) => o.date === date);
  if (meal) out = out.filter((o) => o.meal === meal);
  if (status) out = out.filter((o) => o.status === status);
  // Newest first by date then createdAt
  return [...out].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function getOrder(id) {
  return orders.find((o) => o.id === id) || null;
}

/**
 * Look up the cost & item summary for (date, meal) — used when a new order
 * is created so the price is locked at booking time rather than re-read
 * later (the menu may change).
 */
function snapshotMealAt(date, meal) {
  const day = dayKeyFor(date);
  if (!day) throw new Error("Invalid date");
  if (!MEALS.includes(meal)) throw new Error("Invalid meal");
  const entry = menu[day]?.[meal];
  if (!entry) throw new Error("No menu set for that date/meal");
  return {
    day,
    items: Array.isArray(entry.items) ? [...entry.items] : [],
    cost: Number(entry.cost) || 0,
    vegetarian: !!entry.vegetarian,
    calories: Number(entry.calories) || 0,
    allergens: Array.isArray(entry.allergens) ? [...entry.allergens] : [],
  };
}

function createOrder({ studentId, date, meal, notes, createdBy }) {
  if (!studentId) throw new Error("studentId is required");
  if (!date) throw new Error("date is required");
  if (date < isoToday())
    throw new Error("Cannot order meals for past dates");
  if (!MEALS.includes(meal)) throw new Error("Invalid meal");
  // Prevent duplicates: same student + date + meal that isn't cancelled.
  const dupe = orders.find(
    (o) =>
      o.studentId === studentId &&
      o.date === date &&
      o.meal === meal &&
      o.status !== "cancelled"
  );
  if (dupe) {
    throw new Error(
      `Already ordered ${meal} for ${date} (order ${dupe.id})`
    );
  }
  const snap = snapshotMealAt(date, meal);
  const now = new Date().toISOString();
  const order = {
    id: nextOrderId(),
    studentId,
    date,
    day: snap.day,
    meal,
    items: snap.items,
    cost: snap.cost,
    vegetarian: snap.vegetarian,
    calories: snap.calories,
    allergens: snap.allergens,
    notes: notes ? String(notes).slice(0, 280) : "",
    status: "pending",
    paymentStatus: "unpaid",
    createdAt: now,
    createdBy: createdBy || null,
    servedAt: null,
    cancelledAt: null,
  };
  orders.push(order);
  persistOrders();
  return order;
}

function updateOrder(id, patch) {
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error("Order not found");
  if (o.status === "served") throw new Error("Order has been served — cannot edit");
  if (o.status === "cancelled") throw new Error("Order is already cancelled");
  if (patch.notes !== undefined) o.notes = String(patch.notes).slice(0, 280);
  if (patch.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(patch.paymentStatus))
      throw new Error("Invalid paymentStatus");
    o.paymentStatus = patch.paymentStatus;
  }
  if (patch.status !== undefined) {
    if (!ORDER_STATUSES.includes(patch.status))
      throw new Error("Invalid status");
    o.status = patch.status;
    if (patch.status === "served") o.servedAt = new Date().toISOString();
    if (patch.status === "cancelled")
      o.cancelledAt = new Date().toISOString();
  }
  persistOrders();
  return o;
}

function cancelOrder(id) {
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error("Order not found");
  if (o.status === "served")
    throw new Error("Order has been served — cannot cancel");
  if (o.status === "cancelled") return o;
  o.status = "cancelled";
  o.cancelledAt = new Date().toISOString();
  persistOrders();
  return o;
}

function markServed(id) {
  return updateOrder(id, { status: "served" });
}

/**
 * Headcount + total revenue per meal slot for a given date. Used by the
 * kitchen / admin "today's prep" view.
 */
function ordersSummary(date) {
  date = date || isoToday();
  const byMeal = {};
  for (const m of MEALS) {
    byMeal[m] = { count: 0, paid: 0, unpaid: 0, served: 0, revenue: 0 };
  }
  for (const o of orders) {
    if (o.date !== date) continue;
    if (o.status === "cancelled") continue;
    const m = byMeal[o.meal];
    if (!m) continue;
    m.count++;
    m.revenue += o.cost || 0;
    if (o.paymentStatus === "paid") m.paid++;
    else m.unpaid++;
    if (o.status === "served") m.served++;
  }
  return {
    date,
    byMeal,
    totalOrders: MEALS.reduce((s, m) => s + byMeal[m].count, 0),
    totalRevenue: MEALS.reduce((s, m) => s + byMeal[m].revenue, 0),
  };
}

module.exports = {
  DAYS,
  MEALS,
  MEAL_PLANS,
  COMMON_ALLERGENS,
  SPECIAL_DIETS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  todayKey,
  getDay,
  getWeek,
  updateMeal,
  getPref,
  setPref,
  atRiskForMeal,
  prefs: () => prefs,
  summary,
  // orders
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  cancelOrder,
  markServed,
  ordersSummary,
  snapshotMealAt,
};
