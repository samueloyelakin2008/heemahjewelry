const axios = require("axios");
const fs = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(__dirname, "..", "..", "data", "sheets-retry-queue.json");

function ensureQueueFile() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]");
}

function readQueue() {
  ensureQueueFile();
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  ensureQueueFile();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

/**
 * POST a sales record to the Apps Script Web App. If Google Sheets is
 * unreachable (network blip, script redeploy, quota hit), the record
 * is saved to a local retry queue instead of being silently dropped —
 * a failed sales log should never block confirming the customer's
 * order, but it also should never just vanish.
 */
async function logSaleToSheet(record) {
  const payload = {
    secret: process.env.GOOGLE_SCRIPT_SHARED_SECRET,
    ...record,
  };

  try {
    await axios.post(process.env.GOOGLE_SCRIPT_URL, payload, { timeout: 10000 });
    return { queued: false };
  } catch (err) {
    const queue = readQueue();
    queue.push({ payload, attempts: 0, lastError: err.message, queuedAt: new Date().toISOString() });
    writeQueue(queue);
    return { queued: true, error: err.message };
  }
}

/**
 * Call this on a timer (see server.js) to retry queued rows. Successful
 * rows are removed; failed ones stay queued (with attempts incremented)
 * up to MAX_ATTEMPTS, after which they're left in the file for manual
 * inspection rather than retried forever.
 */
const MAX_ATTEMPTS = 8;

async function processRetryQueue() {
  const queue = readQueue();
  if (queue.length === 0) return { processed: 0, remaining: 0 };

  const remaining = [];
  let processed = 0;

  for (const item of queue) {
    if (item.attempts >= MAX_ATTEMPTS) {
      remaining.push(item); // give up automatically retrying, keep for manual review
      continue;
    }
    try {
      await axios.post(process.env.GOOGLE_SCRIPT_URL, item.payload, { timeout: 10000 });
      processed += 1;
    } catch (err) {
      item.attempts += 1;
      item.lastError = err.message;
      remaining.push(item);
    }
  }

  writeQueue(remaining);
  return { processed, remaining: remaining.length };
}

module.exports = { logSaleToSheet, processRetryQueue };
