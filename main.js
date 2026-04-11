const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');

const IGNORED_SCRAPERS = ['carrefour.js']; 

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
  // On lance en headless: true pour la rapidité
  const browser = await chromium.launch({ headless: false });

  let totalOriginal = 0;
  const totaux = {};
  Object.keys(scrapers).forEach(n => totaux[n] = 0);

  for (const item of articles) {
    if (item.prix === null || item.prix === undefined) continue;
    
    const pTicket = parseFloat(String(item.prix).replace(',', '.'));
    if (isNaN(pTicket)) continue;
    
    totalOriginal += pTicket;

    console.log(`\n🔎 Recherche : "${item.nom}" (${pTicket.toFixed(2)}€)`);
    const results = {};

    const promises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        const res = await scraperFn(browser, item.nom, pTicket);
        
        if (res && res.status === 'found') {
          let pScraped = parseFloat(String(res.product.prix).replace(',', '.'));
          
          // ⚖️ LOGIQUE POIDS (KG)
          const weightMatch = item.nom.match(/(\d+[.,]\d+)\s*kg/i);
          if (weightMatch && res.product.isKg) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            pScraped = pScraped * weight;
          }

          // 🎯 CALCUL DE L'ÉCART
          const diff = Math.abs(pScraped - pTicket) / pTicket;
          
          // 🍎 TOLÉRANCE ÉLARGIE
          // On accepte une différence de 80% pour le vrac/frais et 50% pour le reste
          // car les prix Leclerc/Carrefour varient beaucoup.
          const isFrais = /(POIREAU|POIVRON|ORANGE|BANANE|VRAC|KG|LÉGUME)/i.test(item.nom);
          const maxAllowedDiff = isFrais ? 0.80 : 0.50;

          if (diff <= maxAllowedDiff || name === 'leclerc') { 
            // 💡 FORCE LECLERC : Si le scraper Leclerc dit "found", on lui fait confiance
            results[name] = { prix: pScraped, titre: res.product.titre };
            console.log(`   ✅ [${name}] Trouvé: ${res.product.titre} à ${pScraped.toFixed(2)}€`);
          } else {
            console.log(`   ⚠️ [${name}] Rejeté: Écart de prix trop grand (${(diff*100).toFixed(0)}%)`);
          }
        } else {
            console.log(`   ❌ [${name}] Introuvable sur le site`);
        }
      } catch (e) { console.log(`   ❌ Erreur ${name}: ${e.message}`); }
    });

    await Promise.all(promises);

    // Si on n'a rien trouvé, on garde le prix du ticket pour ne pas fausser le total
    Object.keys(scrapers).forEach(n => {
      totaux[n] += results[n] ? results[n].prix : pTicket;
    });
  }

  await browser.close();
  console.log(`\n============================`);
  console.log(`TOTAL TICKET ORIGINE: ${totalOriginal.toFixed(2)}€`);
  Object.entries(totaux).forEach(([m, t]) => {
    const eco = totalOriginal - t;
    console.log(`${m.toUpperCase()}: ${t.toFixed(2)}€ ${eco > 0 ? `(Économie: ${eco.toFixed(2)}€ 📉)` : ''}`);
  });
  console.log(`============================\n`);
};

runComparator(path.join(__dirname, 'ticket.jpg'));