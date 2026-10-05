let suppliers = load('suppliers', []);
let supplierPurchases = load('supplierPurchases', []);
let supplierLedger = load('supplierLedger', []);
let supplierDraftLines = [];
let supplierDraftHead = null;
const previousSupplierAdmin = renderAdmin;

function saveSupplierData() {
  localStorage.setItem('biotech_suppliers', JSON.stringify(suppliers));
  localStorage.setItem('biotech_supplierPurchases', JSON.stringify(supplierPurchases));
  localStorage.setItem('biotech_supplierLedger', JSON.stringify(supplierLedger));
}

function supplierBalance(id) {
  return supplierLedger.filter(row => row.supplierId === id).reduce((sum, row) => sum + row.amount, 0);
}

function ensureSupplierTabs() {
  if (document.getElementById('panel-suppliers')) return;
  const tabs = document.querySelector('.admin-tabs'), container = document.querySelector('.admin-main');
  [['suppliers', 'Proveedores'], ['purchases', 'Compras']].forEach(([id, label]) => {
    const button = document.createElement('button');
    button.className = 'admin-tab'; button.dataset.tab = id; button.textContent = label;
    button.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.admin-panel').forEach(item => item.classList.toggle('active', item.id === `panel-${id}`));
      renderAdmin();
    };
    tabs.appendChild(button);
    const panel = document.createElement('div'); panel.id = `panel-${id}`; panel.className = 'admin-panel'; container.appendChild(panel);
  });
  document.querySelectorAll('.admin-tab[data-tab="suppliers"],.admin-tab[data-tab="purchases"]').forEach(button => {
    const custom = button.onclick;
    button.dataset.extendedBound = 'yes';
    button.onclick = event => custom.call(button, event);
  });
}

function renderSupplierPanel() {
  const payable = supplierLedger.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const credits = supplierLedger.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const outstanding = suppliers.reduce((sum, s) => sum + Math.max(0, supplierBalance(s.id)), 0);
  document.getElementById('panel-suppliers').innerHTML = `<div class="metrics"><div class="metric"><span>Proveedores registrados</span><strong>${suppliers.length}</strong></div><div class="metric"><span>Por pagar</span><strong>${money(outstanding)}</strong></div><div class="metric"><span>Abonos y pagos aplicados</span><strong>${money(credits)}</strong></div><div class="metric"><span>Compras registradas</span><strong>${supplierPurchases.length}</strong></div></div><div class="admin-bar"><span>Contactos y saldo por proveedor <small>(control interno)</small></span><button class="cta" style="margin:0" onclick="supplierForm()">＋ Agregar proveedor</button></div>${suppliers.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Proveedor</th><th>Contacto</th><th>Compras</th><th>Abonos</th><th>Saldo</th><th></th></tr></thead><tbody>${suppliers.map(s => { const balance = supplierBalance(s.id), count = supplierPurchases.filter(p => p.supplierId === s.id).length, paid = supplierLedger.filter(r => r.supplierId === s.id && r.amount < 0).reduce((sum, r) => sum - r.amount, 0); return `<tr><td><strong>${esc(s.name)}</strong><small>${esc(s.taxId || '')}</small></td><td>${esc(s.phone || '')}<small>${esc(s.email || '')}</small></td><td>${count}</td><td>${money(paid)}</td><td><span class="status ${balance < 0 ? 'credit' : ''}">${balance < 0 ? `A favor ${money(-balance)}` : money(balance)}</span></td><td><button class="admin-action" onclick="supplierPayment('${esc(s.id)}')">＋ Abono</button> <button class="admin-action" onclick="supplierForm('${esc(s.id)}')">Editar</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Agrega proveedores para llevar sus compras, pagos y saldos.</div>'}<p class="fine">Saldos, anticipos y compras de proveedores se guardan únicamente en este panel; no aparecen en la tienda ni en el pago del cliente.</p>`;
}

const supplierPanelBeforeLedger = renderSupplierPanel;
renderSupplierPanel = function () {
  supplierPanelBeforeLedger();
  document.querySelectorAll('#panel-suppliers tbody tr').forEach((row, index) => {
    const supplier = suppliers[index], cell = row.lastElementChild;
    if (!supplier || !cell) return;
    const button = document.createElement('button'); button.className = 'admin-action'; button.textContent = 'Movimientos';
    button.onclick = () => supplierLedgerView(supplier.id); cell.appendChild(button);
  });
};

function supplierForm(id) {
  const s = suppliers.find(x => x.id === id) || { id: `sup-${Date.now()}`, name: '', taxId: '', phone: '', email: '', address: '', notes: '' };
  const modal = document.createElement('div'); modal.className = 'overlay show';
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto;max-height:92vh"><div class="drawer-head"><h2>${id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2><button class="close" onclick="this.closest('.overlay').remove()">×</button></div><form class="checkout" style="margin-top:15px" onsubmit="saveSupplier(event,'${esc(id || '')}')"><label>Nombre comercial<input name="name" required value="${esc(s.name)}"></label><label>Razón social<input name="legalName" value="${esc(s.legalName || '')}"></label><label>RUC / identificación fiscal<input name="taxId" value="${esc(s.taxId)}"></label><label>Teléfono<input name="phone" value="${esc(s.phone)}"></label><label>Correo<input name="email" type="email" value="${esc(s.email)}"></label><label>Dirección<input name="address" value="${esc(s.address)}"></label><label>Notas<input name="notes" value="${esc(s.notes)}"></label><button class="cta">GUARDAR PROVEEDOR</button></form></div>`;
  document.body.appendChild(modal);
}

function saveSupplier(event, id) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  const index = suppliers.findIndex(s => s.id === id), supplier = { id: id || `sup-${Date.now()}`, ...data };
  if (index >= 0) suppliers[index] = supplier; else suppliers.push(supplier);
  saveSupplierData(); logActivity(index >= 0 ? 'Proveedor editado' : 'Proveedor agregado', supplier.name);
  event.target.closest('.overlay').remove(); renderAdmin(); toast('Proveedor guardado.');
}

function supplierPayment(id) {
  const s = suppliers.find(x => x.id === id); if (!s) return;
  const modal = document.createElement('div'); modal.className = 'overlay show';
  modal.innerHTML = `<div class="drawer" style="margin:auto;height:auto"><div class="drawer-head"><h2>Abono a ${esc(s.name)}</h2><button class="close" onclick="this.closest('.overlay').remove()">×</button></div><p>Saldo actual: <strong>${money(supplierBalance(id))}</strong></p><form class="checkout" style="margin-top:15px" onsubmit="saveSupplierPayment(event,'${esc(id)}')"><label>Tipo de movimiento<select name="label"><option>Abono / pago</option><option>Anticipo a favor</option><option>Nota de crédito</option></select></label><label>Monto (${currency})<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Forma de pago<select name="method"><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cheque</option><option>Otro</option></select></label><label>Referencia o detalle<input name="note" placeholder="Recibo, referencia, nota"></label><button class="cta">REGISTRAR ABONO</button></form></div>`;
  document.body.appendChild(modal);
}

function saveSupplierPayment(event, id) {
  event.preventDefault(); const d = Object.fromEntries(new FormData(event.target)), amount = +d.amount;
  supplierLedger.unshift({ id: `mov-${Date.now()}`, supplierId: id, date: new Date().toISOString(), type: d.label, amount: -amount, method: d.method, note: d.note || '' });
  saveSupplierData(); const s = suppliers.find(x => x.id === id);
  logActivity('Abono a proveedor', `${s?.name || ''} · ${money(amount)} · ${d.method}`);
  event.target.closest('.overlay').remove(); renderAdmin(); toast('Abono registrado.');
}

function supplierLedgerView(id) {
  const s = suppliers.find(x => x.id === id); if (!s) return;
  const rows = supplierLedger.filter(row => row.supplierId === id);
  const panel = document.getElementById('panel-suppliers');
  panel.querySelector('.supplier-ledger')?.remove();
  panel.insertAdjacentHTML('beforeend', `<div class="supplier-ledger"><div class="admin-bar"><span>Bitácora de ${esc(s.name)} · saldo ${money(supplierBalance(id))}</span><button class="admin-action" onclick="supplierPayment('${esc(id)}')">＋ Registrar abono</button></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th>Monto</th><th>Saldo luego del movimiento</th></tr></thead><tbody>${[...rows].reverse().map((row, i, arr) => { const balance = arr.slice(0, i + 1).reduce((sum, r) => sum + r.amount, 0); return `<tr><td>${new Date(row.date).toLocaleDateString('es-NI')}</td><td>${esc(row.type)}</td><td>${esc(row.note || row.reference || '')} · ${esc(row.method || '')}</td><td>${money(row.amount)}</td><td>${money(balance)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No hay movimientos registrados para este proveedor.</div>'}</div>`);
}

function openSupplierPurchase() {
  if (!suppliers.length) return toast('Primero agrega un proveedor.');
  supplierDraftLines = [];
  const modal = document.createElement('div'); modal.className = 'overlay show'; modal.id = 'supplierPurchaseModal';
  modal.innerHTML = `<div class="drawer purchase-drawer" style="width:min(760px,100%)"><div class="drawer-head"><h2>Nueva compra a proveedor</h2><button class="close" onclick="this.closest('.overlay').remove()">×</button></div><div id="purchaseEntry"><form id="supplierPurchaseForm" class="checkout purchase-form" onsubmit="reviewSupplierPurchase(event)"><div class="form-grid"><label>Proveedor<select name="supplierId" required><option value="">Elige proveedor</option>${suppliers.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>Fecha de compra<input name="date" type="date" required value="${new Date().toISOString().slice(0,10)}"></label><label>N.º de factura / referencia<input name="reference" placeholder="Opcional"></label><label>Forma de pago<select name="method"><option>Crédito del proveedor</option><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cheque</option></select></label><label>Pagado o abonado ahora (${currency})<input name="paid" type="number" min="0" step="0.01" value="0"></label><label>Envío y cargos (${currency})<input name="shipping" type="number" min="0" step="0.01" value="0"></label><label>Descuento recibido (${currency})<input name="discount" type="number" min="0" step="0.01" value="0"></label><label>Fecha estimada de llegada<input name="arrivalDate" type="date"></label><label class="field-full"><input name="received" type="checkbox" checked> Ya recibí esta compra y deseo sumarla al stock</label></div><div class="purchase-line-add"><label>Producto<select id="purchaseProduct"><option value="">Elige producto</option>${products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.barcode ? ` · ${esc(p.barcode)}` : ''}</option>`).join('')}</select></label><label>Unidades<input id="purchaseQty" type="number" min="1" step="1" value="1"></label><label>Regalías<input id="purchaseGift" type="number" min="0" step="1" value="0"></label><label>Costo unitario (${currency})<input id="purchaseCost" type="number" min="0" step="0.01" placeholder="Precio proveedor"></label><button type="button" class="admin-action" onclick="addPurchaseLine()">＋ Añadir</button></div><div id="purchaseLines" class="purchase-lines"></div><div class="admin-bar"><span id="purchaseSubtotal">Subtotal: ${money(0)}</span><button class="cta" style="margin:0">REVISAR COSTOS ANTES DE CONFIRMAR</button></div></form></div><div id="purchaseReview" hidden></div></div>`;
  document.body.appendChild(modal);
}

function addPurchaseLine() {
  const id = document.getElementById('purchaseProduct').value, product = products.find(p => p.id === id);
  const qty = +document.getElementById('purchaseQty').value, gifts = +document.getElementById('purchaseGift').value, costField = document.getElementById('purchaseCost'), cost = +costField.value;
  if (!product || qty < 1 || gifts < 0 || !costField.value.trim() || cost < 0 || !Number.isFinite(cost)) return toast('Elige producto, cantidad y costo válidos.');
  const existing = supplierDraftLines.find(line => line.productId === id);
  if (existing) { existing.qty += qty; existing.gifts += gifts; existing.unitCost = cost; }
  else supplierDraftLines.push({ productId: id, qty, gifts, unitCost: cost });
  renderPurchaseLines();
}

function renderPurchaseLines() {
  const list = document.getElementById('purchaseLines'); if (!list) return;
  list.innerHTML = supplierDraftLines.map((line, index) => { const p = products.find(item => item.id === line.productId); return `<div class="purchase-item"><span><b>${esc(p?.name || 'Producto')}</b><small>${line.qty} unidades · ${line.gifts} de regalo · ${money(line.unitCost)} c/u</small></span><strong>${money(line.qty * line.unitCost)}</strong><button type="button" class="admin-action" onclick="removePurchaseLine(${index})">Quitar</button></div>`; }).join('') || '<p class="fine">Agrega los productos de esta compra.</p>';
  document.getElementById('purchaseSubtotal').textContent = `Subtotal productos: ${money(supplierDraftLines.reduce((sum, line) => sum + line.qty * line.unitCost, 0))}`;
}

function removePurchaseLine(index) { supplierDraftLines.splice(index, 1); renderPurchaseLines(); }

function landedUnitCost(line) {
  const subtotal = supplierDraftLines.reduce((sum, item) => sum + item.qty * item.unitCost, 0);
  const adjustment = (+supplierDraftHead.shipping || 0) - (+supplierDraftHead.discount || 0);
  const allocated = subtotal ? adjustment * (line.qty * line.unitCost / subtotal) : 0;
  return Math.max(0, (line.qty * line.unitCost + allocated) / (line.qty + line.gifts));
}

function reviewSupplierPurchase(event) {
  event.preventDefault();
  if (!supplierDraftLines.length) return toast('Agrega al menos un producto a la compra.');
  supplierDraftHead = Object.fromEntries(new FormData(event.target));
  const shipping = +supplierDraftHead.shipping || 0, discount = +supplierDraftHead.discount || 0;
  const subtotal = supplierDraftLines.reduce((sum, line) => sum + line.qty * line.unitCost, 0), total = Math.max(0, subtotal + shipping - discount);
  if (+supplierDraftHead.paid > total) return toast('El abono no puede ser mayor que el total de la compra.');
  const review = document.getElementById('purchaseReview');
  document.getElementById('purchaseEntry').hidden = true; review.hidden = false;
  review.innerHTML = `<div class="admin-bar"><span>Compara el costo anterior y decide qué precios actualizar</span><strong>Total ${money(total)}</strong></div><div class="table-wrap"><table class="table cost-review"><thead><tr><th>Producto</th><th>Último costo</th><th>Nuevo costo</th><th>Precio actual</th><th>Acción de costo</th><th>Precio de venta</th></tr></thead><tbody>${supplierDraftLines.map((line, index) => { const p = products.find(item => item.id === line.productId), previous = p.lastPurchaseCost ?? p.cost, margin = p.price > 0 ? (p.price - p.cost) / p.price : .25, suggested = (line.unitCost / Math.max(.05, 1 - Math.max(0, Math.min(.8, margin)))).toFixed(2); return `<tr><td>${esc(p.name)}<small>${line.qty} compra · ${line.gifts} regalo</small></td><td>${money(previous)}</td><td>${money(line.unitCost)}<small class="${line.unitCost > previous ? 'cost-up' : line.unitCost < previous ? 'cost-down' : ''}">${line.unitCost > previous ? `+${Math.round((line.unitCost / (previous || 1) - 1) * 100)}%` : line.unitCost < previous ? 'Bajó' : 'Igual'}</small></td><td>${money(p.price)}</td><td><select class="cost-choice" data-index="${index}" onchange="updatePurchaseSuggestion(${index})"><option value="average">Promedio con el stock actual</option><option value="latest">Usar el nuevo costo</option><option value="keep">Mantener costo actual</option><option value="custom">Costo manual</option></select><input class="cost-manual" data-index="${index}" type="number" min="0" step="0.01" value="${line.unitCost}" hidden></td><td><select class="price-choice" data-index="${index}" onchange="updatePurchaseSuggestion(${index})"><option value="keep">Mantener ${money(p.price)}</option><option value="margin">Ajustar a ${money(+suggested)} para mantener margen</option><option value="custom">Precio manual</option></select><input class="price-manual" data-index="${index}" type="number" min="0" step="0.01" value="${p.price}" hidden></td></tr>`; }).join('')}</tbody></table></div><div class="purchase-summary"><p>Productos: ${money(subtotal)} · Envío/cargos: ${money(shipping)} · Descuento: −${money(discount)}</p><p>Pagado ahora: ${money(+supplierDraftHead.paid || 0)} · Queda por pagar: <b>${money(total - (+supplierDraftHead.paid || 0))}</b></p><p>${supplierDraftHead.received === 'on' ? 'Al confirmar, se sumarán las unidades al stock.' : 'Al confirmar, las unidades quedarán como inventario por llegar.'} Los abonos y saldos son internos.</p></div><div class="admin-bar"><button class="admin-action" onclick="backToPurchaseEntry()">← Volver a editar</button><button class="cta" style="margin:0" onclick="confirmSupplierPurchase()">CONFIRMAR COMPRA Y ACTUALIZAR PRODUCTOS</button></div>`;
}

function updatePurchaseSuggestion(index) {
  const costMode = document.querySelector(`.cost-choice[data-index="${index}"]`)?.value;
  const priceMode = document.querySelector(`.price-choice[data-index="${index}"]`)?.value;
  document.querySelector(`.cost-manual[data-index="${index}"]`).hidden = costMode !== 'custom';
  document.querySelector(`.price-manual[data-index="${index}"]`).hidden = priceMode !== 'custom';
}

function backToPurchaseEntry() {
  document.getElementById('purchaseEntry').hidden = false;
  document.getElementById('purchaseReview').hidden = true;
}

function confirmSupplierPurchase() {
  const header = supplierDraftHead, supplier = suppliers.find(s => s.id === header.supplierId);
  if (!supplier) return toast('El proveedor ya no está disponible.');
  const subtotal = supplierDraftLines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
  const fee = +header.shipping || 0, discount = +header.discount || 0, total = Math.max(0, subtotal + fee - discount), paid = +header.paid || 0;
  const received = header.received === 'on';
  const purchase = { id: `OC-${Date.now().toString().slice(-7)}`, supplierId: supplier.id, supplierName: supplier.name, date: header.date, arrivalDate: header.arrivalDate, reference: header.reference, method: header.method, subtotal, shipping: fee, discount, total, paid, balance: total - paid, received, status: received ? 'Recibido' : 'En camino', items: [] };
  for (const [index, line] of supplierDraftLines.entries()) {
    const product = products.find(p => p.id === line.productId); if (!product) continue;
    const oldCost = +product.cost || 0, oldPrice = +product.price || 0;
    const costMode = document.querySelector(`.cost-choice[data-index="${index}"]`).value;
    const priceMode = document.querySelector(`.price-choice[data-index="${index}"]`).value;
    const enteredCost = +document.querySelector(`.cost-manual[data-index="${index}"]`).value || line.unitCost;
    const enteredPrice = +document.querySelector(`.price-manual[data-index="${index}"]`).value || oldPrice;
    const inventoryBefore = (product.stock || 0) + (product.incoming || 0), purchasedUnits = line.qty + line.gifts;
    const landed = landedUnitCost(line);
    const averageCost = inventoryBefore + purchasedUnits > 0 ? ((inventoryBefore * oldCost) + (landed * purchasedUnits)) / (inventoryBefore + purchasedUnits) : landed;
    const nextCost = costMode === 'keep' ? oldCost : costMode === 'latest' ? landed : costMode === 'custom' ? enteredCost : averageCost;
    const margin = oldPrice > 0 ? (oldPrice - oldCost) / oldPrice : .25;
    const suggestedPrice = nextCost / Math.max(.05, 1 - Math.max(0, Math.min(.8, margin)));
    const nextPrice = priceMode === 'margin' ? +suggestedPrice.toFixed(2) : priceMode === 'custom' ? enteredPrice : oldPrice;
    product.lastPurchaseCost = line.unitCost; product.cost = +nextCost.toFixed(2); product.price = +nextPrice.toFixed(2); product.lastPurchaseAt = header.date;
    if (received) product.stock = (product.stock || 0) + purchasedUnits;
    else { product.incoming = (product.incoming || 0) + purchasedUnits; product.arrivalDate = header.arrivalDate || product.arrivalDate || ''; }
    purchase.items.push({ productId: product.id, name: product.name, qty: line.qty, gifts: line.gifts, unitCost: line.unitCost, previousCost: oldCost, previousPrice: oldPrice, newCost: product.cost, newPrice: product.price, costMode, priceMode });
  }
  supplierPurchases.unshift(purchase);
  supplierLedger.unshift({ id: `mov-${Date.now()}`, supplierId: supplier.id, purchaseId: purchase.id, date: new Date().toISOString(), type: 'Compra a crédito', amount: total, method: header.method, note: header.reference || purchase.id });
  if (paid > 0) supplierLedger.unshift({ id: `mov-${Date.now()}-paid`, supplierId: supplier.id, purchaseId: purchase.id, date: new Date().toISOString(), type: 'Abono al comprar', amount: -paid, method: header.method, note: header.reference || purchase.id });
  saveSupplierData(); save('products');
  logActivity('Compra a proveedor confirmada', `${supplier.name} · ${purchase.id} · ${money(total)} · ${purchase.status}`);
  document.getElementById('supplierPurchaseModal').remove(); supplierDraftLines = []; supplierDraftHead = null;
  renderProducts(); renderAdmin(); toast('Compra confirmada. Costos e inventario actualizados.');
}

function receiveSupplierPurchase(id) {
  const purchase = supplierPurchases.find(p => p.id === id); if (!purchase || purchase.received) return;
  for (const item of purchase.items) { const product = products.find(p => p.id === item.productId); if (!product) continue; const units = item.qty + item.gifts; product.incoming = Math.max(0, (product.incoming || 0) - units); product.stock = (product.stock || 0) + units; }
  purchase.received = true; purchase.status = 'Recibido'; purchase.receivedAt = new Date().toISOString();
  saveSupplierData(); save('products'); logActivity('Compra recibida', `${purchase.supplierName} · ${purchase.id}`); renderAdmin(); renderProducts(); toast('Unidades recibidas y sumadas al stock.');
}

function cancelSupplierPurchase(id) {
  const purchase = supplierPurchases.find(p => p.id === id); if (!purchase || purchase.received) return;
  if (!confirm(`¿Cancelar ${purchase.id}? Se retirarán las unidades por llegar y se revertirá el saldo del proveedor.`)) return;
  for (const item of purchase.items) { const product = products.find(p => p.id === item.productId); if (product) product.incoming = Math.max(0, (product.incoming || 0) - item.qty - item.gifts); }
  purchase.status = 'Cancelado'; purchase.cancelledAt = new Date().toISOString();
  supplierLedger.unshift({ id: `mov-${Date.now()}`, supplierId: purchase.supplierId, purchaseId: purchase.id, date: new Date().toISOString(), type: 'Reversión de compra cancelada', amount: -purchase.total, method: 'Ajuste', note: purchase.id });
  if (purchase.paid > 0) supplierLedger.unshift({ id: `mov-${Date.now()}-reverse`, supplierId: purchase.supplierId, purchaseId: purchase.id, date: new Date().toISOString(), type: 'Abono revertido', amount: purchase.paid, method: 'Ajuste', note: purchase.id });
  expenses = expenses.filter(e => e.id !== `purchase-cost-${purchase.id}`);
  saveSupplierData(); save('products'); save('expenses'); logActivity('Compra cancelada', `${purchase.supplierName} · ${purchase.id}`); renderProducts(); renderAdmin();
}

function renderPurchasesPanel() {
  const outstanding = supplierPurchases.filter(p => !['Cancelado'].includes(p.status)).reduce((sum, p) => sum + p.balance, 0);
  document.getElementById('panel-purchases').innerHTML = `<div class="metrics"><div class="metric"><span>Órdenes de compra</span><strong>${supplierPurchases.length}</strong></div><div class="metric"><span>Saldo pendiente</span><strong>${money(outstanding)}</strong></div><div class="metric"><span>Por recibir</span><strong>${supplierPurchases.filter(p => p.status === 'En camino').length}</strong></div></div><div class="admin-bar"><span>Órdenes de compra y recepción de stock</span><button class="cta" style="margin:0" onclick="openSupplierPurchase()">＋ Nueva compra</button></div>${supplierPurchases.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Orden</th><th>Proveedor</th><th>Productos</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th><th></th></tr></thead><tbody>${supplierPurchases.map(p => `<tr><td><strong>${esc(p.id)}</strong><small>${esc(p.reference || '')} · ${dateText(p.date)}</small></td><td>${esc(p.supplierName)}</td><td>${p.items.map(i => `${i.qty}+${i.gifts} regalo · ${esc(i.name)}`).join('<br>')}<small>${p.arrivalDate ? `Llega ${dateText(p.arrivalDate)}` : ''}</small></td><td>${money(p.total)}<small>${esc(p.method)}</small></td><td>${money(p.paid)}</td><td>${money(p.balance)}</td><td><span class="status">${esc(p.status)}</span></td><td>${!p.received && p.status !== 'Cancelado' ? `<button class="admin-action" onclick="receiveSupplierPurchase('${esc(p.id)}')">Recibir</button> <button class="admin-action" onclick="cancelSupplierPurchase('${esc(p.id)}')">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Todavía no hay compras a proveedores.</div>'}`;
}

renderAdmin = function () {
  previousSupplierAdmin(); ensureSupplierTabs();
  const tab = document.querySelector('.admin-tab.active')?.dataset.tab;
  if (tab === 'suppliers') renderSupplierPanel();
  if (tab === 'purchases') renderPurchasesPanel();
};
document.querySelectorAll('img.brand-logo').forEach(img => {
  if (img.closest('a')) return;
  const link = document.createElement('a'); link.href = './index.html#store'; link.className = 'brand-home';
  link.setAttribute('aria-label', 'Ir a la página principal de BioTech Suplementos');
  link.addEventListener('click', () => {
    if (document.getElementById('admin')?.classList.contains('show')) closeAdmin();
  });
  img.parentNode.insertBefore(link, img); link.appendChild(img);
});
