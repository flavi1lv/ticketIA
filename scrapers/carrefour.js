const { validateTitle, normalizePrice, withRetry } = require('../utils/helpers');

const scrapeCarrefour = async (browser, searchQuery) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9' },
  });
  const page = await context.newPage();

  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    return await withRetry(async () => {
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(searchQuery)}`;
      console.log(`🚀 [Carrefour] GET ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Attend l'un de ces sélecteurs de carte produit
      const cardSelectors = [
        'a[class*="product-card"]',
        '[data-testid="product-card"]',
        'article[class*="product"]',
        '[class*="ProductCard"]',
        '[class*="product-thumbnail"]',
      ];

      let cardSelector = null;
      for (const sel of cardSelectors) {
        try {
          await page.waitForSelector(sel, { state: 'attached', timeout: 8000 });
          cardSelector = sel;
          break;
        } catch { /* essaie le suivant */ }
      }

      if (!cardSelector) {
        console.log('❌ [Carrefour] Aucun sélecteur de carte trouvé.');
        return { status: 'not_found', titles: [] };
      }

      const productsData = await page.evaluate((sel) => {
        const PRICE_REGEX = /^\s*\d{1,4}[,.\s]\d{2}\s*€?\s*$/;

        const cards = Array.from(document.querySelectorAll(sel))
          .filter((el) => {
            const text = el.textContent || '';
            return !text.includes('Vendu et livré par') && !text.includes('marketplace');
          })
          .slice(0, 5);

        return cards.map((el) => {
          // ── Prix : cherche un élément sémantique dédié ──────────────────
          const priceEl = el.querySelector(
            '[class*="price__amount"], [class*="price-amount"], ' +
            '[class*="price__per-unit"], [class*="product-price"], ' +
            '[class*="selling-price"], [class*="Price"], ' +
            '[itemprop="price"], [data-testid*="price"]'
          );
          let rawPrice = priceEl ? priceEl.textContent.trim() : '';

          // Fallback prix : regex sur le texte complet
          if (!rawPrice) {
            const fullText = el.textContent.replace(/\s+/g, ' ');
            const m = fullText.match(/(\d{1,3}[,.\s]\d{2})\s*€/);
            if (m) rawPrice = m[0];
          }

          // ── Titre : cherche un élément qui ne ressemble PAS à un prix ───
          const titleCandidates = Array.from(
            el.querySelectorAll('[class*="title"], [class*="name"], [class*="description"], h2, h3, h4')
          );

          let titre = '';
          for (const candidate of titleCandidates) {
            const text = candidate.textContent.replace(/\s+/g, ' ').trim();
            // Ignore si le texte ressemble à un prix seul ou est trop court
            if (text.length > 5 && !PRICE_REGEX.test(text)) {
              titre = text.slice(0, 200);
              break;
            }
          }

          // Fallback titre : première ligne du texte complet qui n'est pas un prix
          if (!titre) {
            const lines = el.textContent
              .split(/\n/)
              .map((l) => l.replace(/\s+/g, ' ').trim())
              .filter((l) => l.length > 5 && !PRICE_REGEX.test(l));
            titre = lines[0]?.slice(0, 200) || '';
          }

          return { titre, rawPrice };
        }).filter((p) => p.titre.length > 3);
      }, cardSelector);

      for (const produit of productsData) {
        const prix = normalizePrice(produit.rawPrice);
        if (prix && validateTitle(produit.titre, searchQuery)) {
          console.log(`✅ [Carrefour] "${produit.titre}" → ${prix}€`);
          return { status: 'found', product: { titre: produit.titre, prix } };
        }
      }

      const titles = productsData.map(
        (p) => `"${p.titre.slice(0, 60)}" (prix brut: "${p.rawPrice}")`
      );
      console.log(`❌ [Carrefour] Aucun match parmi :\n   ${titles.join('\n   ')}`);
      return { status: 'not_found', titles };
    });
  } catch (error) {
    console.error(`💥 [Carrefour] ${error.message}`);
    return { status: 'error', message: error.message };
  } finally {
    await page.close();
    await context.close();
  }
};

module.exports = scrapeCarrefour;