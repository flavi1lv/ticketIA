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
let currentTicketData = []; 

// Tableaux d'astuces
const TIPS = [
  "💡 Astuce : Le prix au kilo est votre meilleur ami, c'est le seul qui ne ment pas !",
  "🛒 Astuce : N'allez jamais faire les courses le ventre vide.",
  "💸 Promo à -50% ? Si vous n'en aviez pas besoin, ne pas l'acheter c'est 100% de réduction.",
  "🍝 Les pâtes ont augmenté, mais rassurez-vous, les coquillettes restent une valeur sûre.",
  "🏃 Les produits les moins chers sont souvent tout en bas des rayons."
];

let tipInterval;
function startTips() {
  const tipElement = document.getElementById('loading-tip');
  const updateTip = () => {
    tipElement.innerText = TIPS[Math.floor(Math.random() * TIPS.length)];
  };
  updateTip();
  tipInterval = setInterval(updateTip, 5000);
}

// ===== NAVIGATION =====
function showStep(step) {
  [stepUpload, stepLoading, stepResults].forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  step.style.display = 'block';
  setTimeout(() => step.classList.add('active'), 10);
}

// ===== UPLOAD =====
dropzone.addEventListener('click', (e) => { if(e.target.id !== 'file-input') fileInput.click(); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); });

function handleFileSelect(file) {
  selectedFile = file;
  previewName.textContent = file.name;
  previewBar.style.display = 'flex';
}

// ===== ANALYSE TEMPS RÉEL =====
btnAnalyze.addEventListener('click', () => { if (selectedFile) startAnalysis(selectedFile); });

async function startAnalysis(file) {
  showStep(stepLoading);
  startTips();
  
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const currentSearchItem = document.getElementById('current-search-item');

  const formData = new FormData();
  formData.append('ticket', file);

  try {
    const response = await fetch('/api/comparer-ticket-stream', { method: 'POST', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    currentTicketData = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim());

      for (let line of lines) {
        const data = JSON.parse(line);
        if (data.type === 'progress') {
           const pct = Math.round((data.current / data.total) * 100);
           progressBar.style.width = `${pct}%`;
           progressText.innerText = `Analyse : ${data.current}/${data.total}`;
           currentSearchItem.innerText = `🔍 En cours : ${data.item}`;
        }
        if (data.type === 'result') {
           currentTicketData = data.articles;
           renderResultsTable();
        }
      }
    }
  } catch (err) {
    alert("Erreur analyse");
    showStep(stepUpload);
  } finally { clearInterval(tipInterval); }
}

// ===== RÉSULTATS & ÉDITION =====
function renderResultsTable() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';
  
  currentTicketData.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="item-name">${item.nom}</span></td>
      <td class="align-right"><input type="number" step="0.01" class="editable-price" data-index="${index}" data-field="prix_ticket" value="${item.prix_ticket || ''}"></td>
      <td class="align-right"><input type="number" step="0.01" class="editable-price" data-index="${index}" data-field="prix_carrefour" value="${item.prix_carrefour || ''}"></td>
      <td class="align-right"><input type="number" step="0.01" class="editable-price" data-index="${index}" data-field="prix_monoprix" value="${item.prix_monoprix || ''}"></td>
      <td class="align-right" id="badge-${index}">${generateBadge(item)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.editable-price').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const idx = e.target.dataset.index;
      currentTicketData[idx][e.target.dataset.field] = parseFloat(e.target.value) || 0;
      document.getElementById(`badge-${idx}`).innerHTML = generateBadge(currentTicketData[idx]);
      updateTotals();
    });
  });

  updateTotals();
  showStep(stepResults);
  if(window.currentUser) btnSave.style.display = 'inline-block';
}

function updateTotals() {
  let tT = 0, tC = 0, tM = 0;
  currentTicketData.forEach(i => { tT += i.prix_ticket || 0; tC += i.prix_carrefour || 0; tM += i.prix_monoprix || 0; });

  document.getElementById('total-carrefour').innerText = tC.toFixed(2) + " €";
  document.getElementById('total-monoprix').innerText = tM.toFixed(2) + " €";
  
  const min = Math.min(...[tT, tC, tM].filter(p => p > 0));
  const savEl = document.getElementById('total-saving');
  if (tT <= min && tT > 0) savEl.innerText = "🏆 Vous avez trouvé moins cher !";
  else savEl.innerText = `-${(tT - min).toFixed(2)} €`;
}

function generateBadge(i) {
  const pT = i.prix_ticket || 0;
  const min = Math.min(...[pT, i.prix_carrefour, i.prix_monoprix].filter(p => p > 0));
  if (pT <= min && pT > 0) return '<span class="diff-badge equal">Gagnant</span>';
  return `<span class="diff-badge cheaper-c">Gain : ${(pT - min).toFixed(2)}€</span>`;
}

// ===== PARAMÈTRES & ACTIONS =====
const modal = document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', () => modal.classList.add('active'));
document.getElementById('btn-close-settings').addEventListener('click', () => modal.classList.remove('active'));

btnSave.addEventListener('click', async () => {
  if (!window.currentUser) return;
  const res = await fetch('/api/save-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ googleId: window.currentUser.googleId, articles: currentTicketData })
  });
  if (res.ok) { btnSave.innerText = "✅ Sauvegardé"; btnSave.disabled = true; }
});

document.getElementById('btn-save-name').addEventListener('click', async () => {
  const name = document.getElementById('settings-name-input').value;
  await fetch('/api/user/rename', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ googleId: window.currentUser.googleId, newName: name })
  });
  document.getElementById('nav-user-name').innerText = "👋 " + name;
  modal.classList.remove('active');
});

document.getElementById('btn-delete-account').addEventListener('click', async () => {
  if(confirm("Supprimer définitivement ?")) {
    await fetch('/api/user/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleId: window.currentUser.googleId })
    });
    location.reload();
  }
});

btnReset.addEventListener('click', () => { location.reload(); });
