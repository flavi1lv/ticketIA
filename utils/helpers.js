/**
 * Valide qu'un titre produit correspond à ce qu'on cherche.
 * Normalise les formats de volume/poids avant comparaison.
 */
const validateTitle = (titre, productName) => {
  if (!titre || !productName) return false;

  const normalize = (str) =>
    str
      .toLowerCase()
      // Normalise les volumes : 1,75l / 1.75l / 175cl / 1l75 → "175cl"
      .replace(/1[,.]75\s*l\b|1l75|175\s*cl/gi, '175cl')
      .replace(/1[,.]5\s*l\b|1l5|150\s*cl/gi, '150cl')
      .replace(/33\s*cl/gi, '33cl')
      .replace(/50\s*cl/gi, '50cl')
      // Normalise les poids : 1kg / 1000g / 1 kg → "1kg"
      .replace(/1\s*kg\b|1000\s*g\b/gi, '1kg')
      .replace(/950\s*g\b/gi, '950g')
      // Normalise les marques courantes
      .replace(/coca[.\- ]?cola/gi, 'cocacola')
      // Supprime ponctuation résiduelle
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const keywords = normalize(productName)
    .split(' ')
    .filter((k) => k.length > 1);

  const titreLower = normalize(titre);
  
  // Vérification de base : tous les mots clés sont présents
  const matchesAll = keywords.every((keyword) => titreLower.includes(keyword));
  if (matchesAll) return true;

  // Fallback : au moins 70% des mots clés sont présents (pour les titres tronqués)
  const matchCount = keywords.filter((keyword) => titreLower.includes(keyword)).length;
  const ratio = matchCount / keywords.length;
  
  return ratio >= 0.7;
};

/**
 * Extrait et normalise un prix depuis un texte brut.
 * Retourne "X,XX" ou null.
 */
const normalizePrice = (rawText) => {
  if (!rawText) return null;

  const text = String(rawText).replace(/\s/g, '').replace(',', '.');

  // Format décimal classique : 5,89 ou 5.89 (suivi ou non de €)
  let match = text.match(/(\d{1,4})[.](\d{2})€?/);
  if (match) return `${match[1]},${match[2]}`;

  // Format 5€89
  match = text.match(/(\d{1,4})€(\d{2})/);
  if (match) return `${match[1]},${match[2]}`;

  // Format prix rond : 5€ ou 5.0
  match = text.match(/^(\d{1,4})€?$/);
  if (match) return `${match[1]},00`;

  // Prix en centimes depuis une API JSON (ex: 589 → 5,89)
  match = text.match(/^(\d{3,5})$/);
  if (match) {
    const v = parseInt(match[1], 10);
    // On considère que les nombres entiers de 3 à 5 chiffres sont des centimes
    // (ex: 100 -> 1,00€, 99999 -> 999,99€)
    if (v >= 100 && v < 100000) {
      const euros = Math.floor(v / 100);
      const cents = v % 100;
      return `${euros},${String(cents).padStart(2, '0')}`;
    }
  }

  // Prix flottant JSON : 5.89
  match = text.match(/^(\d+)\.(\d{2})$/);
  if (match) return `${match[1]},${match[2]}`;

  return null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (fn, retries = 2, delayMs = 2000) => {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > retries) throw err;
      console.warn(`   ⚠️  Tentative ${attempt} échouée → retry dans ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
};

module.exports = { validateTitle, normalizePrice, sleep, withRetry };