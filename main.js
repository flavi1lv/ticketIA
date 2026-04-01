const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');

const scrapersDir = path.join(__dirname, 'scrapers');
const scrapers = {};
for (const file of fs.readdirSync(scrapersDir).filter((f) => f.endsWith('.js'))) {
  scrapers[file.replace('.js', '')] = require(path.join(scrapersDir, file));
}

const PRODUCTS = [
  { label: 'Nutella 1kg', query: 'Nutella 1kg' },
];

const printComparison = (label, resultatsValides) => {
  const magasins = Object.keys(resultatsValides);
  console.log('\n' + '='.repeat(55));
  console.log(`📊  COMPARAISON — ${label.toUpperCase()}`);

  if (magasins.length === 0) {
    console.log("❌  Aucun résultat exploitable trouvé.");
  } else {
    const classement = [...magasins].sort((a, b) => resultatsValides[a].prix - resultatsValides[b].prix);
    const prixMin = resultatsValides[classement[0]].prix;
    
    console.log(`🏆  Le moins cher : ${classement[0].toUpperCase()}\n`);
    classement.forEach((mag, i) => {
      const medal = i === 0 ? '🥇' : '  ';
      const diff = resultatsValides[mag].prix - prixMin;
      console.log(`${medal} ${mag.toUpperCase().padEnd(12)} : ${resultatsValides[mag].prix.toFixed(2)}€ ${diff > 0 ? `(+${diff.toFixed(2)}€)` : ''}`);
      console.log(`   "${resultatsValides[mag].titre}"`);
    });
  }
  console.log('='.repeat(55) + '\n');
};

(async () => {
  console.log('⚡ Comparateur Démarré (Mode Stealth Actif)\n');

  // CONSEIL : headless: false aide énormément à passer les anti-bots au début
  const browser = await chromium.launch({
    headless: true, 
    args: ['--disable-blink-features=AutomationControlled']
  });

  for (const { label, query } of PRODUCTS) {
    console.log(`🔍 Recherche : "${query}"`);

    const tasks = Object.entries(scrapers).map(async ([name, fn]) => {
      try {
        const res = await fn(browser, query);
        return { name, res };
      } catch (e) {
        return { name, res: { status: 'error', message: e.message } };
      }
    });

    const results = await Promise.all(tasks);
    const validResults = {};

    for (const { name, res } of results) {
      if (res.status === 'found') {
        const p = parseFloat(res.product.prix.replace(',', '.'));
        if (!isNaN(p)) validResults[name] = { titre: res.product.titre, prix: p };
      } else {
        console.log(`⚠️  [${name}] ${res.status === 'not_found' ? 'Non trouvé' : 'Erreur'}`);
      }
    }

    printComparison(label, validResults);
  }

  console.log('🏁 Analyse terminée. Fermeture du navigateur...');
  await browser.close();
})();