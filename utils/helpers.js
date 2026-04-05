/**
 * Normalise un texte pour la recherche (gestion des accents, synonymes, volumes dynamiques)
 */
function normalizeText(str) {
  if (!str) return "";
  let text = String(str).toLowerCase()
    // 1. Suppression des accents
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // 2. Remplacements des caractères spéciaux et synonymes
    .replace(/œ/g, "oe") // Gère le fameux "œuf"
    .replace(/\bsaucisse seche\b/g, "saucisson sec")
    .replace(/\bsaucisses seches\b/g, "saucisson sec")
    .replace(/\boeufs?\b/g, "oeuf"); // Met les oeufs au singulier

  return text
    // 3. Conversion dynamique des volumes et poids
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, p1, p2) => `${p1}${p2.padEnd(2, '0')}cl`) // Ex: 1.5L -> 150cl
    .replace(/(\d+)\s*l\s*(\d+)/g, (_, p1, p2) => `${p1}${p2.padEnd(2, '0')}cl`)    // Ex: 1L5 -> 150cl
    .replace(/(\d+)\s*l\b/g, (_, p1) => `${p1}00cl`)                               // Ex: 2L -> 200cl
    .replace(/(\d+)[.,](\d+)\s*kg\b/g, (_, p1, p2) => `${p1}${p2.padEnd(3, '0')}g`) // Ex: 1.5kg -> 1500g
    .replace(/(\d+)\s*kg\b/g, (_, p1) => `${p1}000g`)                               // Ex: 1kg -> 1000g
    // 4. Nettoyage final : on garde lettres et chiffres
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valide si un super-titre correspond à une recherche
 */
function validateTitle(superTitre, query) {
  if (!superTitre || !query) return false;

  const normTitre = normalizeText(superTitre);
  
  // On découpe la recherche en mots (ex: ["gaufres", "x10", "600g"])
  const keywords = normalizeText(query).split(' ').filter(k => k.length > 1);
  if (keywords.length === 0) return false;

  // On compte combien de mots de la recherche sont trouvés dans le super-titre
  const matchCount = keywords.filter(k => normTitre.includes(k)).length;
  const matchRatio = matchCount / keywords.length;

  // LE DÉTECTEUR DE MENSONGES : On affiche 60 caractères pour voir un peu plus de détails
  console.log(`   ⚖️ [TEST IA] Cherche: "${query}" | Trouvé: "${String(superTitre).slice(0, 60).replace(/\n/g, ' ')}..." | Score: ${matchRatio.toFixed(2)}`);

  // On valide à 50% : il faut que la majorité des mots (y compris les poids) correspondent
  return matchRatio >= 0.50; 
}

/**
 * Normalise un prix renvoyé par l'IA en format français strict "X,YY"
 */
function normalizePrice(raw) {
  if (raw === null || raw === undefined) return null;

  let text = String(raw).toLowerCase()
    .replace(/\s/g, '')      
    .replace(/[€a-z]/g, '')  
    .replace(',', '.');      

  const parts = text.split('.');
  if (parts.length > 2) {
    const decimals = parts.pop();
    text = parts.join('') + '.' + decimals;
  }

  const num = parseFloat(text);
  if (isNaN(num)) return null;

  return num.toFixed(2).replace('.', ',');
}

/**
 * Met en pause l'exécution
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Relance une fonction asynchrone en cas d'échec
 */
async function withRetry(fn, retries = 2, delayMs = 1500) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) { 
      if (i === retries) throw error; 
      await sleep(delayMs * (i + 1));
    }
  }
}

module.exports = { normalizeText, validateTitle, normalizePrice, sleep, withRetry };