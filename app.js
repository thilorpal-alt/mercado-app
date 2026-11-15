/**
 * Mercado PWA - Frontend Application Logic
 * Reactive UI, Listonic-style list, Voice recognition, QR scanner, Gemini Vision receipt OCR,
 * Price history tracker, and Chef Gemini recipe assistant.
 */

// Application State
const state = {
  shoppingItems: [],
  categories: [],
  products: [],
  pantry: [],
  catalog: [],
  catalogCategory: 'all',
  catalogSearch: '',
  currentTab: 'tab-shopping',
  completedExpanded: false,
  editingNoteId: null,
  recognition: null,
  isListening: false,
  html5QrCode: null,
  pendingReceiptData: null,
  pendingReconciliation: null,
  exportData: { gemini_prompt: '', csv_text: '' }
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initLucide();
  loadSettings();
  loadShoppingList();
  loadCatalog();
  loadProducts();
  loadPantry();
  setupSpeechRecognition();
  registerServiceWorker();
  setupLiveSync();
});

// Auto-sync between PC and Mobile devices
function setupLiveSync() {
  // Sync immediately when user switches back to this app/browser tab
  window.addEventListener('focus', () => {
    if (state.currentTab === 'tab-shopping') loadShoppingList();
    if (state.currentTab === 'tab-recipes') loadPantry();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.currentTab === 'tab-shopping') {
      loadShoppingList();
    }
  });

  // Background polling every 4 seconds when viewing shopping list
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.currentTab === 'tab-shopping' && !state.isListening) {
      loadShoppingList(true); // silent background reload
    }
  }, 4000);
}

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('SW registration skipped:', err);
    });
  }
}

// ==================== TAB NAVIGATION ====================
function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(tabId);
  if (target) target.classList.remove('hidden');

  // Update desktop tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.target === tabId) {
      btn.classList.add('border-white', 'text-white');
      btn.classList.remove('border-transparent', 'text-emerald-100');
    } else {
      btn.classList.remove('border-white', 'text-white');
      btn.classList.add('border-transparent', 'text-emerald-100');
    }
  });

  // Update mobile bottom nav
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    if (btn.dataset.target === tabId) {
      btn.classList.add('text-emerald-600', 'font-semibold');
      btn.classList.remove('text-slate-400');
    } else {
      btn.classList.remove('text-emerald-600', 'font-semibold');
      btn.classList.add('text-slate-400');
    }
  });

  if (tabId === 'tab-catalog') loadCatalog();
  if (tabId === 'tab-prices') loadProducts();
  if (tabId === 'tab-recipes') loadPantry();
  if (tabId !== 'tab-receipt' && state.html5QrCode) {
    stopQrScanner();
  }

  initLucide();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.innerText = message;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, duration);
}

// ==================== TAB 1: LISTA DE COMPRAS (LISTONIC STYLE) ====================
async function loadShoppingList(silent = false) {
  if (state.editingNoteId !== null) return; // não atrapalha quem está digitando um lembrete
  try {
    const res = await fetch('/api/shopping');
    const data = await res.json();
    const newItems = data.items || [];
    
    // Check if items changed to avoid unnecessary re-render during background sync
    if (silent && JSON.stringify(newItems) === JSON.stringify(state.shoppingItems)) {
      return;
    }

    state.shoppingItems = newItems;
    state.categories = data.categories || [];
    renderShoppingList();
  } catch (err) {
    if (!silent) console.error('Erro ao carregar lista:', err);
  }
}

function renderShoppingList() {
  const activeItems = state.shoppingItems.filter(i => !i.checked);
  const checkedItems = state.shoppingItems.filter(i => i.checked);

  // Update counters & badges
  document.getElementById('activeCountBadge').innerText = `${activeItems.length} a comprar`;
  document.getElementById('checkedCountBadge').innerText = `${checkedItems.length} no carrinho`;
  document.getElementById('completedCountNum').innerText = checkedItems.length;

  const toLiveBadge = document.getElementById('catalogToLiveCountBadge');
  if (toLiveBadge) toLiveBadge.innerText = activeItems.length;
  
  const mobileBadge = document.getElementById('mobileBadgeCount');
  if (activeItems.length > 0) {
    mobileBadge.innerText = activeItems.length;
    mobileBadge.classList.remove('hidden');
  } else {
    mobileBadge.classList.add('hidden');
  }

  // Render Active items (Grouped by Category)
  const activeContainer = document.getElementById('activeListContainer');
  if (activeItems.length === 0) {
    activeContainer.innerHTML = `
      <div class="text-center py-12 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i data-lucide="shopping-basket" class="w-12 h-12 mx-auto stroke-1 mb-2 opacity-50 text-emerald-600"></i>
        <p class="text-sm font-semibold text-slate-600">Sua lista está limpa!</p>
        <p class="text-xs text-slate-400 mt-1">Adicione itens digitando acima ou falando pelo microfone.</p>
      </div>
    `;
  } else {
    // Group active items by category
    const grouped = {};
    activeItems.forEach(item => {
      const cat = item.category || 'Mercearia e Despensa';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    let html = '';
    for (const [catName, items] of Object.entries(grouped)) {
      const catMeta = state.categories.find(c => c.name === catName) || { icon: '📦', color: 'bg-slate-100 text-slate-700' };
      html += `
        <div class="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <!-- Category Header -->
          <div class="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>${catMeta.icon}</span> ${catName}
            </span>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-600">
              ${items.length} ${items.length === 1 ? 'item' : 'itens'}
            </span>
          </div>

          <!-- Items list -->
          <div class="divide-y divide-slate-100">
            ${items.map(item => `
              <div 
                class="flex items-center justify-between px-3.5 py-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer select-none group"
                onclick="toggleItemChecked(${item.id}, ${item.checked})"
              >
                <div class="flex items-center gap-3 flex-1 min-w-0 pr-2">
                  <!-- Checkbox button -->
                  <div class="w-5 h-5 rounded-lg border-2 border-slate-300 flex items-center justify-center transition-colors group-hover:border-emerald-500">
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-slate-800 truncate leading-snug">${escapeHtml(item.name)}</p>
                    ${renderNoteBlock(item)}
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <span class="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                    ${formatQuantity(item.quantity, item.unit)}
                  </span>
                  <button 
                    onclick="event.stopPropagation(); deleteItem(${item.id})" 
                    class="p-1.5 text-slate-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                    title="Excluir item"
                  >
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    activeContainer.innerHTML = html;
  }

  // Render Completed / In-Cart Items
  const completedSection = document.getElementById('completedSection');
  const completedContainer = document.getElementById('completedListContainer');

  if (checkedItems.length > 0) {
    completedSection.classList.remove('hidden');
    completedContainer.innerHTML = checkedItems.map(item => `
      <div 
        class="flex items-center justify-between px-3.5 py-2.5 bg-slate-100/70 hover:bg-slate-100 rounded-xl transition cursor-pointer opacity-70 select-none"
        onclick="toggleItemChecked(${item.id}, ${item.checked})"
      >
        <div class="flex items-center gap-3 flex-1 min-w-0 pr-2">
          <div class="w-5 h-5 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
            <i data-lucide="check" class="w-3.5 h-3.5 stroke-[3]"></i>
          </div>
          <div class="min-w-0">
            <p class="text-sm line-through text-slate-500 truncate">${escapeHtml(item.name)}</p>
            ${item.notes ? `<p class="text-[10px] text-slate-400 truncate">📝 ${escapeHtml(item.notes)}</p>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">${formatQuantity(item.quantity, item.unit)}</span>
          <button 
            onclick="event.stopPropagation(); deleteItem(${item.id})" 
            class="p-1 text-slate-300 hover:text-red-500 transition"
          >
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `).join('');
  } else {
    completedSection.classList.add('hidden');
  }

  initLucide();
}

// ---------- Lembretes por item (ex: "peça inteira", "para a receita X") ----------
function renderNoteBlock(item) {
  if (state.editingNoteId === item.id) {
    return `
      <div class="mt-1.5" onclick="event.stopPropagation()">
        <input
          id="noteEditInput"
          type="text"
          value="${escapeHtml(item.notes || '')}"
          maxlength="200"
          placeholder="Lembrete: ex. peça inteira, pouca gordura, receita X"
          class="w-full px-2.5 py-1.5 text-xs bg-amber-50 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          onkeydown="handleNoteKey(event, ${item.id})"
          onblur="saveItemNote(${item.id})"
        />
      </div>`;
  }
  if (item.notes) {
    return `
      <button type="button" onclick="startEditNote(${item.id}, event)"
        class="mt-1 block max-w-full text-left text-[11px] leading-snug text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 break-words"
        title="Toque para editar o lembrete">📝 ${escapeHtml(item.notes)}</button>`;
  }
  return `
    <button type="button" onclick="startEditNote(${item.id}, event)"
      class="mt-0.5 text-[11px] text-slate-400 hover:text-amber-700">+ lembrete</button>`;
}

function startEditNote(id, event) {
  if (event) event.stopPropagation();
  state.editingNoteId = id;
  renderShoppingList();
  setTimeout(() => {
    const el = document.getElementById('noteEditInput');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 30);
}

function handleNoteKey(event, id) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur(); // dispara o salvamento
  } else if (event.key === 'Escape') {
    state.editingNoteId = null;
    renderShoppingList();
  }
}

async function saveItemNote(id) {
  if (state.editingNoteId !== id) return;
  const el = document.getElementById('noteEditInput');
  const notes = el ? el.value.trim() : '';
  state.editingNoteId = null;
  const item = state.shoppingItems.find(i => i.id === id);
  if (item) item.notes = notes;
  renderShoppingList();
  try {
    await fetch(`/api/shopping/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
  } catch (err) {
    showToast('Erro ao salvar lembrete.');
    loadShoppingList();
  }
}

function formatQuantity(qty, unit) {
  if (!qty) return '';
  const numStr = (qty % 1 === 0) ? qty.toString() : qty.toFixed(1);
  return `${numStr} ${unit || 'un'}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Add Item from Form
async function handleAddItem(e) {
  e.preventDefault();
  const input = document.getElementById('itemInput');
  const text = input.value.trim();
  if (!text) return;

  // Check if multiple items or natural language was typed (e.g. "leite, cafe, tomate")
  if (text.includes(',') || text.toLowerCase().includes(' e ') || text.includes('\n')) {
    input.value = '';
    showToast('Identificando itens múltiplos...');
    await parseAndAddSpokenText(text);
    return;
  }

  const noteInput = document.getElementById('itemNoteInput');
  const note = noteInput ? noteInput.value.trim() : '';
  try {
    const res = await fetch('/api/shopping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: text, notes: note })
    });
    if (res.ok) {
      input.value = '';
      if (noteInput) noteInput.value = '';
      await loadShoppingList();
      showToast('Item adicionado à lista!');
    }
  } catch (err) {
    showToast('Erro ao adicionar item.');
  }
}

// Toggle Checked (Move between Active and Completed)
async function toggleItemChecked(id, currentStatus) {
  const newStatus = currentStatus ? 0 : 1;
  // Optimistic UI update
  const item = state.shoppingItems.find(i => i.id === id);
  if (item) item.checked = newStatus;
  renderShoppingList();

  try {
    await fetch(`/api/shopping/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: newStatus })
    });
  } catch (err) {
    // revert on error
    loadShoppingList();
  }
}

// Delete item
async function deleteItem(id) {
  try {
    await fetch(`/api/shopping/${id}`, { method: 'DELETE' });
    state.shoppingItems = state.shoppingItems.filter(i => i.id !== id);
    renderShoppingList();
    showToast('Item removido.');
  } catch (err) {
    showToast('Erro ao remover.');
  }
}

// Clear all completed items
async function clearCompletedItems() {
  const completed = state.shoppingItems.filter(i => i.checked);
  if (completed.length === 0) {
    showToast('Nenhum item comprado no carrinho.');
    return;
  }
  if (!confirm(`Remover todos os ${completed.length} itens comprados da lista?`)) return;

  try {
    await fetch('/api/shopping/clear-completed', { method: 'DELETE' });
    await loadShoppingList();
    showToast('Itens comprados limpos!');
  } catch (err) {
    showToast('Erro ao limpar itens.');
  }
}

function toggleCompletedAccordion() {
  state.completedExpanded = !state.completedExpanded;
  const container = document.getElementById('completedListContainer');
  const chevron = document.getElementById('completedChevron');
  if (state.completedExpanded) {
    container.classList.remove('hidden');
    chevron.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    chevron.classList.remove('rotate-180');
  }
}

// ==================== TAB 1B: LISTA GERAL / REPOSITÓRIO (LISTONIC STYLE) ====================
let catalogSearchTimeout = null;

async function loadCatalog(silent = false) {
  try {
    const params = new URLSearchParams();
    if (state.catalogSearch) params.set('q', state.catalogSearch);
    if (state.catalogCategory && state.catalogCategory !== 'all') params.set('category', state.catalogCategory);

    const res = await fetch(`/api/catalog?${params.toString()}`);
    const data = await res.json();
    state.catalog = data.items || [];
    state.catalogCategories = data.categories || [];

    // Update badges
    const desktopBadge = document.getElementById('desktopCatalogBadge');
    if (desktopBadge) desktopBadge.innerText = data.total_count || state.catalog.length;
    
    const statsEl = document.getElementById('catalogItemsStats');
    if (statsEl) {
      statsEl.innerHTML = `<b>${data.total_count || state.catalog.length}</b> itens cadastrados (${data.active_in_list_count || 0} na lista viva)`;
    }

    renderCatalogCategoryPills(data.categories || []);
    renderCatalogCards();
  } catch (err) {
    if (!silent) console.error('Erro ao carregar catálogo:', err);
  }
}

function renderCatalogCategoryPills(categories) {
  const container = document.getElementById('catalogCategoryPills');
  if (!container) return;

  const currentCat = state.catalogCategory || 'all';
  let html = `
    <button 
      onclick="filterCatalogCategory('all')" 
      class="px-2.5 py-1 rounded-lg font-semibold shrink-0 transition text-xs ${currentCat === 'all' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
    >
      Todas
    </button>
  `;

  categories.forEach(cat => {
    const active = currentCat === cat.name;
    html += `
      <button 
        onclick="filterCatalogCategory('${cat.name}')" 
        class="px-2.5 py-1 rounded-lg font-medium shrink-0 transition text-xs flex items-center gap-1 ${active ? 'bg-emerald-600 text-white shadow-xs font-semibold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
      >
        <span>${cat.icon}</span>
        <span>${cat.name}</span>
      </button>
    `;
  });

  container.innerHTML = html;
}

function filterCatalogCategory(catName) {
  state.catalogCategory = catName;
  loadCatalog();
}

function handleCatalogSearch(query) {
  state.catalogSearch = query.trim();
  const clearBtn = document.getElementById('catalogSearchClearBtn');
  if (clearBtn) {
    if (state.catalogSearch) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  clearTimeout(catalogSearchTimeout);
  catalogSearchTimeout = setTimeout(() => {
    loadCatalog();
  }, 250);
}

function clearCatalogSearch() {
  const input = document.getElementById('catalogSearchInput');
  if (input) input.value = '';
  state.catalogSearch = '';
  const clearBtn = document.getElementById('catalogSearchClearBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  loadCatalog();
}

function renderCatalogCards() {
  const container = document.getElementById('catalogContainer');
  if (!container) return;

  if (state.catalog.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i data-lucide="layers" class="w-12 h-12 mx-auto stroke-1 mb-2 opacity-50 text-emerald-600"></i>
        <p class="text-sm font-semibold text-slate-600">Nenhum item encontrado no repositório.</p>
        <p class="text-xs text-slate-400 mt-1">Cadastre acima para incluir na sua lista geral!</p>
      </div>
    `;
    initLucide();
    return;
  }

  // Group by category
  const grouped = {};
  state.catalog.forEach(item => {
    const cat = item.category || 'Mercearia e Despensa';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let html = '';
  for (const [catName, items] of Object.entries(grouped)) {
    const catMeta = (state.categories || []).find(c => c.name === catName) || { icon: '📦', color: 'bg-slate-100 text-slate-700' };
    const inListCount = items.filter(i => i.in_shopping_list).length;

    html += `
      <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div class="bg-slate-50/90 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-base">${catMeta.icon}</span>
            <h3 class="text-xs font-bold text-slate-800">${catName}</h3>
            <span class="text-[10px] text-slate-500 font-semibold bg-white px-2 py-0.5 rounded-full border border-slate-200">
              ${items.length} itens
            </span>
          </div>
          ${inListCount > 0 ? `
            <span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md flex items-center gap-1">
              <i data-lucide="check" class="w-3 h-3"></i> ${inListCount} na lista viva
            </span>
          ` : ''}
        </div>

        <div class="p-2 sm:p-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
    `;

    items.forEach(it => {
      const inList = it.in_shopping_list;
      const cardBg = inList 
        ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400/60 shadow-xs' 
        : 'bg-white hover:bg-slate-50/80 border-slate-200 hover:border-slate-300 shadow-2xs';

      html += `
        <div 
          onclick="toggleCatalogItem(${it.id})" 
          class="group relative cursor-pointer border rounded-xl p-2.5 flex items-center justify-between gap-2 transition select-none ${cardBg}"
          title="${inList ? 'Toque para remover da lista viva' : 'Toque para adicionar à lista viva'}"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <!-- Checkmark / Plus indicator -->
            <div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition ${inList ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-700'}">
              <i data-lucide="${inList ? 'check' : 'plus'}" class="w-3.5 h-3.5 stroke-[2.5]"></i>
            </div>
            
            <div class="min-w-0">
              <p class="text-xs font-semibold leading-tight truncate ${inList ? 'text-emerald-950 font-bold' : 'text-slate-800'}">
                ${it.name}
              </p>
              <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                <span>${it.default_unit || 'un'}</span>
                ${it.last_price ? `
                  <span>•</span>
                  <span class="text-emerald-700 font-medium">R$ ${Number(it.last_price).toFixed(2)}</span>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Actions / In-list pill -->
          <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
            ${inList ? `
              <span class="text-[9px] font-bold text-emerald-700 bg-emerald-100/90 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                ${it.shopping_quantity ? `${Number(it.shopping_quantity)} ${it.shopping_unit || ''}` : 'Na lista'}
              </span>
              <button 
                onclick="addCatalogItemQuantity(${it.id}, event)" 
                class="w-6 h-6 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white flex items-center justify-center shadow-xs transition"
                title="Adicionar mais 1 à lista"
              >
                <i data-lucide="plus" class="w-3 h-3 stroke-[2.5]"></i>
              </button>
            ` : `
              <button 
                onclick="toggleCatalogItem(${it.id})" 
                class="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-emerald-600 hover:underline px-1 py-0.5 transition"
              >
                + Adicionar
              </button>
            `}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  initLucide();
}

async function toggleCatalogItem(id) {
  // Optimistic UI update
  const item = state.catalog.find(i => i.id === id);
  if (item) {
    item.in_shopping_list = !item.in_shopping_list;
    renderCatalogCards();
  }

  try {
    const res = await fetch(`/api/catalog/${id}/toggle-shopping`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      if (data.action === 'added') {
        showToast(`✓ ${data.item_name} adicionado à lista viva!`);
      } else {
        showToast(`${data.item_name} removido da lista viva.`);
      }
      loadShoppingList(true);
      loadCatalog(true);
    }
  } catch (err) {
    showToast('Erro ao atualizar lista.');
    loadCatalog();
  }
}

async function addCatalogItemQuantity(id, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch(`/api/catalog/${id}/add-shopping`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || `+1 adicionado!`);
      loadShoppingList(true);
      loadCatalog(true);
    }
  } catch (err) {
    showToast('Erro ao adicionar quantidade.');
  }
}

async function handleAddCatalogItem() {
  const input = document.getElementById('newCatalogItemInput');
  const name = input ? input.value.trim() : '';
  if (!name) return;

  try {
    const res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      input.value = '';
      showToast(`✓ "${name}" cadastrado no repositório geral!`);
      await loadCatalog();
    }
  } catch (err) {
    showToast('Erro ao cadastrar item no repositório.');
  }
}

// ==================== VOICE RECOGNITION (SPEECH-TO-TEXT) ====================
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.title = 'Reconhecimento de fala não suportado neste navegador';
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.lang = 'pt-BR';
  state.recognition.continuous = false;
  state.recognition.interimResults = false;

  state.recognition.onstart = () => {
    state.isListening = true;
    document.getElementById('voiceStatus').classList.remove('hidden');
    document.getElementById('micBtn').classList.add('text-red-500', 'animate-pulse');
  };

  state.recognition.onend = () => {
    state.isListening = false;
    document.getElementById('voiceStatus').classList.add('hidden');
    document.getElementById('micBtn').classList.remove('text-red-500', 'animate-pulse');
  };

  state.recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    if (transcript) {
      showToast(`Processando: "${transcript}"`);
      await parseAndAddSpokenText(transcript);
    }
  };

  state.recognition.onerror = (event) => {
    console.error('Speech error:', event.error);
    showToast('Não foi possível captar a voz. Tente novamente.');
  };
}

function toggleVoiceInput() {
  if (!state.recognition) {
    alert('O seu navegador não suporta reconhecimento de voz direto. Digite no campo de texto.');
    return;
  }
  if (state.isListening) {
    state.recognition.stop();
  } else {
    try {
      state.recognition.start();
    } catch (e) {
      console.log('Voice start error:', e);
    }
  }
}

function stopVoiceInput() {
  if (state.recognition && state.isListening) {
    state.recognition.stop();
  }
}

async function parseAndAddSpokenText(text) {
  try {
    const res = await fetch('/api/shopping/parse-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, auto_add: true })
    });
    const data = await res.json();
    if (data.count > 0) {
      showToast(`${data.count} ${data.count === 1 ? 'item adicionado' : 'itens adicionados'} à lista!`);
      await loadShoppingList();
    } else {
      showToast('Nenhum item identificado.');
    }
  } catch (err) {
    showToast('Erro ao processar fala.');
  }
}

// ==================== TAB 2: ESCANEAR NOTA FISCAL (NFC-e SC & FOTO IA) ====================
function setScanMode(mode) {
  const btnQr = document.getElementById('btnModeQr');
  const btnPhoto = document.getElementById('btnModePhoto');
  const viewQr = document.getElementById('viewQrScan');
  const viewPhoto = document.getElementById('viewPhotoScan');

  if (mode === 'qr') {
    btnQr.classList.add('bg-white', 'text-emerald-700', 'shadow-sm');
    btnQr.classList.remove('text-slate-600');
    btnPhoto.classList.remove('bg-white', 'text-emerald-700', 'shadow-sm');
    btnPhoto.classList.add('text-slate-600');
    viewQr.classList.remove('hidden');
    viewPhoto.classList.add('hidden');
  } else {
    btnPhoto.classList.add('bg-white', 'text-emerald-700', 'shadow-sm');
    btnPhoto.classList.remove('text-slate-600');
    btnQr.classList.remove('bg-white', 'text-emerald-700', 'shadow-sm');
    btnQr.classList.add('text-slate-600');
    viewPhoto.classList.remove('hidden');
    viewQr.classList.add('hidden');
    stopQrScanner();
  }
  initLucide();
}

// Start QR Code Camera Scanner
function startQrScanner() {
  const qrReaderDiv = document.getElementById('qr-reader');
  qrReaderDiv.innerHTML = '';
  document.getElementById('btnStartQr').classList.add('hidden');
  document.getElementById('btnStopQr').classList.remove('hidden');

  state.html5QrCode = new Html5Qrcode('qr-reader');
  state.html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      stopQrScanner();
      handleQrDecoded(decodedText);
    },
    (errorMessage) => {
      // scanning frames...
    }
  ).catch(err => {
    alert('Erro ao acessar a câmera. Verifique se concedeu permissão.');
    document.getElementById('btnStartQr').classList.remove('hidden');
    document.getElementById('btnStopQr').classList.add('hidden');
  });
}

function stopQrScanner() {
  if (state.html5QrCode) {
    state.html5QrCode.stop().then(() => {
      state.html5QrCode.clear();
      state.html5QrCode = null;
    }).catch(err => console.log('QR Stop err:', err));
  }
  document.getElementById('btnStartQr').classList.remove('hidden');
  document.getElementById('btnStopQr').classList.add('hidden');
}

async function handleQrDecoded(qrUrl) {
  showToast('QR Code detectado! Consultando SEFAZ...');
  showReceiptLoading(true);

  try {
    const res = await fetch('/api/receipt/scan-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: qrUrl })
    });
    const data = await res.json();
    showReceiptLoading(false);

    if (data.parse_result && data.parse_result.success && data.parse_result.items.length > 0) {
      showReconciliationModal({
        source: 'qr_sc',
        receipt_data: {
          store_name: data.parse_result.store_name,
          total_amount: data.parse_result.total_amount,
          items: data.parse_result.items
        },
        reconciliation: data.reconciliation
      });
    } else {
      // Captcha or protected SEFAZ page fallback
      const msg = data.parse_result?.message || 'O portal da SEFAZ exigiu validação humana.';
      alert(`${msg}\n\n👉 Para ler instantaneamente sem depender da SEFAZ, tire uma FOTO do cupom em papel!`);
      setScanMode('photo');
    }
  } catch (err) {
    showReceiptLoading(false);
    showToast('Falha ao processar QR Code.');
  }
}

function submitManualQrUrl() {
  const url = document.getElementById('manualQrUrl').value.trim();
  if (url) handleQrDecoded(url);
}

// Photo file selected
function handleReceiptFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('photoPreviewImg').src = event.target.result;
    document.getElementById('photoPlaceholder').classList.add('hidden');
    document.getElementById('photoPreviewContainer').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function processReceiptPhoto() {
  const imgElement = document.getElementById('photoPreviewImg');
  if (!imgElement.src) return;

  showReceiptLoading(true);

  try {
    const res = await fetch('/api/receipt/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imgElement.src })
    });
    const data = await res.json();
    showReceiptLoading(false);

    if (data.success && data.receipt_data) {
      showReconciliationModal({
        source: 'photo_gemini',
        receipt_data: data.receipt_data,
        reconciliation: data.reconciliation
      });
    } else {
      alert(`Não foi possível processar a foto: ${data.error || 'Verifique se a chave de API do Gemini está configurada.'}`);
    }
  } catch (err) {
    showReceiptLoading(false);
    alert('Erro de conexão ao ler imagem com Gemini.');
  }
}

function showReceiptLoading(show) {
  const spinner = document.getElementById('receiptLoading');
  if (show) spinner.classList.remove('hidden');
  else spinner.classList.add('hidden');
}

// Display the Reconciliation Modal
function showReconciliationModal(data) {
  state.pendingReceiptData = data.receipt_data;
  state.pendingReconciliation = data.reconciliation;

  const container = document.getElementById('reconciliationContainer');
  container.classList.remove('hidden');

  const store = data.receipt_data.store_name || 'Supermercado';
  const total = (data.receipt_data.total_amount || 0).toFixed(2);
  const items = data.receipt_data.items || [];
  const matched = (data.reconciliation && data.reconciliation.matched) ? data.reconciliation.matched : [];

  let matchedHtml = '';
  if (matched.length > 0) {
    matchedHtml = `
      <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl mb-4">
        <h4 class="text-xs font-bold text-emerald-900 flex items-center gap-1.5 mb-2">
          <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i>
          Itens encontrados na sua Lista de Compras (${matched.length}):
        </h4>
        <p class="text-[11px] text-emerald-700 mb-2">Marque para dar baixa automática na lista:</p>
        <div class="space-y-1.5">
          ${matched.map(m => `
            <label class="flex items-center gap-2 text-xs text-slate-800 bg-white p-2 rounded-lg border border-emerald-100 cursor-pointer">
              <input type="checkbox" checked value="${m.shopping_item.id}" class="recon-checkbox rounded text-emerald-600 focus:ring-emerald-500">
              <span class="font-medium flex-1">${escapeHtml(m.shopping_item.name)}</span>
              <span class="text-slate-400 text-[10px]">Nota: ${escapeHtml(m.receipt_item.name)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    matchedHtml = `
      <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-xs text-slate-500">
        Nenhum item da sua lista ativa coincide com os itens desta nota (todos os ${items.length} itens serão salvos no seu histórico de preços).
      </div>
    `;
  }

  container.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-start justify-between border-b border-slate-100 pb-3">
        <div>
          <span class="text-[10px] uppercase font-bold tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Cupom Processado</span>
          <h3 class="text-base font-bold text-slate-800 mt-1">${escapeHtml(store)}</h3>
          <p class="text-xs text-slate-400">Total: R$ ${total} • ${items.length} itens comprados</p>
        </div>
        <button onclick="document.getElementById('reconciliationContainer').classList.add('hidden')" class="text-slate-400 hover:text-slate-600">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>

      ${matchedHtml}

      <div class="space-y-2">
        <h4 class="text-xs font-bold text-slate-700">Todos os itens identificados no cupom:</h4>
        <div class="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100 text-xs border border-slate-100 rounded-xl p-2 bg-slate-50/50">
          ${items.map(it => `
            <div class="py-1.5 flex justify-between items-center">
              <div>
                <p class="font-medium text-slate-800">${escapeHtml(it.name)}</p>
                <p class="text-[10px] text-slate-400">${formatQuantity(it.quantity, it.unit)} x R$ ${(it.unit_price || 0).toFixed(2)}</p>
              </div>
              <span class="font-bold text-slate-700">R$ ${(it.total_price || 0).toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <button 
        onclick="confirmReconciliation()" 
        class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 shadow-md transition"
      >
        <i data-lucide="check" class="w-4 h-4"></i> Confirmar e Dar Baixa na Lista
      </button>
    </div>
  `;

  initLucide();
  container.scrollIntoView({ behavior: 'smooth' });
}

// Confirm and save reconciliation
async function confirmReconciliation() {
  const checkboxes = document.querySelectorAll('.recon-checkbox:checked');
  const itemsToCheck = Array.from(checkboxes).map(cb => parseInt(cb.value));

  try {
    const res = await fetch('/api/receipt/confirm-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt_data: state.pendingReceiptData,
        items_to_check: itemsToCheck,
        source: 'processed'
      })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('reconciliationContainer').classList.add('hidden');
      showToast(`Sucesso! ${data.items_checked_off} itens baixados e histórico atualizado!`, 4000);
      await loadShoppingList();
      await loadProducts();
      await loadPantry();
      switchTab('tab-shopping');
    }
  } catch (err) {
    showToast('Erro ao salvar conciliação.');
  }
}

// ==================== TAB 3: PREÇOS & HISTÓRICO POR ITEM ====================
async function loadProducts(query = '') {
  try {
    const url = query ? `/api/products?q=${encodeURIComponent(query)}` : '/api/products';
    const res = await fetch(url);
    state.products = await res.json();
    renderProductsList();
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
  }
}

function handleSearchProducts(query) {
  loadProducts(query);
}

function renderProductsList() {
  const container = document.getElementById('productsListContainer');
  if (state.products.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <i data-lucide="receipt" class="w-10 h-10 mx-auto stroke-1 mb-2 opacity-50"></i>
        <p class="text-xs">Nenhum produto com histórico registrado ainda.</p>
        <p class="text-[11px] text-slate-400 mt-1">Escaneie cupons fiscais para alimentar o banco de preços automaticamente.</p>
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = state.products.map(prod => `
    <div 
      onclick="openProductDetailModal(${prod.id})" 
      class="p-3.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer transition shadow-sm"
    >
      <div class="min-w-0 pr-3">
        <h4 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(prod.display_name)}</h4>
        <p class="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
          <i data-lucide="store" class="w-3 h-3 text-slate-400"></i>
          Último: <span class="font-medium text-slate-700">${escapeHtml(prod.last_store || 'Supermercado')}</span>
          ${prod.last_purchased_at ? `• ${formatDate(prod.last_purchased_at)}` : ''}
        </p>
      </div>

      <div class="text-right">
        <span class="text-base font-extrabold text-emerald-600">
          R$ ${(prod.last_price || 0).toFixed(2)}
        </span>
        <p class="text-[10px] text-slate-400">Ver histórico ➔</p>
      </div>
    </div>
  `).join('');

  initLucide();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

// Open Item Price History Detail Modal
async function openProductDetailModal(productId) {
  try {
    const res = await fetch(`/api/products/${productId}/history`);
    const data = await res.json();
    const product = data.product;
    const history = data.history || [];

    document.getElementById('modalProductName').innerText = product.display_name;
    const modalContent = document.getElementById('modalProductContent');

    // Calculate min, max, average price
    let statsHtml = '';
    if (history.length > 0) {
      const prices = history.map(h => h.price);
      const minPrice = Math.min(...prices).toFixed(2);
      const maxPrice = Math.max(...prices).toFixed(2);
      const lastPrice = (product.last_price || history[0].price).toFixed(2);

      statsHtml = `
        <div class="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
          <div>
            <p class="text-[10px] text-slate-400 uppercase font-semibold">Último Pago</p>
            <p class="text-sm font-extrabold text-slate-800">R$ ${lastPrice}</p>
          </div>
          <div>
            <p class="text-[10px] text-slate-400 uppercase font-semibold">Menor Preço</p>
            <p class="text-sm font-extrabold text-emerald-600">R$ ${minPrice}</p>
          </div>
          <div>
            <p class="text-[10px] text-slate-400 uppercase font-semibold">Maior Preço</p>
            <p class="text-sm font-extrabold text-amber-600">R$ ${maxPrice}</p>
          </div>
        </div>
      `;
    }

    let historyListHtml = '';
    if (history.length === 0) {
      historyListHtml = '<p class="text-xs text-slate-400 text-center py-4">Nenhum registro detalhado.</p>';
    } else {
      historyListHtml = `
        <div class="space-y-2">
          <h4 class="text-xs font-bold text-slate-700">Histórico de todas as compras:</h4>
          <div class="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
            ${history.map((h, idx) => {
              // Calculate trend compared to previous purchase
              let trendIcon = '';
              if (idx < history.length - 1) {
                const prev = history[idx + 1].price;
                if (h.price > prev) trendIcon = '<span class="text-red-500 font-bold" title="Subiu">↗</span>';
                else if (h.price < prev) trendIcon = '<span class="text-emerald-500 font-bold" title="Caiu">↘</span>';
              }
              return `
                <div class="p-3 flex items-center justify-between hover:bg-slate-50 text-xs">
                  <div>
                    <p class="font-semibold text-slate-800 flex items-center gap-1.5">
                      ${escapeHtml(h.store_name)} ${trendIcon}
                    </p>
                    <p class="text-[10px] text-slate-400">${formatDate(h.purchase_date)} • ${h.quantity} ${h.unit || 'un'}</p>
                  </div>
                  <div class="text-right">
                    <p class="font-extrabold text-slate-900 text-sm">R$ ${h.price.toFixed(2)}</p>
                    <p class="text-[10px] text-slate-400">Total: R$ ${h.total_price.toFixed(2)}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    modalContent.innerHTML = `
      ${statsHtml}
      ${historyListHtml}
      <button onclick="addFromHistoryToShopping('${escapeHtml(product.display_name)}', '${product.category}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition">
        <i data-lucide="plus" class="w-4 h-4"></i> Adicionar este item à Lista de Compras
      </button>
    `;

    document.getElementById('productDetailModal').classList.remove('hidden');
    initLucide();
  } catch (err) {
    showToast('Erro ao carregar histórico do produto.');
  }
}

function closeProductDetailModal() {
  document.getElementById('productDetailModal').classList.add('hidden');
}

async function addFromHistoryToShopping(name, category) {
  try {
    await fetch('/api/shopping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, category: category })
    });
    closeProductDetailModal();
    showToast(`"${name}" adicionado à lista de compras!`);
    await loadShoppingList();
  } catch (err) {
    showToast('Erro ao adicionar à lista.');
  }
}

// ==================== TAB 4: RECEITAS & DESPENSA (CHEF GEMINI) ====================
async function loadPantry() {
  try {
    const res = await fetch('/api/pantry');
    state.pantry = await res.json();
    renderPantry();
  } catch (err) {
    console.error('Erro ao carregar despensa:', err);
  }
}

function renderPantry() {
  document.getElementById('pantryCountNum').innerText = state.pantry.length;
  const list = document.getElementById('pantryItemsList');
  if (state.pantry.length === 0) {
    list.innerHTML = '<p class="text-[11px] text-slate-400 py-1">Nenhum item registrado em casa ainda. Escaneie uma nota para registrar!</p>';
    return;
  }
  list.innerHTML = state.pantry.map(item => `
    <div class="flex items-center justify-between py-1 px-2 bg-slate-50 rounded-lg text-xs">
      <span class="font-medium text-slate-700">${escapeHtml(item.name)}</span>
      <span class="text-slate-400 text-[10px]">${formatQuantity(item.quantity, item.unit)} • ${formatDate(item.purchased_at)}</span>
    </div>
  `).join('');
}

async function requestRecipeSuggestions() {
  const craving = document.getElementById('recipeCravingInput').value.trim();
  const btn = document.getElementById('btnSuggestRecipes');
  const resultsContainer = document.getElementById('recipeResultsContainer');

  btn.disabled = true;
  btn.innerHTML = '<div class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div> Chef pensando nas melhores receitas...';

  try {
    const res = await fetch('/api/pantry/suggest-recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ craving: craving })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i> Sugerir Receitas com o que Tenho em Casa';

    if (data.recipes && data.recipes.length > 0) {
      renderRecipeResults(data.recipes);
    } else {
      resultsContainer.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Nenhuma receita sugerida. Tente especificar algum ingrediente.</p>';
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i> Sugerir Receitas com o que Tenho em Casa';
    alert('Erro ao solicitar receitas ao Gemini. Certifique-se de que configurou a chave de API nas Configurações.');
  }
}

function renderRecipeResults(recipes) {
  const container = document.getElementById('recipeResultsContainer');
  container.innerHTML = recipes.map((r, idx) => {
    const hasMissing = r.missing_ingredients && r.missing_ingredients.length > 0;
    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-800">${escapeHtml(r.title)}</h3>
            <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(r.description)}</p>
          </div>
          <span class="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full whitespace-nowrap">
            ⏱ ${escapeHtml(r.prep_time || '30 min')}
          </span>
        </div>

        <!-- Ingredients Available vs Missing -->
        <div class="space-y-1.5 text-xs">
          <div>
            <span class="font-semibold text-slate-700">O que você já tem em casa:</span>
            <div class="flex flex-wrap gap-1 mt-1">
              ${(r.available_ingredients_used || []).map(ing => `
                <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">✓ ${escapeHtml(ing)}</span>
              `).join('')}
            </div>
          </div>

          ${hasMissing ? `
            <div class="pt-1">
              <span class="font-semibold text-amber-800">Falta comprar para esta receita:</span>
              <div class="flex flex-wrap gap-1 mt-1">
                ${r.missing_ingredients.map(ing => `
                  <span class="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md text-[11px] font-medium">+ ${escapeHtml(ing)}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Instructions -->
        <details class="text-xs text-slate-600 pt-1">
          <summary class="font-semibold cursor-pointer text-emerald-700 hover:underline">Ver modo de preparo</summary>
          <ol class="list-decimal list-inside space-y-1 mt-2 pl-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
            ${(r.instructions || []).map(step => `
              <li class="leading-relaxed">${escapeHtml(step)}</li>
            `).join('')}
          </ol>
        </details>

        ${hasMissing ? `
          <button 
            onclick="addMissingToShopping(${JSON.stringify(r.missing_ingredients).replace(/"/g, '&quot;')}, ${JSON.stringify(r.title || '').replace(/"/g, '&quot;')})" 
            class="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-semibold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition"
          >
            <i data-lucide="shopping-cart" class="w-3.5 h-3.5 text-amber-700"></i> Adicionar faltantes à Lista de Compras
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  initLucide();
}

async function addMissingToShopping(ingredients, recipeTitle = '') {
  try {
    const res = await fetch('/api/shopping/add-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: ingredients, recipe: recipeTitle })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${data.added.length} ingredientes adicionados à lista de compras!`);
      await loadShoppingList();
    }
  } catch (err) {
    showToast('Erro ao adicionar faltantes.');
  }
}

// ==================== EXPORT FOR GOOGLE SHEETS & GEMINI GEM ====================
async function openExportModal() {
  try {
    const res = await fetch('/api/pantry/export', { method: 'POST' });
    const data = await res.json();
    state.exportData = data;
    document.getElementById('exportModal').classList.remove('hidden');
    initLucide();
  } catch (err) {
    showToast('Erro ao exportar despensa.');
  }
}

function closeExportModal() {
  document.getElementById('exportModal').classList.add('hidden');
}

function copyGeminiPrompt() {
  if (!state.exportData.gemini_prompt) return;
  navigator.clipboard.writeText(state.exportData.gemini_prompt).then(() => {
    showToast('Texto copiado! Cole diretamente na sua Gemini Gem.');
    closeExportModal();
  });
}

function downloadCsvFile() {
  if (!state.exportData.csv_text) return;
  const blob = new Blob([state.exportData.csv_text], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `despensa_mercado_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  showToast('Planilha CSV baixada para o seu dispositivo!');
  closeExportModal();
}

// ==================== TAB 5: CONFIGURAÇÕES ====================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    const badge = document.getElementById('geminiBadge');
    const keyBadge = document.getElementById('keyStatusBadge');

    if (data.gemini_configured) {
      badge.classList.remove('bg-amber-400');
      badge.classList.add('bg-emerald-400');
      badge.title = 'Gemini conectado';
      keyBadge.innerText = 'Ativa: ' + data.gemini_api_key_masked;
      keyBadge.classList.remove('bg-slate-200', 'text-slate-600');
      keyBadge.classList.add('bg-emerald-100', 'text-emerald-800');
    } else {
      badge.classList.remove('bg-emerald-400');
      badge.classList.add('bg-amber-400');
      badge.title = 'Configure sua chave Gemini';
      keyBadge.innerText = 'Não configurada';
      keyBadge.classList.remove('bg-emerald-100', 'text-emerald-800');
      keyBadge.classList.add('bg-amber-100', 'text-amber-800');
    }

    // Google Sheets settings UI
    const sheetsBadge = document.getElementById('sheetsStatusBadge');
    const webhookInput = document.getElementById('sheetsWebhookInput');
    if (data.google_sheets_webhook_url) {
      webhookInput.value = data.google_sheets_webhook_url;
      sheetsBadge.innerText = 'Conectado';
      sheetsBadge.classList.remove('bg-slate-200', 'text-slate-600');
      sheetsBadge.classList.add('bg-emerald-100', 'text-emerald-800');
    } else {
      sheetsBadge.innerText = 'Não configurado';
      sheetsBadge.classList.remove('bg-emerald-100', 'text-emerald-800');
      sheetsBadge.classList.add('bg-slate-200', 'text-slate-600');
    }
  } catch (err) {
    console.error('Erro ao ler configurações:', err);
  }
}

async function saveApiKey() {
  const input = document.getElementById('geminiApiKeyInput');
  const key = input.value.trim();
  if (!key) return;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gemini_api_key: key })
    });
    if (res.ok) {
      input.value = '';
      showToast('Chave de API salva com sucesso!');
      await loadSettings();
    }
  } catch (err) {
    showToast('Erro ao salvar chave.');
  }
}

async function saveSheetsSettings() {
  const webhook = document.getElementById('sheetsWebhookInput').value.trim();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_sheets_webhook_url: webhook })
    });
    if (res.ok) {
      showToast('Configurações da planilha salvas!');
      await loadSettings();
    }
  } catch (err) {
    showToast('Erro ao salvar.');
  }
}

function showErrorModal(title, message) {
  const modal = document.getElementById('errorModal');
  const titleEl = document.getElementById('errorModalTitle');
  const contentEl = document.getElementById('errorModalContent');
  if (modal && titleEl && contentEl) {
    titleEl.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-red-600"></i> ${title}`;
    contentEl.innerText = message;
    modal.classList.remove('hidden');
    initLucide();
  } else {
    alert(`${title}\n\n${message}`);
  }
}

function closeErrorModal() {
  const modal = document.getElementById('errorModal');
  if (modal) modal.classList.add('hidden');
}

function copyErrorModalText() {
  const contentEl = document.getElementById('errorModalContent');
  if (contentEl) {
    navigator.clipboard.writeText(contentEl.innerText);
    showToast('Mensagem copiada para a área de transferência!');
  }
}

async function triggerDirectSheetsSync() {
  const btn = document.getElementById('btnSyncSheetsNow');
  btn.disabled = true;
  btn.innerHTML = '<div class="inline-block animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent mr-1.5"></div> Sincronizando com Google Sheets...';

  try {
    const res = await fetch('/api/sheets/sync', { method: 'POST' });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Sincronizar com a Planilha Agora';
    initLucide();

    if (data.success) {
      showToast(`Sucesso! ${data.items_synced} itens atualizados na sua planilha online!`, 4000);
    } else {
      showErrorModal('Falha ao Sincronizar com a Planilha', data.error || 'Verifique a URL do webhook nas configurações.');
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Sincronizar com a Planilha Agora';
    initLucide();
    showErrorModal('Erro de Conexão', 'Não foi possível se comunicar com o servidor para sincronizar.');
  }
}

async function showAppsScriptGuide() {
  try {
    const res = await fetch('/api/sheets/template');
    const data = await res.json();
    document.getElementById('appsScriptCodeArea').value = data.template.trim();
    document.getElementById('appsScriptModal').classList.remove('hidden');
    initLucide();
  } catch (err) {
    showToast('Erro ao carregar script.');
  }
}

function closeAppsScriptModal() {
  document.getElementById('appsScriptModal').classList.add('hidden');
}

function copyAppsScriptCode() {
  const area = document.getElementById('appsScriptCodeArea');
  navigator.clipboard.writeText(area.value).then(() => {
    showToast('Código copiado para a área de transferência!');
  });
}
