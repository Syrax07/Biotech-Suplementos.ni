(() => {
  const openOrderEditor = window.editOrder;
  const saveOrderChanges = window.saveOrderChanges;
  const toggleAdjustment = window.toggleOrderAdjustment;
  const printOrderDocument = window.printDocument;

  if (typeof openOrderEditor !== 'function' || typeof saveOrderChanges !== 'function') return;

  function orderBaseSubtotal(order) {
    const regularItems = order.items.filter(item => !item.isGift);
    return Number(order.subtotal) || regularItems.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
  }

  function previewOrderInvoice(form, order) {
    const preview = form.querySelector('.order-invoice-preview');
    if (!preview) return;

    const subtotal = orderBaseSubtotal(order);
    const promoDiscount = Math.min(subtotal, Math.max(0, Number(order.discount) || 0));
    const type = form.elements.adjustmentType?.value || 'none';
    const value = Math.max(0, Number(form.elements.adjustmentValue?.value) || 0);
    const maxAdminDiscount = Math.max(0, subtotal - promoDiscount);
    const adminDiscount = type === 'percent'
      ? Math.min(maxAdminDiscount, subtotal * Math.min(value, 100) / 100)
      : type === 'amount' ? Math.min(maxAdminDiscount, value) : 0;
    const shippingFee = Math.max(0, Number(form.elements.shipping?.value) || 0);
    const total = Math.max(0, subtotal - promoDiscount - adminDiscount + shippingFee);
    const giftProduct = type === 'gift' ? products.find(product => product.id === form.elements.giftProductId?.value) : null;
    const giftQty = Math.max(1, Math.floor(Number(form.elements.giftQty?.value) || 1));

    preview.innerHTML = `<h3 style="margin:0 0 8px;font:700 14px Manrope">Revisión de factura</h3><div class="fine" style="margin-bottom:10px">${order.items.map(item => `${item.qty} × ${esc(item.name)} · ${money(item.price * item.qty)}${item.isGift ? ' · regalía' : ''}`).join('<br>')}${giftProduct ? `<br>+ ${giftQty} × ${esc(giftProduct.name)} · ${money(0)} · nueva regalía` : ''}</div><div class="order-invoice-row"><span>Subtotal</span><b>${money(subtotal)}</b></div>${promoDiscount ? `<div class="order-invoice-row"><span>Promoción ${esc(order.promoCode || '')}</span><b>−${money(promoDiscount)}</b></div>` : ''}${adminDiscount ? `<div class="order-invoice-row"><span>Descuento BioTech</span><b>−${money(adminDiscount)}</b></div>` : ''}<div class="order-invoice-row"><span>Envío</span><b>${money(shippingFee)}</b></div><div class="order-invoice-row order-invoice-total"><strong>Total a confirmar</strong><strong>${money(total)}</strong></div>`;
  }

  function addInvoiceEditor(orderId) {
    const modal = [...document.querySelectorAll('.overlay.show')].at(-1);
    const form = modal?.querySelector('form.checkout');
    const order = orders.find(item => item.id === orderId);
    if (!form || !order || !form.elements.status || form.elements.shipping) return;
    form.dataset.orderId = orderId;

    const shippingLabel = document.createElement('label');
    shippingLabel.innerHTML = `Costo de envío (${esc(currency)})<input name="shipping" type="number" min="0" step="0.01" required value="${Math.max(0, Number(order.shipping) || 0)}"><small class="fine">Puedes ajustar el cargo de este pedido. La tarifa general se configura en Administrar → Envíos.</small>`;
    form.elements.status.closest('label')?.before(shippingLabel);

    const preview = document.createElement('section');
    preview.className = 'order-invoice-preview';
    preview.style.cssText = 'padding:14px;background:#f1f3ec;border:1px solid var(--line);display:grid;gap:7px';
    form.querySelector('button.cta')?.before(preview);

    form.addEventListener('input', () => previewOrderInvoice(form, order));
    form.addEventListener('change', () => previewOrderInvoice(form, order));
    previewOrderInvoice(form, order);
  }

  window.updateOrderInvoicePreview = previewOrderInvoice;
  window.editOrder = function (id) {
    openOrderEditor(id);
    addInvoiceEditor(id);
  };

  if (typeof toggleAdjustment === 'function') {
    window.toggleOrderAdjustment = function (select) {
      toggleAdjustment(select);
      const orderId = select.form?.dataset.orderId;
      const order = orders.find(item => item.id === orderId);
      if (order) previewOrderInvoice(select.form, order);
    };
  }

  window.saveOrderChanges = function (event, id) {
    const form = event.currentTarget || event.target;
    if (!form?.elements.shipping) return saveOrderChanges(event, id);
    const order = orders.find(item => item.id === id);
    const shippingFee = Number(form.elements.shipping.value);
    if (!order || !Number.isFinite(shippingFee) || shippingFee < 0) return toast('Revisa el costo de envío.');

    const modal = form.closest('.overlay');
    const oldShipping = order.shipping;
    order.shipping = shippingFee;
    saveOrderChanges(event, id);

    if (modal?.isConnected) {
      order.shipping = oldShipping;
      return;
    }

    const subtotal = orderBaseSubtotal(order);
    const promoDiscount = Math.min(subtotal, Math.max(0, Number(order.discount) || 0));
    const adjustment = order.adminAdjustment || { type: 'none', value: 0 };
    const adjustmentValue = Math.max(0, Number(adjustment.value) || 0);
    const maxAdminDiscount = Math.max(0, subtotal - promoDiscount);
    order.shipping = shippingFee;
    order.adminDiscount = adjustment.type === 'percent'
      ? Math.min(maxAdminDiscount, subtotal * Math.min(adjustmentValue, 100) / 100)
      : adjustment.type === 'amount' ? Math.min(maxAdminDiscount, adjustmentValue) : 0;
    order.total = Math.max(0, subtotal - promoDiscount - order.adminDiscount + shippingFee);
    order.refundAmount = Math.min(order.total, Number(order.refundAmount) || 0);
    save('orders');
    logActivity('Factura del pedido actualizada', `${order.id} · envío ${money(shippingFee)} · total ${money(order.total)}`);
    renderAdmin();
    renderProducts();
  };

  if (typeof printOrderDocument === 'function') {
    window.printDocument = function (id, format) {
      const order = orders.find(item => item.id === id);
      if (!order || !(Number(order.adminDiscount) > 0)) return printOrderDocument(id, format);
      const previousDiscount = order.discount, previousCode = order.promoCode;
      order.discount = (Number(order.discount) || 0) + Number(order.adminDiscount);
      order.promoCode = [previousCode, 'ajuste BioTech'].filter(Boolean).join(' · ');
      try { printOrderDocument(id, format); }
      finally { order.discount = previousDiscount; order.promoCode = previousCode; }
    };
  }

  const invoiceStyle = document.createElement('style');
  invoiceStyle.textContent = '.order-invoice-row{display:flex;justify-content:space-between;gap:12px;font-size:12px}.order-invoice-total{border-top:1px solid var(--line);padding-top:9px;margin-top:2px;font-size:15px}';
  document.head.appendChild(invoiceStyle);
})();
