const { validateTitle, normalizePrice, withRetry, sleep } = require('../utils/helpers');

// 🚀 On garde bien le paramètre targetPrice ici !
const scrapeCarrefour = async (browser, searchQuery, targetPrice) => {
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

      // Nettoyage pour la barre de recherche
      let searchTxt = searchQuery
        .replace(/\b\d+([.,]\d+)?\s*(g|kg|l|cl|ml)\b/gi, '') 
        .replace(/\bx\s*\d+\b/gi, '') 
        .replace(/\b\d+\s*x\b/gi, '') 
        .replace(/\s+/g, ' ') 
        .trim();

      const query = searchTxt || searchQuery;
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(query)}&sort=relevance`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});
      await page.waitForSelector('[data-testid="product-card"], article', { timeout: 10000 }).catch(() => {});
      await sleep(1500);

      // Extraction
      const products = await page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="product-card"], article, a[href*="/p/"]');
        
        return Array.from(cards).slice(0, 10).map(el => {
          const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
          const mainTitle = titleEl ? titleEl.innerText.trim() : '';
          const imgEl = el.querySelector('img');
          const imgAlt = imgEl ? imgEl.getAttribute('alt') || '' : '';
          const fullText = el.innerText || '';
          
          const titre = `${mainTitle} ${imgAlt} ${fullText}`.replace(/\s+/g, ' ').trim();

          const priceEl = el.querySelector('[class*="price"], [itemprop="price"], [class*="amount"]');
          let rawPrice = priceEl ? priceEl.innerText.trim() : '';
          if (!rawPrice) {
               const priceMatch = fullText.match(/\d+[.,]\d{2}\s*€/);
               if (priceMatch) rawPrice = priceMatch[0];
          }

          return { titre, titreAffichage: mainTitle || imgAlt, rawPrice };
        }).filter(p => p.titre && p.rawPrice);
      });

      for (const p of products) {
        const prix = normalizePrice(p.rawPrice);
        
        // Validation intelligente (avec le bonus de prix)
        const isValid = validateTitle(p.titre, searchQuery, prix, targetPrice);
        
        if (prix && isValid) {
          const textToAnalyze = (p.rawPrice + " " + p.titre).toLowerCase();
          const isKg = textToAnalyze.includes('/kg') || textToAnalyze.includes('le kg');
          
          return { status: 'found', product: { titre: p.titreAffichage, prix, unitPrice: prix, isKg } };
        }
      }

      return { status: 'not_found' };

    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

module.exports = scrapeCarrefour;