const { chromium } = require('playwright');
const fs = require('fs');

const validateTitle = (title, query) => {
  const queryKeyword = query.split(' ')[0].toLowerCase();
  return title.toLowerCase().includes(queryKeyword);
};

const scrapeCarrefour = async (browser, productName) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    console.log(`🚀 [Carrefour] Recherche de "${productName}"...`);
    await page.goto(`https://www.carrefour.fr/s?q=${encodeURIComponent(productName)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log("⏳ [Carrefour] Lecture du code source...");
    const selector = 'article, [data-testid="product-card"]';
    await page.waitForSelector(selector, { state: 'attached', timeout: 30000 });

    const productsData = await page.evaluate((sel) => {
      const elements = Array.from(document.querySelectorAll(sel))
        .filter(el => !el.innerText.includes('Vendu et livré par'))
        .slice(0, 5); // Get top 5 non-marketplace items
      return elements.map(el => {
        const contenu = el.innerText.replace(/\s+/g, ' ');
        const prixRegex = /(\d+,\d{2})€/;
        const prixMatch = contenu.match(prixRegex);
        const prix = prixMatch ? prixMatch[1] : 'Non trouvé';
        const titre = contenu.replace(prixRegex, '').trim().split('\n')[0];
        return { titre, prix };
      });
    }, selector);

    const titles = productsData.map(p => p.titre);
    for (const produit of productsData) {
      if (validateTitle(produit.titre, productName)) {
        return { status: 'found', product: produit };
      }
    }

    return { status: 'not_found', titles: titles };
  } finally {
    await page.close();
    await context.close();
  }
};

const scrapeLidl = async (browser, productName) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    const searchKeyword = productName.split(' ')[0];
    console.log(`🚀 [Lidl] Recherche de "${searchKeyword}"...`);
    await page.goto(`https://www.lidl.fr/q/search?q=${encodeURIComponent(searchKeyword)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const acceptButtonSelector = '#onetrust-accept-btn-handler';
    try {
      await page.waitForSelector(acceptButtonSelector, { timeout: 5000 });
      await page.click(acceptButtonSelector);
      console.log("✅ [Lidl] Bannière de cookies acceptée.");
    } catch (error) {
      console.log("ℹ️ [Lidl] Pas de bannière de cookies trouvée ou déjà acceptée.");
    }

    console.log("⏳ [Lidl] Lecture du code source...");
    const selector = '[data-testselector="s-product-grid__list-item"]';
    await page.waitForSelector(selector, { state: 'attached', timeout: 30000 });
    
    const productsData = await page.evaluate((sel) => {
      const elements = Array.from(document.querySelectorAll(sel)).slice(0, 5);
      return elements.map(el => {
        const jsonData = JSON.parse(el.dataset.gridData);
        let prix = 'Non trouvé';
        if (jsonData.price && jsonData.price.price) {
            prix = jsonData.price.price.toString();
        } else if (jsonData.lidlPlus && jsonData.lidlPlus.length > 0 && jsonData.lidlPlus[0].price && jsonData.lidlPlus[0].price.price) {
            prix = jsonData.lidlPlus[0].price.price.toString();
        }
        return {
          titre: jsonData.fullTitle,
          prix: prix.replace('.', ',')
        };
      });
    }, selector);

    const titles = productsData.map(p => p.titre);
    for (const produit of productsData) {
      if (validateTitle(produit.titre, productName)) {
        return { status: 'found', product: produit };
      }
    }

    return { status: 'not_found', titles: titles };
  } finally {
    await page.close();
    await context.close();
  }
};


(async () => {
  console.log("⚡ Mode Turbo activé (Fenêtre non visible)...");
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const productsToCompare = ['Nutella 825g', 'Coca-cola 1.5l'];

  for (const product of productsToCompare) {
    console.log(`\n\n==================== Recherche pour: ${product} ====================`);
    let carrefourProduct, lidlProduct;
    let isCarrefourValid = false, isLidlValid = false;

    try {
      const carrefourResult = await scrapeCarrefour(browser, product);
      if (carrefourResult.status === 'found') {
        carrefourProduct = carrefourResult.product;
        if (carrefourProduct.prix !== 'Non trouvé') {
            console.log("\n✅ [Carrefour] Produit trouvé et validé :");
            console.log(`   - Titre: ${carrefourProduct.titre}`);
            console.log(`   - Prix: ${carrefourProduct.prix}€`);
            isCarrefourValid = true;
        } else {
            console.log(`❌ [Carrefour] Produit validé mais prix non trouvé : "${carrefourProduct.titre}"`);
        }
      } else {
        console.log("❌ [Carrefour] Aucun produit correspondant trouvé dans le top 5.");
        console.log("   - Titres vérifiés :", carrefourResult.titles);
      }
    } catch (error) {
      console.log(`❌ [Carrefour] Erreur lors de la recherche : ${error.message}`);
    }

    console.log("\n" + "-".repeat(30) + "\n");

    try {
      const lidlResult = await scrapeLidl(browser, product);
      if (lidlResult.status === 'found') {
        lidlProduct = lidlResult.product;
        if (lidlProduct.prix !== 'Non trouvé') {
            console.log("\n✅ [Lidl] Produit trouvé et validé :");
            console.log(`   - Titre: ${lidlProduct.titre}`);
            console.log(`   - Prix: ${lidlProduct.prix}€`);
            isLidlValid = true;
        } else {
            console.log(`❌ [Lidl] Produit validé mais prix non trouvé : "${lidlProduct.titre}"`);
        }
      } else {
        console.log("❌ [Lidl] Aucun produit correspondant trouvé dans le top 5.");
        console.log("   - Titres vérifiés :", lidlResult.titles);
      }
    } catch (error) {
      console.log(`❌ [Lidl] Erreur lors de la recherche : ${error.message}`);
    }

    // Basic comparison only if both are valid
    if (isCarrefourValid && isLidlValid) {
        const prixCarrefour = parseFloat(carrefourProduct.prix.replace(',', '.'));
        const prixLidl = parseFloat(lidlProduct.prix.replace(',', '.'));

        console.log("\n" + "=".repeat(30) + "\n");
        console.log("📊 COMPARAISON");
        if (prixCarrefour < prixLidl) {
            console.log(`🎉 Carrefour est moins cher !`);
        } else if (prixLidl < prixCarrefour) {
            console.log(`🎉 Lidl est moins cher !`);
        } else {
            console.log(`⚖️ Les prix sont identiques.`);
        }
        console.log(`   - Carrefour: ${prixCarrefour.toFixed(2)}€`);
        console.log(`   - Lidl: ${prixLidl.toFixed(2)}€`);
        console.log("=".repeat(30));
    } else {
        console.log("\n" + "=".repeat(30) + "\n");
        console.log("📊 COMPARAISON IMPOSSIBLE : Un ou plusieurs produits n'ont pas été validés.");
        console.log("=".repeat(30));
    }
  }

  await browser.close();
  console.log("\n🏁 Navigateur fermé.");
})();