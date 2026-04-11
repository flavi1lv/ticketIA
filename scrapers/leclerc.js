const { normalizePrice, withRetry, sleep } = require('../utils/helpers');

const scrapeLeclerc = async (browser, searchQuery, targetPrice) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
      viewport: { width: 375, height: 812 }
    });
    const page = await context.newPage();

    try {
      // Nettoyage pour ne garder que l'essentiel (ex: PATE PIZZA)
      const cleanQuery = searchQuery.split(' ').filter(w => w.length > 3).slice(0, 2).join(' ');
      const url = `https://www.e.leclerc/recherche?q=${encodeURIComponent(cleanQuery)}`;
      
      console.log(`   🌐 [Leclerc] Navigation mobile vers : ${cleanQuery}`);
      
      // On attend que le réseau soit calme
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // 🎯 L'ASTUCE : On attend que le sélecteur de prix apparaisse (max 5 sec)
      await page.waitForSelector('.price, [class*="price"]', { timeout: 5000 }).catch(() => {});

      const product = await page.evaluate(() => {
        // On prend le premier élément qui contient un prix (€)
        const allPrices = Array.from(document.querySelectorAll('span, div, p'))
          .filter(el => el.innerText.includes('€') && /\d/.test(el.innerText));
        
        const titleElement = document.querySelector('h1, h2, .product-title, [class*="title"]');
        
        if (allPrices.length > 0) {
          return {
            titre: titleElement ? titleElement.innerText.trim() : "Produit Leclerc",
            prix: allPrices[0].innerText.trim()
          };
        }
        return null;
      });

      if (!product) {
        console.log(`   ❌ [Leclerc] Page vide pour "${cleanQuery}"`);
        return { status: 'not_found' };
      }

      return { 
        status: 'found', 
        product: { 
          titre: product.titre, 
          prix: normalizePrice(product.prix) || targetPrice, 
          isKg: product.titre.toLowerCase().includes('/kg') || searchQuery.toLowerCase().includes('kg')
        } 
      };

    } finally {
      await context.close().catch(() => {});
    }
  }, 1, 1000);
};

module.exports = scrapeLeclerc;