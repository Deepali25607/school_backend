const store = require("./store");

const CATEGORIES = ["Computers", "Furniture", "Sports", "Lab", "Classroom", "Electrical", "Stationery"];

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

module.exports = { CATEGORIES, assets: () => assets, adjust, summary };
