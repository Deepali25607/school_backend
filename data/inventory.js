const store = require("./store");

const DEFAULT_CATEGORIES = ["Computers", "Furniture", "Sports", "Lab", "Classroom", "Electrical", "Stationery"];
// Categories are persisted and mutable so admins can add their own. We always
// mutate this array in place (push) and never reassign it, so the reference
// exported below stays live for every consumer.
const CATEGORIES = store.load("inventory-categories", () => [...DEFAULT_CATEGORIES]);
const persistCategories = () => store.save("inventory-categories", CATEGORIES);

const SEED = [
  { name: "Dell Latitude 7430",     category: "Computers",  unit: "unit", price: 78000,  qty: 42, reorder: 8 },
  { name: "HP LaserJet Pro M404",   category: "Computers",  unit: "unit", price: 35000,  qty: 7,  reorder: 4 },
  { name: "Smart Board 75\"",      category: "Computers",  unit: "unit", price: 145000, qty: 12, reorder: 2 },
  { name: "Student Desk (steel)",   category: "Furniture",  unit: "unit", price: 4200,   qty: 980, reorder: 60 },
  { name: "Student Chair",          category: "Furniture",  unit: "unit", price: 1800,   qty: 1020, reorder: 60 },
  { name: "Whiteboard 8'x4'",       category: "Furniture",  unit: "unit", price: 5800,   qty: 38, reorder: 5 },
  { name: "Steel Cupboard",         category: "Furniture",  unit: "unit", price: 12500,  qty: 26, reorder: 3 },
  { name: "Football",               category: "Sports",     unit: "piece", price: 1200,  qty: 18, reorder: 10 },
  { name: "Basketball",             category: "Sports",     unit: "piece", price: 1500,  qty: 12, reorder: 8 },
  { name: "Volleyball Net Set",     category: "Sports",     unit: "set",  price: 4500,   qty: 4, reorder: 2 },
  { name: "Cricket Kit",            category: "Sports",     unit: "set",  price: 18000,  qty: 5, reorder: 2 },
  { name: "Carrom Board",           category: "Sports",     unit: "unit", price: 3800,   qty: 8, reorder: 3 },
  { name: "Bunsen Burner",          category: "Lab",        unit: "piece", price: 1200,  qty: 26, reorder: 6 },
  { name: "Microscope (binocular)", category: "Lab",        unit: "unit", price: 22000,  qty: 14, reorder: 2 },
  { name: "Beaker 250ml (set/10)",  category: "Lab",        unit: "box",  price: 1800,   qty: 22, reorder: 8 },
  { name: "Test Tube (pack/100)",   category: "Lab",        unit: "pack", price: 950,    qty: 5, reorder: 12 },
  { name: "Lab Coat",               category: "Lab",        unit: "piece", price: 850,   qty: 90, reorder: 20 },
  { name: "Projector (HD)",         category: "Classroom",  unit: "unit", price: 42000,  qty: 9, reorder: 2 },
  { name: "Chalk (box/100)",        category: "Classroom",  unit: "box",  price: 320,    qty: 14, reorder: 25 },
  { name: "Eraser (large)",         category: "Classroom",  unit: "piece", price: 65,    qty: 88, reorder: 30 },
  { name: "Marker (box/12)",        category: "Classroom",  unit: "box",  price: 720,    qty: 28, reorder: 10 },
  { name: "Tube Light 4ft",         category: "Electrical", unit: "piece", price: 350,   qty: 120, reorder: 40 },
  { name: "Ceiling Fan",            category: "Electrical", unit: "piece", price: 2200,  qty: 22, reorder: 8 },
  { name: "Extension Cord",         category: "Electrical", unit: "piece", price: 480,   qty: 18, reorder: 12 },
  { name: "A4 Paper (ream)",        category: "Stationery", unit: "ream", price: 280,    qty: 145, reorder: 60 },
  { name: "Notebook (200 pages)",   category: "Stationery", unit: "piece", price: 75,    qty: 320, reorder: 80 },
  { name: "Glue Stick",             category: "Stationery", unit: "piece", price: 35,    qty: 8, reorder: 25 },
  { name: "Stapler (heavy duty)",   category: "Stationery", unit: "piece", price: 480,   qty: 16, reorder: 6 },
];

function buildAssets() {
  const list = SEED.map((s, i) => ({
    id: `INV${String(3000 + i + 1)}`,
    sku: `${s.category.slice(0,3).toUpperCase()}-${String(1000 + i * 7 + 3).slice(-4)}`,
    name: s.name,
    category: s.category,
    unit: s.unit,
    price: s.price,
    qty: s.qty,
    reorder: s.reorder,
    vendor: ["Adept Office Pvt", "EduMart", "ScienceWorks", "Reliance Wholesale", "Croma Business"][i % 5],
    lastReceived: new Date(Date.now() - (i * 86400000 * 3))
      .toISOString()
      .slice(0, 10),
  }));
  return list;
}

let assets = store.load("inventory", buildAssets);
const persist = () => store.save("inventory", assets);

function adjust(id, delta, note) {
  const a = assets.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  const next = a.qty + Number(delta || 0);
  if (next < 0) throw new Error("Quantity cannot be negative");
  a.qty = next;
  if (delta > 0) a.lastReceived = new Date().toISOString().slice(0, 10);
  persist();
  return a;
}

// ============ PURCHASE ORDERS & VENDORS (BRD 7.16) ============
const PO_STATUSES = ["Ordered", "Received", "Cancelled"];

let purchases = store.load("inventory-purchases", () => []);
const persistPurchases = () => store.save("inventory-purchases", purchases);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function listPurchases({ status = "all" } = {}) {
  let out = purchases;
  if (status !== "all") out = out.filter((p) => p.status === status);
  return [...out].sort((a, b) => (a.orderedOn < b.orderedOn ? 1 : -1));
}

function addPurchase(payload, actor) {
  const item = assets.find((x) => x.id === payload.itemId);
  if (!item) throw new Error("Unknown inventory item");
  const qty = Number(payload.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("qty must be a positive integer");
  const unitPrice = payload.unitPrice !== undefined ? Number(payload.unitPrice) : item.price;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Invalid unit price");
  const po = {
    id: `PO${String(7000 + purchases.length + 1)}`,
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    vendor: payload.vendor || item.vendor,
    qty,
    unitPrice,
    total: qty * unitPrice,
    status: "Ordered",
    note: payload.note || null,
    orderedBy: actor || "Stores",
    orderedOn: today(),
    receivedOn: null,
  };
  purchases.unshift(po);
  persistPurchases();
  return po;
}

// Receiving a PO increments the linked item's stock and refreshes its
// last-received date and unit price.
function receivePurchase(id) {
  const po = purchases.find((p) => p.id === id);
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "Ordered") throw new Error(`PO is already ${po.status}`);
  const item = assets.find((x) => x.id === po.itemId);
  if (!item) throw new Error("Linked inventory item no longer exists");
  item.qty += po.qty;
  item.lastReceived = today();
  item.price = po.unitPrice;
  if (po.vendor) item.vendor = po.vendor;
  po.status = "Received";
  po.receivedOn = today();
  persist();
  persistPurchases();
  return po;
}

function cancelPurchase(id) {
  const po = purchases.find((p) => p.id === id);
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "Ordered") throw new Error(`Cannot cancel a ${po.status} PO`);
  po.status = "Cancelled";
  persistPurchases();
  return po;
}

// Vendor directory derived from the catalogue + open purchase orders.
function vendors() {
  const map = {};
  for (const a of assets) {
    const v = a.vendor || "—";
    if (!map[v]) map[v] = { vendor: v, skus: 0, stockValue: 0, openOrders: 0, openValue: 0 };
    map[v].skus += 1;
    map[v].stockValue += a.qty * a.price;
  }
  for (const p of purchases) {
    if (p.status !== "Ordered") continue;
    const v = p.vendor || "—";
    if (!map[v]) map[v] = { vendor: v, skus: 0, stockValue: 0, openOrders: 0, openValue: 0 };
    map[v].openOrders += 1;
    map[v].openValue += p.total;
  }
  return Object.values(map).sort((a, b) => b.stockValue - a.stockValue);
}

// Items at or below their reorder threshold, with a suggested reorder quantity
// (top the stock back up to ~3× the reorder point).
function lowStockAlerts() {
  return assets
    .filter((a) => a.qty <= a.reorder)
    .map((a) => ({
      id: a.id,
      name: a.name,
      sku: a.sku,
      category: a.category,
      qty: a.qty,
      reorder: a.reorder,
      unit: a.unit,
      vendor: a.vendor,
      price: a.price,
      suggestedQty: Math.max(a.reorder * 3 - a.qty, a.reorder),
    }))
    .sort((a, b) => a.qty - b.qty);
}

// ============ ITEM CATALOG MANAGEMENT ============
function addCategory(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("category name is required");
  if (n.length > 30) throw new Error("category name too long (max 30 characters)");
  if (CATEGORIES.some((c) => c.toLowerCase() === n.toLowerCase()))
    throw new Error("that category already exists");
  CATEGORIES.push(n);
  persistCategories();
  return { categories: CATEGORIES };
}

function nextAssetId() {
  let max = 3000;
  for (const a of assets) {
    const n = parseInt(String(a.id).replace(/\D+/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `INV${max + 1}`;
}

// Auto SKU: <3-letter category prefix>-<incrementing 4-digit suffix>.
function makeSku(category) {
  const prefix = String(category || "GEN").slice(0, 3).toUpperCase();
  let max = 1000;
  for (const a of assets) {
    if (String(a.sku || "").startsWith(prefix + "-")) {
      const n = parseInt(String(a.sku).split("-")[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}-${max + 1}`;
}

function validateAsset(p, { partial = false } = {}) {
  if (!partial || p.name !== undefined) {
    if (!p.name || !String(p.name).trim()) throw new Error("name is required");
  }
  if (!partial || p.category !== undefined) {
    if (!CATEGORIES.includes(p.category))
      throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  }
  for (const [k, max, integer] of [
    ["price", 100000000, false],
    ["qty", 1000000, true],
    ["reorder", 1000000, true],
  ]) {
    if (p[k] === undefined) continue;
    const n = Number(p[k]);
    const ok = integer ? Number.isInteger(n) : Number.isFinite(n);
    if (!ok || n < 0 || n > max)
      throw new Error(`${k} must be a ${integer ? "whole number" : "number"} between 0 and ${max}`);
  }
}

function addAsset(payload) {
  validateAsset(payload);
  const a = {
    id: nextAssetId(),
    sku: payload.sku ? String(payload.sku).trim() : makeSku(payload.category),
    name: String(payload.name).trim(),
    category: payload.category,
    unit: payload.unit ? String(payload.unit).trim() : "unit",
    price: Math.round(Number(payload.price) || 0),
    qty: payload.qty !== undefined ? Math.round(Number(payload.qty)) : 0,
    reorder: payload.reorder !== undefined ? Math.round(Number(payload.reorder)) : 0,
    vendor: payload.vendor ? String(payload.vendor).trim() : "—",
    lastReceived: today(),
  };
  assets.unshift(a);
  persist();
  return a;
}

// Item-master fields editable after creation. Stock quantity is intentionally
// excluded — it changes only through `adjust` or by receiving a purchase order,
// so every movement goes through a single, auditable path.
const ASSET_FIELDS = ["name", "category", "unit", "price", "reorder", "vendor", "sku"];
function updateAsset(id, patch) {
  const a = assets.find((x) => x.id === id);
  if (!a) throw new Error("Not found");
  validateAsset(patch, { partial: true });
  for (const k of ASSET_FIELDS) {
    if (patch[k] === undefined) continue;
    if (k === "price" || k === "reorder") a[k] = Math.round(Number(patch[k]));
    else a[k] = typeof patch[k] === "string" ? patch[k].trim() : patch[k];
  }
  persist();
  return a;
}

function removeAsset(id) {
  const idx = assets.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Not found");
  if (purchases.some((p) => p.itemId === id && p.status === "Ordered"))
    throw new Error("Cancel or receive the open purchase order for this item first");
  const [removed] = assets.splice(idx, 1);
  persist();
  return removed;
}

function summary() {
  const totalValue = assets.reduce((acc, a) => acc + a.qty * a.price, 0);
  const lowStock = assets.filter((a) => a.qty <= a.reorder).length;
  const skus = assets.length;
  const byCategory = CATEGORIES.map((c) => {
    const items = assets.filter((a) => a.category === c);
    return {
      category: c,
      skus: items.length,
      qty: items.reduce((a, b) => a + b.qty, 0),
      value: items.reduce((a, b) => a + b.qty * b.price, 0),
    };
  }).filter((c) => c.skus > 0);
  return { totalValue, lowStock, skus, byCategory };
}

module.exports = {
  CATEGORIES,
  PO_STATUSES,
  assets: () => assets,
  adjust,
  addCategory,
  addAsset,
  updateAsset,
  removeAsset,
  summary,
  listPurchases,
  addPurchase,
  receivePurchase,
  cancelPurchase,
  vendors,
  lowStockAlerts,
};
