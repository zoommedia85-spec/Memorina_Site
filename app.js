(() => {
  'use strict';

  const CONFIG = window.SITE_CONFIG || {};
  const API = String(CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  const CART_KEY = 'memorina_cart';
  const CUSTOMER_KEY = 'memorina_customer';
  const MAX_QTY = 1000;
  const RIBBON_COLORS = ['coral', 'sage', 'gold', 'dark'];

  const ICONS = {
    frame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><rect x="6.5" y="6.5" width="11" height="11" rx="0.5"/></svg>`,
    medal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="15" r="6"/><path d="M9 4l1.5 5M15 4l-1.5 5" /><path d="M12 12v6M9.5 15h5"/></svg>`,
    notebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="1.5"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/></svg>`,
    glasses: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="14" r="3.2"/><circle cx="17.5" cy="14" r="3.2"/><path d="M9.7 13h4.6M3.3 13l1-4M20.7 13l-1-4"/></svg>`,
    cane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 4a3 3 0 106 0M11 4v16"/></svg>`,
    gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-1.5-4-6-4-6 0h6zM12 8c1.5-4 6-4 6 0h-6z"/></svg>`
  };
  const WA_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11 11 0 003.6 17.3L2 22l4.8-1.6a11 11 0 0013.7-16.9zM12 20a9 9 0 01-4.6-1.3l-.3-.2-3 1 1-2.9-.2-.3A9 9 0 1112 20zm5-6.7c-.3-.1-1.6-.8-1.8-.9-.2-.1-.4-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1a7.3 7.3 0 01-3.6-3.2c-.3-.5.3-.4.7-1.4.1-.2 0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.1 1.3.1 1.8.1.6-.1 1.6-.7 1.8-1.3.2-.6.2-1.1.2-1.3-.1-.1-.3-.2-.6-.3z"/></svg>`;
  const CART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="20" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.3" fill="currentColor" stroke="none"/><path d="M2.5 3h2.2l2.1 11.4a2 2 0 002 1.6h8.6a2 2 0 002-1.7L20.5 7H5.6"/></svg>`;

  const ORDER_ERRORS = {
    invalid_name: 'الاسم مش مظبوط، اكتبه بالكامل.',
    invalid_phone: 'رقم التليفون مش صحيح.',
    invalid_address: 'اكتب العنوان بالتفصيل.',
    invalid_governorate: 'اختار المحافظة من القائمة.',
    invalid_items: 'السلة فيها بيانات مش صحيحة، راجعها.',
    invalid_product: 'في منتج في السلة مبقاش متاح، راجع السلة.',
    invalid_size: 'في منتج في السلة الحجم بتاعه مش متاح، راجع السلة.',
    invalid_quantity: 'الكمية مش مناسبة لواحد من المنتجات، راجع السلة.',
    price_changed: 'الأسعار اتحدّثت، راجع السلة وكمّل الطلب.',
    rate_limited: 'طلبات كتير في وقت قصير، جرّب بعد شوية.'
  };

  let catalog = { settings: {}, collections: [], products: [], shipping: [], reviews: [] };
  let cart = [];

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const isStorageUrl = (u) => typeof u === 'string' && API !== '' && u.startsWith(API + '/storage/v1/object/public/');
  const safeHttps = (u) => {
    try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
  };
  const currency = () => catalog.settings.currency || 'ج.م';
  const money = (n) => `${Number(n)} ${currency()}`;
  const productById = (id) => catalog.products.find((p) => p.id === id);
  const whatsappNumber = () => (/^\d{8,15}$/.test(catalog.settings.whatsapp || '') ? catalog.settings.whatsapp : '');
  const waUrl = (text) => `https://wa.me/${whatsappNumber()}?text=${encodeURIComponent(text)}`;

  /* ---------- server calls ---------- */

  async function rpc(name, body) {
    if (!API || !CONFIG.anonKey || API.includes('YOUR-PROJECT')) throw new Error('not_configured');
    const headers = { 'Content-Type': 'application/json', apikey: CONFIG.anonKey };
    if (CONFIG.anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${CONFIG.anonKey}`;
    const res = await fetch(`${API}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.message) || 'request_failed');
    return data;
  }

  async function loadCatalog() {
    const data = await rpc('get_catalog');
    catalog = {
      settings: data.settings || {},
      collections: data.collections || [],
      products: data.products || [],
      shipping: data.shipping || [],
      reviews: data.reviews || []
    };
  }

  /* ---------- pricing ---------- */

  function tierBounds(p) {
    const lo = Math.min(...p.tiers.map((t) => t.min));
    const hi = p.tiers.some((t) => t.max === null) ? MAX_QTY : Math.max(...p.tiers.map((t) => t.max));
    return { lo, hi: Math.min(hi, MAX_QTY) };
  }

  function tierRate(p, qty) {
    const rates = p.tiers
      .filter((t) => qty >= t.min && (t.max === null || qty <= t.max))
      .map((t) => t.rate);
    return rates.length ? Math.min(...rates) : null;
  }

  function unitPrice(p, size, qty) {
    if (p.hidePrice) return null;
    if (p.tiers && p.tiers.length) return tierRate(p, qty);
    if (p.sizes && p.sizes.length) {
      const chosen = p.sizes.find((s) => s.label === size) || p.sizes[0];
      return chosen.price;
    }
    return p.price;
  }

  function priceLabel(p) {
    if (p.hidePrice) return '';
    if (p.tiers && p.tiers.length) {
      const rates = p.tiers.map((t) => t.rate);
      return `${currency()} ${Math.min(...rates)} : ${Math.max(...rates)} للقطعة حسب الكمية`;
    }
    if (p.sizes && p.sizes.length) return `من ${Math.min(...p.sizes.map((s) => s.price))} ${currency()}`;
    return money(p.price);
  }

  /* ---------- collections and products ---------- */

  function ribbonHtml(ribbon) {
    if (!ribbon || !ribbon.text) return '';
    const color = RIBBON_COLORS.includes(ribbon.color) ? ribbon.color : 'coral';
    return `<span class="product-ribbon ribbon-${color}">${esc(ribbon.text)}</span>`;
  }

  function collectionCard(c) {
    return `
      <div class="product-card collection-card" data-action="open-collection" data-id="${esc(c.id)}">
        <div class="product-photo">
          ${ribbonHtml(c.ribbon)}
          ${isStorageUrl(c.cover)
            ? `<img src="${esc(c.cover)}" alt="${esc(c.name)}" loading="lazy" decoding="async">`
            : `${ICONS[c.icon] || ICONS.gift}<span class="placeholder-note">حطوا صورة الغلاف هنا</span>`}
        </div>
        <div class="product-info">
          <h3>${esc(c.name)}</h3>
          <p>${esc(c.desc)}</p>
          <span class="order-btn" style="margin-top:auto;">تصفح المنتجات</span>
        </div>
      </div>`;
  }

  function renderCollections() {
    const grid = $('collectionsGrid');
    if (!catalog.collections.length) {
      grid.innerHTML = '<p class="cart-empty">المنتجات هتتضاف قريب 🤍</p>';
      return;
    }
    grid.innerHTML = catalog.collections.map(collectionCard).join('');
  }

  function renderNav() {
    const menu = $('navMenu');
    menu.querySelectorAll('.nav-sub').forEach((li) => li.remove());
    const anchor = $('navCollectionsList');
    const items = catalog.collections.map((c) => {
      const li = document.createElement('li');
      li.className = 'nav-sub';
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.action = 'nav-collection';
      a.dataset.id = c.id;
      a.textContent = c.name;
      li.appendChild(a);
      return li;
    });
    anchor.after(...items);
  }

  function renderReviews() {
    const urls = catalog.reviews.filter(isStorageUrl);
    $('reviewsWrap').innerHTML = urls.length ? urls.map((u) => `
      <div class="review-card" data-action="zoom"><img src="${esc(u)}" alt="رأي عميل" loading="lazy" decoding="async"></div>
    `).join('') : '<div class="review-card">حطي صور آراء العملاء هنا<br>(1080×1350 بكسل)</div>';
  }

  function productCard(p, ctx) {
    const images = (p.images || []).filter(isStorageUrl);
    const hasSizes = p.sizes && p.sizes.length;
    const hasTiers = p.tiers && p.tiers.length;
    const ribbon = ribbonHtml(p.ribbon);

    const sizeButtons = hasSizes ? `
      <div class="size-select">
        ${p.sizes.map((s, i) => `
          <button type="button" class="size-btn ${i === 0 ? 'active' : ''}" data-action="size" data-size="${esc(s.label)}">${esc(s.label)}</button>
        `).join('')}
      </div>` : '';

    const tierBoxes = hasTiers ? `
      <div class="tier-boxes">
        ${p.tiers.map((t, i) => {
          const label = t.max !== null ? `من ${t.min} لحد ${t.max} قطعة` : `${t.min} قطعة أو أكتر`;
          return `
          <div class="tier-box">
            <input type="number" class="tier-input" data-index="${i}" min="${t.min}" ${t.max !== null ? `max="${t.max}"` : ''} placeholder="${esc(label)}">
            <span class="tier-price"></span>
          </div>`;
        }).join('')}
      </div>
      <p class="cart-form-error tier-error"></p>` : '';

    const stepper = `
      <div class="qty-stepper">
        <button type="button" class="qty-btn" data-action="qty" data-delta="-1">−</button>
        <span class="qty-value">1</span>
        <button type="button" class="qty-btn" data-action="qty" data-delta="1">+</button>
      </div>`;

    const label = priceLabel(p);
    return `
      <div class="product-card" data-pid="${esc(p.id)}" data-ctx="${esc(ctx)}">
        <div class="product-photo" data-action="zoom">
          ${ribbon}
          ${images[0]
            ? `<img src="${esc(images[0])}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
            : `${ICONS[p.icon] || ICONS.gift}<span class="placeholder-note">حطوا صورة المنتج هنا</span>`}
        </div>
        ${images.length > 1 ? `
        <div class="thumb-strip">
          ${images.map((img, i) => `<img src="${esc(img)}" class="thumb ${i === 0 ? 'active' : ''}" data-action="thumb" alt="">`).join('')}
        </div>` : ''}
        <div class="product-info">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.desc)}</p>
          ${sizeButtons}
          ${label ? `<span class="product-price">${esc(label)}</span>` : ''}
          ${hasTiers ? tierBoxes : stepper}
          <div class="product-actions">
            ${hasTiers ? '' : `<a class="order-btn" data-role="order" href="${esc(directLink(p, null, 1))}" target="_blank" rel="noopener noreferrer">${WA_ICON} اطلب الآن</a>`}
            <button type="button" class="add-cart-btn ${hasTiers ? 'full-width' : ''}" data-action="add-cart">${CART_ICON} أضف للسلة</button>
          </div>
        </div>
      </div>`;
  }

  function directLink(p, size, qty) {
    let text = `أهلاً Memorina، عايزين نطلب: ${p.name}`;
    if (size) text += ` (${size})`;
    if (qty > 1) text += ` × ${qty}`;
    return waUrl(text);
  }

  const cardSize = (card) => {
    const active = card.querySelector('.size-btn.active');
    return active ? active.dataset.size : null;
  };
  const cardQty = (card) => {
    const el = card.querySelector('.qty-value');
    return el ? parseInt(el.textContent, 10) || 1 : 1;
  };

  function refreshCard(card) {
    const p = productById(card.dataset.pid);
    if (!p) return;
    const size = cardSize(card);
    const priceEl = card.querySelector('.product-price');
    if (priceEl && p.sizes && p.sizes.length && !p.hidePrice) {
      priceEl.textContent = money(unitPrice(p, size, 1));
    }
    const order = card.querySelector('[data-role="order"]');
    if (order) order.href = directLink(p, size, cardQty(card));
  }

  function openCollection(id) {
    const c = catalog.collections.find((x) => x.id === id);
    if (!c) return;
    $('collectionModalTitle').textContent = c.name;
    $('collectionModalProducts').innerHTML = catalog.products
      .filter((p) => p.collectionId === id)
      .map((p) => productCard(p, 'col')).join('')
      || '<p class="cart-empty">لسه مفيش منتجات في الكولكشن ده.</p>';
    $('collectionOverlay').classList.add('open');
  }

  let gallery = { list: [], index: 0 };

  function showLightbox() {
    const { list, index } = gallery;
    $('lightboxImg').src = list[index];
    const multi = list.length > 1;
    $('lbPrev').hidden = !multi;
    $('lbNext').hidden = !multi;
    $('lightboxCount').hidden = !multi;
    $('lightboxCount').textContent = `${index + 1} / ${list.length}`;
    if (multi) {
      [1, -1].forEach((d) => { new Image().src = list[(index + d + list.length) % list.length]; });
    }
  }

  function openLightbox(list, index = 0) {
    const urls = list.filter(isStorageUrl);
    if (!urls.length) return;
    gallery = { list: urls, index: Math.min(Math.max(index, 0), urls.length - 1) };
    showLightbox();
    $('lightboxOverlay').classList.add('open');
  }

  function stepLightbox(delta) {
    const n = gallery.list.length;
    if (n < 2) return;
    gallery.index = (gallery.index + delta + n) % n;
    showLightbox();
  }

  const lightboxOpen = () => $('lightboxOverlay').classList.contains('open');

  function zoomFrom(el) {
    if (el.classList.contains('review-card')) {
      const imgs = Array.from($('reviewsWrap').querySelectorAll('.review-card img'));
      const own = el.querySelector('img');
      if (own) openLightbox(imgs.map((i) => i.src), imgs.indexOf(own));
      return;
    }
    const card = el.closest('.product-card');
    const p = card && productById(card.dataset.pid);
    if (p) {
      const thumbs = Array.from(card.querySelectorAll('.thumb'));
      openLightbox(p.images || [], Math.max(0, thumbs.findIndex((t) => t.classList.contains('active'))));
      return;
    }
    const img = el.querySelector('img');
    if (img) openLightbox([img.src], 0);
  }

  /* ---------- tier inputs ---------- */

  function onTierInput(input) {
    const card = input.closest('.product-card');
    const p = productById(card.dataset.pid);
    const index = Number(input.dataset.index);
    const tier = p.tiers[index];

    card.querySelectorAll('.tier-input').forEach((other) => {
      if (other !== input) {
        other.value = '';
        other.classList.remove('invalid');
        other.nextElementSibling.textContent = '';
      }
    });

    const out = input.nextElementSibling;
    const val = parseInt(input.value, 10);
    if (Number.isNaN(val)) {
      input.classList.remove('invalid');
      out.textContent = '';
      return;
    }
    const tooLow = val < tier.min;
    const tooHigh = tier.max !== null && val > tier.max;
    if (tooLow || tooHigh) {
      input.classList.add('invalid');
      out.textContent = tooLow ? `أقل كمية مسموحة ${tier.min}` : `أقصى كمية مسموحة ${tier.max}`;
    } else {
      input.classList.remove('invalid');
      out.textContent = p.hidePrice ? '' : `الإجمالي: ${money(val * tier.rate)}`;
    }
  }

  function readTierQty(card, p) {
    for (const input of card.querySelectorAll('.tier-input')) {
      const val = parseInt(input.value, 10);
      if (Number.isNaN(val) || val <= 0) continue;
      const tier = p.tiers[Number(input.dataset.index)];
      if (val >= tier.min && (tier.max === null || val <= tier.max)) return { qty: val, input };
    }
    return null;
  }

  /* ---------- cart ---------- */

  const lineKey = (pid, size) => `${pid}|${size || ''}`;

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      cart = Array.isArray(saved) ? saved.filter((i) => i
        && typeof i.pid === 'string'
        && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= MAX_QTY
        && (i.size === null || i.size === undefined || typeof i.size === 'string')) : [];
    } catch { cart = []; }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* storage unavailable */ }
  }

  // drop or fix items that no longer match the current catalog
  function syncCart() {
    cart = cart.filter((item) => {
      const p = productById(item.pid);
      if (!p) return false;
      if (p.tiers && p.tiers.length) {
        const { lo, hi } = tierBounds(p);
        item.size = null;
        item.qty = Math.min(Math.max(item.qty, lo), hi);
      } else if (p.sizes && p.sizes.length) {
        if (!p.sizes.some((s) => s.label === item.size)) item.size = p.sizes[0].label;
      } else {
        item.size = null;
      }
      return true;
    });
    saveCart();
  }

  function addToCart(card) {
    const p = productById(card.dataset.pid);
    if (!p) return;
    let qty;
    let size = null;
    if (p.tiers && p.tiers.length) {
      const sel = readTierQty(card, p);
      const err = card.querySelector('.tier-error');
      if (!sel) {
        err.textContent = 'من فضلك اكتب كمية صحيحة جوه أي بوكس من البوكسات فوق.';
        return;
      }
      err.textContent = '';
      qty = sel.qty;
      card.querySelectorAll('.tier-input').forEach((i) => { i.value = ''; i.nextElementSibling.textContent = ''; });
    } else {
      qty = cardQty(card);
      size = p.sizes && p.sizes.length ? cardSize(card) : null;
      const stepper = card.querySelector('.qty-value');
      if (stepper) stepper.textContent = '1';
      refreshCard(card);
    }

    const key = lineKey(p.id, size);
    const existing = cart.find((i) => lineKey(i.pid, i.size) === key);
    if (existing) existing.qty = Math.min(existing.qty + qty, MAX_QTY);
    else cart.push({ pid: p.id, size, qty: Math.min(qty, MAX_QTY) });
    saveCart();
    renderCart();

    const cartBtn = $('cartBtn');
    cartBtn.classList.remove('bounce');
    void cartBtn.offsetWidth;
    cartBtn.classList.add('bounce');

    const btn = card.querySelector('.add-cart-btn');
    if (btn) {
      const original = btn.innerHTML;
      btn.classList.add('added');
      btn.textContent = 'تم ✓';
      setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = original; }, 1200);
    }
  }

  function changeCartQty(key, delta) {
    const item = cart.find((i) => lineKey(i.pid, i.size) === key);
    if (!item) return;
    const p = productById(item.pid);
    let next = item.qty + delta;
    if (p && p.tiers && p.tiers.length) {
      const { lo, hi } = tierBounds(p);
      next = Math.min(Math.max(next, lo), hi);
    } else if (next <= 0) {
      cart = cart.filter((i) => i !== item);
      saveCart();
      renderCart();
      return;
    }
    item.qty = Math.min(next, MAX_QTY);
    saveCart();
    renderCart();
  }

  function removeFromCart(key) {
    cart = cart.filter((i) => lineKey(i.pid, i.size) !== key);
    saveCart();
    renderCart();
  }

  function cartLines() {
    return cart.map((item) => {
      const p = productById(item.pid);
      if (!p) return null;
      return {
        item, p,
        key: lineKey(item.pid, item.size),
        name: item.size ? `${p.name} (${item.size})` : p.name,
        unit: unitPrice(p, item.size, item.qty)
      };
    }).filter(Boolean);
  }

  function shippingFee() {
    const rate = catalog.shipping.find((r) => r.name === $('custGovernorate').value);
    return rate ? Number(rate.price) : 0;
  }

  function cartTotals(lines) {
    let subtotal = 0;
    let priced = false;
    let unpriced = false;
    lines.forEach((l) => {
      if (l.unit === null) unpriced = true;
      else { priced = true; subtotal += l.unit * l.item.qty; }
    });
    return { subtotal, priced, unpriced };
  }

  function renderCart() {
    const lines = cartLines();
    const qtyTotal = lines.reduce((n, l) => n + l.item.qty, 0);
    const badge = $('cartBadge');
    badge.style.display = qtyTotal > 0 ? 'flex' : 'none';
    badge.textContent = qtyTotal;

    $('cartItems').innerHTML = lines.length ? lines.map((l) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${esc(l.name)}</h4>
          <span>${l.unit !== null ? `${esc(money(l.unit))} × ${l.item.qty}` : `الكمية: ${l.item.qty}`}</span>
        </div>
        <div class="cart-item-qty">
          <button type="button" class="qty-btn" data-action="cart-qty" data-key="${esc(l.key)}" data-delta="-1">−</button>
          <span>${l.item.qty}</span>
          <button type="button" class="qty-btn" data-action="cart-qty" data-key="${esc(l.key)}" data-delta="1">+</button>
        </div>
        <button type="button" class="cart-item-remove" data-action="cart-remove" data-key="${esc(l.key)}">حذف</button>
      </div>
    `).join('') : '<p class="cart-empty">السلة فاضية دلوقتي، ضيفوا منتجات من الكولكشن 🤍</p>';

    const { subtotal, priced, unpriced } = cartTotals(lines);
    const govChosen = $('custGovernorate').value !== '';
    const fee = shippingFee();
    const pending = 'بيتأكد مع التيم';

    $('cartSubtotal').textContent = priced ? money(subtotal) : (unpriced ? pending : money(0));
    $('cartShipping').textContent = govChosen ? money(fee) : 'اختر المحافظة';
    $('cartTotal').textContent = priced || !unpriced ? money(subtotal + fee) : pending;
    $('cartNote').textContent = unpriced
      ? 'في منتجات سعرها هيتأكد معاكم على الواتساب، ومش داخلة في الإجمالي.' : '';

    const checkout = $('cartCheckout');
    checkout.disabled = lines.length === 0;
    checkout.style.opacity = lines.length === 0 ? '0.5' : '1';
  }

  function populateGovernorates() {
    const select = $('custGovernorate');
    const current = select.value;
    select.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'اختر المحافظة';
    select.appendChild(first);
    catalog.shipping.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = `${r.name} — شحن ${r.price} ${currency()}`;
      select.appendChild(opt);
    });
    if (catalog.shipping.some((r) => r.name === current)) select.value = current;
  }

  const openCart = () => { $('cartDrawer').classList.add('open'); $('cartOverlay').classList.add('open'); };
  const closeCart = () => { $('cartDrawer').classList.remove('open'); $('cartOverlay').classList.remove('open'); };

  /* ---------- checkout ---------- */

  function loadCustomer() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CUSTOMER_KEY) || '{}');
      if (saved.name) $('custName').value = saved.name;
      if (saved.phone) $('custPhone').value = saved.phone;
      if (saved.address) $('custAddress').value = saved.address;
      if (saved.governorate && catalog.shipping.some((r) => r.name === saved.governorate)) {
        $('custGovernorate').value = saved.governorate;
      }
    } catch { /* ignore */ }
  }

  function saveCustomer(data) {
    try { sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }

  async function checkout() {
    const fields = {
      name: $('custName'), phone: $('custPhone'), address: $('custAddress'), governorate: $('custGovernorate')
    };
    const errorEl = $('cartFormError');
    const okEl = $('cartFormOk');
    okEl.textContent = '';
    Object.values(fields).forEach((el) => el.classList.remove('invalid'));

    const values = {
      name: fields.name.value.trim(),
      phone: fields.phone.value.trim(),
      address: fields.address.value.trim(),
      governorate: fields.governorate.value
    };
    const missing = Object.keys(values).filter((k) => !values[k]);
    if (missing.length) {
      missing.forEach((k) => fields[k].classList.add('invalid'));
      errorEl.textContent = 'من فضلك املأوا الاسم ورقم التليفون والمحافظة والعنوان قبل إتمام الطلب.';
      return;
    }
    if (!whatsappNumber()) {
      errorEl.textContent = 'مش قادرين نجهز الطلب دلوقتي، جرّب تاني بعد شوية.';
      return;
    }
    errorEl.textContent = '';

    const lines = cartLines();
    const { subtotal } = cartTotals(lines);
    const expectedTotal = subtotal + shippingFee();

    const button = $('cartCheckout');
    button.disabled = true;
    // open the tab right away so mobile browsers don't block it after the request
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;

    try {
      const result = await rpc('create_order', {
        ...values,
        website: $('custWebsite').value,
        expectedTotal,
        items: lines.map((l) => ({ id: l.item.pid, size: l.item.size, qty: l.item.qty }))
      });
      saveCustomer(values);
      const url = waUrl(result.message || '');
      cart = [];
      saveCart();
      renderCart();
      if (popup) popup.location.href = url;
      else window.location.href = url;
      okEl.innerHTML = `تم تسجيل طلبك${result.orderNo ? ` رقم #${esc(result.orderNo)}` : ''}. كمّل الإرسال على واتساب لو الصفحة متفتحتش: <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">افتح واتساب</a>`;
    } catch (err) {
      if (popup) popup.close();
      errorEl.textContent = ORDER_ERRORS[err.message] || 'حصلت مشكلة وإحنا بنسجل الطلب، جرّب تاني أو كلمنا على واتساب.';
      if (err.message === 'price_changed' || err.message.startsWith('invalid_')) {
        try { await loadCatalog(); syncCart(); renderCart(); } catch { /* keep current view */ }
      }
    } finally {
      button.disabled = cart.length === 0;
    }
  }

  /* ---------- search ---------- */

  function performSearch(query) {
    const results = $('searchResults');
    const q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '<p class="cart-empty">اكتب كلمة للبحث عن أي منتج أو كوليكشن بالاسم أو الوصف</p>';
      return;
    }
    const has = (text) => String(text || '').toLowerCase().includes(q);
    const collections = catalog.collections.filter((c) => has(c.name) || has(c.desc));
    const products = catalog.products.filter((p) => has(p.name) || has(p.desc));
    results.innerHTML = collections.length || products.length
      ? collections.map(collectionCard).join('') + products.map((p) => productCard(p, 'search')).join('')
      : `<p class="cart-empty">مفيش نتائج مطابقة لـ "${esc(query)}"</p>`;
  }

  /* ---------- page wiring ---------- */

  function wireLinks() {
    const general = waUrl('أهلاً Memorina، عايزين نعرف تفاصيل أكتر عن منتجاتكم.');
    ['mainWaBtn', 'floatWaBtn', 'footerWaLink', 'helpWaBtn'].forEach((id) => { $(id).href = general; });
    const ig = safeHttps(catalog.settings.instagram);
    $('footerIgLink').href = ig || '#';
    $('floatIgBtn').href = ig || '#';
    $('seeMoreReviewsBtn').href = safeHttps(catalog.settings.reviewsLink) || '#';
  }

  // move to the neighbouring review card (wraps around at the ends)
  function scrollReviews(direction) {
    const wrap = $('reviewsWrap');
    const cards = Array.from(wrap.querySelectorAll('.review-card'));
    if (cards.length < 2) return;
    const box = wrap.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const centers = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    let current = 0;
    centers.forEach((c, i) => {
      if (Math.abs(c - middle) < Math.abs(centers[current] - middle)) current = i;
    });
    const target = (current + direction + cards.length) % cards.length;
    wrap.scrollBy({ left: centers[target] - middle, behavior: 'smooth' });
  }

  function fitHeroTitle() {
    const el = document.querySelector('.hero-title-en');
    if (!el) return;
    const lines = el.querySelectorAll('.hero-line');
    if (!lines.length) return;
    let size = 40;
    el.style.fontSize = `${size}px`;
    const width = el.parentElement.clientWidth;
    const widest = () => Math.max(...Array.from(lines).map((l) => l.scrollWidth));
    while (widest() > width && size > 11) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }

  const actions = {
    'open-collection': (el) => {
      $('searchOverlay').classList.remove('open');
      openCollection(el.dataset.id);
    },
    'nav-collection': (el, e) => {
      e.preventDefault();
      $('navMenu').classList.remove('open');
      openCollection(el.dataset.id);
    },
    'close-collection': () => $('collectionOverlay').classList.remove('open'),
    'close-lightbox': () => $('lightboxOverlay').classList.remove('open'),
    'lb-close': () => $('lightboxOverlay').classList.remove('open'),
    'lb-prev': () => stepLightbox(-1),
    'lb-next': () => stepLightbox(1),
    zoom: zoomFrom,
    thumb: (el) => {
      const card = el.closest('.product-card');
      const photo = card.querySelector('.product-photo');
      const ribbon = photo.querySelector('.product-ribbon');
      photo.innerHTML = '';
      if (ribbon) photo.appendChild(ribbon);
      const img = document.createElement('img');
      img.src = el.src;
      img.alt = '';
      photo.appendChild(img);
      card.querySelectorAll('.thumb').forEach((t) => t.classList.remove('active'));
      el.classList.add('active');
    },
    size: (el) => {
      el.parentElement.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      el.classList.add('active');
      refreshCard(el.closest('.product-card'));
    },
    qty: (el) => {
      const card = el.closest('.product-card');
      const value = card.querySelector('.qty-value');
      const next = Math.min(Math.max((parseInt(value.textContent, 10) || 1) + Number(el.dataset.delta), 1), MAX_QTY);
      value.textContent = next;
      refreshCard(card);
    },
    'add-cart': (el) => addToCart(el.closest('.product-card')),
    'cart-qty': (el) => changeCartQty(el.dataset.key, Number(el.dataset.delta)),
    'cart-remove': (el) => removeFromCart(el.dataset.key),
    reload: () => start()
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'close-lightbox' && e.target !== el) return;
    const handler = actions[el.dataset.action];
    if (handler) handler(el, e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('tier-input')) onTierInput(e.target);
  });

  document.addEventListener('keydown', (e) => {
    if (lightboxOpen() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      stepLightbox(e.key === 'ArrowLeft' ? 1 : -1);
      return;
    }
    if (e.key !== 'Escape') return;
    ['collectionOverlay', 'searchOverlay', 'helpOverlay', 'lightboxOverlay'].forEach((id) => $(id).classList.remove('open'));
    closeCart();
  });

  let touchX = null;
  $('lightboxOverlay').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('lightboxOverlay').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) stepLightbox(dx > 0 ? 1 : -1);
  }, { passive: true });

  $('navToggle').addEventListener('click', () => $('navMenu').classList.toggle('open'));
  $('navMenu').addEventListener('click', (e) => {
    if (e.target.tagName === 'A') $('navMenu').classList.remove('open');
  });
  $('helpBtn').addEventListener('click', () => $('helpOverlay').classList.add('open'));
  $('helpClose').addEventListener('click', () => $('helpOverlay').classList.remove('open'));
  $('helpOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'helpOverlay') $('helpOverlay').classList.remove('open');
  });
  $('searchBtn').addEventListener('click', () => {
    $('searchOverlay').classList.add('open');
    $('searchInput').value = '';
    performSearch('');
    setTimeout(() => $('searchInput').focus(), 300);
  });
  $('searchClose').addEventListener('click', () => $('searchOverlay').classList.remove('open'));
  $('searchOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'searchOverlay') $('searchOverlay').classList.remove('open');
  });
  $('searchInput').addEventListener('input', (e) => performSearch(e.target.value));
  $('reviewPrevBtn').addEventListener('click', () => scrollReviews(-1));
  $('reviewNextBtn').addEventListener('click', () => scrollReviews(1));
  $('cartBtn').addEventListener('click', openCart);
  $('cartClose').addEventListener('click', closeCart);
  $('cartOverlay').addEventListener('click', closeCart);
  $('custGovernorate').addEventListener('change', renderCart);
  $('cartCheckout').addEventListener('click', checkout);

  const CATALOG_KEY = 'memorina_catalog';

  function setCatalog(data) {
    catalog = {
      settings: data.settings || {}, collections: data.collections || [], products: data.products || [],
      shipping: data.shipping || [], reviews: data.reviews || []
    };
  }

  function applyCatalog() {
    renderCollections();
    renderNav();
    renderReviews();
    wireLinks();
    populateGovernorates();
    loadCustomer();
    syncCart();
    renderCart();
  }

  async function start() {
    let cached = null;
    try { cached = sessionStorage.getItem(CATALOG_KEY); } catch { /* ignore */ }
    if (cached) {
      try {
        setCatalog(JSON.parse(cached));
        applyCatalog();
      } catch { cached = null; }
    }
    if (!cached) $('collectionsGrid').innerHTML = '<p class="cart-empty">جاري تحميل المنتجات...</p>';

    try {
      const data = await rpc('get_catalog');
      const fresh = JSON.stringify(data);
      try { sessionStorage.setItem(CATALOG_KEY, fresh); } catch { /* storage full or blocked */ }
      if (fresh !== cached) {
        setCatalog(data);
        applyCatalog();
      }
    } catch {
      if (!cached) {
        $('collectionsGrid').innerHTML = '<div class="cart-empty">مقدرناش نحمّل المنتجات دلوقتي.<br><button type="button" class="retry-btn" data-action="reload">حاول تاني</button></div>';
      }
    }
  }

  loadCart();
  renderCart();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeroTitle);
  fitHeroTitle();
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitHeroTitle);
  });
  start();
})();
