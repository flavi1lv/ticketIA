const fs = require('fs');
const { normalizePrice } = require('./helpers');
const config = require('../config');

const AI_PROVIDER = config.aiProvider; // Doit être 'groq' ou 'ollama'

// 🧮 Fonction qui simule la caisse : supprime les articles annulés (prix négatifs)
const filterCancellations = (articles) => {
  const result = [];
  
  for (const item of articles) {
    // Support de la nouvelle clé prix_total ou de l'ancienne clé prix
    const priceValue = item.prix_total !== undefined 
      ? item.prix_total 
      : parseFloat(String(item.prix || "0").replace(',', '.'));

    if (priceValue < 0) {
      // On cherche le dernier article ajouté qui a le même prix en positif
      const cancelIndex = result.findLastIndex(a => {
        const aPrice = a.prix_total !== undefined 
          ? a.prix_total 
          : parseFloat(String(a.prix).replace(',', '.'));
        return Math.abs(aPrice + priceValue) < 0.01; // Évite les bugs de décimales JS
      });
      
      if (cancelIndex !== -1) {
        result.splice(cancelIndex, 1); // On retire l'article d'origine
      }
    } else if (priceValue > 0) {
      result.push(item);
    }
  }
  
  return result;
};

const scanReceipt = async (imagePath) => {
  console.log(`📸 [1/2] Lecture visuelle via ${AI_PROVIDER.toUpperCase()}...`);
  
  try {
    const prompt = `
      Tu es un extracteur de données expert, spécialisé dans les tickets de caisse.
      Ton unique mission est de retourner STRICTEMENT un objet JSON valide.

      CONSIGNES DE NETTOYAGE :
      1. nom_brut : Le nom exact imprimé sur le ticket.
      2. recherche_optimisee : Le nom du produit tel que tu le taperais dans la barre de recherche d'un Drive. Garde les poids et les formats si cela aide à la précision (ex: "Gaufres x10 600g", "Pâte à pizza 300g"). Ne garde pas les abréviations étranges de caisse. Il faut impérativement garder le nom des marques sans les traduire. Si tu n'es pas sûr, privilégie la clarté pour une recherche en ligne.
      3. prix_total : Nombre (ex: 1.99).
      4. poids_kg : Nombre si présent (ex: 1.246), sinon null.
      5. prix_unitaire_kg : Nombre si présent (ex: 3.49), sinon null.

      RÈGLES STRICTES :
      - AUCUN texte avant ou après le JSON.
      - AUCUNE balise markdown (pas de \`\`\`json).
      - Ignore TVA, TOTAL, et lignes de paiement.

      FORMAT JSON ATTENDU :
      { "articles": [ { "nom_brut": "...", "recherche_optimisee": "...", "prix_total": 0.0, "poids_kg": 0.0, "prix_unitaire_kg": 0.0 } ] }
    `;

    let responseText = "";

    // 🚀 ROUTE 1 : GROQ
    if (AI_PROVIDER === 'groq') {
      const base64Image = Buffer.from(fs.readFileSync(imagePath)).toString("base64");
      const imageUrl = `data:image/jpeg;base64,${base64Image}`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct", // TON MODELE CORRECT
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageUrl } }
              ]
            }
          ],
          temperature: 0,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      responseText = data.choices[0].message.content;
    }
    
    // 🐢 ROUTE 2 : OLLAMA
    else if (AI_PROVIDER === 'ollama') {
      const base64Image = Buffer.from(fs.readFileSync(imagePath)).toString("base64");

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "llama3.2-vision",
          prompt: prompt,
          images: [base64Image],
          stream: false,
          format: "json"
        })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      responseText = data.response;
    }

    // 🛡️ NETTOYAGE ANTI-MARKDOWN & PARSING SÉCURISÉ
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Format JSON introuvable dans la réponse.");
    
    const result = JSON.parse(jsonMatch[0]);

    const rawArticles = result.articles || [];
    
    // On passe le balai sur les annulations/erreurs de caisse
    const cleanedArticles = filterCancellations(rawArticles);
    
    // 🌉 PONT DE COMPATIBILITÉ & FORMATAGE POUR LE RETOUR
    return cleanedArticles.map(a => ({
      nom_brut: a.nom_brut,
      recherche_optimisee: (a.recherche_optimisee || a.nom || "INCONNU").toUpperCase(),
      prix_total: a.prix_total,
      poids_kg: a.poids_kg || null,
      prix_unitaire_kg: a.prix_unitaire_kg || null
    }));

  } catch (error) {
    console.error("💥 Erreur Scanner :", error.message || error);
    return [];
  }
};

module.exports = { scanReceipt };