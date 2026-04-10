require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const app = express();
const port = 3000;
const upload = multer({ dest: 'uploads/' });

// --- CONNEXION À LA BASE DE DONNÉES ---
mongoose.connect(process.env.DATABASE_URL)
    .then(() => console.log("💾 Succès : Connecté à MongoDB Atlas !"))
    .catch(err => console.error("❌ Erreur de connexion MongoDB :", err.message));

// --- STRUCTURE DES DONNÉES ---
const User = mongoose.model('User', new mongoose.Schema({
    googleId: String,
    name: String,
    email: String,
    history: [{ 
        date: { type: Date, default: Date.now }, 
        store: String, 
        total: Number 
    }]
}));

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(express.static('public'));
app.use(express.json());

// --- ROUTES ---

// 1. Authentification Google
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        let user = await User.findOne({ googleId: payload.sub });
        if (!user) {
            user = await User.create({
                googleId: payload.sub,
                name: payload.name,
                email: payload.email
            });
            console.log("🆕 Nouvel utilisateur enregistré !");
        } else {
            console.log("🏠 Utilisateur reconnu :", user.name);
        }

        // On renvoie le googleId pour que le Front-end puisse l'utiliser lors du scan
        res.json({ name: user.name, googleId: user.googleId });
    } catch (error) {
        console.error("Erreur Auth:", error);
        res.status(401).send("Erreur d'authentification");
    }
});

// 2. Scan et Analyse du ticket + Sauvegarde en Base
app.post('/api/comparer-ticket', upload.single('ticket'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("Pas de fichier.");
        
        // On récupère l'ID utilisateur envoyé depuis le front (optionnel mais recommandé)
        const userId = req.body.googleId; 

        console.log("📸 Analyse du ticket en cours...");
        const { data: { text } } = await Tesseract.recognize(req.file.path, 'fra');
        fs.unlinkSync(req.file.path); 

        // Extraction Enseigne
        let enseigne = "Inconnue";
        const texteMin = text.toLowerCase();
        if (texteMin.includes("carrefour") || texteMin.includes("senart")) enseigne = "Carrefour";
        else if (texteMin.includes("leclerc")) enseigne = "Leclerc";
        else if (texteMin.includes("intermarche")) enseigne = "Intermarché";
        else if (texteMin.includes("auchan")) enseigne = "Auchan";
        else if (texteMin.includes("lidl")) enseigne = "Lidl";

        // Extraction Prix
        const regexPrix = /(\d+[\s.,]\d{2})/g;
        const montantsTrouves = text.match(regexPrix);
        let total = 0;
        if (montantsTrouves) {
            const prixNumeriques = montantsTrouves
                .map(p => parseFloat(p.replace(',', '.')))
                .filter(p => p < 500); 
            if (prixNumeriques.length > 0) total = Math.max(...prixNumeriques);
        }

        // --- SAUVEGARDE DANS LA BASE DE DONNÉES ---
        // On ajoute ce scan à l'historique de l'utilisateur
        if (userId) {
            await User.findOneAndUpdate(
                { googleId: userId },
                { $push: { history: { store: enseigne, total: total } } }
            );
            console.log(`💾 Ticket sauvegardé dans l'historique de l'utilisateur !`);
        }

        console.log(`✅ Résultat trouvé -> Enseigne: ${enseigne}, Total: ${total}€`);

        res.json({ 
            success: true,
            enseigneGagnante: enseigne,
            prixTotal: total.toFixed(2),
            extrait: text.substring(0, 150)
        });

    } catch (error) {
        console.error("Erreur Serveur:", error);
        res.status(500).send("Erreur lors de l'analyse.");
    }
});

app.listen(port, () => {
    console.log(`🚀 Serveur en ligne : http://localhost:${port}`);
});