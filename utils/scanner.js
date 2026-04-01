const Tesseract = require('tesseract.js');
const { normalizePrice } = require('./helpers');

const scanReceipt = async (imagePath) => {
  console.log(`📸 [1/2] OCR : Lecture...`);
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'fra');
    console.log(`🧠 [2/2] OLLAMA : Traduction des abréviations...`);

    const prompt = `
      Tu es une IA experte en produits de supermarchés français. 
      Voici un texte brut de ticket Carrefour.
      TA MISSION : Traduire chaque ligne en NOM DE PRODUIT COMPLET ET CHERCHABLE.
      
      EXEMPLES DE TRADUCTION :
      - "GAUFR DE" -> "Gaufres de Bruxelles"
      - "PATE PIZZA CO" -> "Pate à pizza croustipate"
      - "SAUCIS.SECHE" -> "Saucisse sèche pur porc"
      - "RECH FRIXION ASS" -> "Recharges stylo Pilot Frixion"
      - "PAINS AU CHOC" -> "Pains au chocolat"
      
      CONSIGNES :
      - Supprime les poids (1KG, 135G) du nom.
      - Retourne uniquement du JSON. Pas de blabla.
      
      JSON à compléter : { "articles": [ { "nom": "NOM_TRADUIT", "prix": "PRIX" } ] }

      TEXTE BRUT :
      ${text}
    `;

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
    const result = JSON.parse(data.response);
    
    return result.articles.map(a => ({
      nom: a.nom.toUpperCase(),
      prix: normalizePrice(a.prix)
    }));
  } catch (error) {
    console.error("💥 Erreur Scanner :", error);
    return [];
  }
};

module.exports = { scanReceipt };