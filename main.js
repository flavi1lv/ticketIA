const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');

const IGNORED_SCRAPERS = ['auchan.js']; 

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

const runComparator = async (imagePath) => {
  const scrapers = loadScrapers();
  const articles = await scanReceipt(imagePath);
  if (!articles.length) return;

  console.table(articles);
  const browser = await chromium.launch({ headless: true });

  let totalOriginal = 0;
  const totaux = {};
  Object.keys(scrapers).forEach(n => totaux[n] = 0);

  for (const item of articles) {
    if (!item.prix) continue;
    const pTicket = parseFloat(item.prix.replace(',', '.'));
    totalOriginal += pTicket;

    console.log(`\n🔎 Recherche : "${item.nom}" (${item.prix}€)`);
    const results = {};

    const promises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        const res = await scraperFn(browser, item.nom);
        if (res && res.status === 'found') {
          let pScraped = parseFloat(res.product.prix.replace(',', '.'));
          
          // ⚖️ LOGIQUE POIDS
          const weightMatch = item.nom.match(/(\d+[.,]\d+)\s*kg/i);
          if (weightMatch && res.product.isKg) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            pScraped = pScraped * weight;
            console.log(`       ⚖️ [POIDS] ${weight}kg x ${res.product.prix}€ = ${pScraped.toFixed(2)}€`);
          }

          const diff = Math.abs(pScraped - pTicket) / pTicket;
          // On accepte si diff < 30% OU si score est parfait (>0.8) OU si c'est du poids
          if (diff <= 0.35 || weightMatch || res.score >= 0.8) {
            results[name] = { prix: pScraped, titre: res.product.titre };
          } else {
            console.log(`   ⚠️ [${name}] Prix trop différent: ${pScraped.toFixed(2)}€`);
          }
        }
      } catch (e) { console.log(`   ❌ Erreur ${name}: ${e.message}`); }
    });

    await Promise.all(promises);

    Object.keys(scrapers).forEach(n => {
      totaux[n] += results[n] ? results[n].prix : pTicket;
    });
  }

  await browser.close();
  console.log(`\nTOTAL TICKET: ${totalOriginal.toFixed(2)}€`);
  Object.entries(totaux).forEach(([m, t]) => console.log(`${m.toUpperCase()}: ${t.toFixed(2)}€`));
};

runComparator(path.join(__dirname, 'ticket.jpg'));