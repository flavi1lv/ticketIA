const Tesseract = require('tesseract.js');
const { normalizePrice } = require('./helpers');
const { GoogleGenAI } = require('@google/genai'); 
const config = require('../config');

const AI_PROVIDER = config.aiProvider;
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey }); 

const scanReceipt = async (imagePath) => {
  console.log(`📸 [1/2] OCR : Lecture...`);
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'fra');
    console.log(`🧠 [2/2] ${AI_PROVIDER.toUpperCase()} : Structuration des données...`);

    const prompt = `
      Tu es une IA experte en produits de supermarchés français. 
      Voici un texte brut issu de l'OCR d'un ticket de caisse.
      TA MISSION : Traduire chaque ligne d'article en NOM DE PRODUIT COMPLET ET CHERCHABLE.
      
      EXEMPLES DE TRADUCTION :
      - "300G PATE PIZZA CO" -> "Pâte à pizza 300g"
      - "250G SAUCIS.SECHE" -> "Saucisse sèche 250g"
      - "PET 1.25L FUZE TEA" -> "Fuze Tea 1.25L"
      - "360G PAINS AU CHOC" -> "Pains au chocolat 360g"
      - "BOT.1KG POIREAU" -> "Poireaux 1kg"
      
      CONSIGNES STRICTES :
      - GARDE absolument les poids et volumes (ex: 600g, 1.25L, 250g, 1kg) car ils sont indispensables pour comparer les bons formats.
      - SUPPRIME les mentions de lots ou quantités multiples (ex: X10, x6, lot de 3) qui perturbent les barres de recherche.
      - CORRIGE les abréviations pour avoir le vrai nom du produit compréhensible par un humain.
      - Ne garde que les vrais articles (ignore les lignes de TVA, les remises, les totaux, ou la carte de fidélité).
      - Retourne UNIQUEMENT un objet JSON valide, sans aucun texte ou blabla avant ou après.
      
      FORMAT ATTENDU : 
      { "articles": [ { "nom": "NOM_TRADUIT", "prix": "PRIX" } ] }

      TEXTE BRUT :
      ${text}
    `;

    let responseText = "";

    // 🚀 ROUTE 1 : GEMINI (Cloud gratuit et rapide)
    if (AI_PROVIDER === 'gemini') {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      responseText = response.text;
    } 
    
    // 🐢 ROUTE 2 : OLLAMA (En local sur ta machine, pour plus tard)
    else if (AI_PROVIDER === 'ollama') {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "llama3",
          prompt: prompt,
          stream: false,
          format: "json"
        })
      });
      const data = await response.json();
      responseText = data.response;
    }

    const result = JSON.parse(responseText);
    
    return (result.articles || []).map(a => ({
      nom: (a.nom || "INCONNU").toUpperCase(),
      prix: normalizePrice(String(a.prix))
    }));

  } catch (error) {
    console.error("💥 Erreur Scanner :", error.message || error);
    return [];
  }
};

module.exports = { scanReceipt };