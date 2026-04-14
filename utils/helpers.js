// ---------------- PRIX ----------------
function normalizePrice(raw) {
  if (raw == null || raw === "") return null;

  let text = String(raw)
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[€a-z]/g, "")
    .replace(",", ".");

  const parts = text.split(".");
  if (parts.length > 2) {
    const decimals = parts.pop();
    text = parts.join("") + "." + decimals;
  }

  const num = parseFloat(text);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

// ---------------- UTILITAIRES ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, retries = 2, delayMs = 1500) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i === retries) break;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}

module.exports = {
  normalizePrice,
  sleep,
  withRetry
};