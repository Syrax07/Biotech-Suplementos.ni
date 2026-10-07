const baseRenderAdmin = renderAdmin;
let activityLog = load('activityLog', []);
let storeSettings = load('storeSettings', {
  name: 'BioTech Suplementos', legalName: '', taxId: '', phone: '', email: '', address: '',
  bannerTitle: 'Entrena con intención.', bannerText: 'Nutrición seleccionada para acompañar tu siguiente nivel.',
  bannerImage: '', bannerVideo: '', logo: 'brand-logo.png'
});
let scannerStream = null;
let logReady = false;

function logActivity(type, detail) {
  activityLog.unshift({ date: new Date().toISOString(), type, detail });
  activityLog = activityLog.slice(0, 500);
  localStorage.setItem('biotech_activityLog', JSON.stringify(activityLog));
}

const originalPlaceOrder = placeOrder;
placeOrder = function (event) {
  const before = orders.length;
  originalPlaceOrder(event);
  if (orders.length > before) logActivity('Pedido creado', `${orders[0].id} · ${orders[0].name} · ${money(orders[0].total)}`);
};

const originalAddExpense = addExpense;
addExpense = function (event) {
  const label = new FormData(event.target).get('label');
  originalAddExpense(event);
  logActivity('Gasto registrado', `${label} · ${money(expenses[0]?.amount)}`);
};

const originalDeleteProduct = deleteProduct;
deleteProduct = function (id) {
  const product = products.find(item => item.id === id), name = product?.name;
  originalDeleteProduct(id);
  if (name && !products.some(item => item.id === id)) logActivity('Producto quitado', name);
};
const originalAddPromo = addPromo;
addPromo = function (event) {
  const count = promos.length;
  originalAddPromo(event);
  if (promos.length > count) logActivity('Promoción creada', promos[0].code);
};
const originalRemoveExpense = removeExpense;
removeExpense = function (index) {
  const expense = expenses[index];
  originalRemoveExpense(index);
  if (expense && !expenses.includes(expense)) logActivity('Gasto eliminado', expense.label);
};
const originalSaveShipping = saveShipping;
saveShipping = function (event) {
  originalSaveShipping(event);
  logActivity('Tarifas de envío editadas', `Envío ${money(shipping.fee)} · gratis desde ${money(shipping.freeFrom)}`);
};
const originalTogglePromo = togglePromo;
togglePromo = function (code) {
  originalTogglePromo(code);
  const promo = promos.find(item => item.code === code);
  if (promo) logActivity(promo.active ? 'Promoción activada' : 'Promoción pausada', code);
};
const originalCloseAdmin = closeAdmin;
closeAdmin = function () { stopBarcodeCamera(); originalCloseAdmin(); };

productForm = function (id) {
  const p = products.find(item => item.id === id) || {
    id: `p${Date.now()}`, name: '', category: 'Proteína', subcategory: 'Proteína', description: '',
    price: '', cost: '', stock: '', incoming: 0, arrivalDate: '', tag: 'Nuevo', image: '', barcode: ''
  };
  const options = Object.values(subcategoryMap).flat();
  const modal = document.createElement('div');
  modal.className = 'overlay show';
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:92vh"><div class="drawer-head"><h2>${id ? 'Editar producto' : 'Nuevo producto'}</h2><button class="close" onclick="this.closest('.overlay').remove()">×</button></div><form class="checkout" style="margin-top:15px" onsubmit="saveCatalogProduct(event,'${esc(id || '')}')"><label>Nombre<input name="name" required value="${esc(p.name)}"></label><label>Categoría principal<select name="category">${Object.keys(subcategoryMap).map(x => `<option ${x === p.category ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Subcategoría<input name="subcategory" list="productSubcategories" required value="${esc(p.subcategory || '')}"><datalist id="productSubcategories">${options.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label><label>Descripción<input name="description" value="${esc(p.description)}"></label><div class="form-grid"><label>Precio (${currency})<input name="price" type="number" min="0" step="0.01" required value="${p.price}"></label><label>Costo (${currency})<input name="cost" type="number" min="0" step="0.01" required value="${p.cost}"></label><label>Stock disponible<input name="stock" type="number" min="0" step="1" required value="${p.stock}"></label><label>Unidades por llegar<input name="incoming" type="number" min="0" step="1" value="${p.incoming || 0}"></label><label>Fecha estimada<input name="arrivalDate" type="date" value="${esc(p.arrivalDate || '')}"></label><label>Código de barras<input name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric"></label><label>Etiqueta<input name="tag" value="${esc(p.tag || '')}"></label></div><label>Imagen del producto (URL)<input name="image" type="url" value="${esc(p.image || '')}" placeholder="https://…"></label><button class="cta">GUARDAR PRODUCTO</button></form></div>`;
  document.body.appendChild(modal);
  if (!p.category && p.categorySuggestion) {
    const category = modal.querySelector('select[name="category"]');
    if (category) { category.value = p.categorySuggestion; category.closest('label').firstChild.textContent = 'Categoría sugerida · revisar'; }
  }
  if (!p.subcategory && p.subcategorySuggestion) {
    const subcategory = modal.querySelector('input[name="subcategory"]');
    if (subcategory) { subcategory.value = p.subcategorySuggestion; subcategory.closest('label').firstChild.textContent = 'Subcategoría sugerida · revisar'; }
  }
};

saveCatalogProduct = function (event, id) {
  event.preventDefault();
  const d = Object.fromEntries(new FormData(event.target));
  const existing = products.find(item => item.id === id);
  const p = {
    ...(existing || {}), id: id || `p${Date.now()}`, ...d, price: +d.price, cost: +d.cost, stock: +d.stock,
    incoming: +d.incoming, arrivalDate: d.arrivalDate || '', allowPreorder: existing?.allowPreorder ?? true,
    image: d.image || existing?.image || ''
  };
  const index = products.findIndex(item => item.id === id);
  if (index >= 0) products[index] = p;
  else products.push(p);
  save('products');
  logActivity(index >= 0 ? 'Producto editado' : 'Producto agregado', p.name);
  event.target.closest('.overlay').remove();
  renderAdmin();
  renderProducts();
  toast('Producto guardado.');
};

editOrder = function (id) {
  const order = orders.find(item => item.id === id);
  if (!order) return;
  const statuses = ['Pendiente', 'En proceso', 'Esperando pago', 'Pago reportado', 'Pago confirmado', 'Confirmado', 'En camino', 'Completado', 'Devolución solicitada', 'Devuelto', 'Cancelado'];
  const payment = order.payment || 'Coordinar por WhatsApp';
  const adjustments = order.adminAdjustment || { type: 'none', value: 0, giftProductId: '', giftQty: 1 };
  const modal = document.createElement('div');
  modal.className = 'overlay show';
  const giftOptions = products.map(product => `<option value="${esc(product.id)}" ${product.id === adjustments.giftProductId ? 'selected' : ''}>${esc(product.name)} · stock ${product.stock}</option>`).join('');
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:92vh"><div class="drawer-head"><h2>Pedido ${esc(order.id)}</h2><button class="close" onclick="this.closest('.overlay').remove()">×</button></div><form class="checkout" style="margin-top:15px" onsubmit="saveOrderChanges(event,'${esc(id)}')"><label>Cliente<input name="name" required value="${esc(order.name)}"></label><label>WhatsApp<input name="phone" required value="${esc(order.phone)}"></label><label>Zona de entrega<input name="address" required value="${esc(order.address)}"></label><label>Fecha de entrega acordada (opcional)<input name="deliveryDate" type="date" value="${esc(order.deliveryDate || '')}"></label><label>Forma de pago<select name="payment" onchange="toggleOrderPayment(this)"><option ${payment === 'Coordinar por WhatsApp' ? 'selected' : ''}>Coordinar por WhatsApp</option><option ${payment === 'Transferencia' ? 'selected' : ''}>Transferencia</option><option ${payment === 'Efectivo contra entrega' ? 'selected' : ''}>Efectivo contra entrega</option></select></label><div class="order-transfer-fields" style="display:${payment === 'Transferencia' ? 'grid' : 'none'};gap:8px"><label>Moneda recibida<select name="paymentCurrency"><option value="USD" ${order.paymentCurrency === 'USD' ? 'selected' : ''}>Dólares (USD)</option><option value="NIO" ${order.paymentCurrency === 'NIO' ? 'selected' : ''}>Córdobas (NIO)</option></select></label><label>Monto transferido<input name="paymentAmount" type="number" min="0" step="0.01" value="${order.paymentAmount ?? ''}" placeholder="Total recibido"></label><label>Banco o detalle de transferencia<input name="paymentDetail" maxlength="100" value="${esc(order.paymentDetail || '')}" placeholder="Banco, cuenta o referencia"></label><label>Número de comprobante / voucher<input name="voucherNumber" maxlength="80" value="${esc(order.voucherNumber || '')}" placeholder="Número de operación"></label></div><label>Beneficio administrativo<select name="adjustmentType" onchange="toggleOrderAdjustment(this)"><option value="none" ${adjustments.type === 'none' ? 'selected' : ''}>Sin ajuste</option><option value="percent" ${adjustments.type === 'percent' ? 'selected' : ''}>Descuento porcentual</option><option value="amount" ${adjustments.type === 'amount' ? 'selected' : ''}>Descuento fijo</option><option value="gift" ${adjustments.type === 'gift' ? 'selected' : ''}>Agregar regalía</option></select></label><div class="order-discount-fields" style="display:${['percent', 'amount'].includes(adjustments.type) ? 'grid' : 'none'};gap:8px"><label>${adjustments.type === 'percent' ? 'Porcentaje de descuento' : 'Descuento en ' + currency}<input name="adjustmentValue" type="number" min="0" step="0.01" max="${adjustments.type === 'percent' ? '100' : ''}" value="${adjustments.value || 0}"></label></div><div class="order-gift-fields" style="display:${adjustments.type === 'gift' ? 'grid' : 'none'};gap:8px"><label>Producto de regalo<select name="giftProductId"><option value="">Seleccionar producto</option>${giftOptions}</select></label><label>Unidades<input name="giftQty" type="number" min="1" step="1" value="${adjustments.giftQty || 1}"></label></div><label>Estado<select name="status" ${order.status === 'Cancelado' ? 'disabled' : ''}>${statuses.map(s => `<option ${s === order.status ? 'selected' : ''}>${s}</option>`).join('')}</select>${order.status === 'Cancelado' ? '<input type="hidden" name="status" value="Cancelado">' : ''}</label><label>Importe devuelto (${currency})<input name="refundAmount" type="number" min="0" step="0.01" value="${order.refundAmount || 0}"></label><label class="return-restock"><input name="restockReturn" type="checkbox" checked> Reintegrar los productos devueltos al inventario</label><div class="fine">${order.items.map(item => `${item.qty} × ${esc(item.name)}${item.preorder ? ' · encargo' : ''}${item.isGift ? ' · regalía' : ''}`).join('<br>')}<br>Total: ${money(order.total)}</div><button class="cta">GUARDAR CAMBIOS</button></form></div>`;
  document.body.appendChild(modal);
};

toggleOrderPayment = function (select) {
  const fields = select.form.querySelector('.order-transfer-fields');
  const visible = select.value === 'Transferencia';
  fields.style.display = visible ? 'grid' : 'none';
  fields.querySelectorAll('input,select').forEach(field => { field.disabled = !visible; });
};

toggleOrderAdjustment = function (select) {
  const form = select.form;
  form.querySelector('.order-discount-fields').style.display = ['percent', 'amount'].includes(select.value) ? 'grid' : 'none';
  form.querySelector('.order-gift-fields').style.display = select.value === 'gift' ? 'grid' : 'none';
};

saveOrderChanges = function (event, id) {
  event.preventDefault();
  const order = orders.find(item => item.id === id);
  if (!order) return;
  const data = Object.fromEntries(new FormData(event.target));
  const originalGift = order.items.find(item => item.isGift);
  const baseItems = order.items.filter(item => !item.isGift);
  const baseSubtotal = Number(order.subtotal) || baseItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const baseTotal = Math.max(0, baseSubtotal - (Number(order.discount) || 0) + (Number(order.shipping) || 0));
  const adjustmentType = data.adjustmentType || 'none';
  const adjustmentValue = Math.max(0, Number(data.adjustmentValue) || 0);
  if (adjustmentType === 'percent' && adjustmentValue > 100) return toast('El descuento no puede superar el 100%.');
  const adminDiscount = adjustmentType === 'percent' ? baseSubtotal * adjustmentValue / 100 : adjustmentType === 'amount' ? Math.min(baseSubtotal, adjustmentValue) : 0;
  let nextGift = null;
  if (adjustmentType === 'gift') {
    const product = products.find(item => item.id === data.giftProductId);
    const qty = Math.max(1, Math.floor(Number(data.giftQty) || 1));
    const available = Number(product?.stock || 0) + Number(originalGift?.qty || 0);
    if (!product || available < qty) return toast('La regalía no tiene suficientes unidades disponibles.');
    nextGift = { id: product.id, name: product.name, qty, price: 0, cost: product.cost || 0, isGift: true };
  }
  if (order.status !== 'Cancelado') {
    if (originalGift) {
      const oldProduct = products.find(item => item.id === originalGift.id);
      if (oldProduct) oldProduct.stock += originalGift.qty;
    }
    if (nextGift) {
      const newProduct = products.find(item => item.id === nextGift.id);
      newProduct.stock -= nextGift.qty;
    }
    save('products');
  }
  order.items = [...baseItems, ...(nextGift ? [nextGift] : [])];
  order.adminAdjustment = { type: adjustmentType, value: adjustmentType === 'gift' || adjustmentType === 'none' ? 0 : adjustmentValue, giftProductId: nextGift?.id || '', giftQty: nextGift?.qty || 1 };
  order.adminDiscount = adminDiscount;
  order.total = Math.max(0, baseTotal - adminDiscount);
  delete data.adjustmentType; delete data.adjustmentValue; delete data.giftProductId; delete data.giftQty;
  if (data.payment !== 'Transferencia') {
    data.paymentCurrency = ''; data.paymentAmount = ''; data.paymentDetail = ''; data.voucherNumber = '';
  } else {
    data.paymentAmount = Math.max(0, Number(data.paymentAmount) || 0);
  }
  const wasReturn = order.status === 'Devuelto';
  const willCancel = data.status === 'Cancelado' && order.status !== 'Cancelado';
  const willReturn = data.status === 'Devuelto' && !wasReturn;
  if (willCancel || (willReturn && data.restockReturn === 'on')) {
    for (const item of order.items) {
      const product = products.find(p => p.id === item.id);
      if (!product) continue;
      const preorderQty = item.preorderQty ?? (item.preorder ? item.qty : 0);
      const returnQty = willCancel ? item.qty : item.qty;
      if (willCancel || data.restockReturn === 'on') {
        product.stock += Math.max(0, returnQty - preorderQty);
        product.incoming = (product.incoming || 0) + preorderQty;
      }
    }
    save('products');
    if (willCancel && nextGift) {
      const giftProduct = products.find(item => item.id === nextGift.id);
      if (giftProduct) giftProduct.stock += nextGift.qty;
      save('products');
    }
  }
  data.refundAmount = Math.min(order.total, +data.refundAmount || 0);
  data.restocked = data.status === 'Devuelto' && data.restockReturn === 'on';
  delete data.restockReturn;
  const oldStatus = order.status;
  Object.assign(order, data);
  save('orders');
  logActivity(oldStatus !== order.status ? `Pedido ${order.status.toLowerCase()}` : 'Pedido editado', `${order.id} · ${order.name}`);
  event.target.closest('.overlay').remove();
  renderAdmin();
  renderProducts();
  toast('Pedido actualizado.');
};

function renderManualOrderAction() {
  const bar = document.querySelector('#panel-orders .admin-bar');
  if (!bar || bar.querySelector('[data-manual-order]')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'admin-action'; button.dataset.manualOrder = 'yes';
  button.textContent = '+ Nuevo pedido manual'; button.onclick = openManualOrder;
  bar.appendChild(button);
}

function manualOrderLineMarkup() {
  return `<div class="manual-order-line" style="display:grid;grid-template-columns:minmax(130px,2fr) minmax(70px,.7fr) auto auto;gap:8px;align-items:end;border-bottom:1px solid var(--line);padding:9px 0"><label>Producto<select name="manualProduct" required onchange="updateManualOrderTotal()"><option value="">Seleccionar</option>${products.map(product => `<option value="${esc(product.id)}">${esc(product.name)} · ${product.stock} en stock${product.incoming ? ` + ${product.incoming} por llegar` : ''}</option>`).join('')}</select></label><label>Cantidad<input name="manualQty" type="number" min="1" step="1" value="1" required oninput="updateManualOrderTotal()"></label><label style="display:flex;align-items:center;gap:5px;padding-bottom:10px"><input name="manualGift" type="checkbox" onchange="updateManualOrderTotal()">Regalía</label><button type="button" class="admin-action" aria-label="Quitar producto" title="Quitar producto" onclick="removeManualOrderLine(this)">×</button></div>`;
}

function openManualOrder() {
  const modal = document.createElement('div'); modal.className = 'overlay show'; modal.id = 'manualOrderModal';
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:94vh;overflow:auto"><div class="drawer-head"><h2>Nuevo pedido manual</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div><form class="checkout" style="margin-top:14px" onsubmit="saveManualOrder(event)"><div class="form-grid"><label>Cliente<input name="name" required maxlength="100" placeholder="Nombre y apellido"></label><label>WhatsApp del cliente<input name="phone" required type="tel" inputmode="tel" placeholder="85672287"></label><label class="field-full">Dirección / zona de entrega<input name="address" required maxlength="200" placeholder="Ciudad, barrio y referencia"></label><label>Fecha acordada (opcional)<input name="deliveryDate" type="date"></label></div><div class="admin-bar"><span>Productos del pedido</span><button type="button" class="admin-action" onclick="addManualOrderLine()">+ Agregar producto</button></div><div class="manual-order-lines">${manualOrderLineMarkup()}</div><div class="form-grid" style="margin-top:10px"><label>Descuento<select name="manualDiscountType" onchange="toggleManualDiscount(this)"><option value="none">Sin descuento</option><option value="percent">Porcentaje</option><option value="amount">Monto fijo</option></select></label><label class="manual-discount-value" style="display:none">Valor del descuento<input name="manualDiscountValue" type="number" min="0" step="0.01" value="0" oninput="updateManualOrderTotal()"></label><label>Envío (${currency})<input name="manualShipping" type="number" min="0" step="0.01" value="${Number(shipping.fee) || 0}" oninput="updateManualOrderTotal()"></label><label>Forma de pago<select name="payment" onchange="toggleOrderPayment(this)"><option>Coordinar por WhatsApp</option><option>Transferencia</option><option>Efectivo contra entrega</option></select></label></div><div class="order-transfer-fields" style="display:none;gap:8px"><label>Moneda recibida<select name="paymentCurrency"><option value="USD">Dólares (USD)</option><option value="NIO">Córdobas (NIO)</option></select></label><label>Monto transferido<input name="paymentAmount" type="number" min="0" step="0.01" placeholder="Total recibido"></label><label>Banco o detalle de transferencia<input name="paymentDetail" maxlength="100" placeholder="Banco, cuenta o referencia"></label><label>Número de comprobante / voucher<input name="voucherNumber" maxlength="80" placeholder="Número de operación"></label></div><label style="display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.45"><input type="checkbox" name="manualMarketingOptIn" style="width:auto;margin-top:2px">El cliente aceptó recibir novedades y promociones por WhatsApp.</label><div class="manual-order-summary" aria-live="polite" style="padding:12px 0;border-top:1px solid var(--line);font-size:13px">Selecciona productos para calcular el total.</div><button class="cta">GUARDAR PEDIDO Y PREPARAR WHATSAPP</button><p class="fine">El pedido quedará pendiente. WhatsApp abrirá un mensaje preparado al número del cliente; tendrás que pulsar Enviar.</p></form></div>`;
  document.body.appendChild(modal); updateManualOrderTotal();
}

function addManualOrderLine() {
  const list = document.querySelector('#manualOrderModal .manual-order-lines');
  if (list) list.insertAdjacentHTML('beforeend', manualOrderLineMarkup());
  updateManualOrderTotal();
}

function removeManualOrderLine(button) {
  const list = button.closest('.manual-order-lines');
  if (list.querySelectorAll('.manual-order-line').length <= 1) return toast('El pedido debe tener al menos un producto.');
  button.closest('.manual-order-line').remove(); updateManualOrderTotal();
}

function toggleManualDiscount(select) {
  const field = select.form.querySelector('.manual-discount-value');
  field.style.display = select.value === 'none' ? 'none' : 'block';
  updateManualOrderTotal();
}

function manualOrderAmounts(form) {
  const lines = [...form.querySelectorAll('.manual-order-line')].map(row => {
    const product = products.find(item => item.id === row.querySelector('[name="manualProduct"]').value);
    const qty = Math.max(0, Math.floor(Number(row.querySelector('[name="manualQty"]').value) || 0));
    const gift = row.querySelector('[name="manualGift"]').checked;
    return { product, qty, gift, amount: product && !gift ? product.price * qty : 0 };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const type = form.elements.manualDiscountType.value;
  const value = Math.max(0, Number(form.elements.manualDiscountValue.value) || 0);
  const discount = type === 'percent' ? Math.min(subtotal, subtotal * Math.min(value, 100) / 100) : type === 'amount' ? Math.min(subtotal, value) : 0;
  const ship = Math.max(0, Number(form.elements.manualShipping.value) || 0);
  return { lines, subtotal, discount, ship, total: Math.max(0, subtotal - discount + ship) };
}

function updateManualOrderTotal() {
  const form = document.querySelector('#manualOrderModal form'); if (!form) return;
  const amounts = manualOrderAmounts(form), summary = form.querySelector('.manual-order-summary');
  summary.innerHTML = `<div style="display:flex;justify-content:space-between"><span>Subtotal</span><b>${money(amounts.subtotal)}</b></div>${amounts.discount ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Descuento</span><b>−${money(amounts.discount)}</b></div>` : ''}<div style="display:flex;justify-content:space-between"><span>Envío</span><b>${money(amounts.ship)}</b></div><div style="display:flex;justify-content:space-between;font-size:16px;margin-top:6px"><strong>Total</strong><strong>${money(amounts.total)}</strong></div>`;
}

function saveManualOrder(event) {
  event.preventDefault();
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  const amounts = manualOrderAmounts(form), quantityByProduct = new Map();
  if (!amounts.lines.length || amounts.lines.some(line => !line.product || line.qty < 1)) return toast('Selecciona cada producto e indica una cantidad válida.');
  if (data.manualDiscountType === 'percent' && Number(data.manualDiscountValue) > 100) return toast('El descuento no puede superar el 100%.');
  for (const line of amounts.lines) quantityByProduct.set(line.product.id, (quantityByProduct.get(line.product.id) || 0) + line.qty);
  for (const [productId, qty] of quantityByProduct) {
    const product = products.find(item => item.id === productId);
    if (!product || qty > product.stock + (product.incoming || 0) || (qty > product.stock && product.allowPreorder === false)) return toast(`No hay unidades suficientes de ${product?.name || 'un producto'}.`);
  }
  const remaining = new Map(products.map(product => [product.id, { stock: product.stock, incoming: product.incoming || 0 }]));
  const items = amounts.lines.map(line => {
    const product = line.product, available = remaining.get(product.id);
    const preorderQty = Math.max(0, line.qty - available.stock);
    available.stock = Math.max(0, available.stock - line.qty);
    available.incoming = Math.max(0, available.incoming - preorderQty);
    return { id: product.id, name: product.name, qty: line.qty, preorder: preorderQty > 0, preorderQty, price: line.gift ? 0 : product.price, cost: product.cost || 0, arrivalDate: product.arrivalDate || '', isGift: line.gift };
  });
  const id = `BT-${Date.now().toString().slice(-7)}`;
  const adjustmentType = data.manualDiscountType;
  const adjustmentValue = adjustmentType === 'none' ? 0 : Math.max(0, Number(data.manualDiscountValue) || 0);
  const order = {
    id, date: new Date().toISOString(), name: data.name.trim(), phone: data.phone.trim(), address: data.address.trim(),
    deliveryDate: data.deliveryDate || '', payment: data.payment, paymentCurrency: data.payment === 'Transferencia' ? data.paymentCurrency || 'USD' : '',
    paymentAmount: data.payment === 'Transferencia' ? Math.max(0, Number(data.paymentAmount) || amounts.total) : '',
    paymentDetail: data.payment === 'Transferencia' ? data.paymentDetail || '' : '',
    voucherNumber: data.payment === 'Transferencia' ? data.voucherNumber || '' : '',
    items, subtotal: amounts.subtotal, shipping: amounts.ship, discount: 0, adminDiscount: amounts.discount,
    adminAdjustment: { type: adjustmentType, value: adjustmentValue, giftProductId: '', giftQty: 1 },
    promoCode: '', total: amounts.total, status: 'Pendiente', source: 'Manual', marketingOptIn: data.manualMarketingOptIn === 'on'
  };
  for (const [productId, balance] of remaining) {
    const product = products.find(item => item.id === productId);
    if (product) { product.stock = balance.stock; product.incoming = balance.incoming; }
  }
  orders.unshift(order); save('products'); save('orders');
  logActivity('Pedido manual creado', `${order.id} · ${order.name} · ${money(order.total)}`);
  document.getElementById('manualOrderModal')?.remove(); renderAdmin(); renderProducts(); toast('Pedido manual guardado.');
  showManualOrderWhatsApp(order);
}

function manualOrderWhatsAppMessage(order) {
  const displayMoney = amount => typeof dualMoneyText === 'function' ? dualMoneyText(amount) : money(amount);
  const lines = order.items.map(item => {
    const product = products.find(row => row.id === item.id);
    const description = product?.description ? `\n  ${product.description}` : '';
    const availability = item.isGift ? ' · REGALÍA' : item.preorder ? ` · ENCARGO, llega aprox. ${dateText(item.arrivalDate)}` : '';
    return `• ${item.name} × ${item.qty}${availability} — ${displayMoney(item.price * item.qty)}${description}`;
  }).join('\n');
  return [`Hola ${order.name}, te comparto el resumen de tu pedido en ${storeSettings.name}:`, '', `Pedido ${order.id}`, lines, '', `Subtotal: ${displayMoney(order.subtotal)}`, order.adminDiscount ? `Descuento: −${displayMoney(order.adminDiscount)}` : '', `Envío: ${displayMoney(order.shipping)}`, `TOTAL: ${displayMoney(order.total)}`, `Entrega: ${order.address}`, `Fecha: ${dateText(order.deliveryDate)}`, `Pago: ${order.payment}`, '', 'Por favor, confirma si los productos y datos están correctos.'].filter(Boolean).join('\n');
}

function showManualOrderWhatsApp(order) {
  const digits = String(order.phone || '').replace(/\D/g, ''), phone = digits.length === 8 ? `505${digits}` : digits;
  const message = manualOrderWhatsAppMessage(order), modal = document.createElement('div');
  modal.className = 'overlay show order-whatsapp-overlay'; modal.id = 'manualOrderWhatsApp';
  modal.innerHTML = `<div class="drawer order-whatsapp-drawer" style="margin:auto;height:auto;max-height:90vh"><div class="drawer-head"><h2>Pedido ${esc(order.id)} listo</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div><p>El pedido quedó guardado como pendiente. Puedes enviar el resumen al WhatsApp del cliente para que confirme.</p>${phone.length >= 8 ? `<a class="cta" style="display:block;text-align:center;text-decoration:none" href="https://wa.me/${esc(phone)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">Enviar al cliente por WhatsApp</a>` : '<p>El número no parece válido. Puedes copiar el resumen y corregir el contacto desde el pedido.</p>'}<button type="button" class="admin-action" style="margin-top:10px" onclick="copyManualOrderMessage('${esc(order.id)}')">Copiar resumen</button><details class="order-message-preview"><summary>Ver mensaje</summary><pre>${esc(message)}</pre></details><p class="fine">WhatsApp no envía el mensaje automáticamente; revisa y pulsa Enviar.</p></div>`;
  document.body.appendChild(modal);
}

function copyManualOrderMessage(orderId) {
  const order = orders.find(item => item.id === orderId); if (!order) return;
  const text = manualOrderWhatsAppMessage(order);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Resumen copiado.')).catch(() => toast('No se pudo copiar; selecciona el resumen manualmente.'));
}

orderTable = function (list) {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Productos y entrega</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(o => `<tr><td><strong>${esc(o.id)}</strong><small>${new Date(o.date).toLocaleDateString('es-NI')}</small></td><td>${esc(o.name)}<small>${esc(o.phone)} · ${esc(o.address)}</small></td><td>${o.items.map(i => `${i.qty}× ${esc(i.name)}${i.preorder ? ' · encargo' : ''}`).join(', ')}<small>${esc(o.payment || '')} · entrega: ${dateText(o.deliveryDate)}</small></td><td>${money(o.total)}${o.refundAmount ? `<small>Devuelto ${money(o.refundAmount)}</small>` : ''}</td><td><span class="status">${esc(o.status)}</span></td><td><button class="admin-action" onclick="editOrder('${esc(o.id)}')">Editar</button> <button class="admin-action" onclick="printDocument('${esc(o.id)}','ticket')">Ticket</button></td></tr>`).join('')}</tbody></table></div>`;
};

function rangeOrders(range) {
  const now = new Date();
  const orderMetrics = list => list.filter(order => order.status !== 'Cancelado').reduce((result, order) => {
    const subtotal = Number(order.subtotal) || (order.items || []).reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
    const discount = Math.max(0, Number(order.discount) || 0) + Math.max(0, Number(order.adminDiscount) || 0);
    const refund = order.status === 'Devuelto' ? Math.max(0, Number(order.refundAmount) || 0) : 0;
    const netSales = Math.max(0, subtotal - discount - refund);
    const cost = orderCost(order);
    const paid = ['Pago confirmado', 'Completado'].includes(order.status) ? Math.max(0, Number(order.total) - refund) : 0;
    result.grossSales += subtotal;
    result.sales += netSales;
    result.cogs += cost;
    result.cashIn += paid;
    return result;
  }, { grossSales: 0, sales: 0, cogs: 0, cashIn: 0 });
  const expensesFor = key => expenses.filter(item => range === 'day' ? String(item.date || '').slice(0, 10) === key : range === 'month' ? String(item.date || '').slice(0, 7) === key : String(item.date || '').slice(0, 4) === key).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const supplierPaymentsFor = key => (typeof supplierLedger === 'undefined' ? [] : supplierLedger).filter(item => {
    const date = String(item.date || '').slice(0, range === 'day' ? 10 : range === 'month' ? 7 : 4);
    return date === key && Number(item.amount) < 0 && !/revers|nota de crédito/i.test(item.type || '');
  }).reduce((sum, item) => sum - Number(item.amount), 0);
  const point = (label, key, match) => {
    const metrics = orderMetrics(orders.filter(order => match(String(order.date || ''))));
    const operatingExpenses = expensesFor(key), supplierPaid = supplierPaymentsFor(key);
    return { label, key, ...metrics, expenses: operatingExpenses, supplierPaid,
      grossProfit: metrics.sales - metrics.cogs,
      netProfit: metrics.sales - metrics.cogs - operatingExpenses,
      cashOut: operatingExpenses + supplierPaid,
      cashNet: metrics.cashIn - operatingExpenses - supplierPaid };
  };
  if (range === 'day') {
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(now); date.setDate(now.getDate() - 13 + index);
      const key = date.toLocaleDateString('en-CA');
      return point(date.toLocaleDateString('es-NI', { day: 'numeric', month: 'short' }), key, value => value.slice(0, 10) === key);
    });
  }
  if (range === 'month') {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return point(date.toLocaleDateString('es-NI', { month: 'short' }), key, value => value.slice(0, 7) === key);
    });
  }
  return Array.from({ length: 5 }, (_, index) => {
    const year = now.getFullYear() - 4 + index;
    return point(String(year), String(year), value => value.slice(0, 4) === String(year));
  });
}

function drawSalesChart(range) {
  const canvas = document.getElementById('salesChart');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = rect.width * scale; canvas.height = rect.height * scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, points = rangeOrders(range), pad = { left: 48, right: 12, top: 15, bottom: 35 };
  const values = points.flatMap(point => [point.sales, point.cogs, point.expenses, point.netProfit]);
  const ceiling = Math.max(1, ...values), floor = Math.min(0, ...values), span = Math.max(1, ceiling - floor);
  ctx.clearRect(0, 0, w, h); ctx.font = '11px DM Sans'; ctx.textAlign = 'right';
  for (let row = 0; row <= 4; row++) {
    const y = pad.top + (h - pad.top - pad.bottom) * row / 4;
    ctx.strokeStyle = '#e8eae3'; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#788078'; ctx.fillText(money(ceiling - span * row / 4), pad.left - 7, y + 4);
  }
  const chartHeight = h - pad.top - pad.bottom, zeroY = pad.top + chartHeight * ceiling / span;
  ctx.strokeStyle = '#899188'; ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(w - pad.right, zeroY); ctx.stroke();
  const slot = (w - pad.left - pad.right) / points.length, bar = Math.max(2, Math.min(9, slot * .16));
  points.forEach((p, i) => {
    const center = pad.left + slot * (i + .5);
    [[p.sales, '#7ab800'], [p.cogs, '#e9a321'], [p.expenses, '#e34848'], [p.netProfit, '#1677b8']].forEach(([value, color], series) => {
      const valueY = pad.top + chartHeight * (ceiling - value) / span;
      ctx.fillStyle = color; ctx.fillRect(center + (series - 1.5) * bar, Math.min(zeroY, valueY), bar - 1, Math.max(1, Math.abs(zeroY - valueY)));
    });
    if (points.length <= 14 || i % 2 === 0) { ctx.fillStyle = '#788078'; ctx.textAlign = 'center'; ctx.fillText(p.label, center, h - 12); }
  });
}

function renderInsights() {
  const range = document.getElementById('reportRange')?.value || 'month';
  const points = rangeOrders(range), totals = points.reduce((sum, p) => {
    for (const key of ['grossSales', 'sales', 'cogs', 'expenses', 'supplierPaid', 'grossProfit', 'netProfit', 'cashIn', 'cashOut', 'cashNet']) sum[key] += p[key];
    return sum;
  }, { grossSales: 0, sales: 0, cogs: 0, expenses: 0, supplierPaid: 0, grossProfit: 0, netProfit: 0, cashIn: 0, cashOut: 0, cashNet: 0 });
  const cancelled = orders.filter(o => o.status === 'Cancelado').length, returned = orders.filter(o => o.status === 'Devuelto').length;
  const pendingStatuses = ['Pendiente', 'En proceso', 'Esperando pago', 'Pago reportado', 'Confirmado', 'En camino'];
  const pendingOrders = orders.filter(order => pendingStatuses.includes(order.status));
  const outstanding = pendingOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const periodKeys = new Set(points.map(point => point.key));
  const periodExpenses = expenses.filter(item => periodKeys.has(String(item.date || '').slice(0, range === 'day' ? 10 : range === 'month' ? 7 : 4)));
  const categories = Object.entries(periodExpenses.reduce((result, item) => { const label = String(item.label || 'Sin descripción'); result[label] = (result[label] || 0) + (Number(item.amount) || 0); return result; }, {})).sort((a, b) => b[1] - a[1]);
  const expenseTop = categories[0];
  const missingCost = products.filter(product => !(Number(product.cost) > 0));
  const lowMargin = products.filter(product => Number(product.price) > 0 && Number(product.cost) > 0 && (product.price - product.cost) / product.price < .15).slice(0, 3);
  const current = points.at(-1), previous = points.at(-2);
  const trend = previous?.sales > 0 ? ((current.sales - previous.sales) / previous.sales) * 100 : null;
  const advice = [];
  if (totals.netProfit < 0) advice.push(`La ganancia neta estimada es negativa (${money(totals.netProfit)}). Revisa costos, descuentos y gastos del período.`);
  else if (totals.sales > 0 && totals.netProfit / totals.sales < .1) advice.push('El margen neto estimado está por debajo del 10%; revisa precios y gastos antes de aumentar promociones.');
  if (missingCost.length) advice.push(`${missingCost.length} producto(s) no tienen costo registrado; su ganancia no se puede calcular bien.`);
  if (lowMargin.length) advice.push(`Margen menor al 15%: ${lowMargin.map(product => esc(product.name)).join(', ')}.`);
  if (expenseTop) advice.push(`Mayor gasto registrado: ${esc(expenseTop[0])} (${money(expenseTop[1])}). Compara su resultado con las ventas que ayuda a generar.`);
  if (outstanding > 0) advice.push(`Hay ${pendingOrders.length} pedido(s) por confirmar o cobrar, por ${money(outstanding)}; no se cuentan como ingreso recibido.`);
  if (trend !== null) advice.push(`Ventas netas del último período ${trend >= 0 ? 'subieron' : 'bajaron'} ${Math.abs(trend).toFixed(1)}% frente al período anterior.`);
  if (!advice.length) advice.push('Aún no hay suficiente información para detectar alertas. Registra costos, gastos y actualiza el estado de pago de cada pedido.');
  const netClass = totals.netProfit < 0 ? 'finance-negative' : 'finance-positive';
  document.getElementById('panel-insights').innerHTML = `<div class="admin-bar"><span>Ventas, costos, caja y tendencias</span><label class="range-label">Ver por <select id="reportRange" onchange="renderInsights()"><option value="day" ${range === 'day' ? 'selected' : ''}>Día · últimos 14 días</option><option value="month" ${range === 'month' ? 'selected' : ''}>Mes · últimos 12 meses</option><option value="year" ${range === 'year' ? 'selected' : ''}>Año · últimos 5 años</option></select></label></div><div class="metrics finance-metrics"><div class="metric"><span>Venta bruta</span><strong>${money(totals.grossSales)}</strong></div><div class="metric"><span>Venta neta tras descuentos/devoluciones</span><strong>${money(totals.sales)}</strong></div><div class="metric"><span>Costo de productos vendidos</span><strong>${money(totals.cogs)}</strong></div><div class="metric profit"><span>Ganancia bruta estimada</span><strong>${money(totals.grossProfit)}</strong></div><div class="metric"><span>Gastos operativos</span><strong>${money(totals.expenses)}</strong></div><div class="metric ${netClass}"><span>Ganancia neta estimada</span><strong>${money(totals.netProfit)}</strong></div><div class="metric"><span>Entradas de pedidos pagados</span><strong>${money(totals.cashIn)}</strong></div><div class="metric"><span>Salidas: gastos + abonos a proveedor</span><strong>${money(totals.cashOut)}</strong></div><div class="metric ${totals.cashNet < 0 ? 'finance-negative' : ''}"><span>Flujo neto de caja estimado</span><strong>${money(totals.cashNet)}</strong></div><div class="metric"><span>Pendiente por cobrar · ${pendingOrders.length} pedidos</span><strong>${money(outstanding)}</strong></div><div class="metric"><span>Cancelados / devueltos</span><strong>${cancelled} / ${returned}</strong></div><div class="metric"><span>Productos sin costo</span><strong>${missingCost.length}</strong></div></div><div class="chart-panel"><div class="chart-title">Comportamiento del período <span class="finance-legend"><i class="sales"></i> Venta neta <i class="cost"></i> Costo <i class="expense"></i> Gastos <i class="profit"></i> Ganancia neta</span></div><canvas id="salesChart" height="280"></canvas></div><section class="finance-advisor"><h3>Recomendaciones automáticas</h3><ul>${advice.map(item => `<li>${item}</li>`).join('')}</ul></section><p class="fine">Estimaciones internas, no contabilidad ni asesoría financiera. Se excluyen pedidos cancelados; solo “Pago confirmado” y “Completado” suman como entrada. Registra cada abono y costo. Los datos son locales y no se sincronizan entre dispositivos. Verifica que todos los importes del período usen la misma moneda; la versión actual no guarda la moneda histórica de gastos ni compras.</p>`;
  requestAnimationFrame(() => drawSalesChart(range));
}

function renderActivity() {
  document.getElementById('panel-log').innerHTML = `<div class="admin-bar"><span>Últimos ${activityLog.length} movimientos registrados</span><button class="admin-action" onclick="exportActivity()">Descargar CSV</button></div>${activityLog.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha y hora</th><th>Movimiento</th><th>Detalle</th></tr></thead><tbody>${activityLog.map(row => `<tr><td>${new Date(row.date).toLocaleString('es-NI')}</td><td>${esc(row.type)}</td><td>${esc(row.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Los cambios en pedidos, productos y gastos aparecerán aquí.</div>'}`;
}

function exportActivity() {
  const rows = [['Fecha', 'Movimiento', 'Detalle'], ...activityLog.map(x => [x.date, x.type, x.detail])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'biotech-bitacora.csv'; a.click(); URL.revokeObjectURL(a.href);
}

function renderScanner() {
  document.getElementById('panel-scanner').innerHTML = `<div class="admin-bar"><span>Lee el código o busca el producto manualmente</span></div><div class="scan-layout"><div><form class="scan-form" onsubmit="lookupBarcode(event)"><label>Código de barras<input id="barcodeInput" name="barcode" autocomplete="off" placeholder="Escanea o escribe el código"></label><button class="cta">BUSCAR</button></form><div id="scanResult" class="scan-result">Elige una entrada para recibir productos o una salida para registrar unidades vendidas, dañadas o usadas.</div><form id="stockMoveForm" class="scan-form" onsubmit="saveStockMove(event)" hidden><input type="hidden" name="productId"><label>Movimiento<select name="direction"><option value="in">Entrada al inventario</option><option value="out">Salida de inventario</option></select></label><label>Unidades<input name="quantity" type="number" min="1" step="1" required value="1"></label><label>Motivo<input name="reason" required placeholder="Compra, venta, ajuste…"></label><button class="cta">REGISTRAR MOVIMIENTO</button></form></div><div><video id="barcodeVideo" playsinline muted></video><button class="admin-action" onclick="startBarcodeCamera()">Usar cámara</button> <button class="admin-action" onclick="stopBarcodeCamera()">Detener cámara</button><p class="fine">La cámara requiere HTTPS y un navegador con detección de códigos. Si no está disponible, escribe el código en el campo.</p></div></div>`;
}

function lookupBarcode(event) {
  event?.preventDefault();
  const code = document.getElementById('barcodeInput').value.trim();
  const product = products.find(p => p.barcode && p.barcode === code);
  const result = document.getElementById('scanResult'), form = document.getElementById('stockMoveForm');
  if (!product) { form.hidden = true; result.textContent = 'No hay un producto con ese código. Agrégalo o edita un producto para asignarle este código de barras.'; return; }
  result.innerHTML = `<strong>${esc(product.name)}</strong><br>Disponible: ${product.stock} · Por llegar: ${product.incoming || 0}`;
  form.hidden = false; form.elements.productId.value = product.id;
}

function saveStockMove(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target)), product = products.find(p => p.id === data.productId), quantity = +data.quantity;
  if (!product || quantity < 1) return;
  if (data.direction === 'out' && quantity > product.stock) return toast('La salida supera el stock disponible.');
  product.stock += data.direction === 'in' ? quantity : -quantity;
  save('products');
  logActivity(data.direction === 'in' ? 'Entrada de inventario' : 'Salida de inventario', `${product.name} · ${quantity} · ${data.reason}`);
  renderAdmin(); renderProducts(); toast('Movimiento de inventario registrado.');
}

async function startBarcodeCamera() {
  if (!('BarcodeDetector' in window)) return toast('Este navegador no dispone de lector de cámara. Escribe el código manualmente.');
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('barcodeVideo'); video.srcObject = scannerStream; await video.play();
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    const scan = async () => {
      if (!scannerStream || !document.getElementById('barcodeVideo')) return;
      const found = await detector.detect(video);
      if (found.length) { document.getElementById('barcodeInput').value = found[0].rawValue; lookupBarcode(); stopBarcodeCamera(); return; }
      setTimeout(scan, 400);
    };
    scan();
  } catch { toast('No se pudo abrir la cámara. Revisa el permiso o escribe el código manualmente.'); }
}

function stopBarcodeCamera() {
  scannerStream?.getTracks().forEach(track => track.stop()); scannerStream = null;
  const video = document.getElementById('barcodeVideo'); if (video) video.srcObject = null;
}

function renderReturns() {
  const returns = orders.filter(o => ['Devolución solicitada', 'Devuelto'].includes(o.status));
  document.getElementById('panel-returns').innerHTML = `<div class="admin-bar"><span>${returns.length} devoluciones · ${money(returns.reduce((sum, o) => sum + (+o.refundAmount || 0), 0))} reembolsados</span></div>${returns.length ? orderTable(returns) : '<div class="empty">Para registrar una devolución, edita un pedido y cambia su estado a “Devolución solicitada” o “Devuelto”.</div>'}`;
}

function renderStoreSettings() {
  document.getElementById('panel-store').innerHTML = `<div class="admin-bar"><span>Información de contacto, marca y portada de la tienda</span></div><form class="store-form" onsubmit="saveStoreSettings(event)"><div class="form-grid"><label>Nombre comercial<input name="name" required value="${esc(storeSettings.name)}"></label><label>Nombre legal o razón social<input name="legalName" value="${esc(storeSettings.legalName)}"></label><label>RUC / identificación fiscal<input name="taxId" value="${esc(storeSettings.taxId)}"></label><label>WhatsApp de contacto<input name="phone" value="${esc(storeSettings.phone)}"></label><label>Correo<input name="email" type="email" value="${esc(storeSettings.email)}"></label><label>Dirección o zona de entrega<input name="address" value="${esc(storeSettings.address)}"></label><label class="field-full">Título principal<input name="bannerTitle" value="${esc(storeSettings.bannerTitle)}"></label><label class="field-full">Texto principal<input name="bannerText" value="${esc(storeSettings.bannerText)}"></label><label>URL de imagen para portada<input name="bannerImage" type="url" value="${esc(storeSettings.bannerImage)}" placeholder="https://…"></label><label>URL de video MP4 para portada<input name="bannerVideo" type="url" value="${esc(storeSettings.bannerVideo)}" placeholder="https://…"></label><label class="field-full">URL o archivo relativo del logo<input name="logo" value="${esc(storeSettings.logo)}" placeholder="https://… o brand-logo.png"></label></div><button class="cta">GUARDAR DATOS Y PORTADA</button><p class="fine">Para videos, usa un enlace directo a un archivo MP4 alojado en una dirección pública.</p></form>`;
}

function saveStoreSettings(event) {
  event.preventDefault(); storeSettings = Object.fromEntries(new FormData(event.target));
  localStorage.setItem('biotech_storeSettings', JSON.stringify(storeSettings));
  document.querySelectorAll('.brand-logo').forEach(img => { img.src = storeSettings.logo || 'brand-logo.png'; });
  document.title = `${storeSettings.name} | Suplementos`;
  const footerCopy = document.querySelector('.footer-inner p');
  if (footerCopy) footerCopy.textContent = [storeSettings.phone, storeSettings.email, storeSettings.address].filter(Boolean).join(' · ') || 'Nutrición para acompañar tu camino.';
  const hero = document.querySelector('.hero');
  if (hero) {
    const heading = hero.querySelector('h1'), copy = hero.querySelector('.hero-copy'), visual = hero.querySelector('.hero-visual');
    heading.textContent = storeSettings.bannerTitle || 'Entrena con intención.';
    copy.textContent = storeSettings.bannerText || 'Nutrición seleccionada para acompañar tu siguiente nivel.';
    if (storeSettings.bannerVideo) visual.innerHTML = `<video autoplay muted loop playsinline src="${esc(storeSettings.bannerVideo)}"></video>`;
    else if (storeSettings.bannerImage) visual.innerHTML = `<img src="${esc(storeSettings.bannerImage)}" alt="${esc(storeSettings.name)}">`;
  }
  renderStoreSettings(); logActivity('Datos de tienda editados', storeSettings.name); toast('Datos de la tienda guardados.');
}

function printDocument(id, format) {
  const order = orders.find(item => item.id === id); if (!order) return;
  const popup = window.open('', '_blank', 'width=820,height=900');
  if (!popup) return toast('Permite las ventanas emergentes para imprimir el comprobante.');
  const ticket = format === 'ticket', logo = new URL(storeSettings.logo || 'brand-logo.png', location.href).href;
  const rows = order.items.map(item => `<tr><td>${esc(item.name)}<small>${item.qty} × ${money(item.price)}</small></td><td>${money(item.qty * item.price)}</td></tr>`).join('');
  popup.document.write(`<!doctype html><html lang="es"><meta charset="utf-8"><title>${ticket ? 'Comprobante' : 'Factura'} ${esc(order.id)}</title><style>@page{size:${ticket ? '80mm auto' : 'A4'};margin:${ticket ? '6mm' : '18mm'}}body{font:14px Arial,sans-serif;color:#171a16;max-width:${ticket ? '72mm' : '760px'};margin:auto}header{text-align:center;border-bottom:1px solid #bbb;padding-bottom:16px}img{max-width:190px;max-height:90px;object-fit:contain}h1{font-size:${ticket ? '19px' : '25px'};margin:8px 0}p{margin:5px 0;font-size:12px;color:#555}.details{margin:20px 0;font-size:13px;line-height:1.7}table{width:100%;border-collapse:collapse}td{padding:9px 4px;border-bottom:1px solid #ddd;text-align:right}td:first-child{text-align:left}small{display:block;color:#666;margin-top:3px}.totals{margin:16px 0 0 auto;width:65%}.totals p{display:flex;justify-content:space-between}.grand{font-weight:bold;font-size:17px!important;color:#111!important;border-top:1px solid #aaa;padding-top:9px}.thanks{text-align:center;margin-top:25px}.screen-only{margin:25px auto;display:block;padding:10px 20px}@media print{.screen-only{display:none}}</style><body><header><img src="${esc(logo)}"><h1>${ticket ? 'COMPROBANTE DE PEDIDO' : 'FACTURA / COMPROBANTE DE VENTA'}</h1><b>${esc(storeSettings.legalName || storeSettings.name)}</b><p>${esc(storeSettings.address)}</p><p>${esc(storeSettings.phone)} ${esc(storeSettings.email)}</p><p>${storeSettings.taxId ? `RUC: ${esc(storeSettings.taxId)}` : ''}</p></header><div class="details"><b>N.º ${esc(order.id)}</b><br>Fecha: ${new Date(order.date).toLocaleDateString('es-NI')}<br>Cliente: ${esc(order.name)}<br>Contacto: ${esc(order.phone)}<br>Entrega: ${esc(order.address)} · ${dateText(order.deliveryDate)}<br>Pago: ${esc(order.payment || '')}</div><table>${rows}</table><div class="totals"><p><span>Subtotal</span><b>${money(order.subtotal ?? order.total)}</b></p>${order.discount ? `<p><span>Descuento ${esc(order.promoCode || '')}</span><b>−${money(order.discount)}</b></p>` : ''}<p><span>Envío</span><b>${money(order.shipping)}</b></p><p class="grand"><span>Total</span><b>${money(order.total)}</b></p></div><p class="thanks">Gracias por comprar en ${esc(storeSettings.name)}.</p><button class="screen-only" onclick="window.print()">Imprimir o guardar como PDF</button></body></html>`);
  popup.document.close(); popup.focus();
}

function extendAdmin() {
  if (!document.getElementById('panel-insights')) {
    const tabs = document.querySelector('.admin-tabs'), panels = document.querySelector('.admin-main');
    [['insights', 'Gráficas'], ['log', 'Bitácora'], ['scanner', 'Lector'], ['returns', 'Devoluciones'], ['store', 'Mi tienda']].forEach(([id, label]) => {
      const button = document.createElement('button'); button.className = 'admin-tab'; button.dataset.tab = id; button.textContent = label;
      button.onclick = () => {
        document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
        document.querySelectorAll('.admin-panel').forEach(item => item.classList.toggle('active', item.id === `panel-${id}`));
        renderAdmin();
      };
      tabs.appendChild(button);
      const panel = document.createElement('div'); panel.id = `panel-${id}`; panel.className = 'admin-panel'; panels.appendChild(panel);
    });
  }
  document.querySelectorAll('.admin-tab').forEach(button => {
    if (button.dataset.extendedBound) return;
    button.dataset.extendedBound = 'yes';
    const previous = button.onclick;
    button.onclick = event => {
      if (document.querySelector('.admin-tab.active')?.dataset.tab === 'scanner' && button.dataset.tab !== 'scanner') stopBarcodeCamera();
      if (!['insights', 'log', 'scanner', 'returns', 'store'].includes(button.dataset.tab)) return previous?.call(button, event);
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.admin-panel').forEach(item => item.classList.toggle('active', item.id === `panel-${button.dataset.tab}`));
      renderAdmin();
    };
  });
  const active = document.querySelector('.admin-tab.active')?.dataset.tab;
  if (active === 'insights') renderInsights();
  if (active === 'log') renderActivity();
  if (active === 'scanner') renderScanner();
  if (active === 'returns') renderReturns();
  if (active === 'store') renderStoreSettings();
}

renderAdmin = function () {
  baseRenderAdmin(); extendAdmin();
  renderManualOrderAction();
  const validSales = orders.filter(o => o.status !== 'Cancelado');
  const net = validSales.reduce((sum, o) => sum + orderNet(o), 0);
  const cost = validSales.reduce((sum, o) => sum + orderCost(o), 0);
  const summary = document.querySelectorAll('#panel-overview .metric strong');
  if (summary[0]) summary[0].textContent = money(net);
  if (summary[1]) summary[1].textContent = money(net - cost - expenses.reduce((sum, e) => sum + e.amount, 0));
};
function applyStoreSettings() {
  document.title = `${storeSettings.name} | Suplementos`;
  document.querySelectorAll('.brand-logo').forEach(img => { img.src = storeSettings.logo || 'brand-logo.png'; });
  const footerCopy = document.querySelector('.footer-inner p');
  if (footerCopy) footerCopy.textContent = [storeSettings.phone, storeSettings.email, storeSettings.address].filter(Boolean).join(' · ') || 'Nutrición para acompañar tu camino.';
  const hero = document.querySelector('.hero');
  if (!hero) return;
  hero.querySelector('h1').textContent = storeSettings.bannerTitle || 'Entrena con intención.';
  hero.querySelector('.hero-copy').textContent = storeSettings.bannerText || 'Nutrición seleccionada para acompañar tu siguiente nivel.';
  const visual = hero.querySelector('.hero-visual');
  if (storeSettings.bannerVideo) visual.innerHTML = `<video autoplay muted loop playsinline src="${esc(storeSettings.bannerVideo)}"></video>`;
  else if (storeSettings.bannerImage) visual.innerHTML = `<img src="${esc(storeSettings.bannerImage)}" alt="${esc(storeSettings.name)}">`;
}
applyStoreSettings();
function orderNet(order) { return order.total - (order.status === 'Devuelto' ? +order.refundAmount || 0 : 0); }
function orderCost(order) { const total = (order.items || []).reduce((sum, item) => sum + (Number(item.cost) || 0) * (Number(item.qty) || 0), 0); return order.status === 'Devuelto' && order.restocked ? 0 : total; }
orderTable = function (list) {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Productos y entrega</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(o => `<tr><td><strong>${esc(o.id)}</strong><small>${new Date(o.date).toLocaleDateString('es-NI')}</small></td><td>${esc(o.name)}<small>${esc(o.phone)} · ${esc(o.address)}</small></td><td>${o.items.map(i => `${i.qty}× ${esc(i.name)}${i.preorder ? ' · encargo' : ''}`).join(', ')}<small>${esc(o.payment || '')} · entrega: ${dateText(o.deliveryDate)}${o.marketingOptIn ? ' · acepta promociones' : ''}</small></td><td>${money(o.total)}${o.refundAmount ? `<small>Devuelto ${money(o.refundAmount)}</small>` : ''}</td><td><span class="status">${esc(o.status)}</span></td><td><button class="admin-action" onclick="openOrderWhatsAppComposer('${esc(o.id)}')">WhatsApp</button> <button class="admin-action" onclick="editOrder('${esc(o.id)}')">Editar</button> <button class="admin-action" onclick="printDocument('${esc(o.id)}','ticket')">Ticket</button> <button class="admin-action" onclick="printDocument('${esc(o.id)}','invoice')">Factura</button></td></tr>`).join('')}</tbody></table></div>`;
};

function orderWhatsAppTemplateMessage(order, key) {
  const template = customerExtras.whatsappTemplates?.[key] || defaultWhatsAppTemplates[key] || '';
  const items = order.items.map(item => {
    const product = products.find(row => row.id === item.id);
    const description = product?.description ? ` — ${product.description}` : '';
    return `${item.qty} × ${item.name}${item.isGift ? ' (regalía)' : ''}${description}`;
  }).join('\n');
  const displayTotal = typeof dualMoneyText === 'function' ? dualMoneyText(order.total) : money(order.total);
  const values = { cliente: order.name || '', pedido: order.id || '', total: displayTotal, productos: items, fecha: dateText(order.deliveryDate), tienda: storeSettings.name || 'BioTech Suplementos' };
  return template.replace(/\{(cliente|pedido|total|productos|fecha|tienda)\}/g, (match, name) => values[name] ?? match);
}

function orderTemplateForStatus(status) {
  return ({ 'En proceso': 'in_process', 'Esperando pago': 'awaiting_payment', 'Pago reportado': 'payment_reported', 'Pago confirmado': 'payment_confirmed', 'Completado': 'thank_you' })[status] || 'order_received';
}

function openOrderWhatsAppComposer(orderId) {
  const order = orders.find(item => item.id === orderId); if (!order) return;
  const digits = String(order.phone || '').replace(/\D/g, ''), phone = digits.length === 8 ? `505${digits}` : digits;
  const keys = [['order_received', 'Pedido recibido'], ['in_process', 'Pedido en proceso'], ['awaiting_payment', 'Esperando pago'], ['payment_reported', 'Pago reportado, por verificar'], ['payment_confirmed', 'Pago confirmado'], ['thank_you', 'Agradecimiento'], ['promotion', 'Promoción']];
  const key = orderTemplateForStatus(order.status);
  const modal = document.createElement('div'); modal.className = 'overlay show'; modal.id = 'orderWhatsAppComposer';
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:92vh"><div class="drawer-head"><h2>WhatsApp · ${esc(order.id)}</h2><button class="close" onclick="this.closest('.overlay').remove()" aria-label="Cerrar">×</button></div><form class="checkout" style="margin-top:14px" onsubmit="return false"><label>Plantilla<select name="templateKey" onchange="updateOrderWhatsAppComposer(this)">${keys.map(([value, label]) => `<option value="${value}" ${value === key ? 'selected' : ''} ${value === 'promotion' && !order.marketingOptIn ? 'disabled' : ''}>${label}${value === 'promotion' && !order.marketingOptIn ? ' · sin autorización' : ''}</option>`).join('')}</select></label><label>Mensaje<textarea name="message" rows="9" maxlength="3000">${esc(orderWhatsAppTemplateMessage(order, key))}</textarea></label>${order.marketingOptIn ? '<p class="fine">Este cliente aceptó recibir promociones.</p>' : '<p class="fine">Promoción deshabilitada: no consta autorización del cliente.</p>'}<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="cta" style="text-align:center;text-decoration:none;flex:1" href="${phone.length >= 8 ? `https://wa.me/${esc(phone)}?text=${encodeURIComponent(orderWhatsAppTemplateMessage(order, key))}` : '#'}" target="_blank" rel="noopener" onclick="return openPreparedOrderWhatsApp(event,this)">ABRIR WHATSAPP</a><button type="button" class="admin-action" onclick="copyPreparedOrderWhatsApp()">Copiar mensaje</button></div><small class="fine">Se abrirá WhatsApp con el mensaje preparado; revísalo y pulsa Enviar.</small></form></div>`;
  modal.dataset.orderId = orderId; document.body.appendChild(modal);
}

function updateOrderWhatsAppComposer(select) {
  const form = select.form, order = orders.find(item => item.id === document.getElementById('orderWhatsAppComposer')?.dataset.orderId);
  if (!order) return;
  const message = orderWhatsAppTemplateMessage(order, select.value);
  form.elements.message.value = message;
  const link = form.querySelector('a.cta'), digits = String(order.phone || '').replace(/\D/g, ''), phone = digits.length === 8 ? `505${digits}` : digits;
  link.href = phone.length >= 8 && phone.length <= 15 ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : '#';
}

function openPreparedOrderWhatsApp(event, link) {
  const modal = document.getElementById('orderWhatsAppComposer');
  const order = orders.find(item => item.id === modal?.dataset.orderId);
  const message = modal?.querySelector('[name="message"]')?.value.trim();
  const digits = String(order?.phone || '').replace(/\D/g, ''), phone = digits.length === 8 ? `505${digits}` : digits;
  if (!message) { event.preventDefault(); return false; }
  if (phone.length < 8 || phone.length > 15) { event.preventDefault(); toast('Revisa el número de WhatsApp del cliente en el pedido.'); return false; }
  const select = modal.querySelector('[name="templateKey"]');
  if (select?.value === 'promotion') {
    if (!order?.marketingOptIn) { event.preventDefault(); return toast('Este cliente no tiene autorización registrada para promociones.'), false; }
  }
  link.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  return true;
}

function copyPreparedOrderWhatsApp() {
  const message = document.querySelector('#orderWhatsAppComposer [name="message"]')?.value || '';
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(message).then(() => toast('Mensaje copiado.')).catch(() => copyOrderMessageFallback(message));
  else copyOrderMessageFallback(message);
}
window.addEventListener('resize', () => { if (document.getElementById('panel-insights')?.classList.contains('active')) drawSalesChart(document.getElementById('reportRange')?.value || 'month'); });
