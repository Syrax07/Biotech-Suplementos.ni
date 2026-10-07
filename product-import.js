(() => {
  'use strict';

  const datasetUrl = new URL('./data/fitshop-2026-09-24.json', document.currentScript?.src || window.location.href);
  const datasetId = 'fitshop-2026-09-24';
  const datasetLabel = 'Fitshop · 24/09/2026';
  const descriptiveFields = ['ean', 'name', 'description', 'brand', 'productName', 'variant', 'presentation', 'weight', 'servings', 'pdfDescription'];
  const pageSize = 20;
  let datasetPromise = null;
  let importPage = 0;
  let imagePage = 0;
  let activeTab = false;

  function normalizeBarcode(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function isMissing(value, field) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') return false;
    const text = String(value).trim().toLowerCase();
    if (!text) return true;
    return field === 'name' && ['producto nuevo', 'sin nombre', 'producto'].includes(text);
  }

  function hasPhoto(product) {
    return Boolean(product && (product.image || product.gallery?.length || product.imagePaths?.length));
  }

  function imageKind(product) {
    if (!hasPhoto(product)) return 'none';
    if (product.imageOrigin === 'automatic' || product.imageAudit?.origin === 'automatic') return 'automatic';
    if (product.imageOrigin === 'manual' || product.imageOrigin === 'manual-url' || product.imagePaths?.length || product.image?.startsWith('biotech-photo:')) return 'manual';
    return 'unknown';
  }

  function getImportHistory(product) {
    return Array.isArray(product?.sourceImports) ? product.sourceImports : [];
  }

  function inspect(products, records) {
    const byCode = new Map();
    const inputCount = new Map();
    for (const product of products || []) {
      const code = normalizeBarcode(product.barcode || product.ean);
      if (!code) continue;
      byCode.set(code, [...(byCode.get(code) || []), product]);
    }
    for (const item of records || []) {
      const code = normalizeBarcode(item.ean || item.barcode);
      inputCount.set(code, (inputCount.get(code) || 0) + 1);
    }
    const rows = (records || []).map(item => {
      const code = normalizeBarcode(item.ean || item.barcode);
      const existing = byCode.get(code) || [];
      const duplicatePdf = !code || inputCount.get(code) !== 1;
      const duplicateStore = existing.length > 1;
      const product = existing.length === 1 ? existing[0] : null;
      const missingFields = product ? descriptiveFields.filter(field => item[field] !== null && item[field] !== undefined && isMissing(product[field], field)) : [];
      return {
        item,
        code,
        product,
        duplicatePdf,
        duplicateStore,
        missingFields,
        action: duplicatePdf || duplicateStore ? 'duplicate' : !product ? 'new' : missingFields.length ? 'update' : 'existing'
      };
    });
    const verifiedImages = rows.filter(row => row.product?.imageVerified === true && hasPhoto(row.product)).length;
    return {
      rows,
      totals: {
        total: rows.length,
        new: rows.filter(row => row.action === 'new').length,
        updated: rows.filter(row => row.action === 'update').length,
        existing: rows.filter(row => row.action === 'existing').length,
        duplicatesAvoided: rows.filter(row => row.action === 'duplicate').length,
        imagesFound: verifiedImages,
        imagesPending: rows.length - verifiedImages,
        categoriesPending: rows.filter(row => !row.product?.category).length,
        errors: rows.filter(row => !row.code || !row.item.description).length
      }
    };
  }

  function appendImportAudit(product, item, action, importedAt) {
    const history = getImportHistory(product);
    if (history.some(entry => entry.datasetId === datasetId)) return product;
    const sourceImports = [...history, {
      datasetId,
      sourceFile: 'Herramienta de Gestión de Inventario al 24-09-2026 vendedores.pdf',
      sourceDate: '2026-09-24',
      importedAt,
      sourcePage: item.pdfPage,
      suggestedCategory: item.category || null,
      suggestedSubcategory: item.subcategory || null,
      action,
      rawDescription: item.pdfDescription || item.description
    }];
    return { ...product, sourceImports };
  }

  function apply(records, currentProducts, importedAt = new Date().toISOString()) {
    const products = Array.isArray(currentProducts) ? currentProducts : [];
    const checked = inspect(products, records);
    const nextProducts = [...products];
    const resultRows = [];
    for (const row of checked.rows) {
      if (row.action === 'duplicate') {
        resultRows.push({ ean: row.code, name: row.item.name, action: 'duplicate-skipped', categorySuggestion: row.item.category || null, subcategorySuggestion: row.item.subcategory || null, imageStatus: 'pending' });
        continue;
      }
      if (row.product) {
        const index = nextProducts.findIndex(product => product === row.product);
        let product = { ...row.product };
        for (const field of row.missingFields) product[field] = row.item[field];
        product = appendImportAudit(product, row.item, row.missingFields.length ? 'descriptive-fields-completed' : 'matched-existing', importedAt);
        if (!hasPhoto(product) && !product.imageAudit) product.imageAudit = { status: 'pending', origin: 'none', updatedAt: null };
        nextProducts[index] = product;
        resultRows.push({ ean: row.code, name: row.item.name, action: row.missingFields.length ? 'updated' : getImportHistory(row.product).some(entry => entry.datasetId === datasetId) ? 'already-imported' : 'existing', imageStatus: product.imageVerified === true && hasPhoto(product) ? 'verified' : hasPhoto(product) ? 'existing-unverified' : 'pending' });
        continue;
      }
      let id = `fitshop-${row.code}`;
      let suffix = 2;
      while (nextProducts.some(product => product.id === id)) id = `fitshop-${row.code}-${suffix++}`;
      let product = {
        id,
        barcode: row.code,
        ean: row.code,
        name: row.item.name,
        description: row.item.description,
        brand: row.item.brand,
        productName: row.item.productName,
        variant: row.item.variant,
        presentation: row.item.presentation,
        weight: row.item.weight,
        servings: row.item.servings,
        category: '',
        subcategory: '',
        categorySuggestion: row.item.category || '',
        subcategorySuggestion: row.item.subcategory || '',
        pdfDescription: row.item.pdfDescription,
        price: null,
        cost: null,
        stock: 0,
        incoming: 0,
        allowPreorder: false,
        image: '',
        gallery: [],
        imagePaths: [],
        imageOrigin: 'none',
        imageAudit: { status: 'pending', origin: 'none', updatedAt: null },
        status: 'draft',
        published: false,
        tag: 'Revisar',
        sourceImports: []
      };
      product = appendImportAudit(product, row.item, 'created-draft', importedAt);
      nextProducts.push(product);
      resultRows.push({ ean: row.code, name: row.item.name, action: 'created-draft', categorySuggestion: row.item.category || null, subcategorySuggestion: row.item.subcategory || null, imageStatus: 'pending' });
    }
    const finalRows = inspect(nextProducts, records).rows;
    const verifiedImages = finalRows.filter(row => row.product?.imageVerified === true && hasPhoto(row.product)).length;
    const totals = {
      total: checked.totals.total,
      new: resultRows.filter(row => row.action === 'created-draft').length,
      updated: resultRows.filter(row => row.action === 'updated').length,
      existing: resultRows.filter(row => ['existing', 'already-imported'].includes(row.action)).length,
      imagesFound: verifiedImages,
      imagesPending: checked.totals.total - verifiedImages,
      errors: checked.totals.errors,
      duplicatesAvoided: resultRows.filter(row => row.action === 'duplicate-skipped').length,
      categoriesPending: finalRows.filter(row => !row.product?.category).length
    };
    return { products: nextProducts, rows: resultRows, totals, importedAt };
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }

  async function loadDataset() {
    if (!datasetPromise) {
      datasetPromise = fetch(datasetUrl.href, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('No se pudo cargar el archivo preparado del PDF.');
        return response.json();
      }).then(data => {
        if (data.datasetId !== datasetId || !Array.isArray(data.products) || data.products.length !== data.productCount) throw new Error('El archivo de importación no pasó la validación.');
        const forbiddenKey = /^(price|cost|stock|margin|profit|public|combo|intermed\.?|key\s?partner|supplierprice)$/i;
        for (const product of data.products) {
          if (!/^\d{8,14}$/.test(normalizeBarcode(product.ean)) || !product.description) throw new Error('El archivo contiene un EAN o una descripción inválida.');
          if (Object.keys(product).some(key => forbiddenKey.test(key))) throw new Error('El archivo contiene un campo que no está permitido.');
        }
        return data;
      });
    }
    return datasetPromise;
  }

  function downloadJson(filename, data) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  function selectAdminTab() {
    const button = document.querySelector('.admin-tab[data-tab="product-import"]');
    if (!button) return;
    document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('.admin-panel').forEach(item => item.classList.toggle('active', item.id === 'panel-product-import'));
    activeTab = true;
    renderProductImport();
  }

  function addAdminTab() {
    const tabs = document.querySelector('.admin-tabs');
    const panels = document.querySelector('.admin-main');
    if (!tabs || !panels) return;
    let button = tabs.querySelector('[data-tab="product-import"]');
    if (!button) {
      button = document.createElement('button');
      button.className = 'admin-tab';
      button.dataset.tab = 'product-import';
      button.textContent = 'Importar catálogo';
      button.onclick = selectAdminTab;
      tabs.appendChild(button);
    }
    if (!document.getElementById('panel-product-import')) {
      const panel = document.createElement('div');
      panel.id = 'panel-product-import';
      panel.className = 'admin-panel';
      panels.appendChild(panel);
    }
    if (tabs.dataset.productImportBound !== 'true') {
      tabs.addEventListener('click', event => {
        const item = event.target.closest('.admin-tab');
        if (item && item.dataset.tab !== 'product-import') activeTab = false;
      });
      tabs.dataset.productImportBound = 'true';
    }
  }

  function classifyRow(row) {
    if (row.action === 'duplicate') return 'EAN duplicado · omitido';
    if (row.action === 'new') return 'Nuevo · borrador';
    if (row.action === 'update') return `Completa ${row.missingFields.length} campo(s)`;
    return 'Ya existe';
  }

  function renderPdfRows() {
    const host = document.getElementById('pdfImportRows');
    if (!host || !window._biotechPdfImportDataset) return;
    const query = document.getElementById('pdfImportSearch')?.value.trim().toLowerCase() || '';
    const filter = document.getElementById('pdfImportFilter')?.value || 'all';
    const preview = inspect(products, window._biotechPdfImportDataset.products);
    let rows = preview.rows.filter(row => {
      if (query && !`${row.code} ${row.item.name} ${row.item.brand || ''} ${row.item.variant || ''}`.toLowerCase().includes(query)) return false;
      return filter === 'all' || row.action === filter;
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    importPage = Math.min(importPage, totalPages - 1);
    rows = rows.slice(importPage * pageSize, (importPage + 1) * pageSize);
    host.innerHTML = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>EAN</th><th>Producto / descripción original</th><th>Marca</th><th>Formato</th><th>Categoría sugerida · revisar</th><th>Resultado</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.code)}</td><td><strong>${esc(row.item.name)}</strong><small>${esc(row.item.pdfDescription)}</small></td><td>${esc(row.item.brand || 'Pendiente')}</td><td>${esc([row.item.weight, row.item.presentation, row.item.servings ? `${row.item.servings} servicios` : ''].filter(Boolean).join(' · ') || 'Pendiente')}</td><td>${esc(row.item.category || 'Pendiente')}<small>${esc(row.item.subcategory || 'Revisar subcategoría')}</small></td><td>${esc(classifyRow(row))}</td></tr>`).join('')}</tbody></table></div><div class="admin-bar"><button class="admin-action" ${importPage <= 0 ? 'disabled' : ''} onclick="changePdfImportPage(-1)">Anterior</button><span>${importPage + 1} / ${totalPages} · ${preview.totals.total} códigos del PDF</span><button class="admin-action" ${importPage >= totalPages - 1 ? 'disabled' : ''} onclick="changePdfImportPage(1)">Siguiente</button></div>` : '<div class="empty">No hay productos para esta búsqueda.</div>';
  }

  function imageFilterMatches(product, filter) {
    const kind = imageKind(product);
    const imported = getImportHistory(product).length > 0;
    if (filter === 'none') return kind === 'none';
    if (filter === 'manual') return kind === 'manual';
    if (filter === 'automatic') return kind === 'automatic';
    if (filter === 'unknown') return kind === 'unknown';
    if (filter === 'imported') return imported;
    return true;
  }

  function imageStatusText(product) {
    const kind = imageKind(product);
    if (kind === 'none') return 'Pendiente';
    if (product.imageVerified === true) return 'Verificada';
    if (kind === 'manual') return 'Manual · revisar';
    if (kind === 'automatic') return 'Automática · revisar';
    return 'Existente · origen sin confirmar';
  }

  function renderImageRows() {
    const host = document.getElementById('productImageRows');
    if (!host) return;
    const query = document.getElementById('productImageSearch')?.value.trim().toLowerCase() || '';
    const filter = document.getElementById('productImageFilter')?.value || 'all';
    let rows = products.filter(product => {
      if (!imageFilterMatches(product, filter)) return false;
      return !query || `${product.barcode || product.ean || ''} ${product.name || ''} ${product.brand || ''} ${product.variant || ''}`.toLowerCase().includes(query);
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    imagePage = Math.min(imagePage, totalPages - 1);
    const shown = rows.slice(imagePage * pageSize, (imagePage + 1) * pageSize);
    host.innerHTML = shown.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>EAN</th><th>Producto</th><th>Imagen</th><th>Fuente (administración)</th><th>Acciones</th></tr></thead><tbody>${shown.map(product => `<tr><td>${esc(product.barcode || product.ean || '—')}</td><td><strong>${esc(product.name || '')}</strong><small>${esc(product.brand || '')}${product.variant ? ` · ${esc(product.variant)}` : ''}</small></td><td>${imageStatusText(product)}</td><td>${product.imageSourceDomain ? esc(product.imageSourceDomain) : '—'}${product.imageUpdatedAt ? `<small>${esc(new Date(product.imageUpdatedAt).toLocaleDateString('es-NI'))}</small>` : ''}</td><td><button class="admin-action" onclick="searchProductImage('${esc(product.id)}')">Buscar por EAN</button> <button class="admin-action" onclick="productForm('${esc(product.id)}')">Editar / foto</button></td></tr>`).join('')}</tbody></table></div><div class="admin-bar"><button class="admin-action" ${imagePage <= 0 ? 'disabled' : ''} onclick="changeImagePage(-1)">Anterior</button><span>${imagePage + 1} / ${totalPages} · ${rows.length} productos</span><button class="admin-action" ${imagePage >= totalPages - 1 ? 'disabled' : ''} onclick="changeImagePage(1)">Siguiente</button></div>` : '<div class="empty">No hay productos en este filtro.</div>';
  }

  function renderProductImport() {
    const panel = document.getElementById('panel-product-import');
    if (!panel) return;
    const cloud = window.BioTechCloud;
    const ready = Boolean(cloud?.configured && cloud?.isAdmin);
    const preview = window._biotechPdfImportDataset ? inspect(products, window._biotechPdfImportDataset.products) : null;
    panel.innerHTML = `<div class="admin-bar"><div><strong>Catálogo del PDF · 24/09/2026</strong><small>${preview ? `${preview.totals.total} productos · 0 datos financieros` : 'Cargando lista…'}</small></div><button class="admin-action" onclick="downloadPdfImportReport()" ${preview ? '' : 'disabled'}>Descargar reporte</button></div>${!cloud?.configured ? '<p class="fine">La conexión Supabase no está configurada. La revisión está disponible; la importación requiere una sesión administrativa en la nube.</p>' : !cloud.isAdmin ? '<p class="fine">Inicia sesión como administrador para importar cambios.</p>' : ''}<div id="pdfImportSummary" class="admin-bar"></div><div class="admin-bar"><label>Buscar EAN, marca o producto<input id="pdfImportSearch" type="search" oninput="renderPdfImportRows()"></label><label>Resultado<select id="pdfImportFilter" onchange="resetPdfImportPage()"><option value="all">Todos</option><option value="new">Nuevos</option><option value="update">Fichas por completar</option><option value="existing">Ya existentes</option><option value="duplicate">EAN duplicados</option></select></label><button class="cta" style="margin:0" onclick="importPdfCatalog()" ${ready && preview && preview.totals.total ? '' : 'disabled'}>IMPORTAR AL CATÁLOGO</button></div><div id="pdfImportRows" class="product-import-list"></div><div class="admin-bar" style="margin-top:28px"><div><strong>Revisión de imágenes</strong><small>Fuentes originales visibles solo en administración.</small></div></div><div class="admin-bar"><label>Buscar EAN, marca o producto<input id="productImageSearch" type="search" oninput="renderProductImageRows()"></label><label>Estado de imagen<select id="productImageFilter" onchange="resetImagePage()"><option value="all">Todas</option><option value="none">Sin imagen</option><option value="manual">Manual</option><option value="automatic">Automática</option><option value="unknown">Origen sin confirmar</option><option value="imported">Importados del PDF</option></select></label></div><div id="productImageRows" class="product-import-list"></div>`;
    if (preview) {
      document.getElementById('pdfImportSummary').innerHTML = `<span>${preview.totals.new} nuevos</span><span>${preview.totals.updated} por completar</span><span>${preview.totals.existing} existentes</span><span>${preview.totals.categoriesPending} categorías por revisar</span><span>${preview.totals.imagesFound} imágenes verificadas</span><span>${preview.totals.imagesPending} pendientes</span><span>${preview.totals.duplicatesAvoided} duplicados omitidos</span>`;
      renderPdfRows();
    }
    renderImageRows();
    if (!window._biotechPdfImportDataset) loadDataset().then(data => {
      window._biotechPdfImportDataset = data;
      if (activeTab) renderProductImport();
    }).catch(error => {
      panel.innerHTML = `<div class="empty">${esc(error.message || 'No se pudo cargar el PDF preparado.')}</div>`;
    });
  }

  function changePdfImportPage(delta) { importPage = Math.max(0, importPage + delta); renderPdfRows(); }
  function changeImagePage(delta) { imagePage = Math.max(0, imagePage + delta); renderImageRows(); }
  function resetPdfImportPage() { importPage = 0; renderPdfRows(); }
  function resetImagePage() { imagePage = 0; renderImageRows(); }

  function searchProductImage(productId) {
    const product = products.find(item => item.id === productId);
    if (!product) return;
    const query = [product.barcode || product.ean, product.brand, product.name, product.variant, product.weight, product.presentation].filter(Boolean).join(' ');
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  }

  function downloadPdfImportReport() {
    const data = window._biotechPdfImportDataset;
    if (!data) return;
    const preview = inspect(products, data.products);
    const result = window._biotechPdfImportReport;
    const report = result ? {
      datasetId,
      sourceFile: data.sourceFile,
      generatedAt: new Date().toISOString(),
      importedAt: result.importedAt,
      verification: result.verification || 'preview',
      totals: result.totals,
      rows: result.rows
    } : {
      datasetId,
      sourceFile: data.sourceFile,
      generatedAt: new Date().toISOString(),
      totals: preview.totals,
      rows: preview.rows.map(row => ({ ean: row.code, name: row.item.name, action: row.action, fieldsToComplete: row.missingFields, categorySuggestion: row.item.category || null, subcategorySuggestion: row.item.subcategory || null, categoryStatus: row.product?.category ? 'existing-category-preserved' : 'needs-review', imageStatus: row.product ? imageStatusText(row.product) : 'Pendiente' }))
    };
    downloadJson(`biotech-importacion-${datasetId}-reporte.json`, report);
  }

  async function importPdfCatalog() {
    const cloud = window.BioTechCloud;
    if (!cloud?.configured || !cloud?.isAdmin || !cloud.client) return toast('Inicia sesión como administrador con Supabase configurado.');
    const data = await loadDataset().catch(error => { toast(error.message); return null; });
    if (!data) return;
    try {
      await cloud.syncNow();
      const { data: remote, error } = await cloud.client.from('business_state').select('value,version').eq('state_key', 'products').maybeSingle();
      if (error) throw error;
      const remoteProducts = Array.isArray(remote?.value) ? remote.value : [];
      if (stableJson(remoteProducts) !== stableJson(products)) {
        return toast('El catálogo cambió o no se sincronizó. Recarga el panel y vuelve a revisar antes de importar.');
      }
      const result = apply(data.products, remoteProducts);
      if (!result.totals.new && !result.totals.updated) {
        window._biotechPdfImportReport = result;
        renderProductImport();
        return toast('El archivo ya fue conciliado: no hubo campos nuevos que aplicar.');
      }
      const summary = `${result.totals.new} nuevos como borrador, ${result.totals.updated} fichas completadas y ${result.totals.duplicatesAvoided} EAN duplicados omitidos. Precios, costos, existencias, proveedores e imágenes existentes no se reemplazarán.`;
      if (!confirm(`${summary}\n\nSe descargará un respaldo antes de guardar. ¿Continuar?`)) return;
      cloud.exportBackup();
      const previousProducts = products;
      products = result.products;
      const reportEntry = { date: result.importedAt, type: 'Importación de catálogo PDF', detail: `${datasetLabel} · ${summary}` };
      activityLog = [reportEntry, ...activityLog].slice(0, 500);
      save('products');
      localStorage.setItem('biotech_activityLog', JSON.stringify(activityLog));
      await cloud.syncNow();
      const { data: saved, error: verifyError } = await cloud.client.from('business_state').select('value,version').eq('state_key', 'products').maybeSingle();
      if (verifyError) throw verifyError;
      const savedProducts = Array.isArray(saved?.value) ? saved.value : [];
      const savedCodes = new Set(savedProducts.map(item => normalizeBarcode(item.barcode || item.ean)));
      const verified = result.rows.filter(row => row.action !== 'duplicate-skipped').every(row => savedCodes.has(row.ean));
      if (!verified) {
        window._biotechPdfImportReport = { ...result, verification: 'pending', previousProductCount: previousProducts.length };
        downloadPdfImportReport();
        throw new Error('La nube no confirmó todos los EAN. Los cambios siguen pendientes; descarga el reporte y no cierres la sesión hasta revisar el estado.');
      }
      window._biotechPdfImportReport = { ...result, verification: 'saved' };
      renderProducts();
      renderAdmin();
      toast(`Importación guardada en la nube: ${result.totals.new} nuevos, ${result.totals.updated} completados.`);
    } catch (error) {
      console.error('BioTech PDF import failed', error);
      toast(error.message || 'No se pudo verificar la importación. Descarga un respaldo antes de salir.');
    }
  }

  const baseRenderAdmin = renderAdmin;
  renderAdmin = function () {
    baseRenderAdmin();
    addAdminTab();
    if (activeTab) renderProductImport();
    document.querySelectorAll('#panel-inventory tbody tr').forEach((row, index) => {
      const product = products[index];
      if (product?.status !== 'draft' && product?.published !== false) return;
      if (row.cells[0] && !row.cells[0].querySelector('.product-draft-label')) {
        const label = document.createElement('small'); label.className = 'product-draft-label'; label.textContent = 'Borrador · no visible'; row.cells[0].appendChild(label);
      }
      if (row.cells[1] && product.price == null) row.cells[1].textContent = 'Sin asignar';
      if (row.cells[2] && product.cost == null) row.cells[2].textContent = 'Sin asignar';
    });
  };

  const style = document.createElement('style');
  style.textContent = `.product-import-list{min-width:0}.product-import-list .table{font-size:12px}.product-import-list .table td small,.product-import-list .admin-bar small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.product-import-list .table td{vertical-align:top}.product-import-list .admin-bar{justify-content:center}.product-draft-label{display:block;color:#9a5800!important;font-weight:700}.product-import-list input,.product-import-list select{min-width:150px}`;
  document.head.appendChild(style);

  window.changePdfImportPage = changePdfImportPage;
  window.changeImagePage = changeImagePage;
  window.resetPdfImportPage = resetPdfImportPage;
  window.resetImagePage = resetImagePage;
  window.renderPdfImportRows = renderPdfRows;
  window.renderProductImageRows = renderImageRows;
  window.searchProductImage = searchProductImage;
  window.downloadPdfImportReport = downloadPdfImportReport;
  window.importPdfCatalog = importPdfCatalog;
  window.BioTechPdfImport = { normalizeBarcode, inspect, apply };
})();
