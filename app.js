const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
let menuItems = [];
let paymentConfig = { paymentEnabled: false };
const cart = new Map();
const CART_STORAGE_KEY = 'brewberry-cart-v1';
const DELIVERY_FEE = 40;
const FREE_DELIVERY_OVER = 1906;

const imageUrl = (id, width = 600) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
const menuGrid = document.querySelector('#menu-grid');
const orderDialog = document.querySelector('#order-dialog');
const orderItems = document.querySelector('#order-items');
const orderTotal = document.querySelector('#order-total');
const cartCount = document.querySelector('#cart-count');
const TRACKING_STORAGE_KEY = 'brewberry-latest-order-v1';

try {
  const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '{}');
  for (const [id, quantity] of Object.entries(saved)) if (Number.isInteger(quantity) && quantity > 0 && quantity <= 20) cart.set(id, quantity);
} catch { try { localStorage.removeItem(CART_STORAGE_KEY); } catch {} }

function persistCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(Object.fromEntries(cart)));
  cartCount.textContent = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
}

function isMondayInIndia() {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()) === 'Monday';
}

function renderMenu(items) {
  menuGrid.innerHTML = items.map(item => `<article class="menu-card"><img src="${imageUrl(item.image, 560)}" alt="${item.name}" loading="lazy"><div class="menu-card-body"><h3>${item.name}</h3><p>${item.description}</p><div class="menu-price">${currency.format(item.price)}</div><div class="menu-actions"><button class="mini-add" type="button" data-add="${item.id}">Add to order +</button></div></div></article>`).join('');
}

async function loadMenu() {
  try {
    const [menuResponse, configResponse] = await Promise.all([fetch('/api/menu'), fetch('/api/config')]);
    if (!menuResponse.ok || !configResponse.ok) throw new Error('Could not load the menu.');
    const data = await menuResponse.json();
    paymentConfig = await configResponse.json();
    menuItems = data.items;
    for (const id of cart.keys()) if (!menuItems.some(item => item.id === id)) cart.delete(id);
    persistCart();
    renderMenu(menuItems);
    document.querySelector('#online-payment-option').hidden = !paymentConfig.paymentEnabled;
  } catch {
    menuGrid.innerHTML = '<p class="loading">Our menu is taking a little break. Please refresh in a moment.</p>';
  }
}

function renderCart() {
  const selected = menuItems.filter(item => cart.has(item.id));
  orderItems.innerHTML = selected.length ? selected.map(item => `<div class="order-line"><span>${item.name}</span><input aria-label="${item.name} quantity" type="number" min="1" max="20" value="${cart.get(item.id)}" data-quantity="${item.id}"><strong>${currency.format(item.price * cart.get(item.id))}</strong></div>`).join('') : '<span class="cart-empty">Choose a drink from the menu first.</span>';
  const subtotal = selected.reduce((sum, item) => sum + item.price * cart.get(item.id), 0);
  const discount = subtotal > 0 && isMondayInIndia() ? Math.round(subtotal * 0.2) : 0;
  const deliveryFee = subtotal === 0 || subtotal - discount > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  orderTotal.textContent = currency.format(subtotal - discount + deliveryFee);
  const details = [];
  if (discount) details.push(`${currency.format(discount)} Monday discount`);
  if (subtotal > 0) details.push(deliveryFee ? `${currency.format(deliveryFee)} delivery` : 'free delivery');
  document.querySelector('#discount-note').textContent = details.length ? ` · ${details.join(' · ')}` : '';
}

function showStatus(form, text, isError = false) {
  const status = form.querySelector('.form-status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function rememberOrder(code, phone) {
  try { localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify({ code, phone })); } catch {}
}

function showOrderSuccess(message, code, total, phone) {
  rememberOrder(code, phone);
  const status = document.querySelector('#order-form .form-status');
  status.replaceChildren(document.createTextNode(`${message} Total: ${currency.format(total)}.`));
  status.classList.remove('error');
  const button = document.createElement('a');
  button.href = '#track';
  button.dataset.openTrack = '';
  button.className = 'track-inline';
  button.textContent = 'Track your order';
  status.append(' ', button);
}

function openTracking() {
  const section = document.querySelector('#track');
  if (window.location.hash !== '#track') window.location.hash = 'track';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  refreshTracking();
}

async function refreshTracking() {
  const title = document.querySelector('#track-status-title');
  const message = document.querySelector('#track-message');
  const summary = document.querySelector('#track-order-summary');
  let saved;
  try { saved = JSON.parse(localStorage.getItem(TRACKING_STORAGE_KEY) || 'null'); } catch {}
  if (!saved?.code || !saved?.phone) {
    title.textContent = 'Your order will show up here';
    message.textContent = 'Place an order on this device, then come back here to see its latest update.';
    summary.replaceChildren();
    return;
  }
  title.textContent = 'Checking your order…';
  message.textContent = 'Getting the latest update from Brewberry.';
  summary.replaceChildren();
  try {
    const query = new URLSearchParams({ code: saved.code, phone: saved.phone });
    const response = await fetch(`/api/orders/track?${query}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'We could not load this order right now.');
    const titles = {
      received: 'We’re preparing your order',
      preparing: 'We’re preparing your order',
      ready: 'Your order is ready',
      completed: 'Your order is complete',
      cancelled: 'This order was cancelled',
      'awaiting payment': 'Waiting for payment',
    };
    title.textContent = titles[result.status] || 'Your order is confirmed';
    message.textContent = result.status === 'awaiting payment'
      ? 'Complete the online payment to confirm your order.'
      : 'Your order has been received by Brewberry and is being prepared.';
    const items = document.createElement('p');
    items.textContent = result.items.map(item => `${item.quantity} × ${item.name}`).join(' · ');
    const total = document.createElement('strong');
    total.textContent = `Order total: ${currency.format(result.total)}`;
    summary.append(items, total);
  } catch (error) {
    title.textContent = 'We can’t load your update right now';
    message.textContent = error.message;
    summary.replaceChildren();
  }
}

async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Online checkout could not load. Please try cash on delivery.'));
    document.head.append(script);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

document.addEventListener('click', event => {
  const add = event.target.closest('[data-add]');
  if (add) {
    cart.set(add.dataset.add, Math.min(20, (cart.get(add.dataset.add) || 0) + 1));
    persistCart();
    renderCart();
    add.textContent = 'Added ✓';
    setTimeout(() => { add.textContent = 'Add to order +'; }, 1000);
  }
  if (event.target.closest('[data-open-order]')) {
    const form = document.querySelector('#order-form');
    form.reset();
    showStatus(form, '');
    renderCart();
    orderDialog.showModal();
  }
  if (event.target.closest('[data-open-track]')) {
    event.preventDefault();
    if (orderDialog.open) orderDialog.close();
    openTracking();
  }
  if (event.target.closest('.dialog-close')) event.target.closest('dialog').close();
});

orderItems.addEventListener('change', event => {
  const input = event.target.closest('[data-quantity]');
  if (!input) return;
  cart.set(input.dataset.quantity, Math.max(1, Math.min(20, Number(input.value) || 1)));
  persistCart();
  renderCart();
});

document.querySelector('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!cart.size) return showStatus(form, 'Add a drink to your order first.', true);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Placing your order…';
  const values = Object.fromEntries(new FormData(form));
  const payload = { ...values, items: [...cart].map(([id, quantity]) => ({ id, quantity })) };
  try {
    if (values.paymentMethod === 'online') {
      const checkoutOrder = await postJson('/api/payments/create-order', payload);
      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: checkoutOrder.keyId,
        amount: checkoutOrder.amount,
        currency: checkoutOrder.currency,
        name: 'Brewberry Coffee House',
        description: 'Coffee order',
        order_id: checkoutOrder.orderId,
        prefill: { name: checkoutOrder.name, email: checkoutOrder.email, contact: checkoutOrder.phone },
        theme: { color: '#392313' },
        handler: async payment => {
          try {
            const result = await postJson('/api/payments/verify', { customerOrderId: checkoutOrder.customerOrderId, razorpayOrderId: payment.razorpay_order_id, razorpayPaymentId: payment.razorpay_payment_id, razorpaySignature: payment.razorpay_signature });
            showOrderSuccess(result.message, result.order.trackingCode, result.order.total, checkoutOrder.phone);
            cart.clear();
            persistCart();
            renderCart();
            form.reset();
          } catch (error) {
            showStatus(form, error.message, true);
          }
        },
        modal: { ondismiss: () => showStatus(form, 'Checkout closed. Your order is not confirmed yet.', true) },
      });
      checkout.on('payment.failed', () => showStatus(form, 'Payment was not completed. You can try again or choose cash on delivery.', true));
      checkout.open();
    } else {
      const result = await postJson('/api/orders', { ...payload, paymentMethod: 'cod' });
      showOrderSuccess(result.message, result.order.trackingCode, result.order.total, values.phone);
      cart.clear();
      persistCart();
      renderCart();
      form.reset();
    }
  } catch (error) {
    showStatus(form, error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Place order <span>→</span>';
  }
});

document.querySelector('#contact-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const result = await postJson('/api/contact', Object.fromEntries(new FormData(form)));
    showStatus(form, result.message);
    form.reset();
  } catch (error) {
    showStatus(form, error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Send a message <span>→</span>';
  }
});

if (window.location.hash === '#track') refreshTracking();

const navToggle = document.querySelector('.nav-toggle');
navToggle.addEventListener('click', () => {
  const nav = document.querySelector('.main-nav');
  const isOpen = nav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});
document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelector('.main-nav').classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
}));

loadMenu();
