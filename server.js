require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');

const { chromium } = require('playwright-extra');
const stealth      = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const { scanReceipt }   = require('./utils/scanner');
const { normalizePrice } = require('./utils/helpers');

const app    = express();
const port   = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

// ─────────────────────────────────────────────────────────────────────────────
// CHARGEMENT DYNAMIQUE DES SCRAPERS
// ─────────────────────────────────────────────────────────────────────────────
const loadScrapers = () => {
  const scrapersDir = path.join(__dirname, 'scrapers');
  const loaded = {};
  if (fs.existsSync(scrapersDir)) {
    fs.readdirSync(scrapersDir).forEach(file => {
      if (file.endsWith('.js')) {
        loaded[file.replace('.js', '')] = require(path.join(scrapersDir, file));
      }
    });
  }
  return loaded;
};

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB
// ─────────────────────────────────────────────────────────────────────────────
mongoose.connect(process.env.DATABASE_URL)
  .then(() => console.log('💾 MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

const User = mongoose.model('User', new mongoose.Schema({
  googleId: String,
  name:     String,
  email:    String,
  history:  [{
    date:  { type: Date, default: Date.now },
    store: String,
    total: Number,
  }]
}));

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
app.use(express.static('public'));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GOOGLE
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken:  token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    let user = await User.findOne({ googleId: payload.sub });
    if (!user) {
      user = await User.create({
        googleId: payload.sub,
        name:     payload.name,
        email:    payload.email,
      });
    }

    res.json({ name: user.name, googleId: user.googleId });
  } catch (error) {
    res.status(401).json({ error: 'Auth Error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPARATEUR TICKET
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/comparer-ticket', upload.single('ticket'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  let browser = null;

  try {
    const userId  = req.body.googleId;
    const scrapers = loadScrapers();

    // 1. OCR / IA → liste d'articles
    const articles = await scanReceipt(req.file.path);
    if (!articles || !articles.length) {
      return res.status(422).json({ error: 'Aucun article détecté sur le ticket' });
    }

    // 2. Lancer le navigateur uniquement si un scraper en a besoin
    const needsBrowser = Object.values(scrapers).some(fn => fn.requiresBrowser);
    if (needsBrowser) {
      console.log('🌐 Lancement du navigateur...');
      browser = await chromium.launch({ headless: true });
    } else {
      console.log('⚡ Mode API directe (pas de navigateur)');
    }

    // 3. Comparer article par article
    let totalOriginal = 0;
    const itemsResult = [];

    for (const item of articles) {
      const pTicket = normalizePrice(item.prix_total);
      if (!pTicket) continue;
      totalOriginal += pTicket;

      console.log(`\n🔎 "${item.recherche_optimisee}" (${pTicket.toFixed(2)}€)`);

      const storeResults = {};
      await Promise.all(
        Object.entries(scrapers).map(async ([name, scraperFn]) => {
          try {
            const result = await scraperFn(browser, item, pTicket);
            if (result?.status === 'found') {
              storeResults[name] = result.product.prix;
              console.log(`   ✅ [${name}] ${result.product.titre} → ${result.product.prix.toFixed(2)}€`);
            } else {
              console.log(`   ❌ [${name}] Introuvable`);
            }
          } catch (e) {
            console.log(`   ❌ Erreur [${name}]: ${e.message}`);
          }
        })
      );

      itemsResult.push({
        nom:            item.nom || item.recherche_optimisee,
        prix_ticket:    pTicket,
        prix_carrefour: storeResults['carrefour'] ?? null,
        prix_monoprix:  storeResults['monoprix']  ?? null,
      });
    }

    if (browser) await browser.close();

    // 4. Nettoyage du fichier uploadé
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // 5. Calculer les totaux et l'enseigne gagnante
    const totalC = itemsResult.reduce((s, i) => s + (i.prix_carrefour ?? i.prix_ticket), 0);
    const totalM = itemsResult.reduce((s, i) => s + (i.prix_monoprix  ?? i.prix_ticket), 0);
    const enseigneGagnante = totalC <= totalM ? 'carrefour' : 'monoprix';

    console.log(`\n============================`);
    console.log(`TOTAL TICKET : ${totalOriginal.toFixed(2)}€`);
    console.log(`CARREFOUR    : ${totalC.toFixed(2)}€`);
    console.log(`MONOPRIX     : ${totalM.toFixed(2)}€`);
    console.log(`GAGNANT      : ${enseigneGagnante.toUpperCase()}`);
    console.log(`============================\n`);

    // 6. Sauvegarder dans l'historique si connecté
    if (userId) {
      await User.findOneAndUpdate(
        { googleId: userId },
        { $push: { history: { store: enseigneGagnante, total: Math.min(totalC, totalM) } } }
      );
    }

    // 7. Réponse au frontend
    res.json({
      success:         true,
      enseigneGagnante,
      prixTotal:       totalOriginal,
      totalCarrefour:  +totalC.toFixed(2),
      totalMonoprix:   +totalM.toFixed(2),
      articles:        itemsResult,
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('❌ Erreur comparateur:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l\'analyse' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`🚀 Server: http://localhost:${port}`);
});
