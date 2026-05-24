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
const persistMenu = () => store.save("cafeteria-menu", menu);
const persistPrefs = () => store.save("cafeteria-prefs", prefs);

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

module.exports = {
  DAYS,
  MEALS,
  MEAL_PLANS,
  COMMON_ALLERGENS,
  SPECIAL_DIETS,
  todayKey,
  getDay,
  getWeek,
  updateMeal,
  getPref,
  setPref,
  atRiskForMeal,
  prefs: () => prefs,
  summary,
};
