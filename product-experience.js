const mediaDbName = 'biotech-product-media';
const photoTokenPrefix = 'biotech-photo:';
const photoUrls = new Map();

function clearPhotoUrlCache(productId) {
  for (const [key, url] of photoUrls) {
    if (key.startsWith(`${productId}:`)) { URL.revokeObjectURL(url); photoUrls.delete(key); }
  }
}

function openMediaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(mediaDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('galleries', { keyPath: 'productId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getProductGallery(productId) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('galleries', 'readonly').objectStore('galleries').get(productId);
    request.onsuccess = () => resolve(request.result?.images || []);
    request.onerror = () => reject(request.error);
  });
}

async function saveProductGallery(productId, images) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('galleries', 'readwrite');
    tx.objectStore('galleries').put({ productId, images, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => { clearPhotoUrlCache(productId); resolve(); }; tx.onerror = () => reject(tx.error);
  });
}

async function removeProductGallery(productId) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('galleries', 'readwrite');
    tx.objectStore('galleries').delete(productId);
    tx.oncomplete = () => { clearPhotoUrlCache(productId); resolve(); }; tx.onerror = () => reject(tx.error);
  });
}

function photoUrl(productId, index, blob) {
  const key = `${productId}:${index}`;
  if (!photoUrls.has(key)) photoUrls.set(key, URL.createObjectURL(blob));
  return photoUrls.get(key);
}

async function resolveProductImage(image, target, productId, index = 0) {
  if (!image?.startsWith(photoTokenPrefix)) return;
  try {
    const gallery = await getProductGallery(productId);
    if (gallery[index]) target.src = photoUrl(productId, index, gallery[index]);
  } catch { /* Keep the product's fallback image if local media is unavailable. */ }
}

async function previewProductPhotos(input, productId) {
  const preview = input.form.querySelector('.product-photo-preview'); if (!preview) return;
  (preview._biotechUrls || []).forEach(URL.revokeObjectURL);
  preview._biotechUrls = [];
  preview.replaceChildren();
  const files = [...input.files];
  if (files.length > 8) { input.value = ''; return toast('Puedes elegir hasta 8 fotos por producto.'); }
  let images = files;
  if (!files.length && productId) {
    try {
      const product = products.find(item => item.id === productId);
      images = product?.gallery?.length ? product.gallery : await getProductGallery(productId);
    } catch { images = []; }
  }
  images.forEach((image, index) => {
    const url = image instanceof File ? URL.createObjectURL(image) : image instanceof Blob ? photoUrl(productId, index, image) : image;
    if (image instanceof File) preview._biotechUrls.push(url);
    const img = document.createElement('img'); img.src = url; img.alt = `Foto ${index + 1} del producto`; preview.appendChild(img);
  });
}

function enhanceProductForm(productId) {
  const form = document.querySelector('.overlay.show .drawer form.checkout'); if (!form || form.querySelector('.product-photo-field')) return;
  const imageInput = form.elements.image;
  const urlLabel = imageInput?.closest('label');
  if (urlLabel && imageInput) { imageInput.type = 'hidden'; urlLabel.replaceWith(imageInput); }
  const photoField = document.createElement('section'); photoField.className = 'product-photo-field';
  const photoStorageNote = window.BioTechCloud?.configured
    ? 'Las fotos nuevas se guardan en Supabase Storage y estarán disponibles en todos tus dispositivos.'
    : 'Configura Supabase para sincronizar las fotos; mientras tanto se conservan en este navegador.';
  photoField.innerHTML = `<label>Fotos del producto<input type="file" class="product-photo-input" accept="image/*" multiple></label><small>Elige desde tu computadora o galería del teléfono. Hasta 8 fotos, máximo 8 MB cada una. Se conserva el archivo original.</small><div class="product-photo-preview"></div><p class="fine">Recomendado: imagen cuadrada de al menos 1200 × 1200 px, fondo claro, envase centrado y con 15–20% de margen. La tienda no recorta ni convierte el archivo. La miniatura de la tarjeta puede recortarse solo al mostrarse.</p><button type="button" class="admin-action" onclick="clearProductPhotos('${esc(productId || '')}')">Quitar todas las fotos guardadas</button><p class="fine">${photoStorageNote}</p></section>`;
  const descriptionLabel = form.querySelector('input[name="description"]')?.closest('label');
  if (descriptionLabel && !form.querySelector('.product-info-fields')) {
    const info = document.createElement('section'); info.className = 'product-info-fields';
    const product = products.find(item => item.id === productId) || {};
    info.innerHTML = `<label>Marca<input name="brand" value="${esc(product.brand || '')}"></label><label>Nombre de línea<input name="productName" value="${esc(product.productName || '')}"></label><label>Variante / sabor<input name="variant" value="${esc(product.variant || '')}"></label><div class="form-grid"><label>Presentación<input name="presentation" value="${esc(product.presentation || '')}"></label><label>Peso / contenido<input name="weight" value="${esc(product.weight || '')}"></label><label>Servicios<input name="servings" type="number" min="1" step="1" value="${esc(product.servings ?? '')}"></label></div><label>Descripción detallada<textarea name="details" rows="3" placeholder="Beneficios y características">${esc(product.details || '')}</textarea></label><label>Ingredientes<textarea name="ingredients" rows="2" placeholder="Ingredientes declarados en la etiqueta">${esc(product.ingredients || '')}</textarea></label><label>Modo de uso<textarea name="usage" rows="2" placeholder="Según la etiqueta del fabricante">${esc(product.usage || '')}</textarea></label>`;
    descriptionLabel.after(info);
  }
  form.querySelector('.product-url-option')?.before(photoField);
  if (!photoField.isConnected) form.querySelector('button.cta')?.before(photoField);
  const currentProduct = products.find(item => item.id === productId) || {};
  if (!form.querySelector('.product-image-audit')) {
    const audit = document.createElement('section'); audit.className = 'product-image-audit';
    const publish = currentProduct.published !== false && currentProduct.status !== 'draft';
    audit.innerHTML = `<label class="product-publish"><input type="checkbox" name="publishProduct" ${publish ? 'checked' : ''}> Mostrar en la tienda</label><div class="form-grid"><label>Fuente original de la foto (solo administración)<input name="imageSourceUrl" type="url" value="${esc(currentProduct.imageSourceUrl || '')}" placeholder="https://fabricante... "></label><label class="product-image-verified"><input type="checkbox" name="imageVerified" ${currentProduct.imageVerified === true ? 'checked' : ''}> Verifiqué EAN, marca, variante y presentación</label></div><button type="button" class="admin-action" onclick="searchProductImage('${esc(productId || '')}')">Buscar imagen por EAN</button><small class="fine">La foto subida se guarda en Storage cuando Supabase está conectado. La fuente y la verificación solo se comparten con administración.</small>`;
    photoField.after(audit);
  }
  const input = photoField.querySelector('input[type=file]');
  input.addEventListener('change', () => previewProductPhotos(input, productId));
  if (productId) previewProductPhotos(input, productId);
  form.setAttribute('onsubmit', `saveProductWithPhotos(event, '${esc(productId || '')}')`);
}

async function clearProductPhotos(productId) {
  if (!productId) return toast('Guarda el producto primero; después podrás quitar sus fotos.');
  if (!confirm('¿Quitar todas las fotos cargadas de este producto?')) return;
  const form = document.querySelector('.overlay.show .checkout'), image = form?.elements.image;
  if (!form) return;
  form.dataset.clearGallery = 'true';
  if (image) image.value = '';
  if (form.elements.imageSourceUrl) form.elements.imageSourceUrl.value = '';
  if (form.elements.imageVerified) form.elements.imageVerified.checked = false;
  const preview = form.querySelector('.product-photo-preview'); if (preview) preview.replaceChildren();
  toast('Fotos marcadas para quitar. Guarda el producto para confirmar.');
}

async function saveProductWithPhotos(event, requestedId) {
  event.preventDefault(); const form = event.currentTarget, input = form.querySelector('.product-photo-input');
  const files = [...(input?.files || [])];
  if (files.length > 8 || files.some(file => !file.type.startsWith('image/') || file.size > 8 * 1024 * 1024)) return toast('Usa hasta 8 imágenes de máximo 8 MB cada una.');
  const id = requestedId || `p${Date.now()}`;
  const before = products.find(item => item.id === id) || {};
  const sourceInput = form.elements.imageSourceUrl;
  const sourceUrl = String(sourceInput?.value || '').trim();
  const verifiedRequested = Boolean(form.elements.imageVerified?.checked);
  const publishRequested = Boolean(form.elements.publishProduct?.checked);
  let safeSourceUrl = '';
  let sourceDomain = '';
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
      parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = '';
      safeSourceUrl = parsed.href;
      sourceDomain = parsed.hostname;
    } catch { return toast('La fuente de imagen debe ser un enlace HTTP o HTTPS válido.'); }
  }
  const imageExists = Boolean(files.length || form.elements.image?.value || before.gallery?.length || before.image);
  if (verifiedRequested && (!imageExists || !safeSourceUrl)) return toast('Para marcar la foto como verificada, registra su fuente y confirma la variante del producto.');
  const imageChanged = files.length > 0 || (form.elements.image?.value || '') !== (before.image || '');
  const needsPhotoReview = !requestedId || before.status === 'draft' || imageChanged;
  if (publishRequested && needsPhotoReview && (!imageExists || !verifiedRequested)) return toast('Antes de publicar esta ficha, sube una foto y confirma EAN, marca, variante y presentación.');
  try {
    let cloudGallery = null;
    if (files.length) {
      if (window.BioTechCloud?.configured) {
        if (!window.BioTechCloud.isAdmin) throw new Error('Se requiere una sesión administrativa.');
        cloudGallery = await window.BioTechCloud.uploadProductImages(id, files);
        form.elements.image.value = cloudGallery.urls[0] || '';
      } else {
        await saveProductGallery(id, files);
        form.elements.image.value = `${photoTokenPrefix}${id}`;
      }
    }
    saveCatalogProduct(event, id);
    const product = products.find(item => item.id === id);
    if (product) {
      const servings = form.elements.servings?.value;
      if (servings !== undefined) product.servings = servings === '' ? null : Number(servings);
      delete product.publishProduct;
      product.published = publishRequested;
      product.status = publishRequested ? 'published' : 'draft';
      product.imageSourceUrl = safeSourceUrl;
      product.imageSourceDomain = sourceDomain;
      product.imageVerified = verifiedRequested;
      if (imageChanged) {
        product.imageOrigin = files.length ? 'manual' : 'manual-url';
        product.imageUpdatedAt = new Date().toISOString();
      }
      product.imageMatchMethod = verifiedRequested ? 'admin-ean-brand-variant-presentation-confirmed' : (imageChanged ? 'manual-unverified' : product.imageMatchMethod || '');
      product.imageAudit = {
        ...(product.imageAudit || {}),
        sourceUrl: product.imageSourceUrl,
        sourceDomain: product.imageSourceDomain,
        verified: verifiedRequested,
        matchMethod: product.imageMatchMethod,
        origin: product.imageOrigin || 'none',
        updatedAt: product.imageUpdatedAt || null
      };
      save('products');
    }
    if (cloudGallery && product) {
      product.image = cloudGallery.urls[0] || product.image;
      product.gallery = cloudGallery.urls;
      product.imagePaths = cloudGallery.paths;
      save('products');
    } else if (form.dataset.clearGallery === 'true' && product) {
      product.image = '';
      product.gallery = [];
      product.imagePaths = [];
      product.imageOrigin = 'none';
      product.imageVerified = false;
      product.imageSourceUrl = '';
      product.imageSourceDomain = '';
      product.imageMatchMethod = '';
      product.imageUpdatedAt = null;
      product.imageAudit = { status: 'pending', origin: 'none', verified: false, updatedAt: null };
      save('products');
      await removeProductGallery(id).catch(() => {});
    }
    renderProducts(); renderAdmin();
  } catch (error) {
    console.error('BioTech product image save failed', error);
    toast('No se pudieron guardar las fotos. Verifica la conexión y el acceso al almacenamiento.');
  }
}

async function fillProductPhoto(img, product) {
  if (product.image?.startsWith(photoTokenPrefix)) await resolveProductImage(product.image, img, product.id);
}

function addProductCardInteractions() {
  document.querySelectorAll('.product').forEach(card => {
    const title = card.querySelector('h3')?.textContent;
    const product = products.find(item => item.name === title); if (!product) return;
    const img = card.querySelector('.product-img img');
    if (img) { img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-label', `Ver detalles de ${product.name}`); img.onclick = () => openProductDetail(product.id); img.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProductDetail(product.id); } }; fillProductPhoto(img, product); }
    const name = card.querySelector('h3'); if (name) { name.tabIndex = 0; name.setAttribute('role', 'button'); name.onclick = () => openProductDetail(product.id); name.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProductDetail(product.id); } }; }
    if (!card.querySelector('.product-details-trigger')) {
      const button = document.createElement('button'); button.className = 'product-details-trigger'; button.textContent = 'Ver detalles'; button.onclick = () => openProductDetail(product.id);
      card.querySelector('.product-body')?.appendChild(button);
    }
  });
}

async function openProductDetail(productId) {
  const product = products.find(item => item.id === productId); if (!product) return;
  const modal = document.createElement('div'); modal.className = 'overlay show product-detail-overlay'; modal.id = 'productDetailModal';
  const stockStatus = product.stock > 0 ? `En stock · ${product.stock} disponibles` : product.incoming > 0 && product.allowPreorder !== false ? `Por encargo · llega aprox. ${dateText(product.arrivalDate)}` : 'Agotado';
  const canOrder = product.stock > 0 || (product.incoming > 0 && product.allowPreorder !== false && product.arrivalDate);
  const reviews = publicReviews(product.id), average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  modal.innerHTML = `<article class="product-detail"><button class="product-detail-close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar detalles">×</button><div class="product-detail-gallery"><div class="detail-main-image"><img id="detailMainImage" src="${esc(product.image?.startsWith(photoTokenPrefix) ? '' : product.image || '')}" alt="${esc(product.name)}"></div><div id="detailThumbnails" class="detail-thumbnails"></div></div><div class="product-detail-copy"><div class="detail-crumb">Inicio / Tienda / ${esc(product.subcategory || product.category)}</div><div class="category">${esc(product.category)} · ${esc(product.subcategory || product.category)}</div><h2>${esc(product.name)}</h2><div class="detail-rating"><span>${reviews.length ? reviewStars(Math.round(average)) : '☆☆☆☆☆'}</span><small>${reviews.length ? `${average.toFixed(1)} · ${reviews.length} opinión${reviews.length === 1 ? '' : 'es'}` : 'Aún sin opiniones'}</small><button onclick="document.getElementById('productDetailModal')?.remove();openReview('${esc(product.id)}')">Calificar</button></div><div class="detail-price">${money(product.price)} <small>${currency} / unidad</small></div><p class="detail-availability">${esc(stockStatus)}</p>${product.description ? `<p>${esc(product.description)}</p>` : ''}${product.details ? `<section><h3>Detalles</h3><p>${esc(product.details)}</p></section>` : ''}${product.ingredients ? `<section><h3>Ingredientes</h3><p>${esc(product.ingredients)}</p></section>` : ''}${product.usage ? `<section><h3>Modo de uso</h3><p>${esc(product.usage)}</p></section>` : ''}<div class="detail-purchase"><label>Cantidad<input id="detailQty" type="number" min="1" max="${Math.max(1, product.stock + (product.incoming || 0))}" value="1"></label><button class="cta" ${!canOrder ? 'disabled' : ''} onclick="addProductDetailToCart('${esc(product.id)}')">${product.stock > 0 ? 'AÑADIR A LA BOLSA' : product.incoming > 0 ? 'ENCARGAR' : 'AGOTADO'}</button></div><p class="fine">Disponibilidad, fecha de llegada y entrega se confirman al coordinar el pedido.</p></div></article>`;
  document.body.appendChild(modal);
  try {
    const gallery = product.gallery?.length ? product.gallery : product.image?.startsWith(photoTokenPrefix) ? await getProductGallery(productId) : [];
    const photos = gallery.length ? gallery : product.image ? [product.image] : [];
    const main = modal.querySelector('#detailMainImage'), thumbs = modal.querySelector('#detailThumbnails');
    photos.forEach((photo, index) => {
      const src = photo instanceof Blob ? photoUrl(productId, index, photo) : photo;
      if (index === 0) main.src = src;
      const button = document.createElement('button'); button.className = `detail-thumb ${index === 0 ? 'active' : ''}`; button.type = 'button'; button.innerHTML = `<img src="${esc(src)}" alt="Vista ${index + 1} de ${esc(product.name)}">`; button.onclick = () => { main.src = src; thumbs.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); }; thumbs.appendChild(button);
    });
  } catch { /* Product details remain usable if local photos cannot be read. */ }
}

function addProductDetailToCart(productId) {
  const product = products.find(item => item.id === productId); if (!product) return;
  const requested = Math.max(1, +(document.getElementById('detailQty')?.value || 1));
  const available = Math.max(0, product.stock + (product.incoming || 0) - (cart[productId] || 0));
  const quantity = Math.min(requested, available);
  if (!quantity) return toast('No hay más unidades disponibles para agregar.');
  if (!product.stock && (product.allowPreorder === false || !product.arrivalDate)) return toast('Este producto no tiene fecha confirmada para aceptar encargos.');
  for (let count = 0; count < quantity; count++) addToCart(productId);
  document.getElementById('productDetailModal')?.remove();
}

function installApp() {
  const ua = navigator.userAgent || '', isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), isAndroid = /Android/i.test(ua);
  if (installPrompt && !isIOS) {
    installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; }); return;
  }
  const modal = document.createElement('div'); modal.className = 'overlay show install-guide-overlay';
  const securityNote = window.isSecureContext ? '' : '<p class="fine install-warning">Para instalarla en el teléfono, primero debe publicarse con HTTPS.</p>';
  const selected = isIOS ? 'ios' : isAndroid ? 'android' : 'other';
  modal.innerHTML = `<div class="drawer install-guide"><div class="drawer-head"><h2>Instalar BioTech</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div>${securityNote}<div class="install-platforms"><button class="${selected === 'ios' ? 'active' : ''}" onclick="showInstallSteps('ios')">iPhone</button><button class="${selected === 'android' ? 'active' : ''}" onclick="showInstallSteps('android')">Android</button><button class="${selected === 'other' ? 'active' : ''}" onclick="showInstallSteps('other')">Computadora</button></div><div class="install-steps" id="installSteps"></div><p class="fine">La instalación estará disponible cuando la tienda se publique en una dirección HTTPS.</p></div>`;
  document.body.appendChild(modal); showInstallSteps(selected);
}

function showInstallSteps(platform) {
  const steps = {
    ios: ['Abre la tienda en Safari (no desde el navegador interno de otra aplicación).', 'Toca Compartir.', 'Elige Añadir a pantalla de inicio y confirma con Añadir.'],
    android: ['Abre la tienda en Chrome.', 'Toca el menú ⋮ y elige Instalar aplicación o Añadir a pantalla de inicio.', 'Confirma la instalación. Si aparece el botón Instalar aplicación del navegador, también puedes usarlo.'],
    other: ['Abre la tienda en Chrome o Edge.', 'Usa el icono Instalar de la barra de direcciones o el menú del navegador.', 'Confirma para añadir BioTech a tus aplicaciones.']
  };
  const pane = document.getElementById('installSteps'); if (!pane) return;
  pane.innerHTML = `<ol>${steps[platform].map(step => `<li>${esc(step)}</li>`).join('')}</ol>`;
  pane.closest('.install-guide').querySelectorAll('.install-platforms button').forEach(button => button.classList.toggle('active', button.textContent.toLowerCase().startsWith(platform === 'ios' ? 'iphone' : platform === 'other' ? 'computadora' : platform)));
}

const installButton = document.querySelector('.nav-actions button[onclick="installApp()"]');
if (installButton) { installButton.classList.add('install-app-button'); const label = installButton.querySelector('.admin-open-label'); if (label) { label.textContent = 'Instalar'; label.classList.add('install-app-label'); } installButton.title = 'Instalar BioTech en este dispositivo'; installButton.setAttribute('aria-label', 'Instalar BioTech en este dispositivo'); }

const baseProductFormWithPhotos = productForm;
productForm = function (id) { baseProductFormWithPhotos(id); enhanceProductForm(id); };
const baseRenderProductsWithDetails = renderProducts;
renderProducts = function () { baseRenderProductsWithDetails(); addProductCardInteractions(); };

const productExperienceStyle = document.createElement('style');
productExperienceStyle.textContent = `.product-img img,h3[role=button]{cursor:pointer}.product-img img{object-fit:contain;background:#f2f4ef}.product:hover .product-img img{transform:none}.product-details-trigger{margin-top:7px;padding:0;border:0;background:none;color:#477300;font-size:10px;text-decoration:underline}.product-photo-field{padding:12px;border:1px solid var(--line);background:#fff}.product-photo-field>label{display:grid;gap:8px;color:var(--ink)!important;font-size:12px!important}.product-photo-field input[type=file]{width:100%;padding:12px;border:1px dashed #91a781;background:#f8faf5}.product-photo-field>small{display:block;margin:6px 0;color:var(--muted);font-size:10px}.product-photo-preview{display:flex;gap:8px;overflow:auto;margin:9px 0}.product-photo-preview img{width:70px;height:70px;object-fit:contain;background:#f2f4ef;border:1px solid var(--line)}.product-url-option{font-size:11px;color:var(--muted)}.product-url-option summary{cursor:pointer;padding:5px 0}.product-info-fields{display:grid;gap:9px}.product-info-fields label{display:grid;gap:4px}.product-info-fields textarea{width:100%;padding:9px;border:1px solid var(--line);font:inherit;resize:vertical}.product-detail-overlay{z-index:13;overflow:auto;justify-content:center;align-items:center;padding:24px}.product-detail{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;width:min(1120px,100%);min-height:560px;padding:36px;background:white;box-shadow:var(--shadow)}.product-detail-close{position:absolute;right:14px;top:12px;z-index:1;border:0;background:transparent;font-size:30px}.product-detail-gallery{min-width:0}.detail-main-image{height:410px;background:#f2f4ef;display:grid;place-items:center}.detail-main-image img{width:100%;height:100%;object-fit:contain}.detail-thumbnails{display:flex;gap:8px;margin-top:12px;overflow-x:auto}.detail-thumb{width:68px;height:68px;flex:none;padding:3px;background:white;border:1px solid var(--line)}.detail-thumb.active{border:2px solid #477300}.detail-thumb img{width:100%;height:100%;object-fit:contain}.product-detail-copy{align-self:center;max-width:480px}.detail-crumb{font-size:10px;color:var(--muted);margin-bottom:20px}.product-detail-copy h2{font:800 34px/1.15 Manrope,sans-serif;margin:10px 0}.detail-rating{display:flex;align-items:center;gap:8px;color:#b47800}.detail-rating small{color:var(--muted);font-size:10px}.detail-rating button{margin-left:auto;border:0;background:transparent;color:#477300;text-decoration:underline}.detail-price{font-size:26px;font-weight:800;margin-top:22px}.detail-price small{font-size:11px;color:var(--muted);font-weight:500}.detail-availability{padding:10px 12px;background:#f0f5eb;color:#466800;font-size:12px;font-weight:700}.product-detail-copy>p,.product-detail-copy section p{font-size:13px;line-height:1.65;color:#596157}.product-detail-copy section{border-top:1px solid var(--line);padding-top:9px}.product-detail-copy section h3{font:700 14px Manrope}.detail-purchase{display:flex;align-items:end;gap:12px;margin-top:22px}.detail-purchase label{display:grid;gap:6px;font-size:10px;font-weight:700}.detail-purchase input{width:75px;padding:12px;border:1px solid var(--line)}.detail-purchase .cta{margin:0;flex:1}.detail-purchase .cta:disabled{opacity:.5}.product-detail-copy .fine{margin-top:12px}.chat-launch{right:22px!important;bottom:92px!important}.chat-launch[aria-expanded=true]{visibility:hidden;pointer-events:none}.chat-box{right:20px!important;bottom:152px!important}.whatsapp-float{right:22px!important;bottom:20px!important}body.chat-open .whatsapp-float{display:none}.install-guide-overlay{z-index:14;justify-content:center;align-items:center;padding:18px}.install-guide{height:auto;max-height:90vh;width:min(460px,100%)}.install-platforms{display:flex;gap:7px;margin:18px 0 10px}.install-platforms button{flex:1;padding:10px 5px;border:1px solid var(--line);background:white;font-size:11px;font-weight:700}.install-platforms button.active{background:var(--ink);color:white;border-color:var(--ink)}.install-steps ol{padding-left:23px;line-height:1.7;font-size:13px}.install-warning{padding:9px;background:#fff5df;color:#785500}.install-app-button .install-app-label{display:inline!important}@media(max-width:720px){.product-detail-overlay{padding:0;align-items:flex-start}.product-detail{grid-template-columns:1fr;gap:15px;padding:18px 16px 28px;min-height:100vh}.product-detail-close{top:6px;right:8px}.detail-main-image{height:min(42vh,340px)}.detail-thumbnails{margin-top:7px}.detail-thumb{width:56px;height:56px}.product-detail-copy{max-width:none}.detail-crumb{margin:0 32px 12px 0}.product-detail-copy h2{font-size:26px}.detail-price{font-size:23px}.detail-purchase{position:sticky;bottom:0;background:white;padding:10px 0;z-index:1}.product-detail-copy>p,.product-detail-copy section p{font-size:12px}.chat-launch{right:13px!important;bottom:calc(82px + env(safe-area-inset-bottom))!important}.chat-box{right:13px!important;bottom:calc(142px + env(safe-area-inset-bottom))!important;height:min(490px,calc(100dvh - 165px - env(safe-area-inset-bottom)))}.whatsapp-float{right:13px!important;bottom:calc(14px + env(safe-area-inset-bottom))!important}.install-app-button{padding:0 5px!important;gap:4px!important;font-size:10px!important}.install-app-button .install-app-label{display:inline!important;font-size:9px}}@media(max-width:440px){.detail-purchase .cta{font-size:10px;padding:12px 8px}}`;
const productAuditStyle = document.createElement('style');
productAuditStyle.textContent = `.product-image-audit{display:grid;gap:9px;padding:12px;border:1px solid var(--line);background:#f8faf5}.product-image-audit label{display:grid;gap:5px}.product-image-audit .product-publish,.product-image-audit .product-image-verified{display:flex;align-items:center;gap:8px}.product-image-audit input[type=checkbox]{width:auto}.product-image-audit small{line-height:1.5}`;
document.head.appendChild(productAuditStyle);
document.head.appendChild(productExperienceStyle);
const originalPhotoDisplayStyle = document.createElement('style');
originalPhotoDisplayStyle.textContent = '.product-img img{object-fit:cover;background:transparent}.product:hover .product-img img{transform:scale(1.045)}.product-photo-preview img{object-fit:cover;background:transparent}';
document.head.appendChild(originalPhotoDisplayStyle);
const baseToggleChat = toggleChat;
toggleChat = function () { baseToggleChat(); document.body.classList.toggle('chat-open', document.getElementById('chatBox').classList.contains('show')); };
const openAdminFromProtectedRoute = openAdmin;
openAdmin = function () {
  let isProtectedAdminFrame = false;
  try { isProtectedAdminFrame = window.self !== window.top && /\/admin\/?$/.test(window.top.location.pathname); } catch { /* A cross-origin parent is never trusted. */ }
  if (!isProtectedAdminFrame) return toast('El panel solo se abre desde la ruta /admin protegida por tu hosting.');
  openAdminFromProtectedRoute();
};
renderProducts();
