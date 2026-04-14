const { normalizePrice, withRetry, sleep } = require('../utils/helpers');

const scrapeCarrefour = async (browser, article, targetPrice) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR'
    });
    
    const page = await context.newPage();

    try {
      await page.route('**/*', route => {
        const type = route.request().resourceType();
        if (['image', 'media'].includes(type)) route.abort();
        else route.continue();
      });

      const query = article.recherche_optimisee;
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(query)}&sort=relevance`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});
      await page.waitForSelector('[data-testid="product-card"], article', { timeout: 10000 }).catch(() => {});
      await sleep(1500);

      // 1. EXTRACTION DES 5 PREMIERS RÉSULTATS
      const products = await page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="product-card"], article, a[href*="/p/"]');
        return Array.from(cards).slice(0, 5).map(el => {
          const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
          const mainTitle = titleEl ? titleEl.innerText.trim() : 'Produit Carrefour';

          const priceEl = el.querySelector('[class*="price"], [itemprop="price"], [class*="amount"]');
          let rawPrice = priceEl ? priceEl.innerText.trim() : '';
          
          const unitPriceEl = el.querySelector('.product-price__per-unit, [class*="per-unit"]');
          let rawUnitPrice = unitPriceEl ? unitPriceEl.innerText.trim() : '';

          return { titre: mainTitle, rawPrice, rawUnitPrice };
        });
      });

      if (!products || products.length === 0) {
        return { status: 'not_found' };
      }

      // Mots de recherche pour vérification basique
      const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 2);

      // 2. RECHERCHE DU MEILLEUR MATCH PARMI LES 5
      for (const p of products) {
        if (!p.rawPrice && !p.rawUnitPrice) continue;

        let finalPrice = normalizePrice(p.rawPrice);
        const unitPrice = normalizePrice(p.rawUnitPrice);

        // Si le produit est au kilo et qu'on a un poids
        if (article.poids_kg && unitPrice) {
          finalPrice = Number((article.poids_kg * unitPrice).toFixed(2));
        }

        if (!finalPrice) continue;

        // Calcul de l'écart avec le prix du ticket
        const diff = Math.abs(finalPrice - targetPrice) / targetPrice;
        
        // Vérification texte: Le titre doit contenir au moins un mot clé
        const titleLower = p.titre.toLowerCase();
        const textMatch = queryWords.length === 0 || queryWords.some(w => titleLower.includes(w));

        // Si le prix est proche (<= 30% d'écart) ET que le texte matche un minimum
        if (diff <= 0.30 && textMatch) {
          return { 
            status: 'found', 
            product: { titre: p.titre, prix: finalPrice } 
          };
        }
      }

      // Si on boucle sur les 5 sans trouver un prix cohérent
      return { status: 'not_found' };

    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

module.exports = scrapeCarrefour;