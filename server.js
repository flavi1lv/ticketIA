require('dotenv').config();
const express = require('express');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const port = 3000;

// Utilisation de la clé stockée dans le fichier .env
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

app.use(express.static('public'));
app.use(express.json()); 

// --- ROUTE AUTHENTIFICATION ---
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    
    // Ce log s'affichera quand Google t'enverra le jeton
    console.log("🛠 Tentative de connexion reçue..."); 
    
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        // CE LOG EST LE PLUS IMPORTANT : il confirme que ça marche !
        console.log(`✅ Utilisateur authentifié : ${payload.name} (${payload.email})`);
        
        res.json({ name: payload.name });
    } catch (error) {
        console.error("❌ Erreur de vérification :", error.message);
        res.status(401).json({ error: "Authentification échouée" });
    }
});

// --- ROUTE SCAN ---
app.post('/api/comparer-ticket', (req, res) => {
    console.log("🔍 Bouton scan cliqué !");
    res.json({ enseigneGagnante: "Carrefour", prixTotal: 45.20 });
});

app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
  // Ce log vérifie que ton fichier .env est bien lu
  console.log(`🔑 Clé Google chargée : ${CLIENT_ID ? "OUI (OK)" : "NON (ERREUR .ENV)"}`);
});