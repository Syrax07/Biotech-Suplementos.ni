(function () {
  'use strict';

  const stateKeys = new Set([
    'products', 'categories', 'orders', 'expenses', 'currency', 'shipping', 'promos',
    'activityLog', 'storeSettings', 'suppliers', 'supplierPurchases', 'supplierLedger',
    'customerExtras', 'productReviews'
  ]);
  const config = window.BIOTECH_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '')
    && typeof config.publishableKey === 'string' && config.publishableKey.length > 20;
  const revisions = new Map();
  const pendingWrites = new Map();
  const pendingLocalKeys = new Set();
  const conflicts = new Map();
  const touchedLocalValues = new Map();
  const initialLocalKeys = new Set([...stateKeys].filter(key => localStorage.getItem(`biotech_${key}`) !== null));
  const touchedLocalKeys = new Set();
  const migrationMarkerKey = 'biotech_cloud_migrated_keys_v1';
  let migratedLocalKeys = new Set();
  try { migratedLocalKeys = new Set(JSON.parse(localStorage.getItem(migrationMarkerKey) || '[]')); } catch { /* Treat an invalid marker as no completed imports. */ }
  let client = null;
  let session = null;
  let isAdmin = false;
  let hydrating = false;
  let statusNode = null;
  let realtimeChannel = null;
  let publicRefreshTimer = null;
  let adminRefreshTimer = null;
  let writeTimer = null;
  let flushInProgress = false;

  function setStatus(message, error = false) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.error = error ? 'true' : 'false';
  }

  function applyState(key, value) {
    if (!stateKeys.has(key)) return;
    switch (key) {
      case 'products': products = Array.isArray(value) ? value : []; break;
      case 'categories':
        if (Array.isArray(value)) subcategoryMap = Object.fromEntries(value.map(row => [row.name, Array.isArray(row.subcategories) ? row.subcategories : []]).filter(([name]) => name));
        break;
      case 'orders': orders = Array.isArray(value) ? value : []; break;
      case 'expenses': expenses = Array.isArray(value) ? value : []; break;
      case 'currency': currency = typeof value === 'string' ? value : 'USD'; break;
      case 'shipping': shipping = value && typeof value === 'object' ? value : { fee: 3, freeFrom: 60 }; break;
      case 'promos': promos = Array.isArray(value) ? value : []; break;
      case 'activityLog': activityLog = Array.isArray(value) ? value : []; break;
      case 'storeSettings': storeSettings = value && typeof value === 'object' ? value : storeSettings; break;
      case 'suppliers': suppliers = Array.isArray(value) ? value : []; break;
      case 'supplierPurchases': supplierPurchases = Array.isArray(value) ? value : []; break;
      case 'supplierLedger': supplierLedger = Array.isArray(value) ? value : []; break;
      case 'customerExtras': customerExtras = Object.assign({}, customerExtras, value || {}); break;
      case 'productReviews': productReviews = Array.isArray(value) ? value : []; break;
    }
  }

  function markLocalMigrated(key) {
    if (!stateKeys.has(key)) return;
    migratedLocalKeys.add(key);
    localStorage.setItem(migrationMarkerKey, JSON.stringify([...migratedLocalKeys]));
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function emptyValueFor(key) {
    const defaults = {
      products: [], categories: [], orders: [], expenses: [], currency: 'USD',
      shipping: { fee: 3, freeFrom: 60 }, promos: [], activityLog: [],
      storeSettings: typeof storeSettings === 'object' ? storeSettings : {},
      suppliers: [], supplierPurchases: [], supplierLedger: [],
      customerExtras: typeof customerExtras === 'object' ? customerExtras : {}, productReviews: []
    };
    return defaults[key];
  }

  function redrawAfterHydration() {
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof renderPromoStrip === 'function') renderPromoStrip();
    if (typeof applyStoreSettings === 'function') applyStoreSettings();
    if (typeof updateCustomerFooter === 'function') updateCustomerFooter();
    if (typeof whatsappMarkup === 'function') whatsappMarkup();
    if (isAdmin && document.getElementById('admin')?.classList.contains('show') && typeof renderAdmin === 'function') {
      document.getElementById('currency').value = currency;
      renderAdmin();
    }
  }

  async function fetchAdminState() {
    const { data, error } = await client.from('business_state').select('state_key,value,version');
    if (error) throw error;
    const remoteKeys = new Set((data || []).map(row => row.state_key));
    for (const row of data || []) {
      revisions.set(row.state_key, Number(row.version));
      pendingLocalKeys.delete(row.state_key);
      const pendingValue = pendingWrites.get(row.state_key);
      if (pendingValue !== undefined && stableJson(pendingValue) !== stableJson(row.value)) {
        conflicts.set(row.state_key, row);
        continue;
      }
      const raw = localStorage.getItem(`biotech_${row.state_key}`);
      let localValue;
      try { localValue = raw === null ? undefined : JSON.parse(raw); } catch { localValue = null; }
      if (raw !== null && !migratedLocalKeys.has(row.state_key) && stableJson(localValue) !== stableJson(row.value)) {
        conflicts.set(row.state_key, row);
        continue;
      }
      if (raw !== null) markLocalMigrated(row.state_key);
      if (pendingValue !== undefined) {
        pendingWrites.delete(row.state_key);
        touchedLocalValues.delete(row.state_key);
        touchedLocalKeys.delete(row.state_key);
      }
      conflicts.delete(row.state_key);
      applyState(row.state_key, row.value);
    }
    for (const key of stateKeys) {
      if (remoteKeys.has(key)) continue;
      if (pendingWrites.has(key)) {
        pendingLocalKeys.delete(key);
        continue;
      }
      revisions.delete(key);
      conflicts.delete(key);
      if ((!migratedLocalKeys.has(key) && initialLocalKeys.has(key)) || touchedLocalKeys.has(key)) {
        pendingLocalKeys.add(key);
        continue;
      }
      pendingLocalKeys.delete(key);
      applyState(key, emptyValueFor(key));
    }
    redrawAfterHydration();
    updateAdminControls();
    return remoteKeys;
  }

  async function flushPendingWrites() {
    if (!client || !isAdmin || flushInProgress || !pendingWrites.size) return;
    flushInProgress = true;
    const batch = [...pendingWrites.entries()];
    pendingWrites.clear();
    const changes = batch.map(([key, value]) => ({ key, value, expectedVersion: revisions.get(key) || 0 }));
    try {
      const { data, error } = await client.rpc('save_business_state_batch', { p_changes: changes });
      if (error) {
        for (const [key, value] of batch) if (!pendingWrites.has(key)) pendingWrites.set(key, value);
        setStatus('Hay cambios sin sincronizar; conserva un respaldo y reintenta.', true);
        if (error.code === '40001') await fetchAdminState().catch(() => {});
        return;
      }
      for (const row of data || []) {
        revisions.set(row.key, Number(row.version));
        pendingLocalKeys.delete(row.key);
        touchedLocalKeys.delete(row.key);
        touchedLocalValues.delete(row.key);
        markLocalMigrated(row.key);
      }
      setStatus('Sincronizado con la nube');
      if (changes.some(change => change.key === 'products')) await refreshPublicCatalog();
    } catch (error) {
      for (const [key, value] of batch) if (!pendingWrites.has(key)) pendingWrites.set(key, value);
      console.error('BioTech cloud write failed', error);
      setStatus('Sin conexión con la nube; mantén esta pestaña abierta y exporta un respaldo antes de salir.', true);
    } finally {
      flushInProgress = false;
      updateAdminControls();
      if (pendingWrites.size) writeTimer = setTimeout(flushPendingWrites, 180);
    }
  }

  function queuePersistence(storageKey, json) {
    const key = storageKey.slice('biotech_'.length);
    if (!stateKeys.has(key) || !isAdmin || hydrating) return;
    let value;
    try { value = JSON.parse(json); } catch { return; }
    touchedLocalKeys.add(key);
    touchedLocalValues.set(key, value);
    if (pendingLocalKeys.has(key)) {
      setStatus('Hay datos locales pendientes de importar; no se sobrescribieron.', true);
      return;
    }
    if (conflicts.has(key)) {
      setStatus('Hay diferencias entre la nube y este navegador; resuélvelas antes de editar.', true);
      return;
    }
    pendingWrites.set(key, value);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushPendingWrites, 180);
  }

  function patchLocalStorage() {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && typeof key === 'string' && key.startsWith('biotech_')) {
        const stateKey = key.slice('biotech_'.length);
        if (configured && stateKeys.has(stateKey)) {
          if (isAdmin && !hydrating) queuePersistence(key, String(value));
          return;
        }
      }
      originalSetItem.call(this, key, value);
      if (this === window.localStorage && typeof key === 'string' && key.startsWith('biotech_')) {
        queuePersistence(key, String(value));
      }
    };
  }

  function safeText(value, maxLength) { return String(value || '').trim().slice(0, maxLength); }

  function ensureAdminLogin() {
    document.getElementById('biotechCloudLogin')?.remove();
    const modal = document.createElement('div');
    modal.id = 'biotechCloudLogin';
    modal.className = 'overlay show';
    const cloudReady = configured && Boolean(client);
    const heading = cloudReady ? 'Acceso de administración' : 'Administración no configurada';
    const content = cloudReady
      ? `<form class="checkout" onsubmit="window.BioTechCloud.login(event)"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button class="cta">INICIAR SESIÓN</button><p class="fine">El acceso se valida con Supabase Auth y el rol de administrador de la base de datos.</p></form>`
      : `<p>Primero configura <b>cloud-config.js</b> y aplica la migración SQL de Supabase. El panel queda bloqueado hasta que Auth y RLS estén activos.</p><button class="admin-action" onclick="document.getElementById('biotechCloudLogin').remove()">Cerrar</button>`;
    const pendingBackupNote = pendingWrites.size || touchedLocalValues.size
      ? '<div class="fine"><p>Hay cambios pendientes de sincronizar. Descarga una copia antes de salir o cerrar esta pestaña.</p><button type="button" class="admin-action" onclick="window.BioTechCloud.exportBackup()">Descargar respaldo</button></div>'
      : '';
    modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:92vh;max-width:460px"><div class="drawer-head"><h2>${heading}</h2><button class="close" onclick="document.getElementById('biotechCloudLogin').remove()" aria-label="Cerrar">×</button></div>${content}${pendingBackupNote}<p class="fine" id="biotechCloudLoginError" role="alert"></p></div>`;
    document.body.appendChild(modal);
  }

  async function checkAdminRole() {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) return false;
    session = sessionData.session;
    const { data: allowed, error } = await client.rpc('is_biotech_admin');
    if (error || allowed !== true) {
      await client.auth.signOut();
      session = null;
      return false;
    }
    isAdmin = true;
    return true;
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = safeText(form.elements.email.value, 254);
    const password = form.elements.password.value;
    form.elements.password.value = '';
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return showLoginError('No se pudo iniciar sesión. Revisa el correo y la contraseña.');
    session = data.session;
    const { data: allowed, error: roleError } = await client.rpc('is_biotech_admin');
    if (roleError || allowed !== true) {
      await client.auth.signOut();
      session = null;
      return showLoginError('La cuenta no tiene rol de administrador.');
    }
    isAdmin = true;
    document.getElementById('biotechCloudLogin')?.remove();
    try {
      await fetchAdminState();
      installAdminControls();
      window._biotechRealOpenAdmin?.();
      setStatus('Sesión administrativa segura');
      connectRealtime();
    } catch (loadError) {
      setStatus('No se pudieron cargar los datos de la nube.', true);
      console.error('BioTech cloud load failed', loadError);
    }
  }

  function showLoginError(message) {
    const error = document.getElementById('biotechCloudLoginError');
    if (error) error.textContent = message;
  }

  function installAdminControls() {
    const header = document.querySelector('#admin .admin-top');
    if (!header || header.querySelector('.cloud-admin-controls')) return;
    const controls = document.createElement('div');
    controls.className = 'cloud-admin-controls';
    controls.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto';
    controls.innerHTML = `<span class="fine" data-cloud-status>Conectando…</span><button type="button" class="admin-action" data-cloud-sync hidden onclick="window.BioTechCloud.syncNow()">Reintentar sincronización</button><button type="button" class="admin-action" data-cloud-resolve hidden onclick="window.BioTechCloud.resolveConflicts()">Resolver diferencias</button><button type="button" class="admin-action" onclick="window.BioTechCloud.exportBackup()">Respaldo</button><button type="button" class="admin-action" onclick="window.BioTechCloud.importLocal()">Importar datos locales</button><button type="button" class="admin-action" onclick="window.BioTechCloud.logout()">Cerrar sesión</button>`;
    header.appendChild(controls);
    statusNode = controls.querySelector('[data-cloud-status]');
    setStatus('Sincronizado con la nube');
    updateAdminControls();
  }

  function updateAdminControls() {
    const resolveButton = document.querySelector('[data-cloud-resolve]');
    const syncButton = document.querySelector('[data-cloud-sync]');
    if (resolveButton) resolveButton.hidden = conflicts.size === 0;
    if (syncButton) syncButton.hidden = pendingWrites.size === 0;
    if (statusNode && (pendingWrites.size || pendingLocalKeys.size || conflicts.size)) {
      setStatus(conflicts.size
        ? `${conflicts.size} diferencia(s): conserva una copia antes de cargar la nube.`
        : pendingWrites.size ? `${pendingWrites.size} cambio(s) sin sincronizar.`
          : `${pendingLocalKeys.size} colección(es) local(es) pendientes de importar.`, true);
    }
  }

  function downloadJson(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function currentStateSnapshot() {
    const snapshot = {
      products, categories: Object.entries(subcategoryMap).map(([name, subcategories]) => ({ name, subcategories })),
      orders, expenses, currency, shipping, promos, activityLog, storeSettings,
      suppliers, supplierPurchases, supplierLedger, customerExtras, productReviews
    };
    for (const [key, value] of touchedLocalValues) snapshot[key] = value;
    for (const [key, value] of pendingWrites) snapshot[key] = value;
    return snapshot;
  }

  function localSnapshot() {
    const data = {};
    for (const key of stateKeys) {
      if (migratedLocalKeys.has(key) && !touchedLocalValues.has(key) && !pendingWrites.has(key)) continue;
      if (!initialLocalKeys.has(key) && !touchedLocalKeys.has(key)) continue;
      if (pendingWrites.has(key)) { data[key] = pendingWrites.get(key); continue; }
      if (touchedLocalValues.has(key)) { data[key] = touchedLocalValues.get(key); continue; }
      const storageKey = `biotech_${key}`;
      const raw = localStorage.getItem(storageKey);
      if (raw === null) continue;
      try { data[key] = JSON.parse(raw); } catch { /* Keep invalid local records out of an import. */ }
    }
    return data;
  }

  async function resolveConflicts() {
    if (!conflicts.size) return;
    const localData = {};
    for (const key of conflicts.keys()) {
      if (touchedLocalValues.has(key)) localData[key] = touchedLocalValues.get(key);
      else try { localData[key] = JSON.parse(localStorage.getItem(`biotech_${key}`)); } catch { localData[key] = null; }
    }
    downloadJson(`biotech-respaldo-local-${new Date().toISOString().slice(0, 10)}.json`, {
      format: 'biotech-local-conflict-backup-v1', exportedAt: new Date().toISOString(), data: localData
    });
    if (!confirm('Se descargó un respaldo de este navegador. ¿Cargar ahora aquí los valores actuales de la nube?')) return;
    for (const [key, row] of conflicts) {
      pendingWrites.delete(key);
      applyState(key, row.value);
      pendingLocalKeys.delete(key);
      touchedLocalKeys.delete(key);
      touchedLocalValues.delete(key);
      markLocalMigrated(key);
    }
    conflicts.clear();
    redrawAfterHydration();
    updateAdminControls();
    setStatus('Se cargó la copia de la nube; el respaldo local quedó separado.');
  }

  async function migrateLegacyProductGalleries(productRows) {
    if (!Array.isArray(productRows) || typeof getProductGallery !== 'function') return;
    for (const product of productRows) {
      if (!product.image?.startsWith('biotech-photo:')) continue;
      const gallery = await getProductGallery(product.id).catch(() => []);
      if (!gallery.length) continue;
      const uploaded = await uploadProductImages(product.id, gallery, { stablePath: true });
      product.image = uploaded.urls[0] || '';
      product.gallery = uploaded.urls;
      product.imagePaths = uploaded.paths;
    }
  }

  function exportBackup() {
    const snapshot = currentStateSnapshot();
    downloadJson(`biotech-respaldo-${new Date().toISOString().slice(0, 10)}.json`, {
      format: 'biotech-business-backup-v1', exportedAt: new Date().toISOString(), data: snapshot
    });
  }

  async function importLocal() {
    if (!isAdmin) return ensureAdminLogin();
    const snapshot = localSnapshot();
    const productWasSaved = Object.hasOwn(snapshot, 'products');
    if (!productWasSaved) delete snapshot.products;
    const entries = Object.entries(snapshot);
    if (!entries.length) return toast('No hay datos guardados en este navegador para importar. Los productos visibles de demostración no se importarán.');
    const { data: existing, error } = await client.from('business_state').select('state_key,version');
    if (error) return toast('No se pudo comprobar qué datos ya existen en la nube. No se importó nada.');
    const existingKeys = new Set((existing || []).map(row => row.state_key));
    const entriesToImport = entries.filter(([key]) => !existingKeys.has(key));
    if (!entriesToImport.length) return toast('La nube ya tiene estas colecciones. No se reemplazó ningún dato local ni remoto.');
    if (!confirm(`Se descargará primero un respaldo y luego se copiarán ${entriesToImport.length} colecciones que aún no existen en la nube. Las colecciones ya existentes no se reemplazarán. ¿Continuar?`)) return;
    downloadJson(`biotech-respaldo-local-${new Date().toISOString().slice(0, 10)}.json`, {
      format: 'biotech-local-backup-v1', exportedAt: new Date().toISOString(), data: snapshot
    });
    setStatus('Importando copia; no cierres esta pestaña…');
    try {
      if (productWasSaved && !existingKeys.has('products')) {
        setStatus('Copiando las fotos locales a Storage…');
        await migrateLegacyProductGalleries(snapshot.products);
      }
      for (const [key, value] of entriesToImport) {
        const { data: version, error: saveError } = await client.rpc('save_business_state', {
          p_state_key: key, p_value: value, p_expected_version: 0
        });
        if (saveError) throw saveError;
        revisions.set(key, Number(version));
        pendingLocalKeys.delete(key);
        touchedLocalKeys.delete(key);
        touchedLocalValues.delete(key);
        markLocalMigrated(key);
        applyState(key, value);
      }
      await fetchAdminState();
      setStatus('Datos importados sin reemplazar la nube');
      toast('Importación terminada. Se conservaron los datos locales y la copia de respaldo.');
    } catch (error) {
      console.error('BioTech local import failed', error);
      setStatus('Importación incompleta; puedes reintentar sin reemplazar la nube.', true);
      toast('La importación se detuvo. Los datos locales se conservaron.');
    }
  }

  async function refreshPublicCatalog() {
    const { data, error } = await client.rpc('public_catalog');
    if (error) throw error;
    products = Array.isArray(data) ? data : [];
    renderProducts();
  }

  async function refreshPublicSettings() {
    const { data, error } = await client.rpc('public_storefront_settings');
    if (error) throw error;
    if (data?.currency) currency = data.currency;
    if (data?.shipping) shipping = data.shipping;
    if (data?.storeSettings) storeSettings = Object.assign({}, storeSettings, data.storeSettings);
    if (data?.customerExtras) customerExtras = Object.assign({}, customerExtras, data.customerExtras);
    if (typeof applyStoreSettings === 'function') applyStoreSettings();
    if (typeof updateCustomerFooter === 'function') updateCustomerFooter();
    if (typeof whatsappMarkup === 'function') whatsappMarkup();
  }

  async function refreshPublicCategories() {
    const { data, error } = await client.rpc('public_categories');
    if (error) throw error;
    if (Array.isArray(data)) {
      const rows = data.map(row => ({ name: row.name, subcategories: Array.isArray(row.subcategories) ? row.subcategories : [] }));
      subcategoryMap = Object.fromEntries(rows.map(row => [row.name, row.subcategories]));
    }
  }

  async function refreshPublicPromotions() {
    const { data, error } = await client.rpc('public_promotions');
    if (error) throw error;
    promos = Array.isArray(data) ? data : [];
    renderPromoStrip();
  }

  async function refreshPublicReviews() {
    const { data, error } = await client.rpc('public_product_reviews');
    if (error) throw error;
    productReviews = Array.isArray(data) ? data : [];
    if (typeof renderProducts === 'function') renderProducts();
  }

  async function loadPublicData() {
    try {
      await Promise.all([refreshPublicCatalog(), refreshPublicSettings(), refreshPublicCategories(), refreshPublicPromotions(), refreshPublicReviews()]);
      renderProducts();
    } catch (error) {
      console.error('BioTech public cloud load failed', error);
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.currentTarget));
    const items = Object.entries(cart).filter(([, qty]) => Number(qty) > 0).map(([id, qty]) => ({ id, qty: Number(qty) }));
    if (!items.length) return toast('Tu bolsa está vacía.');
    const requestSignature = JSON.stringify({ items, formData, promo: appliedPromo?.code || '' });
    const webCrypto = window.crypto;
    let signatureHash = '';
    if (webCrypto?.subtle) {
      try {
        const hash = await webCrypto.subtle.digest('SHA-256', new TextEncoder().encode(requestSignature));
        signatureHash = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      } catch { /* The server still validates the order if hashing is unavailable. */ }
    }
    let requestId = sessionStorage.getItem('biotech_orderRequestId');
    if (!requestId || (signatureHash && sessionStorage.getItem('biotech_orderRequestHash') !== signatureHash)) {
      if (webCrypto?.randomUUID) requestId = webCrypto.randomUUID();
      else {
        const bytes = webCrypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
        requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
      sessionStorage.setItem('biotech_orderRequestId', requestId);
      if (signatureHash) sessionStorage.setItem('biotech_orderRequestHash', signatureHash);
    }
    const { data, error } = await client.rpc('create_public_order', {
      p_customer: {
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        deliveryDate: formData.deliveryDate || '',
        payment: formData.payment,
        marketingOptIn: formData.marketingOptIn === 'on'
      },
      p_items: items,
      p_promo_code: appliedPromo?.code || '',
      p_request_id: requestId
    });
    if (error) {
      toast(error.message?.includes('disponibilidad') ? 'Cambió la disponibilidad. Actualiza tu bolsa.' : 'No se pudo registrar el pedido. Conservamos tu bolsa para intentar de nuevo.');
      return;
    }
    const order = {
      id: data.id,
      date: new Date().toISOString(),
      name: formData.name,
      phone: formData.phone,
      address: formData.address,
      deliveryDate: formData.deliveryDate || '',
      payment: formData.payment,
      marketingOptIn: formData.marketingOptIn === 'on',
      items: items.map(({ id, qty }) => {
        const product = products.find(row => row.id === id);
        const preorderQty = Math.max(0, qty - Number(product?.stock || 0));
        return {
          id, name: product?.name || id, qty, preorder: preorderQty > 0, preorderQty,
          price: Number(product?.price) || 0, arrivalDate: product?.arrivalDate || ''
        };
      }),
      subtotal: Number(data.subtotal) || 0,
      shipping: Number(data.shipping) || 0,
      discount: Number(data.discount) || 0,
      promoCode: String(data.promoCode || ''),
      total: Number(data.total) || 0,
      currency: String(data.currency || currency),
      status: 'Pendiente'
    };
    orders.unshift(order);
    cart = {}; appliedPromo = null;
    sessionStorage.removeItem('biotech_orderRequestId');
    sessionStorage.removeItem('biotech_orderRequestHash');
    localStorage.setItem('biotech_cart', '{}');
    await refreshPublicCatalog().catch(error => console.error('Catalog refresh after order failed', error));
    updateBag(); closeCart(); renderProducts();
    toast(`Pedido ${data.id} registrado. ¡Gracias por elegir BioTech!`);
    if (typeof chooseOrderWhatsApp === 'function') chooseOrderWhatsApp(order);
  }

  async function submitReview(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const { error } = await client.rpc('submit_public_review', {
      p_product_id: activeReviewProduct,
      p_display_name: safeText(form.name, 60) || 'Cliente',
      p_rating: Math.max(1, Math.min(5, Number(form.rating) || 5)),
      p_body: safeText(form.text, 600)
    });
    if (error) return toast('No se pudo enviar la opinión. Inténtalo de nuevo.');
    document.getElementById('reviewModal')?.remove();
    toast('Gracias. Tu opinión quedó pendiente de revisión.');
  }

  async function uploadProductImages(productId, files, options = {}) {
    if (!isAdmin || !client) throw new Error('Se requiere una sesión de administrador.');
    const safeId = String(productId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const urls = [], paths = [];
    for (const [index, file] of [...files].entries()) {
      if (!file?.type?.startsWith('image/') || file.size > 8 * 1024 * 1024) throw new Error('Archivo de imagen no válido.');
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' })[file.type];
      if (!ext) throw new Error('Formato no permitido; usa JPG, PNG, WebP o AVIF.');
      const path = options.stablePath
        ? `legacy/${safeId}/${index}.${ext}`
        : `${safeId}/${Date.now()}-${index}.${ext}`;
      const { error } = await client.storage.from('product-images').upload(path, file, { contentType: file.type, upsert: Boolean(options.stablePath) });
      if (error) throw error;
      const { data } = client.storage.from('product-images').getPublicUrl(path);
      urls.push(data.publicUrl); paths.push(path);
    }
    return { urls, paths };
  }

  async function logout() {
    if (!client) return;
    if (pendingWrites.size || touchedLocalValues.size) {
      await flushPendingWrites();
      if (pendingWrites.size || touchedLocalValues.size) {
        if (!confirm('Hay cambios que no llegaron a la nube. Se descargará un respaldo antes de cerrar sesión. ¿Continuar?')) return;
        exportBackup();
      }
    }
    clearTimeout(writeTimer);
    clearInterval(adminRefreshTimer);
    await client.auth.signOut();
    session = null; isAdmin = false; revisions.clear();
    realtimeChannel && client.removeChannel(realtimeChannel);
    document.getElementById('admin')?.classList.remove('show');
    document.querySelector('.cloud-admin-controls')?.remove();
    ensureAdminLogin();
  }

  function connectRealtime() {
    if (!client || realtimeChannel) return;
    realtimeChannel = client.channel('biotech-business-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_state' }, payload => {
        if (!isAdmin || !payload.new?.state_key) return;
        revisions.set(payload.new.state_key, Number(payload.new.version));
        const pendingValue = pendingWrites.get(payload.new.state_key);
        if (pendingValue !== undefined && stableJson(pendingValue) !== stableJson(payload.new.value)) {
          conflicts.set(payload.new.state_key, payload.new);
          updateAdminControls();
          return;
        }
        const raw = localStorage.getItem(`biotech_${payload.new.state_key}`);
        let localValue;
        try { localValue = raw === null ? undefined : JSON.parse(raw); } catch { localValue = null; }
        if (raw !== null && !migratedLocalKeys.has(payload.new.state_key) && stableJson(localValue) !== stableJson(payload.new.value)) {
          conflicts.set(payload.new.state_key, payload.new);
          updateAdminControls();
          return;
        }
        if (raw !== null) markLocalMigrated(payload.new.state_key);
        if (pendingValue !== undefined) {
          pendingWrites.delete(payload.new.state_key);
          touchedLocalValues.delete(payload.new.state_key);
          touchedLocalKeys.delete(payload.new.state_key);
        }
        conflicts.delete(payload.new.state_key);
        applyState(payload.new.state_key, payload.new.value);
        redrawAfterHydration();
        updateAdminControls();
      })
      .subscribe();
    adminRefreshTimer = setInterval(() => {
      if (isAdmin && !document.hidden && !flushInProgress) fetchAdminState().catch(error => console.error('BioTech cloud refresh failed', error));
    }, 20000);
  }

  function start() {
    patchLocalStorage();
    window.addEventListener('online', () => flushPendingWrites());
    window.addEventListener('beforeunload', event => {
      if (!pendingWrites.size && !touchedLocalValues.size && !flushInProgress) return;
      event.preventDefault();
      event.returnValue = '';
    });
    if (!configured || !window.supabase?.createClient) return;
    client = window.supabase.createClient(config.url, config.publishableKey);
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (!nextSession) {
        const wasAdmin = isAdmin;
        isAdmin = false;
        clearInterval(adminRefreshTimer);
        adminRefreshTimer = null;
        if (realtimeChannel) client.removeChannel(realtimeChannel);
        realtimeChannel = null;
        if (wasAdmin) {
          document.getElementById('admin')?.classList.remove('show');
          document.querySelector('.cloud-admin-controls')?.remove();
          statusNode = null;
          products = []; orders = []; expenses = []; activityLog = [];
          suppliers = []; supplierPurchases = []; supplierLedger = [];
          productReviews = []; storeSettings = {}; customerExtras = {};
          loadPublicData();
        }
        return;
      }
      setTimeout(async () => {
        try {
          const allowed = await checkAdminRole();
          if (allowed) {
            await fetchAdminState(); installAdminControls(); connectRealtime();
          }
        } catch (error) { console.error('BioTech session validation failed', error); }
      }, 0);
    });
    client.auth.getSession().then(async ({ data, error }) => {
      if (error) return console.error('BioTech auth session failed', error);
      session = data.session;
      if (session && await checkAdminRole()) {
        try { await fetchAdminState(); installAdminControls(); connectRealtime(); }
        catch (loadError) { console.error('BioTech cloud load failed', loadError); }
      } else {
        await loadPublicData();
        publicRefreshTimer = setInterval(() => { if (!document.hidden && !isAdmin) loadPublicData(); }, 60000);
      }
    });
  }

  window.BioTechCloud = {
    get configured() { return configured; },
    get isAdmin() { return isAdmin; },
    get client() { return client; },
    login,
    logout,
    importLocal,
    resolveConflicts,
    syncNow: flushPendingWrites,
    exportBackup,
    uploadProductImages,
    refreshPublicCatalog,
    submitOrder,
    submitReview
  };
  if (typeof window.openAdmin === 'function') {
    window._biotechRealOpenAdmin = window.openAdmin.bind(window);
    window.openAdmin = async function () {
      if (!configured || !client) return ensureAdminLogin();
      if (!isAdmin && !(await checkAdminRole())) return ensureAdminLogin();
      try {
        await fetchAdminState();
        installAdminControls();
        connectRealtime();
        return window._biotechRealOpenAdmin();
      } catch (error) {
        setStatus('No se pudieron comprobar el rol o los datos.', true);
        return ensureAdminLogin();
      }
    };
  }
  if (typeof window.placeOrder === 'function') {
    const localPlaceOrder = window.placeOrder;
    window.placeOrder = function (event) {
      if (!configured || !client) return localPlaceOrder(event);
      return submitOrder(event);
    };
  }
  if (typeof window.submitProductReview === 'function') {
    const localSubmitReview = window.submitProductReview;
    window.submitProductReview = function (event) {
      if (!configured || !client) return localSubmitReview(event);
      return submitReview(event);
    };
  }
  start();
})();

