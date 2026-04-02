const { validateTitle, normalizePrice, sleep, withRetry } = require('../utils/helpers');

const extractProductsFromJson = (obj, results = [], depth = 0) => {
  if (depth > 12 || !obj || typeof obj !== 'object' || results.length >= 15) return results;
  const name = obj.name || obj.title || obj.label || obj.productName || '';
  let rawPrice = obj.price?.value ?? obj.salePrice ?? obj.pricePerUnit ?? obj.currentPrice ?? obj.prices?.normal ?? obj.price;

  if (rawPrice && typeof rawPrice === 'object') {
    rawPrice = rawPrice.value ?? rawPrice.amount ?? rawPrice.price ?? null;
  }

  if (name && rawPrice !== null && rawPrice !== undefined && typeof rawPrice !== 'object') {
    results.push({ titre: String(name).trim().slice(0, 200), rawPrice: String(rawPrice).trim() });
  }

  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      const val = obj[key];
      if (val && typeof val === 'object') extractProductsFromJson(val, results, depth + 1);
    }
  }
  return results;
};

const scrapeAuchan = async (browser, query) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR'
    });
    
    const page = await context.newPage();

    try {
      // 🧹 ASTUCE : Recherche sans le poids pour éviter le "0 résultat"
      const searchTxt = query.replace(/\b\d+([.,]\d+)?\s*(g|kg|l|cl|ml)\b/gi, '').trim();
      const url = `https://www.auchan.fr/recherche?text=${encodeURIComponent(searchTxt || query)}`;
      
      // 🔗 AFFICHAGE DU LIEN DANS LA CONSOLE
      console.log(`   🌐 [AUCHAN] Lien : ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});
      
      // On attend un peu pour laisser la page s'hydrater
      await sleep(2000);

      let products = [];

      // 1. Next.js Data
      const nextData = await page.evaluate(() => {
        const script = document.querySelector('#__NEXT_DATA__');
        return script ? JSON.parse(script.textContent) : null;
      });

      if (nextData) products = extractProductsFromJson(nextData);

      // 2. Fallback DOM (largement assoupli pour attraper tout ce qui ressemble à un produit)
      if (products.length === 0) {
        products = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('article, [role="listitem"]')).slice(0, 15).map(el => {
            const titre = el.querySelector('h2, h3, [class*="title"], [class*="name"]')?.innerText?.trim() || '';
            const rawPrice = el.querySelector('[class*="price"], [class*="amount"]')?.innerText?.trim() || '';
            return { titre, rawPrice };
          }).filter(p => p.titre && p.rawPrice);
        });
      }

      for (const p of products) {
        const price = normalizePrice(p.rawPrice);
        // On valide avec la requête contenant le poids !
        if (price && validateTitle(p.titre, query)) {
          const textToAnalyze = (p.titre + " " + p.rawPrice).toLowerCase();
          const isKg = textToAnalyze.includes('/kg') || textToAnalyze.includes('le kg');
          return { status: 'found', product: { titre: p.titre, prix: price, unitPrice: price, isKg } };
        }
      }

      return { status: 'not_found' };

    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

module.exports = scrapeAuchan;