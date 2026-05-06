// ===== SCAN&SAVE — app.js (Frontend) =====

// ===== ELEMENTS DOM =====
const dropzone    = document.getElementById('dropzone');
const fileInput   = document.getElementById('file-input');
const previewBar  = document.getElementById('preview-bar');
const previewName = document.getElementById('preview-name');
const btnAnalyze  = document.getElementById('btn-analyze');
const btnReset    = document.getElementById('btn-reset');

const stepUpload  = document.getElementById('step-upload');
const stepLoading = document.getElementById('step-loading');
const stepResults = document.getElementById('step-results');

let selectedFile = null;

// Tableaux de conseils amusants, malins et originaux
const TIPS = [
  "💡 Astuce : Le prix au kilo est votre meilleur ami, c'est le seul qui ne ment pas !",
  "🤖 L'IA travaille dur... et espère secrètement trouver du chocolat en promo.",
  "🛒 Astuce : N'allez jamais faire les courses le ventre vide. Jamais.",
  "💸 Promo à -50% ? Si vous n'en aviez pas besoin, ne pas l'acheter c'est 100% de réduction.",
  "🥕 Privilégiez les produits de saison : moins chers, plus de goût, et la planète vous remercie.",
  "📦 Acheter en gros volume est économique... à condition d'avoir de la place dans les placards !",
  "🏃 Le saviez-vous ? Les produits les moins chers sont souvent tout en bas des rayons. L'heure des squats !",
  "📊 On compare les prix pour vous. Spoiler : les pâtes, ça coûte un pognon de dingue."
];

// ===== NAVIGATION ENTRE ÉTAPES =====
function showStep(step) {
  [stepUpload, stepLoading, stepResults].forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  step.style.display = 'block';
  setTimeout(() => step.classList.add('active'), 10);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== UPLOAD / DRAG & DROP =====
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) {
    alert('Format non supporté. Utilisez JPG, PNG ou PDF.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Fichier trop volumineux (max 10 Mo).');
    return;
  }
  selectedFile = file;
  previewName.textContent = file.name;
  previewBar.style.display = 'flex';
}

// ===== ANALYSE =====
btnAnalyze.addEventListener('click', () => {
  if (!selectedFile) return;
  startAnalysis(selectedFile);
});

async function startAnalysis(file) {
  showStep(stepLoading);
  
  // Démarrer la simulation de progression et l'affichage des astuces
  startProgressSimulation();

  const formData = new FormData();
  formData.append('ticket', file);
  if (window.currentUserId) {
    formData.append('googleId', window.currentUserId);
  }

  try {
    const response = await fetch('/api/comparer-ticket', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Erreur serveur : ${response.status}`);
    }
    
    const data = await response.json();
    stopProgressSimulation(); 
    displayResults(data);

  } catch (err) {
    console.error("Erreur lors de l'analyse :", err);
    stopProgressSimulation();
    showStep(stepUpload);
    alert(`Oups ! L'analyse a échoué.\n\nDétail : ${err.message}`);
  }
}

// ===== SIMULATION DE PROGRESSION ET ASTUCES =====
let progressInterval;
let tipInterval;

function startProgressSimulation() {
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const origName = document.getElementById('current-original-name');
  const normName = document.getElementById('current-normalized-name');
  const tipElement = document.getElementById('loading-tip');
  
  // Noms fictifs pour l'animation d'attente
  const fakeItems = [
    { o: "LAIT DEMI ECREME 1L", n: "Lait demi-écrémé" },
    { o: "OEUFS PLEIN AIR X12", n: "Oeufs frais x12" },
    { o: "PATES SPAGHETTI 500", n: "Pâtes spaghetti 500g" },
    { o: "BEURRE DOUX PLAQUE", n: "Beurre doux 250g" },
    { o: "STEACK HACHE 5% 400G", n: "Viande hachée boeuf 5%" }
  ];

  let currentItem = 0;
  let estimatedTotal = Math.floor(Math.random() * 5) + 6; 
  
  progressBar.style.width = '0%';
  progressText.innerText = "Lecture initiale de l'image...";
  origName.innerText = "Extraction OCR...";
  normName.innerText = "En attente...";
  
  // Astuce initiale
  tipElement.innerText = TIPS[Math.floor(Math.random() * TIPS.length)];

  // 1. Boucle pour la barre de progression (toutes les 2.5 secondes)
  progressInterval = setInterval(() => {
    currentItem++;
    if (currentItem > estimatedTotal) {
      progressBar.style.width = '95%';
      progressText.innerText = `Finalisation des comparaisons...`;
      return;
    }

    const percentage = Math.min((currentItem / estimatedTotal) * 90, 95);
    progressBar.style.width = `${percentage}%`;
    progressText.innerText = `Vérification de l'article ${currentItem}/${estimatedTotal}...`;
    
    const fakeData = fakeItems[currentItem % fakeItems.length];
    origName.innerText = fakeData.o;
    normName.innerText = fakeData.n;

  }, 2500); 

  // 2. Boucle pour changer l'astuce (toutes les 5 secondes)
  tipInterval = setInterval(() => {
    tipElement.style.animation = 'none';
    tipElement.offsetHeight; // Déclenche un reflow pour relancer l'animation
    tipElement.innerText = TIPS[Math.floor(Math.random() * TIPS.length)];
    tipElement.style.animation = 'fadeTip 5s ease forwards';
  }, 5000);
}

function stopProgressSimulation() {
  clearInterval(progressInterval);
  clearInterval(tipInterval);
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('progress-text').innerText = "Terminé !";
}

// ===== AFFICHAGE DES RÉSULTATS =====
function displayResults(data) {
  const articles = data.articles || [];
  const totalC = data.totalCarrefour || 0;
  const totalM = data.totalMonoprix || 0;
  const totalTicket = data.prixTotal || 0; 
  
  document.getElementById('total-carrefour').textContent = formatPrice(totalC);
  document.getElementById('total-monoprix').textContent  = formatPrice(totalM);
  
  // Calcul du gain global
  let bestTotal = Math.min(totalTicket, totalC, totalM);
  let summaryText = "";
  
  if (bestTotal === totalTicket && totalTicket > 0) {
    document.getElementById('total-saving').textContent = "Ticket gagnant";
    document.getElementById('total-saving').style.color = "var(--primary)";
    summaryText = `${articles.length} articles · Bonne nouvelle, votre ticket initial était le moins cher !`;
  } else {
    const diff = totalTicket - bestTotal;
    document.getElementById('total-saving').textContent = `-${formatPrice(diff)}`;
    document.getElementById('total-saving').style.color = "var(--primary)";
    summaryText = `${articles.length} articles · Vous auriez pu économiser ${formatPrice(diff)} ailleurs.`;
  }
  document.getElementById('results-summary').textContent = summaryText;

  // Remplir le tableau
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  articles.forEach(item => {
    const tr = document.createElement('tr');
    
    const pt = item.prix_ticket; 
    const pc = item.prix_carrefour;
    const pm = item.prix_monoprix;
    
    tr.innerHTML = `
      <td>
        <span class="item-name">${escHtml(item.nom || 'Article inconnu')}</span><br>
        <span style="font-size:12px;color:var(--secondary)">Payé sur ticket : ${formatPrice(pt)}</span>
      </td>
      <td class="align-right">${priceCell(pc, 'price-carrefour')}</td>
      <td class="align-right">${priceCell(pm, 'price-monoprix')}</td>
      <td class="align-right">${generateDifferenceBadge(pt, pc, pm)}</td>
    `;
    tbody.appendChild(tr);
  });

  showStep(stepResults);
}

// ===== RESET =====
btnReset.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  previewBar.style.display = 'none';
  previewName.textContent = '';
  showStep(stepUpload);
});

// ===== HELPERS =====
function formatPrice(val) {
  if (typeof val !== 'number' || isNaN(val) || val === 0) return '—';
  return val.toFixed(2).replace('.', ',') + ' €';
}

function priceCell(val, cls) {
  if (val === null || val === undefined || val === 0) return '<span class="price-na" style="font-size:12px; color:var(--secondary)">Introuvable</span>';
  return `<span class="${cls}">${formatPrice(val)}</span>`;
}

function generateDifferenceBadge(ticket, carrefour, monoprix) {
  if (!ticket || ticket === 0) return '<span class="diff-badge equal">N/A</span>';
  
  let min = ticket;
  let winner = 'ticket';
  
  if (carrefour && carrefour > 0 && carrefour < min) { min = carrefour; winner = 'carrefour'; }
  if (monoprix && monoprix > 0 && monoprix < min) { min = monoprix; winner = 'monoprix'; }
  
  if (winner === 'ticket') {
    return '<span class="diff-badge equal">Le moins cher</span>';
  } else if (winner === 'carrefour') {
    const saved = ticket - carrefour;
    return `<span class="diff-badge cheaper-c">Carrefour -${formatPrice(saved)}</span>`;
  } else {
    const saved = ticket - monoprix;
    return `<span class="diff-badge cheaper-m">Monoprix -${formatPrice(saved)}</span>`;
  }
}

function escHtml(str) {
  if(!str) return '';
  return str.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}