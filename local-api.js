/* Mercado PWA - API local (substitui o servidor Python). Dados ficam neste aparelho. */
(() => {
  const KEY = 'mercado.db.v1', realFetch = window.fetch.bind(window);
  let db, seed, syncTimer;
  const now = () => Date.now(), uid = () => now() * 1000 + Math.floor(Math.random() * 1000);
  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const cmp = (a, b) => a.localeCompare(b, 'pt');
  const guess = n => { n = n.toLowerCase(); for (const id in seed.keywords) if (seed.keywords[id].some(k => n.includes(k))) return seed.categories.find(c => c.id === id).name; return 'Mercearia e Despensa'; };

  const ready = (async () => {
    seed = await (await realFetch('catalogo.json')).json();
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!db) {
      db = { shopping: [], del: {}, settings: {},
        catalog: seed.items.map(([n, c, u], i) => ({ id: i + 1, name: n, normalized_name: norm(n), category: c, default_unit: u, is_favorite: 0, u: 0 })) };
      save(false);
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  })();

  function save(sync = true) { localStorage.setItem(KEY, JSON.stringify(db)); if (sync) queueSync(); }
  const rm = (t, id) => { db[t] = db[t].filter(r => r.id !== id); db.del[t + ':' + id] = now(); };
  const activeShop = name => db.shopping.find(s => !s.checked && norm(s.name) === norm(name));

  function ensureCatalog(name, category, unit) {
    const n = norm(name); if (!n) return null;
    let c = db.catalog.find(x => x.normalized_name === n);
    if (!c) { c = { id: uid(), name: name.trim(), normalized_name: n, category: category || guess(name), default_unit: unit || 'un', is_favorite: 0, u: now() }; db.catalog.push(c); }
    return c;
  }
  function addShop(name, category, quantity = 1, unit = 'un', notes = '') {
    ensureCatalog(name, category, unit);
    const it = { id: uid(), name, category, quantity, unit, notes, checked: 0, u: now() };
    db.shopping.push(it); return it;
  }
  function parseText(t) {
    const re = /^([\d.,]+)\s*(?:(quilos|quilo|kilos|kilo|kg|gramas|g|litros|litro|l|caixas|caixa|cx|pacotes|pacote|pct|unidades|unidade|un)\b\s*)?(?:de\s+)?(.+)$/i;
    return t.split(/[,;\n]|\s+e\s+/i).map(s => s.trim()).filter(Boolean).map(s => {
      s = s.replace(/^(comprar|adicionar|pegar|preciso de|falta)\s+/i, '');
      const m = s.match(re); let q = 1, u = 'un', n = s;
      if (m) { q = parseFloat(m[1].replace(',', '.')) || 1; const r = (m[2] || 'un').toLowerCase();
        u = /^(quilo|kilo|kg)/.test(r) ? 'kg' : /^(gramas|g)$/.test(r) ? 'g' : /^(litro|l)/.test(r) ? 'l' : /^(caixa|cx)/.test(r) ? 'cx' : /^(pacote|pct)/.test(r) ? 'pct' : 'un'; n = m[3]; }
      n = n.trim(); n = n[0].toUpperCase() + n.slice(1);
      return { name: n, quantity: q, unit: u, category: guess(n), notes: '' };
    });
  }

  function route(m, p, q, b) {
    let x;
    if (p === '/api/shopping') {
      if (m === 'GET') return { items: [...db.shopping].sort((a, c) => a.checked - c.checked || cmp(a.category, c.category) || c.id - a.id), categories: seed.categories };
      const name = (b.name || '').trim(); if (!name) return [400, { error: 'O nome do item é obrigatório', success: false }];
      const it = addShop(name, b.category || guess(name), parseFloat(b.quantity) || 1, b.unit || 'un', b.notes || ''); save(); return [201, it];
    }
    if (p === '/api/shopping/clear-completed') { db.shopping.filter(s => s.checked).forEach(s => rm('shopping', s.id)); save(); return { success: true }; }
    if (p === '/api/shopping/parse-voice') {
      const items = parseText((b.text || '').trim());
      if (b.auto_add !== false) { items.forEach(i => addShop(i.name, i.category, i.quantity, i.unit, i.notes)); save(); }
      return { parsed_items: items, count: items.length, added_to_list: b.auto_add !== false };
    }
    if (p === '/api/shopping/add-missing') {
      const note = b.recipe ? 'Para a receita: ' + b.recipe : 'Sugerido pelo Chef para receita', added = [];
      (b.ingredients || []).forEach(n => { n = (n || '').trim(); if (n) { addShop(n, guess(n), 1, 'un', note); added.push(n); } });
      save(); return { success: true, added };
    }
    if ((x = p.match(/^\/api\/shopping\/(\d+)$/))) {
      const id = +x[1], it = db.shopping.find(s => s.id === id);
      if (m === 'DELETE') { rm('shopping', id); save(); return { success: true, id }; }
      if (m === 'PUT' && it) { ['name', 'category', 'quantity', 'unit', 'notes', 'checked'].forEach(k => { if (k in b) it[k] = b[k]; }); it.u = now(); save(); return it; }
    }
    if (p === '/api/catalog') {
      if (m === 'POST') { const name = (b.name || '').trim(); if (!name) return [400, { error: 'O nome do item é obrigatório', success: false }];
        const c = ensureCatalog(name, b.category, b.unit); save(); return [201, c]; }
      const qq = norm(q.get('q')), cat = q.get('category');
      const items = db.catalog.filter(c => (!qq || norm(c.name).includes(qq) || norm(c.category).includes(qq)) && (!cat || cat === 'all' || c.category === cat))
        .sort((a, c) => cmp(a.category, c.category) || cmp(a.name, c.name))
        .map(c => { const s = activeShop(c.name); return { ...c, shopping_item_id: s ? s.id : null, shopping_quantity: s ? s.quantity : null, shopping_unit: s ? s.unit : null, last_price: null, last_store: null, in_shopping_list: !!s }; });
      return { items, categories: seed.categories, total_count: items.length, active_in_list_count: items.filter(i => i.in_shopping_list).length };
    }
    if ((x = p.match(/^\/api\/catalog\/(\d+)(?:\/(toggle-shopping|add-shopping))?$/))) {
      const id = +x[1], c = db.catalog.find(r => r.id === id);
      if (!c) return [404, { error: 'Item do catálogo não encontrado' }];
      if (m === 'DELETE') { rm('catalog', id); save(); return { success: true, id }; }
      const s = activeShop(c.name), out = { success: true, item_name: c.name, in_shopping_list: true, quantity: 1 };
      if (x[2] === 'toggle-shopping' && s) { rm('shopping', s.id); save(); return { ...out, action: 'removed', in_shopping_list: false }; }
      if (x[2] === 'add-shopping' && s) { s.quantity += 1; s.u = now(); save(); return { ...out, action: 'incremented', quantity: s.quantity, message: `+1 ${c.name} (${s.quantity} ${c.default_unit}) na lista!` }; }
      const n = addShop(c.name, c.category, 1, c.default_unit); save(); return { ...out, action: 'added', shopping_item_id: n.id, message: `${c.name} adicionado à lista viva!` };
    }
    if (p === '/api/settings') {
      const S = db.settings;
      if (m === 'POST') { ['gemini_api_key', 'google_sheets_webhook_url', 'google_sheets_id'].forEach(k => { if (k in b) S[k] = (b[k] || '').trim(); }); save(false); return { success: true, message: 'Configurações salvas neste aparelho!' }; }
      const k = S.gemini_api_key || '';
      return { gemini_configured: !!k, gemini_api_key_masked: k.length > 8 ? k.slice(0, 4) + '...' + k.slice(-4) : (k ? 'Configurada' : ''),
        google_sheets_webhook_url: S.google_sheets_webhook_url || '', google_sheets_id: '', has_service_account: false };
    }
    if (['/api/products', '/api/pantry', '/api/receipts'].includes(p)) return [];
    if (p === '/api/pantry/export') return { gemini_prompt: '', csv_text: '', items_count: 0 };
    if (p === '/api/sheets/template') return { template: '' };
    return [501, { error: 'Esta função (nota fiscal, Chef Gemini, planilha) chega na próxima etapa.', success: false }];
  }

  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, location.href);
    if (!u.pathname.includes('/api/') || u.origin !== location.origin) return realFetch(url, opts);
    await ready;
    let b = {}; try { b = JSON.parse(opts.body || '{}'); } catch (e) {}
    const p = u.pathname.slice(u.pathname.indexOf('/api/'));
    let r = route((opts.method || 'GET').toUpperCase(), p, u.searchParams, b), s = 200;
    if (Array.isArray(r) && typeof r[0] === 'number') { s = r[0]; r = r[1]; }
    return new Response(JSON.stringify(r), { status: s, headers: { 'Content-Type': 'application/json' } });
  };

  /* ---------- Backup e sincronização ---------- */
  const payload = () => ({ v: 1, shopping: db.shopping, catalog: db.catalog, del: db.del });
  function mergeIn(o) {
    const del = { ...db.del }; for (const k in (o.del || {})) del[k] = Math.max(del[k] || 0, o.del[k]);
    for (const t of ['shopping', 'catalog']) {
      const mp = new Map();
      for (const r of [...db[t], ...(o[t] || [])]) { const e = mp.get(r.id); if (!e || (r.u || 0) > (e.u || 0)) mp.set(r.id, r); }
      let list = [...mp.values()].filter(r => !(del[t + ':' + r.id] >= (r.u || 0) && del[t + ':' + r.id]));
      if (t === 'catalog') { const seen = new Set(); list = list.sort((a, c) => a.id - c.id).filter(r => !seen.has(r.normalized_name) && seen.add(r.normalized_name)); }
      db[t] = list;
    }
    db.del = del;
  }
  const status = t => { const e = document.getElementById('syncStatus'); if (e) e.textContent = t; };
  const refresh = () => { if (window.loadShoppingList) loadShoppingList(); if (window.loadCatalog) loadCatalog(); };
  function queueSync() { clearTimeout(syncTimer); if (db.settings.backup_url) syncTimer = setTimeout(() => syncDrive(true).catch(() => {}), 8000); }

  /* Leitura via <script> (JSONP): não depende de CORS, que o Apps Script não garante */
  const jsonp = (url, code) => new Promise((res, rej) => {
    const cb = '__mcb' + now(), el = document.createElement('script');
    const end = () => { clearTimeout(t); delete window[cb]; el.remove(); };
    const t = setTimeout(() => { end(); rej(new Error('o Apps Script não respondeu')); }, 25000);
    window[cb] = d => { end(); res(d); };
    el.onerror = () => { end(); rej(new Error('não consegui carregar o Apps Script (confira se o acesso é "Qualquer pessoa")')); };
    el.src = url + (url.includes('?') ? '&' : '?') + 'code=' + encodeURIComponent(code || '') + '&callback=' + cb;
    document.head.appendChild(el);
  });

  window.syncDrive = async (silent) => {
    await ready; const { backup_url: url, backup_code: code } = db.settings;
    if (!url) { status('Configure a URL do Apps Script primeiro.'); return; }
    if (!navigator.onLine) { status('Sem internet. Sincroniza quando voltar.'); return; }
    try {
      if (!silent) status('Sincronizando...');
      const r = await jsonp(url, code);
      if (!r.ok) throw new Error('código secreto não confere');
      if (r.data) mergeIn(r.data);
      save(false);
      await realFetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code, data: payload() }) });
      status('Sincronizado às ' + new Date().toLocaleTimeString('pt-BR')); refresh();
    } catch (e) { status('Falha ao sincronizar: ' + e.message); }
  };
  window.saveBackupSettings = async () => {
    await ready; db.settings.backup_url = document.getElementById('backupUrlInput').value.trim();
    db.settings.backup_code = document.getElementById('backupCodeInput').value.trim(); save(false); syncDrive();
  };
  window.exportBackup = async () => {
    await ready; const f = new File([JSON.stringify(payload())], 'mercado-backup-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'Backup Mercado' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
  };
  window.importBackup = async (ev) => {
    await ready; const f = ev.target.files[0]; if (!f) return;
    try { mergeIn(JSON.parse(await f.text())); save(); refresh(); status('Backup importado e mesclado.'); } catch (e) { status('Arquivo de backup inválido.'); }
    ev.target.value = '';
  };
  window.addEventListener('online', () => queueSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queueSync(); });
  document.addEventListener('DOMContentLoaded', async () => {
    await ready; const u = document.getElementById('backupUrlInput'), c = document.getElementById('backupCodeInput');
    if (u) { u.value = db.settings.backup_url || ''; c.value = db.settings.backup_code || ''; } queueSync();
  });
})();
