// ===== SCAN&SAVE — app.js (Frontend) =====

// ===== ELEMENTS DOM =====
const dropzone    = document.getElementById('dropzone');
const fileInput   = document.getElementById('file-input');
const previewBar  = document.getElementById('preview-bar');
const previewName = document.getElementById('preview-name');
const btnAnalyze  = document.getElementById('btn-analyze');
const btnReset    = document.getElementById('btn-reset');
const btnSave     = document.getElementById('btn-save-ticket');

const stepUpload  = document.getElementById('step-upload');
const stepLoading = document.getElementById('step-loading');
const stepResults = document.getElementById('step-results');

let selectedFile = null;
let currentTicketData = []; // Stockera les articles modifiables

// ===== ASTUCES =====
const TIPS = [
  "💡 Astuce : Le prix au kilo est votre meilleur ami, c'est le seul qui ne ment pas !",
  "🛒 Astuce : N'allez jamais faire les courses le ventre vide. Jamais.",
  "💸 Promo à -50% ? Si vous n'en aviez pas besoin, ne pas l'acheter c'est 100% de réduction.",
  "🍅 Privilégiez les produits de saison : moins chers, plus de goût, et la planète vous remercie.",
  "🍝 Le saviez-vous ? Les pâtes ont beaucoup augmenté récemment, mais rassurez-vous, les coquillettes restent une valeur sûre.",
  "📦 Acheter en gros volume est économique... à condition d'avoir de la place dans les placards !",
  "🏃 Les produits les moins chers sont souvent tout en bas des rayons. L'heure des squats !"
];

// Gestion de l'affichage des astuces
let tipInterval;
function startTips() {
  const tipElement = document.getElementById('loading-tip');
  tipElement.innerText = TIPS[Math.floor(Math.random() * TIPS.length)];
  tipInterval = setInterval(() => {
    tipElement.style.animation = 'none';
    tipElement.offsetHeight; 
    tipElement.innerText = TIPS[Math.floor(Math.random() * TIPS.length)];
    tipElement.style.animation = 'fadeTip 5s ease forwards';
  }, 5000);
}

// ===== NAVIGATION =====
function showStep(step) {
  [stepUpload, stepLoading, stepResults].forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  step.style.display = 'block';
  setTimeout(() => step.classList.add('active'), 10);
}

// ===== UPLOAD =====
// On déclenche le clic sur fileInput seulement si on clique sur la zone, mais on évite le double déclenchement
dropzone.addEventListener('click', (e) => {
  if(e.target.id !== 'file-input') fileInput.click();
});
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); });

function handleFileSelect(file) {
  selectedFile = file;
  previewName.textContent = file.name;
  previewBar.style.display = 'flex';
}

// ===== ANALYSE (TEMPS RÉEL AVEC STREAM / SSE) =====
btnAnalyze.addEventListener('click', () => { if (selectedFile) startAnalysis(selectedFile); });

async function startAnalysis(file) {
  showStep(stepLoading);
  startTips();
  
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const currentSearchItem = document.getElementById('current-search-item');
  
  progressBar.style.width = '5%';
  progressText.innerText = "Envoi de l'image...";

  const formData = new FormData();
  formData.append('ticket', file);

  try {
    // Cette requête attend une réponse en FLUX (Stream) du serveur Node.js !
    const response = await fetch('/api/comparer-ticket-stream', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) throw new Error('Erreur serveur');

    // Lecture du flux de données ligne par ligne
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    currentTicketData = []; // On réinitialise

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
... (200lignes restantes)
