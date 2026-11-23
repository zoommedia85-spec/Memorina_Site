(() => {
  'use strict';

  const CONFIG = window.SITE_CONFIG || {};
  const BASE = String(CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  const SESSION_KEY = 'memorina_admin_session';

  const STATUS_LABELS = {
    new: 'جديد', confirmed: 'مؤكد', in_progress: 'تحت التنفيذ',
    shipped: 'اتشحن', delivered: 'اتسلّم', cancelled: 'ملغي'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  const isUrl = (u) => typeof u === 'string' && u.startsWith(`${BASE}/storage/v1/object/public/media/`);

  let session = null;
  let state = { collections: [], products: [], shipping: [], reviews: [], settings: null, orders: [] };

  /* ---------- helpers ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  const fail = (err) => toast(`❌ ${err && err.message ? err.message : 'حصلت مشكلة'}`);

  function jwtPayload(token) {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  }

  /* ---------- auth ---------- */

  async function authCall(path, { method = 'POST', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json', apikey: CONFIG.anonKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/auth/v1${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || 'request_failed');
    }
    return data;
  }

  function setSession(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600)
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async function freshToken() {
    if (!session) throw new Error('سجّل الدخول الأول');
    if (session.expires_at - Math.floor(Date.now() / 1000) < 60) {
      const data = await authCall('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
      setSession(data);
    }
    return session.access_token;
  }

  async function logout() {
    const token = session && session.access_token;
    session = null;
    sessionStorage.removeItem(SESSION_KEY);
    if (token) { try { await authCall('/logout', { token }); } catch { /* already expired */ } }
    showView('login');
  }

  function showView(name) {
    $('loginView').classList.toggle('hidden', name !== 'login');
    $('mfaView').classList.toggle('hidden', name !== 'mfa');
    $('app').classList.toggle('hidden', name !== 'app');
    $('logoutBtn').classList.toggle('hidden', name === 'login');
    $('statusText').textContent = name === 'app' ? '✅ متصل' : '';
  }

  async function afterLogin() {
    const payload = jwtPayload(session.access_token);
    if (payload.aal === 'aal2') return enterApp();

    const user = await authCall('/user', { method: 'GET', token: session.access_token });
    const factors = (user.factors || []).filter((f) => f.factor_type === 'totp');
    const verified = factors.find((f) => f.status === 'verified');
    $('mfaError').textContent = '';
    showView('mfa');

    if (verified) {
      $('mfaVerifyBox').classList.remove('hidden');
      $('mfaEnrollBox').classList.add('hidden');
      $('mfaVerifyForm').dataset.factor = verified.id;
      $('mfaCode').value = '';
      $('mfaCode').focus();
      return;
    }

    for (const f of factors) {
      try { await authCall(`/factors/${f.id}`, { method: 'DELETE', token: session.access_token }); } catch { /* ignore */ }
    }
    const factor = await authCall('/factors', {
      token: session.access_token,
      body: { factor_type: 'totp', friendly_name: `memorina-${Date.now()}`, issuer: 'Memorina' }
    });
    $('mfaQr').src = factor.totp.qr_code;
    $('mfaSecret').textContent = factor.totp.secret;
    $('mfaEnrollForm').dataset.factor = factor.id;
    $('mfaEnrollCode').value = '';
    $('mfaEnrollBox').classList.remove('hidden');
    $('mfaVerifyBox').classList.add('hidden');
  }

  async function verifyTotp(factorId, code) {
    const token = session.access_token;
    const challenge = await authCall(`/factors/${factorId}/challenge`, { token });
    const data = await authCall(`/factors/${factorId}/verify`, {
      token, body: { challenge_id: challenge.id, code: code.trim() }
    });
    setSession(data);
    await enterApp();
  }

  /* ---------- api ---------- */

  async function rest(method, path, { body, prefer } = {}) {
    const token = await freshToken();
    const headers = { apikey: CONFIG.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      if (res.status === 401) logout();
      throw new Error((data && data.message) || 'request_failed');
    }
    return data;
  }

  const q = (v) => encodeURIComponent(v);

  async function patchOne(table, column, value, body) {
    const rows = await rest('PATCH', `${table}?${column}=eq.${q(value)}`, { body, prefer: 'return=representation' });
    if (!rows || !rows.length) throw new Error('مفيش صلاحية أو العنصر مش موجود');
    return rows[0];
  }

  async function loadAll() {
    const [collections, products, shipping, reviews, settings] = await Promise.all([
      rest('GET', 'collections?select=*&order=sort_order,created_at'),
      rest('GET', 'products?select=*&order=sort_order,created_at'),
      rest('GET', 'shipping_rates?select=*&order=sort_order,id'),
      rest('GET', 'review_images?select=*&order=sort_order,id'),
      rest('GET', 'settings?select=*&id=eq.1')
    ]);
    state = { ...state, collections, products, shipping, reviews, settings: settings[0] || null };
  }

  async function enterApp() {
    const admins = await rest('GET', 'admins?select=user_id');
    if (!admins || !admins.length) {
      await logout();
      $('loginError').textContent = 'الحساب ده مش مسجّل كأدمن.';
      return;
    }
    await loadAll();
    await loadOrders();
    showView('app');
    renderCollections();
    renderProducts();
    shippingDraft = state.shipping.map((r) => ({ ...r }));
    renderShipping();
    renderReviews();
    renderSettings();
  }

  /* ---------- images ---------- */

  async function compress(file, maxSide) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('مقدرناش نجهز الصورة'))), 'image/jpeg', 0.86);
    });
  }

  async function uploadBlob(blob, folder) {
    const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const token = await freshToken();
    const res = await fetch(`${BASE}/storage/v1/object/media/${path}`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'false',
        'cache-control': 'max-age=31536000'
      },
      body: blob
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && data.message) || 'فشل رفع الصورة');
    }
    return `${BASE}/storage/v1/object/public/media/${path}`;
  }

  async function uploadImage(file, folder, maxSide = 1600) {
    if (!file.type.startsWith('image/')) throw new Error('الملف لازم يكون صورة');
    return uploadBlob(await compress(file, maxSide), folder);
  }

  async function removeStoredImage(url) {
    const marker = '/storage/v1/object/public/media/';
    const i = url.indexOf(marker);
    if (i === -1) return;
    try {
      const token = await freshToken();
      await fetch(`${BASE}/storage/v1/object/media/${url.slice(i + marker.length)}`, {
        method: 'DELETE', headers: { apikey: CONFIG.anonKey, Authorization: `Bearer ${token}` }
      });
    } catch { /* orphan file is harmless */ }
  }

  const thumbs = (urls, action) => urls.map((u, i) => `
    <div class="img-thumb"><img src="${esc(u)}" alt=""><button type="button" data-action="${action}" data-index="${i}">✕</button></div>
  `).join('');

  /* ---------- orders ---------- */

  async function loadOrders() {
    state.orders = await rest('GET', 'orders?select=*&order=created_at.desc&limit=300');
    renderOrders();
  }

  function waPhone(phone) {
    const digits = String(phone).replace(/\D/g, '');
    return /^01\d{9}$/.test(digits) ? `20${digits.slice(1)}` : digits;
  }

  function renderOrders() {
    const filter = $('orderFilter').value;
    const list = state.orders.filter((o) => !filter || o.status === filter);
    const fresh = state.orders.filter((o) => o.status === 'new').length;
    $('ordersCount').textContent = state.orders.length;
    $('newOrdersBadge').textContent = fresh;
    $('newOrdersBadge').classList.toggle('hidden', fresh === 0);

    if (!list.length) {
      $('ordersList').innerHTML = '<div class="empty-msg">مفيش طلبات.</div>';
      return;
    }
    $('ordersList').innerHTML = list.map((o) => {
      const lines = (o.items || []).map((l) => `
        <li>${esc(l.name)}${l.size ? ` (${esc(l.size)})` : ''} × ${esc(l.qty)}${l.total !== null && l.total !== undefined ? ` = ${esc(l.total)}` : ' — السعر بيتأكد'}</li>
      `).join('');
      return `
      <div class="item-row order" data-order="${esc(o.id)}">
        <div class="order-head">
          <b>طلب #${esc(o.id)} <span class="tag">${esc(STATUS_LABELS[o.status] || o.status)}</span></b>
          <span class="hint">${esc(new Date(o.created_at).toLocaleString('ar-EG'))}</span>
        </div>
        <div class="meta">
          ${esc(o.customer_name)} · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>
          · <a href="https://wa.me/${esc(waPhone(o.phone))}" target="_blank" rel="noopener noreferrer">واتساب</a><br>
          ${esc(o.governorate)} — ${esc(o.address)}
        </div>
        <ul>${lines}</ul>
        <div class="meta">
          المنتجات: ${esc(o.subtotal)} · الشحن: ${esc(o.shipping)} · <b>الإجمالي: ${esc(o.total)}</b>
          ${o.has_unpriced ? ' (فيه منتجات سعرها لسه بيتحدد)' : ''}
        </div>
        <div class="row">
          <select data-field="status">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <input type="text" data-field="note" maxlength="1000" placeholder="ملاحظة" value="${esc(o.note)}">
          <button class="btn btn-danger btn-sm" type="button" data-action="order-delete" data-id="${esc(o.id)}">حذف</button>
        </div>
      </div>`;
    }).join('');
  }

  async function updateOrder(id, body) {
    try {
      const row = await patchOne('orders', 'id', id, body);
      state.orders = state.orders.map((o) => (String(o.id) === String(id) ? { ...o, ...row } : o));
      renderOrders();
      toast('تم الحفظ ✓');
    } catch (err) { fail(err); }
  }

  async function deleteOrder(id) {
    if (!confirm(`حذف الطلب #${id} نهائيًا؟`)) return;
    try {
      await rest('DELETE', `orders?id=eq.${q(id)}`);
      state.orders = state.orders.filter((o) => String(o.id) !== String(id));
      renderOrders();
    } catch (err) { fail(err); }
  }

  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportOrders() {
    const head = ['رقم الطلب', 'التاريخ', 'الاسم', 'التليفون', 'المحافظة', 'العنوان', 'المنتجات', 'الشحن', 'الإجمالي', 'الحالة', 'ملاحظات'];
    const rows = state.orders.map((o) => [
      o.id, new Date(o.created_at).toLocaleString('ar-EG'), o.customer_name, o.phone, o.governorate, o.address,
      (o.items || []).map((l) => `${l.name}${l.size ? ` (${l.size})` : ''} × ${l.qty}`).join(' | '),
      o.shipping, o.total, STATUS_LABELS[o.status] || o.status, o.note
    ]);
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memorina-orders.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- collections ---------- */

  let editingCollection = null;
  let collectionCover = '';

  function renderCollections() {
    $('collectionsCount').textContent = state.collections.length;
    $('collectionsList').innerHTML = state.collections.length ? state.collections.map((c) => `
      <div class="item-row">
        <div class="info">
          <b>${esc(c.name)}${c.hide_prices ? '<span class="tag">الأسعار مخفية</span>' : ''}${c.is_active ? '' : '<span class="tag off">مخفي</span>'}</b>
          <span>${esc(c.description)}</span>
        </div>
        <div class="actions">
          <button class="btn btn-outline btn-sm" type="button" data-action="collection-edit" data-id="${esc(c.id)}">تعديل</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="collection-delete" data-id="${esc(c.id)}">حذف</button>
        </div>
      </div>`).join('') : '<div class="empty-msg">لسه مفيش كوليكشنز.</div>';

    const options = state.collections.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const filter = $('productFilterCollection');
    const keep = filter.value;
    filter.innerHTML = `<option value="">كل الكوليكشنز</option>${options}`;
    filter.value = keep;
    $('prodCollection').innerHTML = options;
  }

  function openCollectionEditor(id) {
    editingCollection = id;
    const c = id ? state.collections.find((x) => x.id === id)
      : { name: '', description: '', icon: 'frame', cover_url: '', hide_prices: false, is_active: true };
    $('collectionEditorTitle').textContent = id ? 'تعديل كوليكشن' : 'كوليكشن جديد';
    $('colName').value = c.name;
    $('colDesc').value = c.description;
    $('colIcon').value = c.icon;
    $('colHidePrices').checked = c.hide_prices;
    $('colActive').checked = c.is_active;
    collectionCover = c.cover_url || '';
    renderCover();
    $('collectionEditorBox').classList.add('open');
    $('collectionEditorBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const renderCover = () => { $('colCoverThumb').innerHTML = collectionCover ? thumbs([collectionCover], 'cover-remove') : ''; };

  async function saveCollection() {
    const name = $('colName').value.trim();
    if (!name) { toast('اكتب اسم الكوليكشن'); return; }
    const body = {
      name,
      description: $('colDesc').value.trim(),
      icon: $('colIcon').value,
      cover_url: collectionCover,
      hide_prices: $('colHidePrices').checked,
      is_active: $('colActive').checked
    };
    try {
      if (editingCollection) {
        const row = await patchOne('collections', 'id', editingCollection, body);
        state.collections = state.collections.map((c) => (c.id === row.id ? row : c));
      } else {
        const order = state.collections.reduce((m, c) => Math.max(m, c.sort_order), 0) + 10;
        const rows = await rest('POST', 'collections', {
          body: { id: uid('col'), ...body, sort_order: order }, prefer: 'return=representation'
        });
        state.collections.push(rows[0]);
      }
      $('collectionEditorBox').classList.remove('open');
      renderCollections();
      renderProducts();
      toast('تم حفظ الكوليكشن ✓');
    } catch (err) { fail(err); }
  }

  async function deleteCollection(id) {
    const count = state.products.filter((p) => p.collection_id === id).length;
    const msg = count ? `الكوليكشن ده فيه ${count} منتج. تمسحه هو ومنتجاته؟` : 'تمسح الكوليكشن ده؟';
    if (!confirm(msg)) return;
    try {
      await rest('DELETE', `collections?id=eq.${q(id)}`);
      state.collections = state.collections.filter((c) => c.id !== id);
      state.products = state.products.filter((p) => p.collection_id !== id);
      renderCollections();
      renderProducts();
      toast('تم الحذف');
    } catch (err) { fail(err); }
  }

  /* ---------- products ---------- */

  let editingProduct = null;
  let draft = { images: [], sizes: [], tiers: [], mode: 'fixed' };

  function priceSummary(p) {
    if (p.quantity_tiers) return `كمية بالجملة (${p.quantity_tiers.length} فئة)`;
    if (p.sizes) return `أحجام: ${p.sizes.map((s) => `${s.label} ${s.price}`).join(' / ')}`;
    return `${p.price} ${state.settings ? state.settings.currency : ''}`;
  }

  function renderProducts() {
    const filterId = $('productFilterCollection').value;
    const list = filterId ? state.products.filter((p) => p.collection_id === filterId) : state.products;
    $('productsCount').textContent = state.products.length;
    if (!list.length) {
      $('productsList').innerHTML = '<div class="empty-msg">لسه مفيش منتجات هنا.</div>';
      return;
    }
    $('productsList').innerHTML = list.map((p) => {
      const col = state.collections.find((c) => c.id === p.collection_id);
      const hidden = p.hide_price || (col && col.hide_prices);
      return `
      <div class="item-row">
        <div class="info">
          <b>${esc(p.name)}${p.ribbon_text ? `<span class="tag">${esc(p.ribbon_text)}</span>` : ''}${hidden ? '<span class="tag">السعر مخفي</span>' : ''}${p.is_active ? '' : '<span class="tag off">مخفي</span>'}</b>
          <span>${col ? esc(col.name) : '—'} · ${esc(priceSummary(p))}</span>
        </div>
        <div class="actions">
          <button class="btn btn-outline btn-sm" type="button" data-action="product-edit" data-id="${esc(p.id)}">تعديل</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="product-delete" data-id="${esc(p.id)}">حذف</button>
        </div>
      </div>`;
    }).join('');
  }

  function setMode(mode) {
    draft.mode = mode;
    document.querySelectorAll('.pricing-switch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    ['fixed', 'sizes', 'tiers'].forEach((m) => $(`panel-${m}`).classList.toggle('active', m === mode));
  }

  function renderSizeRows() {
    $('sizesRows').innerHTML = draft.sizes.map((s, i) => `
      <div class="size-row">
        <input data-list="sizes" data-index="${i}" data-key="label" maxlength="30" placeholder="اسم الحجم (صغير)" value="${esc(s.label)}">
        <input type="number" min="0" step="0.01" data-list="sizes" data-index="${i}" data-key="price" placeholder="السعر" value="${esc(s.price)}">
        <button class="btn btn-danger btn-sm" type="button" data-action="size-remove" data-index="${i}">✕</button>
      </div>`).join('');
  }

  function renderTierRows() {
    $('tiersRows').innerHTML = draft.tiers.map((t, i) => `
      <div class="tier-row">
        <input type="number" min="1" data-list="tiers" data-index="${i}" data-key="min" placeholder="أقل كمية" value="${esc(t.min)}">
        <input type="number" min="1" data-list="tiers" data-index="${i}" data-key="max" placeholder="أقصى كمية (فاضي = مفتوح)" value="${t.max === null || t.max === undefined ? '' : esc(t.max)}">
        <input type="number" min="0" step="0.01" data-list="tiers" data-index="${i}" data-key="rate" placeholder="سعر القطعة" value="${esc(t.rate)}">
        <button class="btn btn-danger btn-sm" type="button" data-action="tier-remove" data-index="${i}">✕</button>
      </div>`).join('');
  }

  const renderProductImages = () => { $('prodImagesThumb').innerHTML = thumbs(draft.images, 'prodimg-remove'); };

  function openProductEditor(id) {
    if (!state.collections.length) { toast('اعمل كوليكشن الأول'); return; }
    editingProduct = id;
    const p = id ? state.products.find((x) => x.id === id) : {
      collection_id: $('productFilterCollection').value || state.collections[0].id,
      name: '', description: '', icon: 'gift', images: [], price: 0, sizes: null, quantity_tiers: null,
      hide_price: false, ribbon_text: '', ribbon_color: 'coral', is_active: true
    };
    $('productEditorTitle').textContent = id ? 'تعديل منتج' : 'منتج جديد';
    $('prodCollection').value = p.collection_id;
    $('prodIcon').value = p.icon;
    $('prodName').value = p.name;
    $('prodDesc').value = p.description;
    $('prodRibbonText').value = p.ribbon_text;
    $('prodRibbonColor').value = p.ribbon_color;
    $('prodPrice').value = p.price ?? 0;
    $('prodHidePrice').checked = p.hide_price;
    $('prodActive').checked = p.is_active;
    draft = {
      images: (p.images || []).slice(),
      sizes: p.sizes ? p.sizes.map((s) => ({ ...s })) : [],
      tiers: p.quantity_tiers ? p.quantity_tiers.map((t) => ({ ...t })) : [],
      mode: p.quantity_tiers ? 'tiers' : (p.sizes ? 'sizes' : 'fixed')
    };
    renderProductImages();
    renderSizeRows();
    renderTierRows();
    setMode(draft.mode);
    $('productEditorBox').classList.add('open');
    $('productEditorBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function saveProduct() {
    const name = $('prodName').value.trim();
    if (!name) { toast('اكتب اسم المنتج'); return; }
    const body = {
      collection_id: $('prodCollection').value,
      name,
      description: $('prodDesc').value.trim(),
      icon: $('prodIcon').value,
      images: draft.images,
      hide_price: $('prodHidePrice').checked,
      ribbon_text: $('prodRibbonText').value.trim(),
      ribbon_color: $('prodRibbonColor').value,
      is_active: $('prodActive').checked,
      price: null, sizes: null, quantity_tiers: null
    };

    if (draft.mode === 'fixed') {
      const price = Number($('prodPrice').value);
      if (Number.isNaN(price) || price < 0) { toast('السعر مش صحيح'); return; }
      body.price = price;
    } else if (draft.mode === 'sizes') {
      if (!draft.sizes.length) { toast('ضيف حجم واحد على الأقل'); return; }
      if (draft.sizes.some((s) => !String(s.label).trim())) { toast('اكتب اسم لكل حجم'); return; }
      body.sizes = draft.sizes.map((s) => ({ label: String(s.label).trim(), price: Number(s.price) || 0 }));
    } else {
      if (!draft.tiers.length) { toast('ضيف فئة واحدة على الأقل'); return; }
      body.quantity_tiers = draft.tiers.map((t) => ({
        min: Number(t.min) || 0,
        max: t.max === null || t.max === '' || t.max === undefined ? null : Number(t.max),
        rate: Number(t.rate) || 0
      }));
      if (body.quantity_tiers.some((t) => t.min < 1)) { toast('أقل كمية لازم تكون 1 أو أكتر'); return; }
    }

    try {
      if (editingProduct) {
        const row = await patchOne('products', 'id', editingProduct, body);
        state.products = state.products.map((p) => (p.id === row.id ? row : p));
      } else {
        const order = state.products.reduce((m, p) => Math.max(m, p.sort_order), 0) + 10;
        const rows = await rest('POST', 'products', {
          body: { id: uid('prod'), ...body, sort_order: order }, prefer: 'return=representation'
        });
        state.products.push(rows[0]);
      }
      $('productEditorBox').classList.remove('open');
      renderProducts();
      toast('تم حفظ المنتج ✓');
    } catch (err) { fail(err); }
  }

  async function deleteProduct(id) {
    if (!confirm('تمسح المنتج ده؟')) return;
    try {
      await rest('DELETE', `products?id=eq.${q(id)}`);
      state.products = state.products.filter((p) => p.id !== id);
      renderProducts();
      toast('تم الحذف');
    } catch (err) { fail(err); }
  }

  /* ---------- shipping ---------- */

  let shippingDraft = [];

  function renderShipping() {
    $('shippingCount').textContent = shippingDraft.length;
    $('shippingRows').innerHTML = shippingDraft.map((r, i) => `
      <tr>
        <td><input data-list="shipping" data-index="${i}" data-key="name" maxlength="60" value="${esc(r.name)}"></td>
        <td><input type="number" min="0" step="0.01" data-list="shipping" data-index="${i}" data-key="price" value="${esc(r.price)}"></td>
        <td><button class="btn btn-danger btn-sm" type="button" data-action="shipping-remove" data-index="${i}">✕</button></td>
      </tr>`).join('');
  }

  async function saveShipping() {
    const rows = shippingDraft.map((r, i) => ({
      ...(r.id ? { id: r.id } : {}),
      name: String(r.name).trim(),
      price: Number(r.price),
      sort_order: (i + 1) * 10
    }));
    if (rows.some((r) => !r.name || Number.isNaN(r.price) || r.price < 0)) { toast('راجع الأسماء والأسعار'); return; }
    if (new Set(rows.map((r) => r.name)).size !== rows.length) { toast('في اسم محافظة متكرر'); return; }

    try {
      const keptIds = rows.filter((r) => r.id).map((r) => r.id);
      const removed = state.shipping.filter((r) => !keptIds.includes(r.id)).map((r) => r.id);
      if (removed.length) await rest('DELETE', `shipping_rates?id=in.(${removed.join(',')})`);
      const existing = rows.filter((r) => r.id);
      if (existing.length) {
        await rest('POST', 'shipping_rates?on_conflict=id', { body: existing, prefer: 'resolution=merge-duplicates' });
      }
      const fresh = rows.filter((r) => !r.id);
      if (fresh.length) await rest('POST', 'shipping_rates', { body: fresh });
      state.shipping = await rest('GET', 'shipping_rates?select=*&order=sort_order,id');
      shippingDraft = state.shipping.map((r) => ({ ...r }));
      renderShipping();
      toast('تم حفظ أسعار الشحن ✓');
    } catch (err) { fail(err); }
  }

  /* ---------- reviews ---------- */

  function renderReviews() {
    $('reviewsCount').textContent = state.reviews.length;
    $('reviewImagesThumb').innerHTML = state.reviews.map((r) => `
      <div class="img-thumb"><img src="${esc(r.url)}" alt=""><button type="button" data-action="review-remove" data-id="${esc(r.id)}">✕</button></div>
    `).join('');
  }

  async function addReviewImages(files) {
    try {
      let order = state.reviews.reduce((m, r) => Math.max(m, r.sort_order), 0);
      for (const file of files) {
        const url = await uploadImage(file, 'reviews', 1350);
        order += 10;
        const rows = await rest('POST', 'review_images', { body: { url, sort_order: order }, prefer: 'return=representation' });
        state.reviews.push(rows[0]);
        renderReviews();
      }
      toast('تم رفع الصور ✓');
    } catch (err) { fail(err); }
  }

  async function removeReview(id) {
    const item = state.reviews.find((r) => String(r.id) === String(id));
    if (!item) return;
    try {
      await rest('DELETE', `review_images?id=eq.${q(id)}`);
      state.reviews = state.reviews.filter((r) => r !== item);
      renderReviews();
      removeStoredImage(item.url);
    } catch (err) { fail(err); }
  }

  /* ---------- settings ---------- */

  function renderSettings() {
    const s = state.settings;
    if (!s) return;
    $('setWhatsapp').value = s.whatsapp_number;
    $('setInstagram').value = s.instagram_url;
    $('setCurrency').value = s.currency;
    $('setReviewsLink').value = s.reviews_link_url;
  }

  async function saveSettings() {
    const body = {
      whatsapp_number: $('setWhatsapp').value.replace(/\D/g, ''),
      instagram_url: $('setInstagram').value.trim(),
      currency: $('setCurrency').value.trim(),
      reviews_link_url: $('setReviewsLink').value.trim(),
      updated_at: new Date().toISOString()
    };
    if (!/^\d{8,15}$/.test(body.whatsapp_number)) { toast('رقم الواتساب لازم يكون بالكود الدولي، أرقام بس'); return; }
    if ((body.instagram_url && !body.instagram_url.startsWith('https://')) ||
        (body.reviews_link_url && !body.reviews_link_url.startsWith('https://'))) {
      toast('اللينكات لازم تبدأ بـ https://');
      return;
    }
    try {
      state.settings = await patchOne('settings', 'id', 1, body);
      renderSettings();
      toast('تم حفظ الإعدادات ✓');
    } catch (err) { fail(err); }
  }

  /* ---------- import ---------- */

  let importData = null;

  function base64ToBlob(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  async function runImport() {
    if (!importData) { toast('اختار ملف الاستيراد الأول'); return; }
    const status = $('importStatus');
    const btn = $('importBtn');
    const data = importData;
    btn.disabled = true;
    try {
      const keys = Object.keys(data.files || {});
      const urls = {};
      for (let i = 0; i < keys.length; i++) {
        status.textContent = `رفع الصور ${i + 1} من ${keys.length}...`;
        urls[keys[i]] = await uploadBlob(base64ToBlob(data.files[keys[i]]), 'import');
      }
      const url = (key) => (key ? urls[key] || '' : '');

      status.textContent = 'حفظ الكوليكشنز...';
      await rest('POST', 'collections?on_conflict=id', {
        prefer: 'resolution=merge-duplicates',
        body: data.collections.map((c, i) => ({
          id: c.id, name: c.name, description: c.desc || '', icon: c.icon,
          cover_url: url(c.cover), sort_order: (i + 1) * 10
        }))
      });

      status.textContent = 'حفظ المنتجات...';
      await rest('POST', 'products?on_conflict=id', {
        prefer: 'resolution=merge-duplicates',
        body: data.products.map((p, i) => ({
          id: p.id, collection_id: p.collectionId, name: p.name, description: p.desc || '', icon: p.icon,
          images: (p.images || []).map(url).filter(Boolean),
          price: p.tiers || p.sizes ? null : p.price,
          sizes: p.sizes || null,
          quantity_tiers: p.tiers || null,
          sort_order: (i + 1) * 10
        }))
      });

      if (!state.reviews.length && (data.reviews || []).length) {
        status.textContent = 'حفظ آراء العملاء...';
        await rest('POST', 'review_images', {
          body: data.reviews.map((k, i) => ({ url: url(k), sort_order: (i + 1) * 10 }))
        });
      }

      await loadAll();
      renderCollections();
      renderProducts();
      renderReviews();
      status.textContent = `تم الاستيراد: ${data.collections.length} كوليكشن، ${data.products.length} منتج، ${keys.length} صورة.`;
      toast('تم الاستيراد ✓');
    } catch (err) {
      status.textContent = `وقف الاستيراد: ${err.message}. تقدر تشغّله تاني.`;
      fail(err);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- events ---------- */

  const actions = {
    'pick-file': (el) => $(el.dataset.target).click(),
    'orders-refresh': () => loadOrders().then(() => toast('اتحدّثت')).catch(fail),
    'orders-export': exportOrders,
    'order-delete': (el) => deleteOrder(el.dataset.id),
    'collection-new': () => openCollectionEditor(null),
    'collection-edit': (el) => openCollectionEditor(el.dataset.id),
    'collection-save': saveCollection,
    'collection-cancel': () => $('collectionEditorBox').classList.remove('open'),
    'collection-delete': (el) => deleteCollection(el.dataset.id),
    'cover-remove': () => { collectionCover = ''; renderCover(); },
    'product-new': () => openProductEditor(null),
    'product-edit': (el) => openProductEditor(el.dataset.id),
    'product-save': saveProduct,
    'product-cancel': () => $('productEditorBox').classList.remove('open'),
    'product-delete': (el) => deleteProduct(el.dataset.id),
    'prodimg-remove': (el) => { draft.images.splice(Number(el.dataset.index), 1); renderProductImages(); },
    'size-add': () => { draft.sizes.push({ label: '', price: 0 }); renderSizeRows(); },
    'size-remove': (el) => { draft.sizes.splice(Number(el.dataset.index), 1); renderSizeRows(); },
    'tier-add': () => { draft.tiers.push({ min: 1, max: null, rate: 0 }); renderTierRows(); },
    'tier-remove': (el) => { draft.tiers.splice(Number(el.dataset.index), 1); renderTierRows(); },
    'shipping-add': () => { shippingDraft.push({ name: '', price: 0 }); renderShipping(); },
    'shipping-remove': (el) => { shippingDraft.splice(Number(el.dataset.index), 1); renderShipping(); },
    'shipping-save': saveShipping,
    'review-remove': (el) => removeReview(el.dataset.id),
    'settings-save': saveSettings,
    'import-start': runImport
  };

  document.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('.pricing-switch button');
    if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    const tab = e.target.closest('.tab-btn');
    if (tab) {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === tab));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
      return;
    }
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.list) return;
    const i = Number(el.dataset.index);
    const key = el.dataset.key;
    const target = { sizes: draft.sizes, tiers: draft.tiers, shipping: shippingDraft }[el.dataset.list];
    if (!target || !target[i]) return;
    if (el.dataset.list === 'tiers' && key === 'max' && el.value === '') target[i][key] = null;
    else target[i][key] = el.type === 'number' ? Number(el.value) : el.value;
  });

  $('ordersList').addEventListener('change', (e) => {
    const row = e.target.closest('[data-order]');
    if (!row) return;
    const field = e.target.dataset.field;
    if (field === 'status' || field === 'note') updateOrder(row.dataset.order, { [field]: e.target.value });
  });
  $('orderFilter').addEventListener('change', renderOrders);
  $('productFilterCollection').addEventListener('change', renderProducts);

  $('colCoverInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { collectionCover = await uploadImage(file, 'collections'); renderCover(); } catch (err) { fail(err); }
  });
  $('prodImagesInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    try {
      for (const file of files) draft.images.push(await uploadImage(file, 'products'));
      renderProductImages();
    } catch (err) { fail(err); }
  });
  $('reviewImagesInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    addReviewImages(files);
  });

  $('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      importData = JSON.parse(await file.text());
      if (!Array.isArray(importData.collections) || !Array.isArray(importData.products)) throw new Error('الملف مش بصيغة صحيحة');
      $('importFileName').textContent = `${file.name} (${importData.collections.length} كوليكشن، ${importData.products.length} منتج)`;
    } catch (err) {
      importData = null;
      fail(err);
    }
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      const data = await authCall('/token?grant_type=password', {
        body: { email: $('loginEmail').value.trim(), password: $('loginPassword').value }
      });
      setSession(data);
      $('loginPassword').value = '';
      await afterLogin();
    } catch (err) {
      $('loginError').textContent = 'بيانات الدخول غلط أو حصلت مشكلة.';
    }
  });

  const mfaSubmit = (formId, inputId) => $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    $('mfaError').textContent = '';
    try { await verifyTotp(e.target.dataset.factor, $(inputId).value); } catch {
      $('mfaError').textContent = 'الكود غلط أو منتهي، جرّب تاني.';
    }
  });
  mfaSubmit('mfaVerifyForm', 'mfaCode');
  mfaSubmit('mfaEnrollForm', 'mfaEnrollCode');

  $('logoutBtn').addEventListener('click', logout);

  (async () => {
    if (!BASE || BASE.includes('YOUR-PROJECT')) {
      $('loginError').textContent = 'لسه معملتش ربط config.js بمشروع Supabase.';
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.access_token) { session = saved; await afterLogin(); }
    } catch { session = null; showView('login'); }
  })();
})();
