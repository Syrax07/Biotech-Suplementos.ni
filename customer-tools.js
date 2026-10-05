const customerExtrasKey = 'biotech_customerExtras';
const defaultWhatsAppTemplates = {
  order_received: 'Hola {cliente}, recibimos tu pedido {pedido} en {tienda}. Total: {total}. Productos: {productos}. Te contactaremos para coordinar.',
  in_process: 'Hola {cliente}, tu pedido {pedido} ya está en proceso. Te avisaremos cuando esté listo.',
  awaiting_payment: 'Hola {cliente}, tu pedido {pedido} está reservado y queda esperando pago. Total: {total}. Cuando lo realices, envíanos el comprobante para revisarlo.',
  payment_reported: 'Hola {cliente}, gracias por avisarnos del pago de tu pedido {pedido}. Recibimos tu comprobante y lo estamos verificando; te confirmaremos cuando esté validado.',
  payment_confirmed: 'Hola {cliente}, confirmamos el pago de tu pedido {pedido}. Gracias. Seguimos preparando tu compra.',
  thank_you: 'Hola {cliente}, gracias por comprar en {tienda}. Esperamos que disfrutes tu pedido {pedido}. ¡Estamos para servirte!',
  promotion: 'Hola {cliente}, tenemos una promoción en {tienda}: [escribe aquí la oferta]. Responde SALIR si no deseas recibir promociones.'
};
let customerExtras = Object.assign({
  whatsappContacts: [{ label: 'Ventas', phone: '+505 85672287' }],
  copyright: '© 2026 BioTech Suplementos', googleReviewUrl: '', privacyUrl: '', termsUrl: '', exchangeRate: 37.1,
  aboutText: 'Suplementos seleccionados para acompañar tus objetivos de entrenamiento y bienestar.',
  paymentText: 'Aceptamos efectivo y transferencia. Coordinamos los detalles por WhatsApp.',
  facebookUrl: '', instagramUrl: '',
  whatsappTemplates: defaultWhatsAppTemplates
}, JSON.parse(localStorage.getItem(customerExtrasKey) || 'null') || {});
if (!Array.isArray(customerExtras.whatsappContacts)) customerExtras.whatsappContacts = [];
customerExtras.whatsappTemplates = Object.assign({}, defaultWhatsAppTemplates, customerExtras.whatsappTemplates || {});
let productReviews = JSON.parse(localStorage.getItem('biotech_productReviews') || '[]');
let activeReviewProduct = null;

function saveCustomerExtras() { localStorage.setItem(customerExtrasKey, JSON.stringify(customerExtras)); }
function validWaNumber(phone) { return String(phone || '').replace(/\D/g, ''); }
function publicReviews(productId) { return productReviews.filter(review => review.productId === productId && review.approved); }
function reviewStars(value) { return '★'.repeat(value) + '☆'.repeat(5 - value); }
function formatPublicMoney(amount, code) { return new Intl.NumberFormat('es-NI', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(amount) || 0); }
function dualMoneyText(amount) {
  const rate = Number(customerExtras.exchangeRate) || 37.1;
  const nio = currency === 'USD' ? amount * rate : amount;
  const usd = currency === 'NIO' ? amount / rate : amount;
  return `${formatPublicMoney(nio, 'NIO')} · ${formatPublicMoney(usd, 'USD')}`;
}
function dualMoneyMarkup(amount) {
  const rate = Number(customerExtras.exchangeRate) || 37.1;
  const nio = currency === 'USD' ? amount * rate : amount;
  const usd = currency === 'NIO' ? amount / rate : amount;
  return `<span class="dual-main">${formatPublicMoney(nio, 'NIO')}</span><small class="dual-secondary">${formatPublicMoney(usd, 'USD')}</small>`;
}

function updateCustomerFooter() {
  const footer = document.querySelector('.footer-inner'); if (!footer) return;
  const cats = [...new Set(products.map(product => product.category).filter(Boolean))];
  const categoryLinks = `<a href="#catalogo" onclick="chooseFooterCategory('Todos')">Ver todos los productos</a>${cats.map(cat => `<div class="footer-category-group"><a href="#catalogo" onclick="chooseFooterCategory('${esc(cat)}')">${esc(cat)}</a>${(subcategoryMap[cat] || []).map(sub => `<a class="footer-subcategory" href="#catalogo" onclick="chooseFooterCategory('${esc(cat)}','${esc(sub)}')">${esc(sub)}</a>`).join('')}</div>`).join('')}`;
  const phone = String(storeSettings.phone || '').trim(), phoneDigits = validWaNumber(phone);
  const contacts = customerExtras.whatsappContacts.filter(contact => validWaNumber(contact.phone));
  if (!contacts.length && phoneDigits.length >= 8) contacts.push({ label: 'WhatsApp', phone });
  const contactInfo = [
    phoneDigits.length >= 8 ? `<a href="tel:+${phoneDigits}">Llamar: ${esc(phone)}</a>` : '',
    storeSettings.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeSettings.address)}" target="_blank" rel="noopener">${esc(storeSettings.address)} · Ver mapa</a>` : '',
    safePublicUrl(customerExtras.googleReviewUrl) ? `<a href="${esc(safePublicUrl(customerExtras.googleReviewUrl))}" target="_blank" rel="noopener">Valorar en Google</a>` : '',
    safePublicUrl(customerExtras.privacyUrl) ? `<a href="${esc(safePublicUrl(customerExtras.privacyUrl))}" target="_blank" rel="noopener">Privacidad</a>` : '',
    safePublicUrl(customerExtras.termsUrl) ? `<a href="${esc(safePublicUrl(customerExtras.termsUrl))}" target="_blank" rel="noopener">Términos y condiciones</a>` : ''
  ].filter(Boolean).join('');
  const socials = [
    safePublicUrl(customerExtras.facebookUrl) ? `<a href="${esc(safePublicUrl(customerExtras.facebookUrl))}" target="_blank" rel="noopener">Facebook</a>` : '',
    safePublicUrl(customerExtras.instagramUrl) ? `<a href="${esc(safePublicUrl(customerExtras.instagramUrl))}" target="_blank" rel="noopener">Instagram</a>` : ''
  ].filter(Boolean).join('');
  const about = String(customerExtras.aboutText || '').trim();
  const payment = String(customerExtras.paymentText || '').trim();
  const whatsappButtons = contacts.map((contact, i) => `<a class="footer-btn footer-whatsapp" href="https://wa.me/${validWaNumber(contact.phone)}?text=${encodeURIComponent(`Hola, quisiera información de ${storeSettings.name}.`)}" target="_blank" rel="noopener">WhatsApp${contacts.length > 1 ? ` · ${esc(contact.label || `Ventas ${i + 1}`)}` : ''}</a>`).join('');
  const emailButton = storeSettings.email ? `<a class="footer-btn footer-email" href="mailto:${esc(storeSettings.email)}?subject=${encodeURIComponent(`Consulta · ${storeSettings.name}`)}">Correo electrónico</a>` : '';
  footer.innerHTML = `<section class="footer-brand-col"><h3>Quiénes somos</h3><a class="footer-brand" href="#catalogo" aria-label="${esc(storeSettings.name)} · ir a la tienda"><img class="brand-logo" src="${esc(storeSettings.logo || 'brand-logo.png')}" alt="${esc(storeSettings.name)}"></a><p class="footer-about">${esc(about).replace(/\n/g, '<br>')}</p>${socials ? `<div class="footer-social" aria-label="Redes sociales">${socials}</div>` : ''}</section><section class="footer-column"><h3>Categorías</h3><div class="footer-links">${categoryLinks}</div></section><section class="footer-column"><h3>Contacto</h3>${contactInfo ? `<div class="footer-links">${contactInfo}</div>` : ''}<div class="footer-actions">${whatsappButtons}${emailButton}</div></section><section class="footer-column"><h3>Pagos y ayuda</h3><p>${esc(payment).replace(/\n/g, '<br>')}</p></section><div class="footer-meta">${esc(customerExtras.copyright || `© ${new Date().getFullYear()} ${storeSettings.name}`)}</div>`;
}

function chooseFooterCategory(categoryName, subcategoryName = 'Todos') {
  category = categoryName; subcategory = subcategoryName; renderProducts();
}

function whatsappMarkup() {
  let control = document.getElementById('whatsappFloat');
  if (!control) {
    control = document.createElement('div'); control.id = 'whatsappFloat'; control.className = 'whatsapp-float';
    document.body.appendChild(control);
  }
  const contacts = customerExtras.whatsappContacts.filter(contact => validWaNumber(contact.phone));
  control.hidden = !contacts.length;
  if (!contacts.length) return;
  control.innerHTML = `${contacts.length > 1 ? `<div class="whatsapp-menu" id="whatsappMenu" hidden>${contacts.map((contact, i) => `<a href="https://wa.me/${validWaNumber(contact.phone)}?text=${encodeURIComponent(`Hola, vi su tienda ${storeSettings.name} y quisiera información.`)}" target="_blank" rel="noopener">${esc(contact.label || `WhatsApp ${i + 1}`)}<small>${esc(contact.phone)}</small></a>`).join('')}</div>` : ''}<a class="whatsapp-trigger" href="${contacts.length === 1 ? `https://wa.me/${validWaNumber(contacts[0].phone)}?text=${encodeURIComponent(`Hola, vi su tienda ${storeSettings.name} y quisiera información.`)}` : '#'}" ${contacts.length === 1 ? 'target="_blank" rel="noopener"' : 'onclick="toggleWhatsAppMenu(event)"'} aria-label="Contactar a BioTech por WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.5 28.6l6.4-1.6A12.8 12.8 0 1 0 16 3.2Zm0 23.2c-2 0-4-.5-5.7-1.6l-.4-.2-3.8 1 1-3.7-.3-.4A10.3 10.3 0 1 1 16 26.4Zm5.7-7.7c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.5 8.5 0 0 1-2.5-1.5 9.4 9.4 0 0 1-1.7-2.1c-.2-.4 0-.5.2-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6s-.7-1.7-.9-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.6s1.1 3 1.3 3.2c.2.2 2.2 3.4 5.4 4.7.8.4 1.4.6 1.9.7.8.3 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4Z"/></svg><span>WhatsApp</span></a>`;
}

function toggleWhatsAppMenu(event) {
  event.preventDefault(); const menu = document.getElementById('whatsappMenu'); if (menu) menu.hidden = !menu.hidden;
}

function addReviewControls() {
  document.querySelectorAll('.product').forEach(card => {
    if (card.querySelector('.review-summary')) return;
    const name = card.querySelector('h3')?.textContent, product = products.find(item => item.name === name);
    if (!product) return;
    const reviews = publicReviews(product.id), average = reviews.length ? reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length : 0;
    const rating = document.createElement('div'); rating.className = 'review-summary';
    rating.innerHTML = `<span aria-label="${reviews.length ? `${average.toFixed(1)} de 5 estrellas` : 'Aún sin calificaciones'}">${reviews.length ? reviewStars(Math.round(average)) : '☆☆☆☆☆'}</span><small>${reviews.length ? `${average.toFixed(1)} · ${reviews.length} opinión${reviews.length === 1 ? '' : 'es'}` : 'Aún sin opiniones'}</small>`;
    const action = document.createElement('button'); action.className = 'review-open'; action.textContent = 'Calificar'; action.onclick = () => openReview(product.id);
    card.querySelector('.product-body')?.insertBefore(rating, card.querySelector('.product-bottom'));
    card.querySelector('.product-body')?.insertBefore(action, card.querySelector('.stock'));
  });
}

function openReview(productId) {
  const product = products.find(item => item.id === productId); if (!product) return;
  activeReviewProduct = productId;
  const modal = document.createElement('div'); modal.className = 'overlay show'; modal.id = 'reviewModal';
  modal.innerHTML = `<div class="drawer review-drawer" style="margin:auto;height:auto;max-height:92vh"><div class="drawer-head"><h2>Opinión de ${esc(product.name)}</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div><form class="checkout review-form" onsubmit="submitProductReview(event)"><label>Tu calificación</label><div class="star-picker" role="radiogroup" aria-label="Calificación de una a cinco estrellas">${[1,2,3,4,5].map(n => `<button type="button" class="star-choice" aria-label="${n} estrellas" aria-checked="${n === 5}" role="radio" onclick="selectReviewStars(${n})">${n <= 5 ? '★' : '☆'}</button>`).join('')}</div><input type="hidden" name="rating" value="5"><label>Nombre (opcional)<input name="name" maxlength="60" placeholder="Tu nombre"></label><label>Tu opinión<textarea name="text" required minlength="8" maxlength="600" rows="4" placeholder="¿Qué te pareció este producto?"></textarea></label><button class="cta">ENVIAR OPINIÓN</button><p class="fine">Tu opinión quedará pendiente de revisión antes de mostrarse. No incluyas información médica o personal sensible.</p></form></div>`;
  document.body.appendChild(modal);
}

function selectReviewStars(value) {
  const form = document.querySelector('#reviewModal form'); if (!form) return;
  form.elements.rating.value = value;
  form.querySelectorAll('.star-choice').forEach((button, index) => { button.textContent = index < value ? '★' : '☆'; button.setAttribute('aria-checked', String(index + 1 === value)); });
}

function submitProductReview(event) {
  event.preventDefault(); const form = Object.fromEntries(new FormData(event.target));
  productReviews.unshift({ id: `rev-${Date.now()}`, productId: activeReviewProduct, name: form.name.trim() || 'Cliente', text: form.text.trim(), rating: Math.max(1, Math.min(5, +form.rating)), date: new Date().toISOString(), approved: false });
  localStorage.setItem('biotech_productReviews', JSON.stringify(productReviews));
  document.getElementById('reviewModal')?.remove(); toast('Gracias. Tu opinión será revisada antes de publicarse.');
  if (customerExtras.googleReviewUrl) toast('También puedes compartir tu experiencia en Google desde el enlace del pie.');
}

function renderCustomerSettings() {
  const panel = document.getElementById('panel-store'); if (!panel) return;
  panel.querySelector('.customer-extra-settings')?.remove();
  const section = document.createElement('section'); section.className = 'customer-extra-settings';
  const contactText = customerExtras.whatsappContacts.map(contact => `${contact.label}|${contact.phone}`).join('\n');
  section.innerHTML = `<div class="admin-bar"><span>Contacto público, derechos y opiniones</span></div><form class="store-form" onsubmit="saveCustomerSettings(event)"><div class="form-grid"><label class="field-full">Contactos de WhatsApp (una línea por contacto: Nombre|+código país y número)<textarea name="contacts" rows="4" placeholder="Ventas|+505 85672287">${esc(contactText)}</textarea></label><label>Texto de copyright<input name="copyright" maxlength="120" value="${esc(customerExtras.copyright)}"></label><label>Tipo de cambio interno (C$ por US$)<input name="exchangeRate" type="number" min="0.01" step="0.01" value="${Number(customerExtras.exchangeRate) || 37.1}"><small class="fine">El cliente ve ambos precios, no esta tasa.</small></label><label>Enlace para reseñas externas (por ejemplo Google)<input name="googleReviewUrl" type="url" value="${esc(customerExtras.googleReviewUrl)}" placeholder="https://g.page/r/…/review"></label><label>Enlace de política de privacidad<input name="privacyUrl" type="url" value="${esc(customerExtras.privacyUrl)}"></label><label>Enlace de términos y condiciones<input name="termsUrl" type="url" value="${esc(customerExtras.termsUrl)}"></label></div><button class="cta">GUARDAR CONTACTO Y DATOS LEGALES</button><p class="fine">El enlace externo permite que clientes dejen una reseña en el servicio que elijas. Este sitio no importa ni sincroniza reseñas externas sin cuenta/API.</p></form><div class="admin-bar"><span>Opiniones de productos · ${productReviews.filter(review => !review.approved).length} pendientes</span></div>${productReviews.length ? `<div class="review-admin-list">${productReviews.map(review => { const product = products.find(item => item.id === review.productId); return `<article class="review-admin-item"><div><b>${esc(product?.name || 'Producto eliminado')}</b><span class="review-stars">${reviewStars(review.rating)}</span><small>${esc(review.name)} · ${new Date(review.date).toLocaleDateString('es-NI')}</small><p>${esc(review.text)}</p></div><div>${review.approved ? '<span class="status">Publicada</span>' : `<button type="button" class="admin-action" onclick="moderateReview('${esc(review.id)}',true)">Publicar</button>`} <button type="button" class="admin-action" onclick="moderateReview('${esc(review.id)}',false)">${review.approved ? 'Ocultar' : 'Eliminar'}</button></div></article>`; }).join('')}</div>` : '<div class="empty">Todavía no hay opiniones recibidas.</div>'}`;
  const templateLabels = [['order_received', 'Pedido recibido'], ['in_process', 'Pedido en proceso'], ['awaiting_payment', 'Esperando pago'], ['payment_reported', 'Pago reportado, por verificar'], ['payment_confirmed', 'Pago confirmado'], ['thank_you', 'Agradecimiento'], ['promotion', 'Promoción']];
  const templatesForm = document.createElement('form'); templatesForm.className = 'store-form'; templatesForm.onsubmit = saveWhatsAppTemplates;
  templatesForm.innerHTML = `<div class="admin-bar"><span>Plantillas de WhatsApp · respuestas manuales</span></div><p class="fine">Puedes editar cada mensaje. Variables disponibles: {cliente}, {pedido}, {total}, {productos}, {fecha}, {tienda}.</p><div class="form-grid">${templateLabels.map(([key, label]) => `<label class="field-full">${label}<textarea name="${key}" rows="3" maxlength="1000">${esc(customerExtras.whatsappTemplates[key])}</textarea></label>`).join('')}</div><button class="cta">GUARDAR PLANTILLAS</button><p class="fine">Las promociones solo deben enviarse a clientes que aceptaron recibirlas. El botón abre WhatsApp; tú revisas y envías.</p>`;
  const footerForm = document.createElement('form'); footerForm.className = 'store-form footer-settings-form'; footerForm.onsubmit = saveFooterSettings;
  footerForm.innerHTML = `<div class="admin-bar"><span>Pie de página BioTech</span></div><div class="form-grid"><label class="field-full">Descripción de la tienda<textarea name="aboutText" rows="3" maxlength="400">${esc(customerExtras.aboutText)}</textarea></label><label class="field-full">Formas de pago y ayuda<textarea name="paymentText" rows="3" maxlength="300">${esc(customerExtras.paymentText)}</textarea></label><label>Facebook (URL)<input name="facebookUrl" type="url" value="${esc(customerExtras.facebookUrl)}" placeholder="https://facebook.com/…"></label><label>Instagram (URL)<input name="instagramUrl" type="url" value="${esc(customerExtras.instagramUrl)}" placeholder="https://instagram.com/…"></label></div><button class="cta">GUARDAR PIE DE PÁGINA</button><p class="fine">Categorías, contacto, reseñas y enlaces legales se completan con la información de tu tienda.</p>`;
  section.appendChild(templatesForm);
  section.appendChild(footerForm);
  panel.appendChild(section);
}

function saveWhatsAppTemplates(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  customerExtras.whatsappTemplates = Object.fromEntries(Object.keys(defaultWhatsAppTemplates).map(key => [key, String(data[key] || '').trim()]));
  saveCustomerExtras(); logActivity('Plantillas de WhatsApp actualizadas', `${Object.keys(customerExtras.whatsappTemplates).length} plantillas`);
  renderCustomerSettings(); toast('Plantillas de WhatsApp guardadas.');
}

function saveCustomerSettings(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  customerExtras.whatsappContacts = data.contacts.split('\n').map(row => { const [label, ...phone] = row.split('|'); return { label: label.trim(), phone: phone.join('|').trim() }; }).filter(contact => contact.label && validWaNumber(contact.phone));
  customerExtras.copyright = data.copyright.trim() || `© ${new Date().getFullYear()} ${storeSettings.name}`;
  customerExtras.exchangeRate = Math.max(0.01, Number(data.exchangeRate) || 37.1);
  customerExtras.googleReviewUrl = safePublicUrl(data.googleReviewUrl); customerExtras.privacyUrl = safePublicUrl(data.privacyUrl); customerExtras.termsUrl = safePublicUrl(data.termsUrl);
  saveCustomerExtras(); whatsappMarkup(); updateCustomerFooter(); renderCustomerSettings(); logActivity('Contacto público y datos legales actualizados', `${customerExtras.whatsappContacts.length} WhatsApp`); toast('Contacto y datos legales guardados.');
}

function saveFooterSettings(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  customerExtras.aboutText = String(data.aboutText || '').trim().slice(0, 400);
  customerExtras.paymentText = String(data.paymentText || '').trim().slice(0, 300);
  customerExtras.facebookUrl = safePublicUrl(data.facebookUrl); customerExtras.instagramUrl = safePublicUrl(data.instagramUrl);
  saveCustomerExtras(); updateCustomerFooter(); renderCustomerSettings(); logActivity('Pie de página actualizado', 'Descripción, pagos y redes'); toast('Pie de página guardado.');
}

function safePublicUrl(value) {
  try { const url = new URL(String(value || '').trim()); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function moderateReview(id, approved) {
  const review = productReviews.find(item => item.id === id); if (!review) return;
  if (!approved && review.approved && !confirm('¿Ocultar esta opinión pública?')) return;
  if (!approved && !review.approved && !confirm('¿Eliminar esta opinión pendiente?')) return;
  if (!approved && !review.approved) productReviews = productReviews.filter(item => item.id !== id); else review.approved = approved;
  localStorage.setItem('biotech_productReviews', JSON.stringify(productReviews)); renderCustomerSettings(); renderProducts(); toast(approved ? 'Opinión publicada.' : 'Opinión actualizada.');
}

function buildOrderWhatsAppMessage(order) {
  const items = order.items.map(item => {
    const product = products.find(row => row.id === item.id);
    const description = product?.description ? `\n  ${product.description}` : '';
    const fulfillment = item.preorder ? `\n  ENCARGO · llegada estimada ${dateText(item.arrivalDate)}` : '\n  En stock';
    return `• ${item.name} × ${item.qty} · ${money(item.price * item.qty)}${description}${fulfillment}`;
  }).join('\n');
  return [
    `Hola, quiero confirmar el pedido ${order.id} de ${storeSettings.name}.`,
    '', 'PRODUCTOS', items, '',
    `Subtotal: ${dualMoneyText(order.subtotal)}`,
    order.discount ? `Descuento${order.promoCode ? ` (${order.promoCode})` : ''}: −${dualMoneyText(order.discount)}` : '',
    `Envío: ${dualMoneyText(order.shipping)}`, `TOTAL: ${dualMoneyText(order.total)}`, '',
    `Cliente: ${order.name}`, `Mi WhatsApp: ${order.phone}`, `Entrega: ${order.address}`,
    `Fecha solicitada: ${order.deliveryDate ? dateText(order.deliveryDate) : 'Lo antes posible; confirmar horario por WhatsApp'}`, `Forma de pago: ${order.payment || 'Por coordinar'}`,
    '', 'Por favor, confirmen disponibilidad y fecha de entrega.'
  ].filter(Boolean).join('\n');
}

function orderWhatsAppUrl(phone, message) { return `https://wa.me/${validWaNumber(phone)}?text=${encodeURIComponent(message)}`; }

function showOrderWhatsAppFallback(order, contacts, message, autoOpen = false) {
  document.getElementById('orderWhatsAppFallback')?.remove();
  const modal = document.createElement('div'); modal.className = 'overlay show order-whatsapp-overlay'; modal.id = 'orderWhatsAppFallback';
  const contactLinks = contacts.filter(contact => validWaNumber(contact.phone)).map(contact => `<a class="cta" href="${esc(orderWhatsAppUrl(contact.phone, message))}">Abrir WhatsApp · ${esc(contact.label)} · ${esc(contact.phone)}</a>`).join('');
  modal.innerHTML = `<div class="drawer order-whatsapp-drawer" style="margin:auto;height:auto;max-height:90vh"><div class="drawer-head"><h2>Pedido ${esc(order.id)} registrado</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div><p id="orderWhatsAppNotice">${autoOpen ? 'Estamos abriendo WhatsApp con el resumen listo.' : 'El pedido quedó pendiente. Usa el contacto de BioTech para iniciar la conversación.'}</p>${contactLinks ? `<div class="order-whatsapp-contacts">${contactLinks}</div>` : '<p>No hay un número de WhatsApp configurado. La tienda debe agregarlo en Administrar → Mi tienda.</p>'}<button class="admin-action" type="button" onclick="copyOrderWhatsAppMessage('${esc(order.id)}')">Copiar resumen del pedido</button><details class="order-message-preview"><summary>Ver resumen que se enviará</summary><pre>${esc(message)}</pre></details><p class="fine">El pedido ya se guardó en el panel como pendiente. Para que BioTech reciba la notificación, debes enviar el mensaje desde WhatsApp.</p></div>`;
  document.body.appendChild(modal);
  return modal;
}

function copyOrderWhatsAppMessage(orderId) {
  const order = orders.find(item => item.id === orderId); if (!order) return;
  const text = buildOrderWhatsAppMessage(order);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Resumen copiado.')).catch(() => copyOrderMessageFallback(text));
  else copyOrderMessageFallback(text);
}

function copyOrderMessageFallback(text) {
  const field = document.createElement('textarea'); field.value = text; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select();
  const copied = document.execCommand('copy'); field.remove(); toast(copied ? 'Resumen copiado.' : 'No se pudo copiar el resumen.');
}

function chooseOrderWhatsApp(order) {
  let contacts = customerExtras.whatsappContacts.filter(contact => validWaNumber(contact.phone));
  if (!contacts.length && validWaNumber(storeSettings.phone)) contacts = [{ label: 'Contacto de la tienda', phone: storeSettings.phone }];
  const message = buildOrderWhatsAppMessage(order);
  if (contacts.length === 1) {
    showOrderWhatsAppFallback(order, contacts, message, true);
    try { window.location.assign(orderWhatsAppUrl(contacts[0].phone, message)); }
    catch { document.getElementById('orderWhatsAppNotice').textContent = 'No pudimos abrir WhatsApp automáticamente. Toca el botón con el número para iniciar la conversación.'; }
    return;
  }
  showOrderWhatsAppFallback(order, contacts, message);
}

const customerBaseRenderProducts = renderProducts;
renderProducts = function () { customerBaseRenderProducts(); addReviewControls(); };
const customerBaseRenderCart = renderCart;
renderCart = function () {
  const previousPreference = document.querySelector('#cartCheckout [name="deliveryPreference"]:checked')?.value || 'asap';
  const previousDate = document.querySelector('#cartCheckout [name="deliveryDate"]')?.value || '';
  customerBaseRenderCart();
  const form = document.querySelector('#cartCheckout form.checkout');
  if (!form) return;
  const dateInput = form.querySelector('[name="deliveryDate"]');
  const dateLabel = dateInput?.closest('label');
  if (dateInput && dateLabel && !form.querySelector('[name="deliveryPreference"]')) {
    const minimumDate = dateInput.min;
    dateLabel.remove();
    const delivery = document.createElement('fieldset');
    delivery.className = 'delivery-choice';
    delivery.innerHTML = `<legend>¿Cuándo prefieres recibir?</legend><label><input type="radio" name="deliveryPreference" value="asap" ${previousPreference === 'asap' ? 'checked' : ''}> Lo antes posible</label><label><input type="radio" name="deliveryPreference" value="scheduled" ${previousPreference === 'scheduled' ? 'checked' : ''}> Programar fecha</label><label class="delivery-date-field" ${previousPreference === 'scheduled' ? '' : 'hidden'}>Fecha preferida<input name="deliveryDate" type="date" min="${esc(minimumDate)}" value="${esc(previousDate)}" ${previousPreference === 'scheduled' ? 'required' : 'disabled'}></label><small class="fine">La fecha es opcional. Si no eliges una, coordinaremos la entrega contigo por WhatsApp.</small>`;
    form.insertBefore(delivery, form.querySelector('[name="payment"]')?.closest('label') || form.querySelector('.cart-total'));
    delivery.addEventListener('change', () => {
      const scheduled = delivery.querySelector('[name="deliveryPreference"]:checked')?.value === 'scheduled';
      const dateField = delivery.querySelector('.delivery-date-field'), input = delivery.querySelector('[name="deliveryDate"]');
      dateField.hidden = !scheduled; input.disabled = !scheduled; input.required = scheduled;
    });
  }
  if (!form.querySelector('[name="marketingOptIn"]')) {
    const label = document.createElement('label'); label.className = 'marketing-opt-in'; label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.45';
    label.innerHTML = '<input type="checkbox" name="marketingOptIn" style="width:auto;margin-top:2px">Acepto recibir por WhatsApp novedades y promociones de BioTech. Puedo pedir que dejen de enviármelas.';
    form.querySelector('.cta')?.before(label);
  }
};
const customerBaseRenderSettings = renderStoreSettings;
renderStoreSettings = function () { customerBaseRenderSettings(); renderCustomerSettings(); };
const customerBaseSaveSettings = saveStoreSettings;
saveStoreSettings = function (event) { customerBaseSaveSettings(event); updateCustomerFooter(); whatsappMarkup(); };
const customerBasePlaceOrder = placeOrder;
placeOrder = function (event) {
  const countBefore = orders.length;
  customerBasePlaceOrder(event);
  if (orders.length > countBefore) chooseOrderWhatsApp(orders[0]);
};

let advisorConversation = [];
let advisorBusy = false;

function initializeAdvisorChat() {
  const status = document.querySelector('#chatBox .chat-head small');
  if (status) { status.id = 'chatStatus'; status.textContent = 'Asesor local · IA aún sin conectar'; }
  const launcher = document.getElementById('chatLaunch');
  if (launcher) { launcher.setAttribute('aria-controls', 'chatBox'); launcher.setAttribute('aria-expanded', 'false'); }
  const head = document.querySelector('#chatBox .chat-head');
  const close = head?.querySelector('.close');
  if (close) { close.setAttribute('aria-label', 'Cerrar asesor'); close.title = 'Cerrar asesor'; }
  if (!window.biotechChatKeyboardReady) {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('chatBox')?.classList.contains('show')) toggleChat();
    });
    window.biotechChatKeyboardReady = true;
  }
  if (head && close && !document.getElementById('chatReset')) {
    const reset = document.createElement('button');
    reset.id = 'chatReset'; reset.className = 'chat-reset'; reset.type = 'button'; reset.textContent = 'Nueva conversación';
    reset.title = 'Borrar esta conversación'; reset.onclick = resetAdvisorConversation;
    head.insertBefore(reset, close);
  }
  const quick = document.querySelector('#chatBox .chat-quick');
  if (quick) {
    quick.replaceChildren();
    [['Quiero proteína', 'Busco proteína para complementar mi entrenamiento'], ['Ganar masa', 'Busco opciones para ganar masa'], ['Fuerza y energía', 'Quiero conocer opciones de rendimiento y energía'], ['Bienestar', 'Busco opciones de bienestar']].forEach(([label, question]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => askAdvisor(question)); quick.appendChild(button);
    });
  }
  const messages = document.getElementById('chatMessages');
  if (messages) { messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite'); }
  const input = document.getElementById('chatInput');
  if (input) { input.maxLength = 600; input.setAttribute('autocomplete', 'off'); }
  const disclaimer = document.querySelector('#chatBox .chat-disclaimer');
  if (disclaimer) disclaimer.textContent = 'Asesoría general de productos, no médica. No escribas datos personales ni información de salud. Si Gemini está activado, tu consulta se procesa con ese servicio.';
}

function toggleChat() {
  const box = document.getElementById('chatBox'); if (!box) return;
  box.classList.toggle('show'); document.body.classList.toggle('chat-open', box.classList.contains('show'));
  const isOpen = box.classList.contains('show');
  document.getElementById('chatLaunch')?.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) document.getElementById('chatInput')?.focus(); else document.getElementById('chatLaunch')?.focus();
}

function sendAdvisor(event) {
  event.preventDefault();
  const input = document.getElementById('chatInput'), question = input?.value.trim();
  if (!question || advisorBusy) return;
  input.value = ''; askAdvisor(question);
}

function advisorBubble(role, text) {
  const bubble = document.createElement('div'); bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text; document.getElementById('chatMessages')?.appendChild(bubble); return bubble;
}

function normalizedAdvisorText(value) {
  return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findAdvisorProducts(question) {
  const query = normalizedAdvisorText(question);
  const words = query.split(/[^a-z0-9]+/).filter(word => word.length > 2 && !['para','con','una','uno','que','quiero','busco','tienen','hay','del','las','los'].includes(word));
  const intentGroups = [
    { terms: ['proteina','whey','suero','masa','musculo','muscular','ganar'], test: product => /prote|whey|masa|mass|gainer/.test(normalizedAdvisorText(`${product.name} ${product.category} ${product.subcategory}`)) },
    { terms: ['fuerza','rendimiento','creatina','entrenar','entreno','energia','preentreno','pre'], test: product => /rendimiento|creatina|pre|bcaa|amino/.test(normalizedAdvisorText(`${product.name} ${product.category} ${product.subcategory}`)) },
    { terms: ['bienestar','vitamina','salud','omega','diario'], test: product => /bienestar|vitamina|omega|salud|multivit/.test(normalizedAdvisorText(`${product.name} ${product.category} ${product.subcategory}`)) },
    { terms: ['accesorio','shaker','ropa','botella'], test: product => /accesorio|shaker|ropa|alimento/.test(normalizedAdvisorText(`${product.name} ${product.category} ${product.subcategory}`)) }
  ];
  const requested = intentGroups.filter(group => group.terms.some(term => query.includes(term)));
  return products.map(product => {
    const fields = normalizedAdvisorText(`${product.name} ${product.category} ${product.subcategory} ${product.description || ''}`);
    let score = words.reduce((sum, word) => sum + (fields.includes(word) ? 3 : 0), 0);
    requested.forEach(group => { if (group.test(product)) score += 2; });
    if (score && product.stock > 0) score += 1;
    return { product, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.product);
}

function advisorAvailability(product) {
  if (Number(product.stock) > 0) return `En stock · ${product.stock} disponible${product.stock === 1 ? '' : 's'}`;
  if (Number(product.incoming) > 0 && product.allowPreorder !== false) return `Por encargo · ${product.incoming} por llegar${product.arrivalDate ? ` · aprox. ${dateText(product.arrivalDate)}` : ''}`;
  return 'Agotado por ahora';
}

function appendAdvisorProducts(matches) {
  const box = document.getElementById('chatMessages');
  for (const product of matches) {
    const card = document.createElement('article'); card.className = 'chat-product';
    const detail = document.createElement('div'), name = document.createElement('b'), stock = document.createElement('small'), price = document.createElement('small');
    name.textContent = product.name; stock.textContent = advisorAvailability(product); price.textContent = dualMoneyText(Number(product.price) || 0);
    detail.append(name, stock, price);
    const actions = document.createElement('div'); actions.className = 'chat-product-actions';
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'Ver ficha';
    view.addEventListener('click', () => { toggleChat(); if (typeof openProductDetail === 'function') openProductDetail(product.id); else { document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' }); } });
    actions.appendChild(view);
    const canOrder = Number(product.stock) > 0 || (Number(product.incoming) > 0 && product.allowPreorder !== false && product.arrivalDate);
    const add = document.createElement('button'); add.type = 'button'; add.textContent = Number(product.stock) > 0 ? 'Agregar' : 'Encargar'; add.disabled = !canOrder;
    add.addEventListener('click', () => { if (typeof addToCart === 'function') addToCart(product.id); });
    actions.appendChild(add); card.append(detail, actions); box?.appendChild(card);
  }
}

function localAdvisorAnswer(question, matches) {
  const query = normalizedAdvisorText(question);
  if (/hola|buenas|buen dia|saludos/.test(query)) return '¡Hola! Te puedo orientar por objetivo o buscar un producto del catálogo. ¿Buscas proteína, rendimiento, bienestar o accesorios?';
  if (/envio|entrega|envian|costo de envio/.test(query)) return `El envío configurado cuesta ${dualMoneyText(Number(shipping.fee) || 0)} y queda gratis desde ${dualMoneyText(Number(shipping.freeFrom) || 0)}. La cobertura y el tiempo se confirman al coordinar tu pedido.`;
  if (/pago|pagar|transferencia|efectivo/.test(query)) return 'Puedes dejar el pedido y coordinar por WhatsApp, pagar por transferencia o elegir efectivo contra entrega. El pago se confirma directamente con BioTech.';
  if (matches.length) return `Encontré ${matches.length === 1 ? 'esta opción' : 'estas opciones'} que podrían coincidir. Te muestro precio y disponibilidad del catálogo actual; confirma ambos antes de comprar.`;
  if (/medic|enfermed|embaraz|dosis|tratar|curar|dolor/.test(query)) return 'No puedo recomendar suplementos para tratar una condición ni indicar dosis personalizadas. Consulta con un profesional de salud y sigue la etiqueta del fabricante.';
  return 'Cuéntame un poco más: ¿qué objetivo tienes, qué tipo de producto buscas o cuál nombre del catálogo quieres revisar?';
}

function sanitizeAdvisorHistory(messages) {
  return messages.map(message => ({
    role: message.role,
    content: String(message.content || '')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[correo oculto]')
      .replace(/\b(?:BT[- ]?)\d{5,}\b/gi, '[número de pedido oculto]')
      .replace(/(^|[^\d])(\+?\d(?:[\s().-]*\d){7,14})(?!\d)/g, '$1[teléfono oculto]')
  }));
}

async function requestGeminiAdvisorReply() {
  const config = window.BIOTECH_AI_CONFIG || {};
  if (!config.endpoint || !config.publishableKey) return null;
  let endpoint;
  try { endpoint = new URL(config.endpoint); } catch { return null; }
  if (endpoint.protocol !== 'https:') return null;
  const response = await fetch(endpoint.href, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.publishableKey },
    body: JSON.stringify({
      messages: sanitizeAdvisorHistory(advisorConversation.slice(-10)), currency,
      products: products.slice(0, 35).map(product => ({ name: product.name, category: product.category, description: product.description, price: Number(product.price) || 0, currency, stock: Number(product.stock) || 0, incoming: Number(product.incoming) || 0, arrivalDate: product.arrivalDate || '' })),
      store: { name: storeSettings.name, shippingFee: Number(shipping.fee) || 0, freeShippingFrom: Number(shipping.freeFrom) || 0 }
    }),
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.reply) throw new Error(result.error || 'El asistente no respondió.');
  return String(result.reply).slice(0, 2400);
}

async function askAdvisor(question) {
  const text = String(question || '').trim().slice(0, 600);
  if (!text || advisorBusy) return;
  advisorBusy = true;
  const input = document.getElementById('chatInput'), submit = document.querySelector('#chatBox .chat-input button'), status = document.getElementById('chatStatus');
  if (input) input.disabled = true; if (submit) submit.disabled = true;
  const quickButtons = [...document.querySelectorAll('#chatBox .chat-quick button')]; quickButtons.forEach(button => { button.disabled = true; });
  advisorBubble('user', text); advisorConversation.push({ role: 'user', content: text }); advisorConversation = advisorConversation.slice(-10);
  const loading = advisorBubble('assistant chat-typing', 'Estoy revisando tu consulta…');
  const matches = findAdvisorProducts(text);
  let reply;
  try {
    reply = await requestGeminiAdvisorReply();
    if (reply) { if (status) status.textContent = 'Gemini conectado'; }
    else { if (status) status.textContent = 'Asesor local · IA aún sin configurar'; reply = localAdvisorAnswer(text, matches); }
  } catch {
    if (status) status.textContent = 'IA no disponible · modo catálogo';
    reply = `${localAdvisorAnswer(text, matches)}\n\nAhora mismo no tengo conexión con Gemini.`;
  }
  loading.remove(); advisorBubble('assistant', reply); advisorConversation.push({ role: 'assistant', content: reply }); advisorConversation = advisorConversation.slice(-10);
  if (matches.length) appendAdvisorProducts(matches);
  if (input) { input.disabled = false; input.focus(); } if (submit) submit.disabled = false;
  quickButtons.forEach(button => { button.disabled = false; });
  advisorBusy = false;
  const box = document.getElementById('chatMessages'); if (box) box.scrollTop = box.scrollHeight;
}

function resetAdvisorConversation() {
  advisorConversation = [];
  const messages = document.getElementById('chatMessages'); if (!messages) return;
  const quick = messages.querySelector('.chat-quick');
  messages.replaceChildren(); advisorBubble('assistant', '¡Hola! Soy el asesor de BioTech. Puedo revisar el catálogo y ayudarte a comparar opciones. ¿Qué objetivo tienes?');
  if (quick) messages.appendChild(quick);
}

const customerStyle = document.createElement('style');
customerStyle.textContent = `.whatsapp-float{position:fixed;right:22px;bottom:22px;z-index:9;display:grid;justify-items:end;gap:10px}.whatsapp-trigger{display:flex;align-items:center;gap:9px;background:#168b50;color:white;text-decoration:none;font-weight:700;font-size:13px;padding:12px 17px;border:0;border-radius:28px;box-shadow:0 5px 18px #10120d35}.whatsapp-trigger svg{width:22px;height:22px;fill:currentColor}.whatsapp-trigger:hover{background:#116d3e}.whatsapp-menu{display:grid;min-width:220px;background:white;border:1px solid var(--line);box-shadow:var(--shadow)}.whatsapp-menu[hidden]{display:none}.whatsapp-menu a{padding:12px 14px;color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line);font-size:12px;font-weight:700}.whatsapp-menu a:last-child{border:0}.whatsapp-menu a:hover{background:#f0f5eb}.whatsapp-menu small{display:block;color:var(--muted);margin-top:3px}.review-summary{display:flex;align-items:center;gap:5px;margin-top:10px;color:#b47800;font-size:13px}.review-summary small{color:var(--muted);font-size:9px}.review-open{margin-top:7px;background:transparent;border:0;padding:0;color:#477300;text-decoration:underline;font-size:10px}.star-picker{display:flex;gap:7px}.star-choice{border:0;background:transparent;color:#d69700;font-size:30px;padding:0 2px}.review-form textarea,.customer-extra-settings textarea{width:100%;padding:10px;border:1px solid var(--line);font:inherit;resize:vertical}.review-admin-list{display:grid;gap:8px}.review-admin-item{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line)}.review-admin-item p{margin:7px 0;font-size:12px}.review-admin-item small,.review-admin-item b,.review-stars{display:block}.review-admin-item small{font-size:10px;color:var(--muted);margin-top:3px}.review-stars{color:#b47800}.company-details{display:grid;gap:4px;max-width:360px;color:#abb3aa;font-size:10px}.legal-links{display:flex;gap:12px;margin-top:5px}.legal-links a{color:#d7e9bd}.order-whatsapp-overlay{z-index:16;justify-content:center;align-items:center;padding:16px}.order-whatsapp-drawer{height:auto;max-height:90vh;width:min(480px,100%)}.order-whatsapp-drawer>p{font-size:12px;line-height:1.6;color:var(--muted)}.order-whatsapp-contacts{display:grid;gap:8px}.order-whatsapp-contacts .cta{display:block;text-align:center;text-decoration:none;margin:0}.footer-inner{display:grid;grid-template-columns:1.35fr 1fr 1.1fr 1fr;gap:30px;align-items:start}.footer-group{min-width:0}.footer-group summary{position:relative;cursor:pointer;list-style:none;color:var(--lime);font-size:12px;font-weight:800;text-transform:uppercase;padding:4px 22px 12px 0;border-bottom:1px solid #ffffff24;transition:color .16s ease}.footer-group summary::-webkit-details-marker{display:none}.footer-group summary:after{content:'+';position:absolute;right:1px;top:0;font-size:18px;font-weight:400;line-height:1;transition:transform .16s ease}.footer-group[open] summary:after{content:'−'}.footer-group summary:hover{color:#fff}.footer-group summary:focus-visible,.footer a:focus-visible{outline:2px solid var(--lime);outline-offset:3px}.footer-group-body{display:grid;gap:10px;padding-top:13px}.footer-group-body p{margin:0;line-height:1.7}.footer-group-body a,.footer-social a{width:fit-content;color:#e5e8e2;text-decoration:none;font-size:12px;line-height:1.5;transition:color .16s ease,transform .16s ease}.footer-group-body a:hover,.footer-social a:hover{color:var(--lime);transform:translateX(2px)}.footer-category-group{display:grid;gap:9px}.footer-group-body .footer-subcategory{padding-left:12px;color:#abb3aa;font-size:11px}.footer-brand-col{display:grid;gap:12px}.footer-brand-col .brand-logo{width:min(190px,100%);height:76px;object-fit:contain;object-position:left center}.footer-about{font-size:12px!important;line-height:1.7}.footer-social{display:flex;gap:14px;flex-wrap:wrap}.footer-meta{grid-column:1/-1;border-top:1px solid #ffffff24;padding-top:16px}.footer-inner .footer-group-body a{overflow-wrap:anywhere}@media(max-width:850px){.footer-inner{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}}@media(max-width:700px){.whatsapp-float{right:13px;bottom:calc(13px + env(safe-area-inset-bottom))}.whatsapp-trigger{padding:12px}.whatsapp-trigger span{display:none}.review-admin-item{display:grid}.footer-inner{grid-template-columns:1fr;gap:18px}.footer-brand-col{padding-bottom:5px}.footer-group summary{font-size:13px;padding:8px 26px 12px 0}.footer-group-body{gap:12px}.footer-meta{font-size:11px}}`;
document.head.appendChild(customerStyle);
const deliveryStyle = document.createElement('style');
deliveryStyle.textContent = `.delivery-choice{border:1px solid var(--line);background:white;padding:12px;display:grid;gap:10px;margin:2px 0}.delivery-choice legend{font-size:11px;color:#697269;font-weight:700;padding:0 4px}.delivery-choice>label:not(.delivery-date-field){display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink);font-weight:600}.delivery-choice input[type=radio]{accent-color:#477300;width:16px;height:16px;margin:0}.delivery-date-field{display:block;font-size:11px;color:#697269;font-weight:700}.delivery-date-field[hidden]{display:none}.delivery-date-field input{width:100%;border:1px solid var(--line);background:white;padding:11px;font-size:12px;margin-top:5px}`;
document.head.appendChild(deliveryStyle);
const advisorStyle = document.createElement('style');
advisorStyle.textContent = `.chat-launch{bottom:82px}.chat-head{gap:8px}.chat-head>span{min-width:0;flex:1}.chat-reset{border:1px solid #ffffff55;background:transparent;color:white;padding:7px 8px;font-size:10px;white-space:nowrap}.chat-reset:hover{border-color:#c5f900}.chat-product{align-items:flex-start}.chat-product>div:first-child{min-width:0;flex:1}.chat-product b,.chat-product small{overflow-wrap:anywhere}.chat-product-actions{display:grid;gap:5px;flex:none}.chat-product-actions button:disabled,.chat-input button:disabled{opacity:.5;cursor:not-allowed}.chat-typing{color:var(--muted);font-style:italic}.chat-typing:after{content:' ';display:inline-block;width:12px;animation:chat-dots 1s steps(3,end) infinite}@keyframes chat-dots{0%{content:'.'}33%{content:'..'}66%,100%{content:'...'}}@media(max-width:700px){.chat-launch{bottom:calc(70px + env(safe-area-inset-bottom))}.chat-box{bottom:calc(71px + env(safe-area-inset-bottom));height:min(490px,calc(100dvh - 145px - env(safe-area-inset-bottom)))}}@media(max-width:500px){.chat-product{flex-direction:column}.chat-product-actions{grid-template-columns:1fr 1fr;width:100%}.chat-head{padding:11px}.chat-reset{font-size:9px;padding:7px 5px}.chat-head .close{font-size:22px}}`;
document.head.appendChild(advisorStyle);
initializeAdvisorChat();
whatsappMarkup(); updateCustomerFooter(); renderProducts();
