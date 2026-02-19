
// ====== App state + constants ======
const STATE_KEY = 'appStateV1';
let undoStack = [];
let redoStack = [];
let saveTimeout = null;

// Grid + selection + z
let gridSize = parseInt(document.getElementById('gridSizeSlider').value, 10);
let selectedDraggable = null;
let zIndex = 1;

// Canvas setup
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
let penEnabled = false;
let penColor = document.getElementById('colorPicker').value || '#000';
let isDrawing = false;

// Helper: throttle saves during drag/resize for perf
let lastSave = 0;
function throttledSave() {
  const now = Date.now();
  if (now - lastSave > 250) { // every 250ms
    debouncedSave();
    lastSave = now;
  }
}

// Size canvas to viewport (preserve drawing)
function sizeCanvasToWindow(preserve=true) {
  let snapshot = null;
  if (preserve) {
    try { snapshot = canvas.toDataURL('image/png'); } catch(e) {}
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (snapshot) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = snapshot;
  }
}
sizeCanvasToWindow(true);
window.addEventListener('resize', () => sizeCanvasToWindow(true));

// ====== State helpers (get, save, load) ======
function getState() {
  const draggables = [];
  document.querySelectorAll('.draggable').forEach(d => {
    const left = parseInt(d.style.left,10) || 0;
    const top  = parseInt(d.style.top,10)  || 0;
    const width = parseInt(d.style.width,10) || 250;
    const height= parseInt(d.style.height,10) || 100;
    const inputs = d.querySelectorAll('input');
    const [text1='', text2='', text3='', text4=''] = Array.from(inputs).map(i=>i.value||'');
    const backgroundColor = d.style.backgroundColor || '';
    const z = d.style.zIndex || '1';
    draggables.push({ left, top, width, height, text1, text2, text3, text4, backgroundColor, z });
  });

  let drawingData = '';
  try { drawingData = canvas.toDataURL('image/png'); } catch(e){ drawingData = ''; }

  return {
    draggables,
    darkMode: document.body.classList.contains('dark-mode'),
    backgroundImage: document.body.dataset.userBg || '', // store user bg only
    drawing: drawingData
  };
}

function saveStateToStorage(state = null) {
  const s = state || getState();
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { console.error('save failed', e); }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { console.error('load failed', e); return null; }
}

function pushUndoSnapshot() {
  try {
    const snapshot = JSON.stringify(getState());
    undoStack.push(snapshot);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }catch(e){ console.error('push undo failed', e); }
}

function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStateToStorage();
  }, 220);
}

// ====== Apply/restore state ======
function applyState(state) {
  // Clear current cards
  document.querySelectorAll('.draggable').forEach(d => d.remove());

  (state.draggables || []).forEach(item => {
    createDraggable(item.left, item.top, item.text1, item.text2, item.text3, item.text4, item.backgroundColor || 'black', item.width, item.height, item.z);
  });

  // Adjust global zIndex so new cards stack on top
  const maxZ = (state.draggables||[]).reduce((m, d) => Math.max(m, parseInt(d.z||1,10)), 1);
  zIndex = maxZ;

  // Dark mode
  document.body.classList.toggle('dark-mode', !!state.darkMode);
  document.getElementById('toggleDarkModeBtn').textContent = state.darkMode ? '☀️' : '🌙';

  // Background
  if (state.backgroundImage) {
    document.body.dataset.userBg = state.backgroundImage;
    document.body.style.backgroundImage = state.backgroundImage;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
  } else {
    document.body.dataset.userBg = '';
    document.body.style.backgroundImage = 'none';
  }

  // Drawing
  clearCanvas();
  if (state.drawing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = state.drawing;
  }
}

// ====== Canvas helpers ======
function clearCanvas() { ctx.clearRect(0,0,canvas.width, canvas.height); }
function startStroke(x,y) { if (!penEnabled) return; isDrawing = true; ctx.beginPath(); ctx.moveTo(x,y); }
function continueStroke(x,y) {
  if (!isDrawing || !penEnabled) return;
  ctx.lineTo(x,y);
  ctx.strokeStyle = penColor || '#000';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  debouncedSave(); // ensure drawings get into state for undo
}
function endStroke() { if (!penEnabled) return; if (!isDrawing) return; isDrawing = false; debouncedSave(); }

// Canvas events (mouse)
canvas.addEventListener('mousedown', e => startStroke(e.clientX, e.clientY));
canvas.addEventListener('mousemove', e => continueStroke(e.clientX, e.clientY));
canvas.addEventListener('mouseup', endStroke);
canvas.addEventListener('mouseleave', () => { if (isDrawing) endStroke(); });
// Touch events
canvas.addEventListener('touchstart', e => { const t=e.touches[0]; startStroke(t.clientX,t.clientY); e.preventDefault(); }, {passive:false});
canvas.addEventListener('touchmove', e => { const t=e.touches[0]; continueStroke(t.clientX,t.clientY); e.preventDefault(); }, {passive:false});
canvas.addEventListener('touchend', e => { endStroke(); e.preventDefault(); }, {passive:false});

// Toggle pen
document.getElementById('togglePenBtn').addEventListener('click', () => {
  penEnabled = !penEnabled;
  document.body.classList.toggle('drawing-mode', penEnabled);
});

// Color picker: set pen color and selected card bg
document.getElementById('colorPicker').addEventListener('input', e => {
  penColor = e.target.value;
  if (selectedDraggable) {
    selectedDraggable.style.backgroundColor = e.target.value;
    debouncedSave();
  }
});

// ====== Draggable creation ======
function createDraggable(left = 100, top = 100, t1='', t2='', t3='', t4='', backgroundColor = '#222', width=255, height=100, savedZ=null) {
  const d = document.createElement('div');
  d.className = 'draggable';
  d.style.left = `${left}px`;
  d.style.top  = `${top}px`;
  d.style.width = `${width}px`;
  d.style.height = `${height}px`;
  d.style.backgroundColor = backgroundColor || '#222';
  d.style.zIndex = savedZ || (++zIndex);

  // notches
  const nL = document.createElement('div'); nL.className = 'notch notch-left';
  const nR = document.createElement('div'); nR.className = 'notch notch-right';
  d.appendChild(nL); d.appendChild(nR);

  // delete button
  const del = document.createElement('button'); del.className = 'delete-btn'; del.textContent = '✕'; del.setAttribute('aria-label','Delete Card');
  del.addEventListener('click', () => { if (confirm('Delete this card?')) { d.remove(); selectedDraggable = null; debouncedSave(); }});
  d.appendChild(del);

  // inputs
  ;[t1,t2,t3,t4].forEach((val,i) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = val || '';
    inp.setAttribute('aria-label', `card-input-${i+1}`);
    inp.addEventListener('input', debouncedSave);
    d.appendChild(inp);
  });

  // resize handle
  const rh = document.createElement('div'); rh.className = 'resize-handle';
  d.appendChild(rh);

  document.body.appendChild(d);

  // dragging/resizing logic (per-card listeners)
  let isDragging=false, isResizing=false;
  let offsetX=0, offsetY=0, startW=0, startH=0, startMouseX=0, startMouseY=0;

  d.addEventListener('mousedown', e => {
    if (e.target === rh || e.target.tagName === 'INPUT') return;
    pushUndoSnapshot();
    isDragging = true;
    selectedDraggable = d;
    offsetX = e.clientX - d.offsetLeft;
    offsetY = e.clientY - d.offsetTop;
    d.style.cursor = 'grabbing';
    d.style.opacity = .75;
    d.style.zIndex = ++zIndex;
  });

  rh.addEventListener('mousedown', e => {
    pushUndoSnapshot();
    isResizing = true;
    startW = d.offsetWidth; startH = d.offsetHeight;
    startMouseX = e.clientX; startMouseY = e.clientY;
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (isDragging) {
      let newLeft = Math.round((e.clientX - offsetX) / gridSize) * gridSize;
      let newTop  = Math.round((e.clientY - offsetY) / gridSize) * gridSize;
      newLeft = Math.max(0, Math.min(window.innerWidth - d.offsetWidth, newLeft));
      newTop  = Math.max(0, Math.min(window.innerHeight - d.offsetHeight, newTop));
      d.style.left = `${newLeft}px`; d.style.top = `${newTop}px`;
      throttledSave();
    } else if (isResizing) {
      const newW = Math.max(100, startW + (e.clientX - startMouseX));
      const newH = Math.max(50,  startH + (e.clientY - startMouseY));
      d.style.width = `${newW}px`; d.style.height = `${newH}px`;
      throttledSave();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging || isResizing) { isDragging=false; isResizing=false; d.style.cursor='grab'; d.style.opacity = 1; debouncedSave(); }
  });

  // touch
  d.addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (e.target === rh) {
      pushUndoSnapshot();
      isResizing = true; startW = d.offsetWidth; startH = d.offsetHeight; startMouseX = t.clientX; startMouseY = t.clientY;
    } else {
      pushUndoSnapshot();
      isDragging = true; selectedDraggable = d; offsetX = t.clientX - d.offsetLeft; offsetY = t.clientY - d.offsetTop;
      d.style.opacity = .75; d.style.zIndex = ++zIndex;
    }
    e.preventDefault();
  }, {passive:false});

  document.addEventListener('touchmove', e => {
    const t = e.touches[0]; if (!t) return;
    if (isDragging) {
      let newLeft = Math.round((t.clientX - offsetX)/gridSize) * gridSize;
      let newTop  = Math.round((t.clientY - offsetY)/gridSize) * gridSize;
      newLeft = Math.max(0, Math.min(window.innerWidth - d.offsetWidth, newLeft));
      newTop  = Math.max(0, Math.min(window.innerHeight - d.offsetHeight, newTop));
      d.style.left = `${newLeft}px`; d.style.top = `${newTop}px`;
      throttledSave();
    } else if (isResizing) {
      const newW = Math.max(100, startW + (t.clientX - startMouseX));
      const newH = Math.max(50,  startH + (t.clientY - startMouseY));
      d.style.width = `${newW}px`; d.style.height = `${newH}px`;
      throttledSave();
    }
    e.preventDefault();
  }, {passive:false});

  document.addEventListener('touchend', () => { if (isDragging||isResizing) { isDragging=false; isResizing=false; d.style.opacity=1; debouncedSave(); } });

  return d;
}

// Add new card
document.getElementById('addDraggableBtn').addEventListener('click', () => {
  penEnabled = false; document.body.classList.remove('drawing-mode');
  createDraggable(80 + Math.floor(Math.random()*120), 80 + Math.floor(Math.random()*120), '', '', '', '', '#f6e58d', 250, 105);
  debouncedSave();
});

// grid slider
document.getElementById('gridSizeSlider').addEventListener('input', e => { gridSize = parseInt(e.target.value, 10); document.getElementById('gridValue').textContent = `${gridSize}px`; });

// background upload
const bgInput = document.getElementById('backgroundInput');
document.getElementById('changeBackgroundBtn').addEventListener('click', () => { penEnabled=false; document.body.classList.remove('drawing-mode'); bgInput.click(); });
bgInput.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const MAX_MB = 3; if (f.size > MAX_MB * 1024 * 1024) { alert(`Please choose an image smaller than ${MAX_MB}MB.`); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const cssVal = `url(${ev.target.result})`;
    document.body.dataset.userBg = cssVal;
    document.body.style.backgroundImage = cssVal;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    debouncedSave();
  };
  reader.readAsDataURL(f);
  e.target.value = '';
});

// dark mode toggle
const darkBtn = document.getElementById('toggleDarkModeBtn');
darkBtn.addEventListener('click', () => {
  const isDark = !document.body.classList.contains('dark-mode');
  document.body.classList.toggle('dark-mode', isDark);
  darkBtn.textContent = isDark ? '☀️' : '🌙';
  if (document.body.dataset.userBg) {
    document.body.style.backgroundImage = document.body.dataset.userBg;
    document.body.style.backgroundSize = 'cover'; document.body.style.backgroundRepeat = 'no-repeat';
  } else {
    document.body.style.backgroundImage = 'none';
  }
  debouncedSave();
});

// fullscreen
document.getElementById('fullscreen-btn').addEventListener('click', () => {
  const doc = document;
  const el = doc.documentElement;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement && !doc.mozFullScreenElement && !doc.msFullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen).call(el);
  } else {
    (doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen).call(doc);
  }
});

// erase modal
const eraseModal = document.getElementById('eraseModal');
document.getElementById('eraseBtn').addEventListener('click', ()=> eraseModal.style.display = 'flex');
document.getElementById('closeModal').addEventListener('click', ()=> eraseModal.style.display = 'none');
document.querySelectorAll('.erase-option').forEach(btn => {
  btn.addEventListener('click', e => {
    const opt = e.currentTarget.dataset.option;
    if (opt === '1') { // drawings
      clearCanvas(); debouncedSave();
    } else if (opt === '2') {
      if (confirm('Delete all sticky notes?')) { document.querySelectorAll('.draggable').forEach(d => d.remove()); debouncedSave(); }
    } else if (opt === '3') {
      if (confirm('Remove background?')) { document.body.dataset.userBg=''; document.body.style.backgroundImage='none'; debouncedSave(); }
    } else if (opt === '4') {
      if (confirm('Erase drawings, notes, and background?')) {
        clearCanvas();
        document.querySelectorAll('.draggable').forEach(d => d.remove());
        document.body.dataset.userBg=''; document.body.style.backgroundImage='none';
        debouncedSave();
      }
    }
    eraseModal.style.display = 'none';
  });
});

// undo/redo (operate on full app state)
document.getElementById('undoBtn').addEventListener('click', () => {
  if (!undoStack.length) { alert('Nothing to undo'); return; }
  const current = JSON.stringify(getState());
  const prev = undoStack.pop();
  redoStack.push(current);
  try { const st = JSON.parse(prev); applyState(st); saveStateToStorage(st); } catch(e){ console.error('undo failed', e); }
});
document.getElementById('redoBtn').addEventListener('click', () => {
  if (!redoStack.length) { alert('Nothing to redo'); return; }
  const current = JSON.stringify(getState());
  const next = redoStack.pop();
  undoStack.push(current);
  try { const st = JSON.parse(next); applyState(st); saveStateToStorage(st); } catch(e){ console.error('redo failed', e); }
});

// keyboard shortcuts
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); document.getElementById('undoBtn').click(); }
  if (e.ctrlKey && (k === 'y' || (e.shiftKey && k==='z'))) { e.preventDefault(); document.getElementById('redoBtn').click(); }
  if (e.ctrlKey && k === 'q' && selectedDraggable) { e.preventDefault(); if (confirm('Delete this card?')) { selectedDraggable.remove(); selectedDraggable = null; debouncedSave(); } }
});

// ====== XML Export / Import ======
const exportBtn = document.getElementById('exportXmlBtn');
const importBtn = document.getElementById('importXmlBtn');
const xmlInput = document.getElementById('xmlInput');

function escCdata(s=''){ return String(s).replace(/]]>/g, ']]]]><![CDATA[>'); }

function exportToXML() {
  const state = getState();
  const parts = [];
  parts.push('<?xml version="1.0" encoding="utf-8"?>');
  parts.push('<workspace>');
  parts.push(`  <darkMode>${state.darkMode}</darkMode>`);
  parts.push(`  <background><![CDATA[${escCdata(state.backgroundImage || '')}]]></background>`);
  parts.push(`  <drawing><![CDATA[${escCdata(state.drawing || '')}]]></drawing>`);
  parts.push('  <draggables>');
  state.draggables.forEach(d => {
    parts.push(`    <draggable left="${d.left}" top="${d.top}" width="${d.width}" height="${d.height}" z="${d.z}">`);
    parts.push(`      <text1><![CDATA[${escCdata(d.text1 || '')}]]></text1>`);
    parts.push(`      <text2><![CDATA[${escCdata(d.text2 || '')}]]></text2>`);
    parts.push(`      <text3><![CDATA[${escCdata(d.text3 || '')}]]></text3>`);
    parts.push(`      <text4><![CDATA[${escCdata(d.text4 || '')}]]></text4>`);
    parts.push(`      <bg><![CDATA[${escCdata(d.backgroundColor || '')}]]></bg>`);
    parts.push('    </draggable>');
  });
  parts.push('  </draggables>');
  parts.push('</workspace>');

  const blob = new Blob([parts.join('\n')], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'workspace.xml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importFromXMLFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(ev.target.result, 'application/xml');
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) throw new Error(parseError.textContent || 'XML parse error');

      const darkModeNode = xmlDoc.querySelector('darkMode');
      const backgroundNode = xmlDoc.querySelector('background');
      const drawingNode = xmlDoc.querySelector('drawing');
      const draggablesNodes = xmlDoc.querySelectorAll('draggable');

      const state = { draggables: [], darkMode: false, backgroundImage: '', drawing: '' };

      state.darkMode = darkModeNode && darkModeNode.textContent === 'true';
      state.backgroundImage = backgroundNode ? backgroundNode.textContent : '';
      state.drawing = drawingNode ? drawingNode.textContent : '';

      draggablesNodes.forEach(nd => {
        const left = parseInt(nd.getAttribute('left') || 0, 10);
        const top = parseInt(nd.getAttribute('top') || 0, 10);
        const width = parseInt(nd.getAttribute('width') || 250, 10);
        const height = parseInt(nd.getAttribute('height') || 100, 10);
        const z = nd.getAttribute('z') || '1';
        const text1 = (nd.querySelector('text1') && nd.querySelector('text1').textContent) || '';
        const text2 = (nd.querySelector('text2') && nd.querySelector('text2').textContent) || '';
        const text3 = (nd.querySelector('text3') && nd.querySelector('text3').textContent) || '';
        const text4 = (nd.querySelector('text4') && nd.querySelector('text4').textContent) || '';
        const bg = (nd.querySelector('bg') && nd.querySelector('bg').textContent) || '';
        state.draggables.push({ left, top, width, height, text1, text2, text3, text4, backgroundColor: bg, z });
      });

      applyState(state);
      saveStateToStorage(state);
      pushUndoSnapshot();
      alert('Workspace imported.');
    } catch (err) {
      console.error('Failed to import XML', err);
      alert('Failed to import XML file.');
    }
  };
  reader.readAsText(file);
}

exportBtn.addEventListener('click', exportToXML);
importBtn.addEventListener('click', () => xmlInput.click());
xmlInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importFromXMLFile(file);
  e.target.value = '';
});

// ====== Init: load saved state ======
(function init(){
  sizeCanvasToWindow(true);
  const saved = loadStateFromStorage();
  if (saved) applyState(saved);
  pushUndoSnapshot();
})();

// Instructions modal
const instructionsBtn = document.getElementById('instructionsBtn');
const instructionsModal = document.getElementById('instructionsModal');
const closeInstructionsBtn = document.getElementById('closeInstructionsBtn');
instructionsBtn.addEventListener('click', () => instructionsModal.style.display = 'flex');
closeInstructionsBtn.addEventListener('click', () => instructionsModal.style.display = 'none');

// About modal
const aboutBtn = document.getElementById('aboutBtn');
const aboutModal = document.getElementById('aboutModal');
const closeAboutBtn = document.getElementById('closeAboutBtn');
aboutBtn.addEventListener('click', () => { aboutModal.style.display = 'flex'; });
closeAboutBtn.addEventListener('click', () => { aboutModal.style.display = 'none'; });
window.addEventListener('click', (e) => { if (e.target === aboutModal) { aboutModal.style.display = 'none'; } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { aboutModal.style.display = 'none'; instructionsModal.style.display = 'none'; eraseModal.style.display = 'none'; } });


