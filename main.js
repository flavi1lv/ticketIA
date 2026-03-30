const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ── Chargement dynamique des scrapers ─────────────────────────────────────────
const scrapersDir = path.join(__dirname, 'scrapers');
const scrapers = {};
for (const file of fs.readdirSync(scrapersDir).filter((f) => f.endsWith('.js'))) {
  scrapers[file.replace('.js', '')] = require(path.join(scrapersDir, file));
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Produits à comparer ───────────────────────────────────────────────────────
const PRODUCTS = [
  { label: 'Nutella 1kg', query: 'Nutella 1kg' },
];

const printComparison = (label, resultatsValides) => {
  const magasins = Object.keys(resultatsValides);
  console.log('\n' + '='.repeat(52));
  console.log(`📊  COMPARAISON — ${label}`);

  if (magasins.length === 0) {
    console.log("❌  Aucun magasin n'a trouvé de prix valide.");
  } else if (magasins.length === 1) {
    const [seul] = magasins;
    console.log(`⚠️  Seul ${capitalize(seul)} a trouvé ce produit.`);
    console.log(`     → ${capitalize(seul)} : ${resultatsValides[seul].prix.toFixed(2)}€`);
    console.log(`     → "${resultatsValides[seul].titre}"`);
  } else {
    const classement = [...magasins].sort(
      (a, b) => resultatsValides[a].prix - resultatsValides[b].prix
    );
    const prixMin = resultatsValides[classement[0]].prix;
    console.log(`\n🏆  ${capitalize(classement[0])} est le moins cher !`);
    classement.forEach((mag, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] ?? '  ';
      const diff = resultatsValides[mag].prix - prixMin;
      const diffStr = diff > 0 ? `  (+${diff.toFixed(2)}€)` : '';
      console.log(`  ${medal} ${capitalize(mag).padEnd(14)} ${resultatsValides[mag].prix.toFixed(2)}€${diffStr}`);
      console.log(`       "${resultatsValides[mag].titre}"`);
    });
  }
  console.log('='.repeat(52) + '\n');
};

(async () => {
  console.log('⚡ Comparateur de prix — démarrage\n');
  console.log(`🤖 Scrapers  : ${Object.keys(scrapers).map((s) => s.toUpperCase()).join(', ')}`);
  console.log(`🛒 Produits  : ${PRODUCTS.map((p) => p.label).join(', ')}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  for (const { label, query } of PRODUCTS) {
    console.log(`\n${'─'.repeat(52)}`);
    console.log(`🔍  ${label}  (requête : "${query}")`);
    console.log(`${'─'.repeat(52)}`);

    const tasks = Object.entries(scrapers).map(([name, fn]) =>
      fn(browser, query)
        .then((result) => ({ name, result }))
        .catch((err) => ({ name, result: { status: 'error', message: err.message } }))
    );

    const results = await Promise.all(tasks);
    const resultatsValides = {};

    for (const { name, result } of results) {
      if (result.status === 'found') {
        const prix = parseFloat(result.product.prix.replace(',', '.'));
        if (!isNaN(prix)) {
          resultatsValides[name] = { titre: result.product.titre, prix };
        }
      }
    }

    printComparison(label, resultatsValides);
  }

  await browser.close();
  console.log('🏁 Terminé.');
})();