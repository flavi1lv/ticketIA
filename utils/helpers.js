// ---------------- NORMALISATION TEXTE ----------------
function normalizeText(str) {
  if (!str) return "";

  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    // Suppression des mots de liaison inutiles pour la comparaison
    .replace(/\b(de|du|des|le|la|les|au|aux|un|une)\b/g, " ")
    
    // unités avancées
    .replace(/(\d+)\s?x\s?(\d+)/g, "$1x$2")
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, a, b) => `${a}${b.padEnd(2, "0")}cl`)
    .replace(/(\d+)\s*l\b/g, (_, a) => `${a}00cl`)
    .replace(/(\d+)[.,](\d+)\s*kg\b/g, (_, a, b) => `${a}${b.padEnd(3, "0")}g`)
    .replace(/(\d+)\s*kg\b/g, (_, a) => `${a}000g`)
    .replace(/(\d+)\s*ml\b/g, (_, a) => `${Math.round(a / 10)}cl`)

    // synonymes / Marques propres
    .replace(/\boeufs?\b/g, "oeuf")
    .replace(/\byaourts?\b/g, "yaourt")
    .replace(/\bmarque repere\b/g, "") // On ignore la marque distributeur Leclerc
    .replace(/\bbio village\b/g, "bio")

    // nettoyage
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- EXTRACTION FEATURES ----------------
function extractFeatures(text) {
  const tokens = new Set(text.split(" ").filter(t => t.length > 1)); // On ignore les lettres isolées

  let quantity = null;
  const qMatch = text.match(/(\d+)(g|cl)\b/);
  if (qMatch) quantity = parseInt(qMatch[1]);

  let pack = 1;
  const pMatch = text.match(/(\d+)x(\d+)/);
  if (pMatch) pack = parseInt(pMatch[1]);

  return { tokens, quantity, pack };
}

// ---------------- SIMILARITÉ TEXTE ----------------
function computeTextScore(queryTokens, titleTokens) {
  if (queryTokens.size === 0) return 0;
  let matches = 0;

  for (const q of queryTokens) {
    if (titleTokens.has(q)) {
      matches += 1;
    } else {
      for (const t of titleTokens) {
        if (t.includes(q) || q.includes(t)) {
          matches += 0.7; // Match partiel boosté à 0.7
          break;
        }
      }
    }
  }

  return matches / queryTokens.size;
}

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

  // ----- Poids/Volume (Crucial chez Leclerc)
  if (queryFeatures.quantity && titleFeatures.quantity) {
    const diff = Math.abs(queryFeatures.quantity - titleFeatures.quantity) / queryFeatures.quantity;
    if (diff <= 0.05) score += 0.35; // Très proche
    else if (diff <= 0.20) score += 0.15;
    else score -= 0.4; // Pénalité si format différent (ex: 500g vs 1kg)
  }

  // ----- Packs
  if (queryFeatures.pack !== titleFeatures.pack) {
    score -= 0.25;
  }

  // ----- Comparaison de prix (Le bonus "Adem")
  // Si le prix trouvé est très proche du prix ticket, on valide presque à coup sûr
  if (scrapedPrice != null && targetPrice != null) {
    const pScraped = typeof scrapedPrice === 'number' ? scrapedPrice : normalizePrice(scrapedPrice);
    const pTarget = typeof targetPrice === 'number' ? targetPrice : normalizePrice(targetPrice);

    if (pScraped && pTarget) {
      const diffPrix = Math.abs(pScraped - pTarget) / pTarget;
      if (diffPrix <= 0.03) score += 0.4; // Prix quasi identique = gros bonus
      else if (diffPrix <= 0.15) score += 0.2;
    }
  }

  // Seuil de validation
  return score >= 0.55; 
}

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