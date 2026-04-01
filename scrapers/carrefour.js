const { validateTitle, normalizePrice, withRetry, sleep } = require('../utils/helpers');

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
      const capturedProducts = [];

      const responseHandler = async (response) => {
        try {
          const url = response.url();
          if (url.includes('/api/v1/search') || url.includes('search-api')) {
            const json = await response.json();
            const items = json?.data?.search?.products || json?.data?.products || json?.products || [];
            items.forEach(item => {
              capturedProducts.push({
                titre: item.name || item.label || item.title,
                rawPrice: item.price?.amount || item.price?.value || item.prices?.v3?.salePrice?.amount
              });
            });
          }
        } catch (e) {}
      };

      page.on('response', responseHandler);

      // On utilise une URL qui déclenche souvent l'API de recherche
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(searchQuery)}&sort=relevance`;
      console.log(`🚀 [Carrefour] GET ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Accepter les cookies pour voir les prix
      try {
        const cookieBtn = page.locator('#onetrust-accept-btn-handler');
        if (await cookieBtn.isVisible({ timeout: 3000 })) {
          await cookieBtn.click();
        }
      } catch (e) {}

      // Crucial : On attend que la liste des produits soit réellement rendue
      await page.waitForSelector('[data-testid="product-card"], article', { timeout: 15000 }).catch(() => {});
      await sleep(2000);

      // Fallback DOM si l'API n'a pas été capturée
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

      page.off('response', responseHandler);

      // On teste d'abord les produits capturés via API (plus précis)
      if (capturedProducts.length > 0) {
        for (const p of capturedProducts) {
          const prix = normalizePrice(p.rawPrice);
          const isValid = validateTitle(p.titre, searchQuery);
          if (prix && isValid) {
            console.log(`✅ [Carrefour] (API) "${p.titre}" → ${prix}€`);
            return { status: 'found', product: { titre: p.titre, prix } };
          }
        }
      }

      if (!cardSelector) {
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
            if (text.length > 5 && !PRICE_REGEX.test(text)) {
              titre = text.slice(0, 200);
              break;
            }
          }
          
          if (!titre) {
            titre = el.querySelector('h2, h3')?.textContent.trim() || '';
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