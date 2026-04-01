const { validateTitle, normalizePrice, sleep, withRetry } = require('../utils/helpers');

const extractProductsFromJson = (obj, results = [], depth = 0) => {
  if (depth > 10 || !obj || typeof obj !== 'object' || results.length >= 15) return results;

  const hasName = typeof obj.name === 'string' || typeof obj.title === 'string' || typeof obj.label === 'string';
  const priceValue = 
    obj.price?.value ?? obj.salePrice ?? obj.pricePerUnit ?? 
    obj.currentPrice ?? obj.prices?.normal ?? obj.price;

  if (hasName && priceValue !== null && priceValue !== undefined) {
    results.push({
      titre: String(obj.name ?? obj.title ?? obj.label).slice(0, 200),
      rawPrice: String(typeof priceValue === 'object' ? priceValue.value : priceValue),
    });
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) val.forEach((v) => extractProductsFromJson(v, results, depth + 1));
    else if (val && typeof val === 'object') extractProductsFromJson(val, results, depth + 1);
  }
  return results;
};

const scrapeAuchan = async (browser, searchQuery) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    return await withRetry(async () => {
      // L'URL /boutique/recherche renvoie souvent des 404 pour les bots, on utilise la recherche globale
      const searchUrl = `https://www.auchan.fr/recherche?text=${encodeURIComponent(searchQuery)}`;
      console.log(`   🌐 [Auchan] Navigation vers ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });

      // Gestion des cookies Auchan
      try {
        const cookieBtn = page.locator('#onetrust-accept-btn-handler');
        if (await cookieBtn.isVisible({ timeout: 3000 })) {
          await cookieBtn.click();
          await sleep(1000);
        }
      } catch (e) {}

      // On attend qu'au moins une carte produit soit visible
      await page.waitForSelector('article, [class*="product"]', { timeout: 10000 }).catch(() => {});

      // Extraction du State JSON (Next.js)
      const nextData = await page.evaluate(() => {
        const script = document.querySelector('#__NEXT_DATA__');
        return script ? JSON.parse(script.textContent) : null;
      });

      let foundProducts = [];
      if (nextData) {
        foundProducts = extractProductsFromJson(nextData);
      }

      // Si le JSON échoue, on tente le DOM
      if (foundProducts.length === 0) {
        foundProducts = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('article')).map(el => ({
            titre: el.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '',
            rawPrice: el.querySelector('[class*="price"], [class*="Price"]')?.textContent?.trim() || ''
          }));
        });
      }

      for (const p of foundProducts) {
        const prix = normalizePrice(p.rawPrice);
        if (prix && validateTitle(p.titre, searchQuery)) {
          console.log(`✅ [Auchan] "${p.titre}" → ${prix}€`);
          return { status: 'found', product: { titre: p.titre, prix: String(prix) } };
        }
      }

      return { status: 'not_found', titles: foundProducts.map(p => p.titre) };
    });
  } finally {
    await page.close();
    await context.close();
  }
};

module.exports = scrapeAuchan;