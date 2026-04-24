const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');
const { normalizePrice } = require('./utils/helpers');

const IGNORED_SCRAPERS = []; // ex: ['carrefour.js']

// ─────────────────────────────────────────────────────────────────────────────
// CHARGEMENT DES SCRAPERS
// ─────────────────────────────────────────────────────────────────────────────
const loadScrapers = () => {
  const scrapersDir = path.join(__dirname, 'scrapers');
  const loaded = {};
  if (fs.existsSync(scrapersDir)) {
    fs.readdirSync(scrapersDir).forEach(file => {
      if (file.endsWith('.js') && !IGNORED_SCRAPERS.includes(file)) {
        loaded[file.replace('.js', '')] = require(path.join(scrapersDir, file));
      }
    });
  }
  return loaded;
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPARATEUR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const runComparator = async (imagePath) => {
  const scrapers = loadScrapers();
  const articles = await scanReceipt(imagePath);
  if (!articles.length) return;

  console.table(articles);

  // Lance le navigateur uniquement si au moins un scraper en a besoin
  // (déterminé par le flag requiresBrowser exporté par chaque scraper)
  const needsBrowser = Object.values(scrapers).some(fn => fn.requiresBrowser);
  const browserScraperNames = Object.entries(scrapers)
    .filter(([, fn]) => fn.requiresBrowser)
    .map(([name]) => name);

  let browser = null;
  if (needsBrowser) {
    console.log(`🌐 Lancement du navigateur pour : ${browserScraperNames.join(', ')}...`);
    browser = await chromium.launch({ headless: true });
  } else {
    console.log('⚡ Mode API Directe (Aucun navigateur lancé)');
  }

  let totalOriginal = 0;
  const totaux = {};
  Object.keys(scrapers).forEach(n => { totaux[n] = 0; });

  for (const item of articles) {
    const pTicket = normalizePrice(item.prix_total);
    if (!pTicket) continue;

    totalOriginal += pTicket;
    console.log(`\n🔎 Recherche : "${item.recherche_optimisee}" (${pTicket.toFixed(2)}€)`);

    const results = {};

    const promises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        const res = await scraperFn(browser, item, pTicket);

        if (res?.status === 'found') {
          results[name] = { prix: res.product.prix, titre: res.product.titre };
          console.log(`   ✅ [${name}] Validé: ${res.product.titre} à ${res.product.prix.toFixed(2)}€`);
        } else {
          console.log(`   ❌ [${name}] Introuvable`);
        }
      } catch (e) {
        console.log(`   ❌ Erreur ${name}: ${e.message}`);
      }
    });

    await Promise.all(promises);

    // Si introuvable → prix ticket par défaut
    Object.keys(scrapers).forEach(n => {
      totaux[n] += results[n] ? results[n].prix : pTicket;
    });
  }

  if (browser) await browser.close();

  console.log('\n============================');
  console.log(`TOTAL TICKET ORIGINE: ${totalOriginal.toFixed(2)}€`);
  Object.entries(totaux).forEach(([name, total]) => {
    const eco = totalOriginal - total;
    console.log(
      `${name.toUpperCase()}: ${total.toFixed(2)}€` +
      (eco > 0 ? ` (Économie: ${eco.toFixed(2)}€ 📉)` : '')
    );
  });
  console.log('============================\n');
};

runComparator(path.join(__dirname, 'ticket.jpg'));