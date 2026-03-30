const express = require('express');
const app = express();
const port = 3000;

// On sert le dossier "public" pour afficher le site web
app.use(express.static('public'));
app.use(express.json()); 

// L'API que le site web va appeler
app.post('/api/comparer-ticket', async (req, res) => {
    console.log("📥 Le site web a cliqué sur le bouton !");
    
    // PLUS TARD : Ici, on appellera ta fonction "scrapeCarrefour" qui est dans scraper.js
    
    // Pour l'instant on renvoie des fausses données pour que l'Étudiant A puisse coder le site
    res.json({
        enseigneGagnante: "Carrefour",
        prixTotal: 45.20,
        message: "Analyse réussie !"
    });
});

app.listen(port, () => {
  console.log(`✅ Serveur Web démarré ! Ouvre ton navigateur sur http://localhost:${port}`);
});
