(() => {
  const addProduct = window.addToCart;
  if (typeof addProduct !== 'function') return;

  const seenKey = 'biotech_flashOfferSeen';
  const sessionHasSeenOffer = () => {
    try { return sessionStorage.getItem(seenKey) === 'yes'; } catch { return false; }
  };
  const markOfferSeen = () => {
    try { sessionStorage.setItem(seenKey, 'yes'); } catch { /* The offer still works without session storage. */ }
  };

  function activeFlashPromotion() {
    const today = new Date().toISOString().slice(0, 10);
    return promos.find(promo => promo.active && (!promo.expires || promo.expires >= today));
  }

  function closeFlashOffer() {
    document.getElementById('flashOfferModal')?.remove();
  }

  function acceptFlashOffer(code) {
    const today = new Date().toISOString().slice(0, 10);
    const promo = promos.find(item => item.code.toUpperCase() === code && item.active && (!item.expires || item.expires >= today));
    closeFlashOffer();
    if (!promo) return toast('La oferta ya no está disponible. Revisa las promociones vigentes.');
    appliedPromo = promo;
    openCart();
    renderCart();
    toast(`Oferta ${promo.code} aplicada a tu pedido.`);
  }

  function showFlashOffer() {
    if (document.getElementById('flashOfferModal') || sessionHasSeenOffer() || appliedPromo) return;
    const promo = activeFlashPromotion();
    if (!promo) return;
    markOfferSeen();
    const offer = promo.type === 'percent' ? `${promo.value}% de descuento` : `${money(promo.value)} de descuento`;
    const modal = document.createElement('div');
    modal.className = 'overlay show flash-offer-overlay';
    modal.id = 'flashOfferModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'flashOfferTitle');
    modal.innerHTML = `<section class="flash-offer"><button type="button" class="close flash-offer-close" aria-label="Cerrar oferta">×</button><div class="flash-offer-kicker">OFERTA FLASH</div><h2 id="flashOfferTitle">Un impulso para tu compra</h2><p>Activa <strong>${esc(promo.code)}</strong> y recibe <strong>${esc(offer)}</strong> en este pedido.</p><small>Promoción${promo.expires ? ` válida hasta el ${dateText(promo.expires)}` : ''}. Se aplican las condiciones de la oferta.</small><div class="flash-offer-actions"><button type="button" class="admin-action" data-flash-cancel>Cancelar</button><button type="button" class="cta" data-flash-accept>Aceptar oferta</button></div></section>`;
    modal.addEventListener('click', event => { if (event.target === modal) closeFlashOffer(); });
    modal.querySelector('.flash-offer-close').addEventListener('click', closeFlashOffer);
    modal.querySelector('[data-flash-cancel]').addEventListener('click', closeFlashOffer);
    modal.querySelector('[data-flash-accept]').addEventListener('click', () => acceptFlashOffer(promo.code.toUpperCase()));
    document.body.appendChild(modal);
    modal.querySelector('[data-flash-accept]').focus();
  }

  window.addToCart = function (id) {
    const wasEmpty = Object.values(cart).reduce((sum, qty) => sum + qty, 0) === 0;
    const before = Number(cart[id]) || 0;
    addProduct(id);
    if (wasEmpty && (Number(cart[id]) || 0) > before && !sessionHasSeenOffer()) setTimeout(showFlashOffer, 250);
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeFlashOffer();
  });

  const flashStyle = document.createElement('style');
  flashStyle.textContent = `.flash-offer-overlay{z-index:18;justify-content:center;align-items:center;padding:18px}.flash-offer{position:relative;width:min(430px,100%);padding:30px;background:#10120d;color:#f7f7f3;border:1px solid #477300;box-shadow:0 18px 60px #10120d66}.flash-offer-kicker{color:#c5f900;font-size:11px;font-weight:800;letter-spacing:1.5px}.flash-offer h2{font:800 27px/1.15 Manrope,sans-serif;margin:12px 30px 10px 0}.flash-offer p{font-size:14px;line-height:1.65;color:#e3e7dc}.flash-offer p strong{color:#c5f900}.flash-offer small{display:block;color:#adb5aa;font-size:11px;line-height:1.5}.flash-offer-close{position:absolute;right:12px;top:10px;color:white}.flash-offer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.flash-offer-actions .admin-action{background:transparent;border-color:#ffffff55;color:white;min-height:42px}.flash-offer-actions .cta{margin:0;min-height:42px}@media(max-width:480px){.flash-offer{padding:24px 19px}.flash-offer h2{font-size:23px}.flash-offer-actions{display:grid;grid-template-columns:1fr 1fr}.flash-offer-actions button{min-width:0;padding:12px 8px;font-size:11px}}`;
  document.head.appendChild(flashStyle);
})();
