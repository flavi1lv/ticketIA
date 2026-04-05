const fs = require('fs');
const { normalizePrice } = require('./helpers');
const config = require('../config');

const AI_PROVIDER = config.aiProvider; // Doit être 'groq' ou 'ollama'

// 🧮 Fonction qui simule la caisse : supprime les articles annulés (prix négatifs)
const filterCancellations = (articles) => {
  const result = [];
  for (const item of articles) {
    const priceStr = String(item.prix || "0").replace(',', '.');
    const price = parseFloat(priceStr);

    if (price < 0) {
      // On cherche le dernier article ajouté qui a le même prix en positif
      const cancelIndex = result.findLastIndex(a => {
        const aPrice = parseFloat(String(a.prix).replace(',', '.'));
        return Math.abs(aPrice + price) < 0.01; // Évite les bugs de décimales JS
      });
      
      if (cancelIndex !== -1) {
        result.splice(cancelIndex, 1); // On retire l'article d'origine
      }
    } else if (price > 0) {
      result.push(item);
    }
  }
  return result;
};

const scanReceipt = async (imagePath) => {
  console.log(`📸 [1/2] Lecture visuelle via ${AI_PROVIDER.toUpperCase()}...`);
  try {
    const prompt = `
      Tu es une IA experte en produits de supermarchés français. 
      Voici la photo d'un ticket de caisse.
      TA MISSION : Extraire chaque ligne d'article, la traduire en NOM DE PRODUIT COMPLET ET CHERCHABLE, et récupérer le PRIX TTC final.
      
      CONSIGNES STRICTES :
      - PRIX : Lis bien la colonne TTC à droite. Extrait uniquement les chiffres avec un point "." (ex: "1.99"). N'oublie pas le signe "-" si c'est une remise ou annulation (ex: "-0.54").
      - NOMS : Garde absolument les poids (600g), volumes (1.25L) et quantités (3x).
      - FILTRE : Ne garde que les articles (ignore TVA, TOTAL, CARTE BANCAIRE, etc.).
      - Retourne UNIQUEMENT un objet JSON valide.
      
      FORMAT ATTENDU : 
      { "articles": [ { "nom": "NOM_TRADUIT", "prix": "PRIX" } ] }
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
          model: "meta-llama/llama-4-scout-17b-16e-instruct", 
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

    // Traitement des données
    const result = JSON.parse(responseText);
    const rawArticles = result.articles || [];
    
    // On passe le balai sur les annulations/erreurs de caisse
    const cleanedArticles = filterCancellations(rawArticles);
    
    // On formate proprement pour le retour
    return cleanedArticles.map(a => ({
      nom: (a.nom || "INCONNU").toUpperCase(),
      prix: normalizePrice(String(a.prix))
    }));

  } catch (error) {
    console.error("💥 Erreur Scanner :", error.message || error);
    return [];
  }
};

module.exports = { scanReceipt };