const fs = require("fs");
const path = require("path");

/**
 * NOTE: This is a simple JSON-file store so the whole project runs with
 * zero external infrastructure out of the box. It is fine for low/medium
 * traffic. For real production scale, swap this for Postgres/MongoDB —
 * the only thing that matters is that `getOrder`/`saveOrder` stay atomic
 * per-reference, since that's what prevents a webhook and a frontend
 * verify-call from both crediting the same order twice.
 */
const ORDERS_FILE = path.join(__dirname, "..", "..", "data", "orders.json");

function ensureFile() {
  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "{}");
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(orders) {
  ensureFile();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function getOrder(reference) {
  const orders = readAll();
  return orders[reference] || null;
}

function saveOrder(reference, data) {
  const orders = readAll();
  orders[reference] = { ...(orders[reference] || {}), ...data, updatedAt: new Date().toISOString() };
  writeAll(orders);
  return orders[reference];
}

module.exports = { getOrder, saveOrder };
