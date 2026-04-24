const {
  normalizePrice,
  withRetry,
  PRICE_DIFF_THRESHOLD,
  SCORE_THRESHOLD,
  tokenize,
  isQuantityToken,
  scoreSimilarity,
  extractQuantityTokens,
  validateQuantity,
  computePrice,
} = require('../utils/helpers');

const scrapeCarrefour = async (browser, article, targetPrice) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
    });

    const page  = await context.newPage();
    const query = article.recherche_optimisee;

    try {
      await page.route('**/*', route => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
      });

      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(query)}&sort=relevance`;

      // Intercepter la réponse XHR/fetch (stratégie principale)
      let apiData = null;
      const apiInterceptPromise = page
        .waitForResponse(
          res =>
            res.status() === 200 &&
            res.request().resourceType() === 'fetch' &&
            (res.url().includes('/api/') || res.url().includes('search')),
          { timeout: 8000 }
        )
        .then(res => res.json())
        .then(json => { apiData = json; })
        .catch(() => {});

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});

      await Promise.race([
        apiInterceptPromise,
        page.waitForSelector('[data-testid="product-card"], article', { timeout: 10000 }).catch(() => {}),
      ]);

      // ── EXTRACTION ──────────────────────────────────────────────────────────
      let products = [];

      if (apiData) {
        const hits = apiData.hits || apiData.results || apiData.products || [];
        products = hits.slice(0, 5).map(h => ({
          titre:        h.name || h.title || '',
          rawPrice:     h.price?.current?.toString() || '',
          rawUnitPrice: h.price?.perUnit?.toString() || '',
          rawFormat:    h.format || h.quantity || h.weight || '',
        }));
      } else {
        products = await page.evaluate(() => {
          const cards = document.querySelectorAll('[data-testid="product-card"], article, a[href*="/p/"]');
          return Array.from(cards).slice(0, 5).map(el => {
            const titleEl     = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
            const priceEl     = el.querySelector('[class*="price"], [itemprop="price"], [class*="amount"]');
            const unitPriceEl = el.querySelector('.product-price__per-unit, [class*="per-unit"]');
            const formatEl    = Array.from(
              el.querySelectorAll('[class*="format"], [class*="quantity"], [class*="grammage"], [class*="weight"], [class*="packaging"]')
            ).find(e => !['BUTTON', 'A'].includes(e.tagName) && e.innerText.trim().length > 2);

            return {
              titre:        titleEl?.innerText.trim()     ?? 'Produit Carrefour',
              rawPrice:     priceEl?.innerText.trim()     ?? '',
              rawUnitPrice: unitPriceEl?.innerText.trim() ?? '',
              rawFormat:    formatEl?.innerText.trim()    ?? '',
            };
          });
        });
      }

      if (!products.length) return { status: 'not_found', reason: 'no_products' };

      // ── SCORING & SÉLECTION ─────────────────────────────────────────────────
      const quantityTokens = extractQuantityTokens(query);
      const isVrac         = !!article.poids_kg && !quantityTokens.length;

      const candidates = products
        .map(p => {
          const { finalPrice, compareTarget } = computePrice(
            p.rawPrice, p.rawUnitPrice, article, targetPrice, isVrac
          );
          const score = scoreSimilarity(p.titre, query);
          const diff  = finalPrice && compareTarget
            ? Math.abs(finalPrice - compareTarget) / compareTarget
            : Infinity;
          const qtyOk = validateQuantity(p, quantityTokens);

          return { ...p, finalPrice, score, diff, qtyOk };
        })
        .filter(p =>
          p.finalPrice              &&
          p.score >= SCORE_THRESHOLD &&
          p.diff  <= 2.0             &&
          p.qtyOk
        )
        .sort((a, b) => b.score - a.score || a.diff - b.diff);

      // ── FALLBACK : relance sans tokens quantité si aucun candidat ───────────
      // Ex: "FUZE TEA 1.25L" → Carrefour retourne des théières → relance avec "FUZE TEA"
      if (!candidates.length && quantityTokens.length) {
        const fallbackQuery = tokenize(query)
          .filter(w => w.length > 2 && !isQuantityToken(w))
          .join(' ');

        if (fallbackQuery) {
          const fallbackUrl = `https://www.carrefour.fr/s?q=${encodeURIComponent(fallbackQuery)}&sort=relevance`;
          await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForSelector('[data-testid="product-card"], article', { timeout: 8000 }).catch(() => {});

          const fallbackProducts = await page.evaluate(() => {
            const cards = document.querySelectorAll('[data-testid="product-card"], article, a[href*="/p/"]');
            return Array.from(cards).slice(0, 5).map(el => {
              const titleEl     = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
              const priceEl     = el.querySelector('[class*="price"], [itemprop="price"], [class*="amount"]');
              const unitPriceEl = el.querySelector('.product-price__per-unit, [class*="per-unit"]');
              const formatEl    = Array.from(
                el.querySelectorAll('[class*="format"], [class*="quantity"], [class*="grammage"], [class*="weight"], [class*="packaging"]')
              ).find(e => !['BUTTON', 'A'].includes(e.tagName) && e.innerText.trim().length > 2);
              return {
                titre:        titleEl?.innerText.trim()     ?? 'Produit Carrefour',
                rawPrice:     priceEl?.innerText.trim()     ?? '',
                rawUnitPrice: unitPriceEl?.innerText.trim() ?? '',
                rawFormat:    formatEl?.innerText.trim()    ?? '',
              };
            });
          });

          const fallbackCandidates = fallbackProducts
            .map(p => {
              const { finalPrice, compareTarget } = computePrice(
                p.rawPrice, p.rawUnitPrice, article, targetPrice, isVrac
              );
              const score = scoreSimilarity(p.titre, query);
              const diff  = finalPrice && compareTarget
                ? Math.abs(finalPrice - compareTarget) / compareTarget
                : Infinity;
              // Pas de validateQuantity ici : on a retiré les tokens quantité de la recherche
              return { ...p, finalPrice, score, diff, qtyOk: true };
            })
            .filter(p =>
              p.finalPrice              &&
              p.score >= SCORE_THRESHOLD &&
              p.diff  <= 2.0
            )
            .sort((a, b) => b.score - a.score || a.diff - b.diff);

          if (fallbackCandidates.length) {
            const best = fallbackCandidates[0];
            return { status: 'found', product: { titre: best.titre, prix: best.finalPrice } };
          }
        }
      }

      if (!candidates.length) {
        const debugInfo = products.map(p => ({
          titre:  p.titre,
          format: p.rawFormat,
          score:  scoreSimilarity(p.titre, query).toFixed(2),
          price:  normalizePrice(p.rawPrice),
          qtyOk:  validateQuantity(p, quantityTokens),
        }));
        console.log(JSON.stringify({
          scraper: 'carrefour', query,
          msg: 'no_valid_candidate',
          ts: new Date().toISOString(),
          quantityTokens, debugInfo,
        }));
        return { status: 'not_found', reason: 'no_match', debug: debugInfo };
      }

      const best = candidates[0];
      return {
        status: 'found',
        product: { titre: best.titre, prix: best.finalPrice },
      };

    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

scrapeCarrefour.requiresBrowser = true;

module.exports = scrapeCarrefour;