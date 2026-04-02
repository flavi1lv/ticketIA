/**
 * Normalise un texte pour la recherche (gestion des accents, volumes dynamiques, etc.)
 */
const normalizeText = (str) => {
  if (!str) return "";
  return str.toLowerCase()
    // 1. Suppression des accents (crucial en français : "pâte" -> "pate")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // 2. Conversion dynamique des Litres en centilitres (ex: 1.5L, 1,5 L -> 150cl)
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, p1, p2) => `${p1}${p2.padEnd(2, '0')}cl`)
    // 3. Conversion dynamique du format "1L5" ou "1L75" -> 150cl / 175cl
    .replace(/(\d+)\s*l\s*(\d+)/g, (_, p1, p2) => `${p1}${p2.padEnd(2, '0')}cl`)
    // 4. Conversion dynamique des kilos en grammes (ex: 1kg -> 1000g, 1.5kg -> 1500g)
    .replace(/(\d+)[.,](\d+)\s*kg\b/g, (_, p1, p2) => `${p1}${p2.padEnd(3, '0')}g`)
    .replace(/(\d+)\s*kg\b/g, (_, p1) => `${p1}000g`)
    // 5. Nettoyage final : on remplace tout ce qui n'est pas lettre/chiffre par un espace
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Valide si un titre correspond à une recherche
 */
const validateTitle = (titre, query) => {
  if (!titre || !query) return false;

  const normTitre = normalizeText(titre);
  const keywords = normalizeText(query).split(' ').filter(k => k.length > 1);
  
  if (keywords.length === 0) return false;

  const matchCount = keywords.filter(k => normTitre.includes(k)).length;
  const matchRatio = matchCount / keywords.length;

  // 🚨 LE DÉTECTEUR DE MENSONGES : On affiche ce qui se passe dans l'ombre !
  console.log(`   ⚖️ [TEST IA] Cherche: "${query}" | Trouvé: "${titre.slice(0, 40)}..." | Score: ${matchRatio.toFixed(2)}`);

  // On valide si au moins 40% des mots correspondent (très souple)
  return matchRatio >= 0.4; 
};

/**
 * Normalise un prix renvoyé par l'IA en format français strict "X,YY"
 */
const normalizePrice = (raw) => {
  if (raw === null || raw === undefined) return null;

  // 1. On nettoie la chaîne (ex: " 1 250,50 € " -> "1250.50")
  let text = String(raw).toLowerCase()
    .replace(/\s/g, '')      // Retire les espaces (ex: séparateur de milliers "1 200")
    .replace(/[€a-z]/g, '')  // Retire la devise et les lettres éventuelles
    .replace(',', '.');      // Transforme la virgule française en point anglais pour le code

  // S'il y a plusieurs points (format américain bizarre "1.250.00")
  const parts = text.split('.');
  if (parts.length > 2) {
    const decimals = parts.pop();
    text = parts.join('') + '.' + decimals;
  }
  const num = parseFloat(text);

  if (isNaN(num)) return null;

  // 3. On force 2 décimales et on remet la virgule pour l'affichage final
  return num.toFixed(2).replace('.', ',');
};

/**
 * Met en pause l'exécution
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Relance une fonction asynchrone en cas d'échec
 */
const withRetry = async (fn, retries = 2, delayMs = 1500) => {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries) throw error; 
      await sleep(delayMs * (i + 1));
    }
  }
};

module.exports = { validateTitle, normalizePrice, sleep, withRetry };