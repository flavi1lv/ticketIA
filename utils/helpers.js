// ---------------- NORMALISATION TEXTE ----------------
function normalizeText(str) {
  if (!str) return "";

  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")

    // unités avancées
    .replace(/(\d+)\s?x\s?(\d+)/g, "$1x$2")
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, a, b) => `${a}${b.padEnd(2, "0")}cl`)
    .replace(/(\d+)\s*l\b/g, (_, a) => `${a}00cl`)
    .replace(/(\d+)[.,](\d+)\s*kg\b/g, (_, a, b) => `${a}${b.padEnd(3, "0")}g`)
    .replace(/(\d+)\s*kg\b/g, (_, a) => `${a}000g`)
    .replace(/(\d+)\s*ml\b/g, (_, a) => `${Math.round(a / 10)}cl`)

    // synonymes basiques (extensible)
    .replace(/\boeufs?\b/g, "oeuf")
    .replace(/\byaourts?\b/g, "yaourt")
    .replace(/\bsodas?\b/g, "soda")

    // nettoyage
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- EXTRACTION FEATURES ----------------
function extractFeatures(text) {
  const tokens = new Set(text.split(" ").filter(Boolean));

  // quantité (g / cl)
  let quantity = null;
  const qMatch = text.match(/(\d+)(g|cl)\b/);
  if (qMatch) quantity = parseInt(qMatch[1]);

  // packs (6x33cl etc)
  let pack = 1;
  const pMatch = text.match(/(\d+)x(\d+)/);
  if (pMatch) pack = parseInt(pMatch[1]);

  return { tokens, quantity, pack };
}

// ---------------- SIMILARITÉ TEXTE ----------------
function computeTextScore(queryTokens, titleTokens) {
  let score = 0;

  for (const q of queryTokens) {
    if (titleTokens.has(q)) {
      score += 1;
    } else {
      // match partiel (ex: coca dans cocacola)
      for (const t of titleTokens) {
        if (t.includes(q) || q.includes(t)) {
          score += 0.6;
          break;
        }
      }
    }
  }

  return score / queryTokens.size;
}

// ---------------- PRIX ----------------
function normalizePrice(raw) {
  if (raw == null) return null;

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

// ---------------- VALIDATION PRINCIPALE ----------------
function validateTitle(superTitre, query, scrapedPrice = null, targetPrice = null) {
  if (!superTitre || !query) return false;

  const normTitle = normalizeText(superTitre);
  const normQuery = normalizeText(query);

  const titleFeatures = extractFeatures(normTitle);
  const queryFeatures = extractFeatures(normQuery);

  const textScore = computeTextScore(
    queryFeatures.tokens,
    titleFeatures.tokens
  );

  let score = textScore;

  // ----- quantité (critique)
  if (queryFeatures.quantity && titleFeatures.quantity) {
    const diff =
      Math.abs(queryFeatures.quantity - titleFeatures.quantity) /
      queryFeatures.quantity;

    if (diff <= 0.1) score += 0.3;
    else if (diff <= 0.25) score += 0.15;
    else score -= 0.3; // pénalité forte
  }

  // ----- pack
  if (queryFeatures.pack !== titleFeatures.pack) {
    score -= 0.2;
  } else if (queryFeatures.pack > 1) {
    score += 0.1;
  }

  // ----- prix
  if (scrapedPrice != null && targetPrice != null) {
    const p1 = normalizePrice(scrapedPrice);
    const p2 = normalizePrice(targetPrice);

    if (p1 && p2 && p2 !== 0) {
      const diff = Math.abs(p1 - p2) / p2;

      if (diff <= 0.05) score += 0.25;
      else if (diff <= 0.20) score += 0.1;
    }
  }

  // clamp
  score = Math.max(0, Math.min(score, 1));

  return score >= 0.50;
}

// ---------------- UTILS ----------------
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
  normalizeText,
  validateTitle,
  normalizePrice,
  sleep,
  withRetry
};