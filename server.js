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
... (99lignes restantes)
