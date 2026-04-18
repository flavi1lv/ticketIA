// ---------------- PRIX ----------------
function normalizePrice(raw) {
  if (raw == null || raw === "") return null;

  // 🛡️ NOUVEAUTÉ : Détection automatique des objets API
  if (typeof raw === 'object') {
    if (raw.amount !== undefined) {
      raw = raw.amount; // Format Monoprix / API modernes
    } else if (raw.price !== undefined) {
      raw = raw.price; // Format alternatif courant
    } else if (raw.value !== undefined) {
      raw = raw.value; 
    } else {
      return null; // Objet non reconnu, on abandonne
    }
  }

  // Nettoyage classique de la chaîne
  let text = String(raw)
    .toLowerCase()
    .replace(/\s/g, "")      // Enlève les espaces
    .replace(/[€a-z]/g, "")  // Enlève les symboles et les lettres
    .replace(",", ".");      // Remplace la virgule par un point

  // Gestion des erreurs de type "1.000.50" (ex: 1 000,50€ mal parsé)
  const parts = text.split(".");
  if (parts.length > 2) {
    const decimals = parts.pop();
    text = parts.join("") + "." + decimals;
  }

  // Conversion finale
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