const fs = require('fs');
const { normalizePrice } = require('./helpers');
const config = require('../config');

const AI_PROVIDER = config.aiProvider;

// ─────────────────────────────────────────────────────────────────────────────
// FILTRAGE DES ANNULATIONS
// ─────────────────────────────────────────────────────────────────────────────
const filterCancellations = (articles) => {
  const result = [];

  for (const item of articles) {
    const priceValue = normalizePrice(item.prix_total ?? item.prix ?? 0) ?? 0;

    if (priceValue < 0) {
      const cancelIndex = result.findLastIndex(a => {
        const aPrice = normalizePrice(a.prix_total ?? a.prix ?? 0) ?? 0;
        return Math.abs(aPrice + priceValue) < 0.01;
      });
      if (cancelIndex !== -1) result.splice(cancelIndex, 1);
    } else if (priceValue > 0) {
      result.push(item);
    }
  }

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISATION DES ARTICLES
// ─────────────────────────────────────────────────────────────────────────────
const normalizeArticle = (a) => ({
  nom_brut:            a.nom_brut || '',
  recherche_optimisee: (a.recherche_optimisee || a.nom || 'INCONNU').toUpperCase(),
  prix_total:          normalizePrice(a.prix_total)       ?? 0,
  poids_kg:            normalizePrice(a.poids_kg)         ?? null,
  prix_unitaire_kg:    normalizePrice(a.prix_unitaire_kg) ?? null,
});

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const PROMPT = `
Tu es un extracteur de données expert, spécialisé dans les tickets de caisse.
Ton unique mission est de retourner STRICTEMENT un objet JSON valide.

CONSIGNES DE NETTOYAGE :
1. nom_brut : Le nom exact imprimé sur le ticket.
2. recherche_optimisee : Le nom du produit tel que tu le taperais dans la barre de recherche d'un Drive.
   - Garde les poids et les formats si cela aide à la précision (ex: "Gaufres x10 600g", "Pâte à pizza 300g", "Fuze Tea 1.25L").
   - Corrige les abréviations de caisse en français lisible.
   - IMPORTANT : Conserve les noms de marques tels qu'ils apparaissent sur le ticket, même abrégés — ne les traduis pas.
     Exemple : "RECH FRIXION" → oui pour "Recharges Frixion x6"  non pour "Recharge stylo à bille"
   - Si tu n'es pas sûr du nom d'une marque, retranscris-la phonétiquement plutôt que de la traduire.
   - Il ne faut pas garder les abréviations étranges de caisse.
   - Si tu n'es pas sûr, privilégie la clarté pour une recherche en ligne.
3. prix_total : Nombre (ex: 1.99).
4. poids_kg : Nombre si présent (ex: 1.246), sinon null.
5. prix_unitaire_kg : Nombre si présent (ex: 3.49), sinon null.

RÈGLES STRICTES :
- AUCUN texte avant ou après le JSON.
- AUCUNE balise markdown (pas de \`\`\`json).
- Ignore TVA, TOTAL, et lignes de paiement.
- Un article annulé a un prix négatif : inclus-le quand même, il sera traité.

FORMAT JSON ATTENDU :
{ "articles": [ { "nom_brut": "...", "recherche_optimisee": "...", "prix_total": 0.0, "poids_kg": null, "prix_unitaire_kg": null } ] }
`;


const callLLM = async (imagePath) => {
  const base64Image = Buffer.from(fs.readFileSync(imagePath)).toString('base64');

  if (AI_PROVIDER === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (AI_PROVIDER === 'ollama') {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2-vision',
        prompt: PROMPT,
        images: [base64Image],
        stream: false,
        format: 'json',
      }),
    });
    const data = await response.json();
    return data.response;
  }

  throw new Error(`AI_PROVIDER inconnu : ${AI_PROVIDER}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// SCAN PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const scanReceipt = async (imagePath) => {
  console.log(`📸 [1/2] Lecture visuelle via ${AI_PROVIDER.toUpperCase()}...`);

  try {
    const responseText = await callLLM(imagePath);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Format JSON introuvable dans la réponse du LLM.');

    const result = JSON.parse(jsonMatch[0]);
    const articles = result.articles;

    if (!Array.isArray(articles) || articles.length === 0)
      throw new Error('Aucun article extrait par le LLM.');

    const cleaned = filterCancellations(articles);
    return cleaned.map(normalizeArticle);

  } catch (error) {
    console.error('💥 Erreur Scanner :', error.message || error);
    return [];
  }
};

module.exports = { scanReceipt };