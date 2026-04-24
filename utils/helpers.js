/**
 * Normalise n'importe quelle représentation de prix en Number | null.
 * Gère : objets API, chaînes avec €/espaces/virgules, formats "1.000,50".
 */
function normalizePrice(raw) {
  if (raw == null || raw === '') return null;

  // Déballage des objets API courants
  if (typeof raw === 'object') {
    if (raw.amount !== undefined) raw = raw.amount;
    else if (raw.price !== undefined) raw = raw.price;
    else if (raw.value !== undefined) raw = raw.value;
    else return null;
  }

  let text = String(raw)
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[€a-z]/g, '')
    .replace(/,/g, '.');     // /,/g — toutes les virgules (fix: était sans flag g)

  // Gestion "1.000.50" → "1000.50"
  const parts = text.split('.');
  if (parts.length > 2) {
    const decimals = parts.pop();
    text = parts.join('') + '.' + decimals;
  }

  const num = parseFloat(text);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES ASYNC
// ─────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Retry avec backoff linéaire (delayMs × tentative).
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// SCORING & MATCHING — partagés par tous les scrapers
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_DIFF_THRESHOLD = 0.30;
const SCORE_THRESHOLD      = 0.50;

/**
 * Normalise une chaîne : minuscules, sans accents, œ→oe, virgule→point.
 */
const norm = str =>
  str.toLowerCase()
     .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
     .replace(/œ/g, 'oe')
     .replace(/,/g, '.');

/**
 * Tokenise en préservant les décimales.
 * "1.25l" reste un seul token ; "600g" aussi.
 */
const tokenize = str => {
  const normalized = norm(str);
  const decimals = normalized.match(/\d+\.\d+[a-z]*/g) || [];
  const rest = normalized
    .replace(/\d+\.\d+[a-z]*/g, ' ')
    .split(/\W+/)
    .filter(w => w.length > 1);
  return [...decimals, ...rest];
};

/**
 * Retourne true si le token représente une quantité/unité.
 * ex: "600g", "x10", "1.25l", "1kg", "30", "135g"
 */
const isQuantityToken = w =>
  /^\d+(\.\d+)?(g|kg|ml|l|cl|x\d*)?$/.test(w) ||
  /^x\d+$/.test(w) ||
  /^\d+x\d+[a-z]*$/.test(w); // tokens composés : "7x45g", "6x33cl"

/**
 * Score sémantique 0→1.
 * Les tokens quantité sont exclus du calcul pour ne pas pénaliser
 * les produits dont le titre n'affiche pas le grammage.
 */
const scoreSimilarity = (titre, query) => {
  const titleTokens = tokenize(titre).filter(w => w.length > 2);
  const queryTokens = tokenize(query).filter(w => w.length > 2 && !isQuantityToken(w));

  if (!queryTokens.length) return 1;

  const matched = queryTokens.filter(qw =>
    titleTokens.some(tw => tw.includes(qw) || qw.includes(tw))
  );
  return matched.length / queryTokens.length;
};

/** Extrait les tokens quantité d'une query. */
const extractQuantityTokens = query =>
  tokenize(query).filter(isQuantityToken);

/**
 * Valide que tous les tokens quantité de la query sont présents
 * dans le titre ou le format du produit.
 */
const validateQuantity = (product, quantityTokens) => {
  if (!quantityTokens.length) return true;

  const cleanFormat   = (product.rawFormat || '').replace(/\bacheter\b/gi, '').trim();
  const haystack      = norm(`${product.titre} ${cleanFormat}`);
  const hasFormatInfo = cleanFormat.length > 3;

  return quantityTokens.every(qt => {
    if (haystack.includes(qt)) return true;

    if (/^x\d+$/.test(qt)) {
      const digits = qt.slice(1);
      if (new RegExp(`\\b${digits}\\b`).test(haystack)) return true;
    }

    if (!hasFormatInfo) {
      // Le titre contient une quantité différente → faux positif
      const titleQuantities = tokenize(product.titre).filter(isQuantityToken);
      if (titleQuantities.length && !titleQuantities.includes(qt)) return false;
      return true;
    }

    return false;
  });
};


const computePrice = (rawPrice, rawUnitPrice, article, targetPrice, isVrac) => {
  const unitPrice = normalizePrice(rawUnitPrice);

  if (isVrac) {
    return unitPrice
      ? { finalPrice: unitPrice,               compareTarget: article.prix_unitaire_kg }
      : { finalPrice: normalizePrice(rawPrice), compareTarget: targetPrice };
  }

  if (article.poids_kg && unitPrice) {
    return {
      finalPrice:    Number((article.poids_kg * unitPrice).toFixed(2)),
      compareTarget: targetPrice,
    };
  }

  return { finalPrice: normalizePrice(rawPrice), compareTarget: targetPrice };
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  normalizePrice,
  sleep,
  withRetry,
  PRICE_DIFF_THRESHOLD,
  SCORE_THRESHOLD,
  norm,
  tokenize,
  isQuantityToken,
  scoreSimilarity,
  extractQuantityTokens,
  validateQuantity,
  computePrice,
};