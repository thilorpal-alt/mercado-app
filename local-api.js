/* Mercado PWA - API local (substitui o servidor Python). Dados ficam neste aparelho. */
(() => {
  const KEY = 'mercado.db.v1', realFetch = window.fetch.bind(window);
  let db, seed, P, syncTimer;
  const now = () => Date.now(), uid = () => now() * 1000 + Math.floor(Math.random() * 1000);
  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const cmp = (a, b) => a.localeCompare(b, 'pt');
  const guess = n => { n = n.toLowerCase(); for (const id in seed.keywords) if (seed.keywords[id].some(k => n.includes(k))) return seed.categories.find(c => c.id === id).name; return 'Mercearia e Despensa'; };

  const ready = (async () => {
    seed = await (await realFetch('catalogo.json')).json();
    P = await (await realFetch('prompts.json')).json();
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!db) {
      db = { shopping: [], del: {}, settings: {},
        catalog: seed.items.map(([n, c, u], i) => ({ id: i + 1, name: n, normalized_name: norm(n), category: c, default_unit: u, is_favorite: 0, u: 0 })) };
      save(false);
    }
    ['products', 'history', 'pantry', 'receipts'].forEach(t => db[t] = db[t] || []);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  })();

  function save(sync = true) { localStorage.setItem(KEY, JSON.stringify(db)); if (sync) queueSync(); }
  const rm = (t, id) => { db[t] = db[t].filter(r => r.id !== id); db.del[t + ':' + id] = now(); };
  const catalogFor = name => {
    const n = norm(name); let c = db.catalog.find(x => x.normalized_name === n); if (c) return c;
    db.catalog.forEach(x => { if (x.normalized_name.length >= 4 && n.includes(x.normalized_name) && (!c || x.normalized_name.length > c.normalized_name.length)) c = x; });
    return c || null;
  };
  const countBuy = (name, d) => { const c = catalogFor(name); if (c) { c.buy_count = Math.max(0, (c.buy_count || 0) + d); c.u = now(); } };
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

  const err = (m, st = 500) => [st, { error: m, success: false }];
  const today = () => new Date().toISOString().slice(0, 10);
  const pantryList = () => db.pantry.filter(r => !r.consumed).sort((a, c) => cmp(a.category, c.category) || c.purchased_at.localeCompare(a.purchased_at));

  async function gem(contents, sys) {
    const key = db.settings.gemini_api_key;
    if (!key) throw new Error('Chave de API do Gemini não configurada. Por favor, configure-a na tela de Configurações.');
    const body = JSON.stringify({ contents, systemInstruction: { parts: [{ text: sys }] }, generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } });
    let r;
    for (const m of ['gemini-2.5-flash', 'gemini-1.5-flash']) {
      r = await realFetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status !== 404) break;
    }
    if (!r.ok) { let t = await r.text(); try { t = JSON.parse(t).error.message; } catch (e) {} throw new Error(`Erro na API do Gemini (${r.status}): ${t}`); }
    const d = await r.json();
    return JSON.parse(d.candidates[0].content.parts[0].text.trim().replace(/^```json\s*/, '').replace(/```$/, ''));
  }
  function match(ri, si) {
    const nz = t => norm(t).replace(/[^\w\s]/g, ''), matched = [], un = [], rest = [...si];
    for (const r of ri) {
      const rc = nz(r.name || ''), rr = nz(r.raw_name || ''); let best = null, bs = 0;
      for (const s of rest) {
        const sc = nz(s.name); let v = 0;
        if (sc && rc && (sc === rc || rc.includes(sc) || sc.includes(rc))) v = 1;
        else if (sc && rr.includes(sc)) v = 0.9;
        else { const st = new Set(sc.split(/\s+/)), rt = new Set(rc.split(/\s+/)); v = [...st].filter(w => rt.has(w)).length / Math.max(st.size, 1); }
        if (v > bs && v >= 0.5) { bs = v; best = s; }
      }
      if (best) { matched.push({ shopping_item: best, receipt_item: r, confidence: bs }); rest.splice(rest.indexOf(best), 1); } else un.push(r);
    }
    return { matched, unmatched_receipt: un, remaining_shopping: rest };
  }
  async function sheetsSync() {
    const url = db.settings.google_sheets_webhook_url;
    if (!url) throw new Error('Nenhum método de sincronização com o Google Sheets está configurado nas Configurações.');
    const items = pantryList();
    await realFetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'update_pantry', items, synced_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }) });
    return { success: true, method: 'webhook', items_synced: items.length };
  }

  async function route(m, p, q, b) {
    let x;
    if (p === '/api/shopping') {
      if (m === 'GET') return { items: db.shopping.map(s => ({ ...s, buy_count: (catalogFor(s.name) || {}).buy_count || 0 })).sort((a, c) => a.checked - c.checked || cmp(a.category, c.category) || c.buy_count - a.buy_count || cmp(a.name, c.name)), categories: seed.categories };
      const name = (b.name || '').trim(); if (!name) return [400, { error: 'O nome do item é obrigatório', success: false }];
      const it = addShop(name, b.category || guess(name), parseFloat(b.quantity) || 1, b.unit || 'un', b.notes || ''); save(); return [201, it];
    }
    if (p === '/api/shopping/clear-completed') { db.shopping.filter(s => s.checked).forEach(s => rm('shopping', s.id)); save(); return { success: true }; }
    if (p === '/api/shopping/parse-voice') {
      const text = (b.text || '').trim(); if (!text) return err('Texto não informado', 400);
      let items;
      if (db.settings.gemini_api_key) { try { const r = await gem([{ parts: [{ text: `Itens falados pelo usuário: '${text}'` }] }], P.voice);
        if (Array.isArray(r.items)) items = r.items.map(i => ({ name: i.name, quantity: +i.quantity || 1, unit: i.unit || 'un', category: i.category || guess(i.name), notes: i.notes || '' })); } catch (e) {} }
      items = items || parseText(text);
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
      if (m === 'PUT' && it) {
        const was = it.checked ? 1 : 0;
        ['name', 'category', 'quantity', 'unit', 'notes', 'checked', 'unavailable'].forEach(k => { if (k in b) it[k] = b[k]; });
        if ('unavailable' in b && b.unavailable) it.checked = 0; else if ('checked' in b && b.checked) it.unavailable = 0;
        const nowC = it.checked ? 1 : 0; if (nowC !== was) countBuy(it.name, nowC ? 1 : -1);
        it.u = now(); save(); return it;
      }
    }
    if (p === '/api/catalog') {
      if (m === 'POST') { const name = (b.name || '').trim(); if (!name) return [400, { error: 'O nome do item é obrigatório', success: false }];
        const c = ensureCatalog(name, b.category, b.unit); save(); return [201, c]; }
      const qq = norm(q.get('q')), cat = q.get('category');
      const items = db.catalog.filter(c => (!qq || norm(c.name).includes(qq) || norm(c.category).includes(qq)) && (!cat || cat === 'all' || c.category === cat))
        .sort((a, c) => cmp(a.category, c.category) || (c.buy_count || 0) - (a.buy_count || 0) || cmp(a.name, c.name))
        .map(c => { const s = activeShop(c.name), pr = db.products.find(r => r.normalized_name === c.normalized_name); return { ...c, shopping_item_id: s ? s.id : null, shopping_quantity: s ? s.quantity : null, shopping_unit: s ? s.unit : null, last_price: pr ? pr.last_price : null, last_store: pr ? pr.last_store : null, in_shopping_list: !!s }; });
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
    if (p === '/api/products') { const qq = norm(q.get('q'));
      return db.products.filter(r => !qq || norm(r.display_name).includes(qq)).sort((a, c) => (c.last_purchased_at || '').localeCompare(a.last_purchased_at || '') || cmp(a.display_name, c.display_name)).slice(0, qq ? 999 : 50); }
    if ((x = p.match(/^\/api\/products\/(\d+)\/history$/))) {
      const pr = db.products.find(r => r.id === +x[1]); if (!pr) return [404, { error: 'Produto não encontrado', success: false }];
      return { product: pr, history: db.history.filter(h => h.product_id === pr.id).sort((a, c) => c.purchase_date.localeCompare(a.purchase_date) || c.id - a.id) }; }
    if (p === '/api/pantry') return pantryList();
    if ((x = p.match(/^\/api\/pantry\/(\d+)(?:\/(toggle))?$/))) {
      const id = +x[1], it = db.pantry.find(r => r.id === id);
      if (m === 'DELETE') { rm('pantry', id); save(); return { success: true, id }; }
      if (it) { it.consumed = it.consumed ? 0 : 1; it.u = now(); save(); } return { success: true }; }
    if (p === '/api/receipts') return [...db.receipts].sort((a, c) => c.purchase_date.localeCompare(a.purchase_date) || c.id - a.id).slice(0, 30);
    if (p === '/api/pantry/export') { const it = pantryList();
      return { gemini_prompt: 'Ingredientes disponíveis atualmente na minha despensa:\n' + it.map(i => `- ${i.name} (${i.quantity} ${i.unit}) [Comprado em: ${i.purchased_at}]\n`).join(''),
        csv_text: ['Produto,Categoria,Quantidade,Unidade,Data da Compra', ...it.map(i => `"${i.name}","${i.category}",${i.quantity},"${i.unit}","${i.purchased_at}"`)].join('\n'), items_count: it.length }; }
    if (p === '/api/sheets/template') return { template: P.sheets_template };
    if (p === '/api/sheets/sync') { try { return await sheetsSync(); } catch (e) { return err('Erro na sincronização com Google Sheets: ' + e.message); } }
    if (p === '/api/pantry/suggest-recipes') {
      let msg = 'Ingredientes disponíveis na minha casa agora:\n' + pantryList().map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ');
      if (b.craving) msg += `\n\nObservação ou preferência do usuário: Quero algo do tipo '${b.craving}'.`;
      try { return await gem([{ parts: [{ text: msg }] }], P.recipes); } catch (e) { return err('Erro ao sugerir receitas: ' + e.message); } }
    if (p === '/api/receipt/scan-qr') {
      const u = (b.url || '').trim(); if (!u) return err('URL do QR Code não informada', 400);
      let k = ''; try { k = (new URL(u).searchParams.get('p') || '').split('|')[0]; } catch (e) {}
      if (k.length !== 44) { const mm = u.match(/\d{44}/); k = mm ? mm[0] : ''; }
      return { qr_info: { url: u, access_key: k, uf: k.startsWith('42') ? 'SC' : 'Outro', cnpj: k.length === 44 ? k.slice(6, 20) : '', year_month: k.length === 44 ? `20${k.slice(2, 4)}-${k.slice(4, 6)}` : '' },
        parse_result: { success: false, needs_captcha: true, message: 'O navegador do celular não consegue consultar a SEFAZ diretamente. Use a opção Foto da Nota para leitura com IA!' }, reconciliation: null };
    }
    if (p === '/api/receipt/upload-photo') {
      let img = b.image_base64 || '', mime = 'image/jpeg'; if (!img) return err('Imagem não enviada', 400);
      if (img.includes(',')) { const h = img.split(',')[0]; img = img.split(',').slice(1).join(','); if (h.includes('png')) mime = 'image/png'; else if (h.includes('webp')) mime = 'image/webp'; }
      let rd; try { rd = await gem([{ parts: [{ inlineData: { mimeType: mime, data: img } }, { text: P.receipt_user }] }], P.receipt); } catch (e) { return err('Falha ao ler cupom fiscal: ' + e.message); }
      return { success: true, receipt_data: rd, reconciliation: match(rd.items || [], db.shopping.filter(s => !s.checked)) };
    }
    if (p === '/api/receipt/confirm-reconciliation') {
      const rd = b.receipt_data || {}, store = rd.store_name || 'Supermercado', date = rd.purchase_date || today(), items = rd.items || [], chk = b.items_to_check || [];
      const rec = { id: uid(), store_name: store, total_amount: +rd.total_amount || 0, purchase_date: date, source: b.source || 'photo_gemini', items_count: items.length, raw_json: JSON.stringify(rd), u: now() };
      db.receipts.push(rec);
      items.forEach(i => {
        const name = i.name || i.raw_name, n = norm(name), cat = i.category || guess(name), up = +i.unit_price || 0, qty = +i.quantity || 1, unit = i.unit || 'un', tot = +i.total_price || qty * up;
        let pr = db.products.find(r => r.normalized_name === n);
        const f = { display_name: name, category: cat, last_price: up, last_store: store, last_purchased_at: date, u: now() };
        if (pr) Object.assign(pr, f); else { pr = { id: uid(), normalized_name: n, ...f }; db.products.push(pr); }
        db.history.push({ id: uid(), product_id: pr.id, product_name: name, store_name: store, price: up, quantity: qty, unit, total_price: tot, purchase_date: date, receipt_id: rec.id, u: now() });
        db.pantry.push({ id: uid(), product_id: pr.id, name, category: cat, quantity: qty, unit, purchased_at: date, consumed: 0, u: now() });
      });
      const inCart = match(items, db.shopping.filter(s => s.checked)).matched.map(x => x.receipt_item);
      const viaList = new Map(match(items, db.shopping.filter(s => chk.includes(s.id))).matched.map(x => [x.receipt_item, x.shopping_item.name]));
      items.forEach(i => { if (!inCart.includes(i)) countBuy(viaList.get(i) || i.name || i.raw_name, 1); });
      chk.forEach(id => { const s = db.shopping.find(r => r.id === id); if (s) { s.checked = 1; s.u = now(); } });
      save(); sheetsSync().catch(() => {});
      return { success: true, receipt_id: rec.id, items_processed: items.length, items_checked_off: chk.length };
    }
    return [501, { error: 'Esta função (nota fiscal, Chef Gemini, planilha) chega na próxima etapa.', success: false }];
  }

  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, location.href);
    if (!u.pathname.includes('/api/') || u.origin !== location.origin) return realFetch(url, opts);
    await ready;
    let b = {}; try { b = JSON.parse(opts.body || '{}'); } catch (e) {}
    const p = u.pathname.slice(u.pathname.indexOf('/api/'));
    let r = await route((opts.method || 'GET').toUpperCase(), p, u.searchParams, b), s = 200;
    if (Array.isArray(r) && typeof r[0] === 'number') { s = r[0]; r = r[1]; }
    return new Response(JSON.stringify(r), { status: s, headers: { 'Content-Type': 'application/json' } });
  };

  /* ---------- Backup e sincronização ---------- */
  const TB = ['shopping', 'catalog', 'products', 'history', 'pantry', 'receipts'];
  const payload = () => ({ v: 1, del: db.del, ...Object.fromEntries(TB.map(t => [t, db[t]])) });
  function mergeIn(o) {
    const del = { ...db.del }; for (const k in (o.del || {})) del[k] = Math.max(del[k] || 0, o.del[k]);
    for (const t of TB) {
      const mp = new Map();
      for (const r of [...db[t], ...(o[t] || [])]) { const e = mp.get(r.id); if (!e || (r.u || 0) > (e.u || 0)) mp.set(r.id, r); }
      let list = [...mp.values()].filter(r => !(del[t + ':' + r.id] >= (r.u || 0) && del[t + ':' + r.id]));
      if (t === 'catalog') { const seen = new Set(); list = list.sort((a, c) => a.id - c.id).filter(r => !seen.has(r.normalized_name) && seen.add(r.normalized_name)); }
      db[t] = list;
    }
    const byN = {}, remap = {};
    db.products = db.products.sort((a, c) => a.id - c.id).filter(r => { if (byN[r.normalized_name]) { remap[r.id] = byN[r.normalized_name]; return false; } byN[r.normalized_name] = r.id; return true; });
    ['history', 'pantry'].forEach(t => db[t].forEach(r => { if (remap[r.product_id]) r.product_id = remap[r.product_id]; }));
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
