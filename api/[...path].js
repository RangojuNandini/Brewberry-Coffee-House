const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const DB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DELIVERY_FEE = 40;
const FREE_DELIVERY_OVER = 1906;
const MENU = [
  { id: 'cappuccino', name: 'Cappuccino', description: 'Perfect blend of espresso, milk and a cloud of foam.', price: 334, category: 'Coffee', image: 'photo-1572442388796-11668a67e53d' },
  { id: 'iced-coffee', name: 'Iced Coffee', description: 'Cool, refreshing coffee for a perfect day.', price: 286, category: 'Cold coffee', image: 'photo-1461023058943-07fcbe16d735' },
  { id: 'latte', name: 'Latte', description: 'Smooth espresso with perfectly steamed milk.', price: 362, category: 'Coffee', image: 'photo-1461023058943-07fcbe16d735' },
  { id: 'mocha', name: 'Mocha', description: 'Rich chocolate blended with our signature espresso.', price: 400, category: 'Coffee', image: 'photo-1578314675249-a6910f80cc4e' },
  { id: 'americano', name: 'Americano', description: 'Classic espresso, gently diluted with hot water.', price: 238, category: 'Coffee', image: 'photo-1517701550927-30cf4ba1dba5' },
  { id: 'caramel-macchiato', name: 'Caramel Macchiato', description: 'Milk, vanilla and caramel with a shot of espresso.', price: 429, category: 'Coffee', image: 'photo-1485808191679-5f86510681a2' },
];

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { throw error('Please send valid JSON.'); }
}
function dbReady() {
  if (!DB_URL || !DB_KEY) throw error('Ordering is not configured yet. Please try again later.', 503);
}
async function db(table, { method = 'GET', query = '', data } = {}) {
  dbReady();
  const response = await fetch(`${DB_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Database request failed', response.status, result?.message || '');
    throw error('We could not save or retrieve your order. Please try again.', 503);
  }
  return result;
}
function normalizeOrder(input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MENU.length) throw error('Add valid drinks to your order.');
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw error('Enter your name and a valid email address.');
  if (typeof input.phone !== 'string' || input.phone.replace(/\D/g, '').length < 10) throw error('Enter a valid phone number so we can confirm delivery.');
  if (typeof input.address !== 'string' || input.address.trim().length < 8) throw error('Enter your delivery address.');
  const items = [];
  for (const line of input.items) {
    const product = MENU.find(item => item.id === line.id);
    const quantity = Number(line.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || items.some(item => item.id === product.id)) throw error('One of the selected drinks is invalid.');
    items.push({ id: product.id, name: product.name, quantity, unitPrice: product.price });
  }
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const monday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()) === 'Monday';
  const discount = monday ? Math.round(subtotal * 0.2) : 0;
  const deliveryFee = subtotal - discount > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  return { id: randomUUID(), trackingCode: `BRW-${randomBytes(4).toString('hex').toUpperCase()}`, name: input.name.trim().slice(0, 100), email: input.email.trim().slice(0, 200), phone: input.phone.trim().slice(0, 40), address: input.address.trim().slice(0, 500), notes: String(input.notes || '').trim().slice(0, 500), items, subtotal, discount, deliveryFee, total: subtotal - discount + deliveryFee, currency: 'INR', createdAt: new Date().toISOString() };
}
function row(order) {
  return { id: order.id, tracking_code: order.trackingCode, phone: order.phone, status: order.status, payment_status: order.paymentStatus, total: order.total, currency: order.currency, items: order.items, data: order, created_at: order.createdAt };
}
function fromRow(value) { return value?.data || null; }
function secureEqual(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  for (const [name, value] of Object.entries({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; base-uri 'self'; form-action 'self' https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'" })) res.setHeader(name, value);
  const url = new URL(req.url, 'https://brewberry.invalid');
  const method = req.method || 'GET';
  try {
    if (method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', service: 'Brewberry Coffee House' });
    if (method === 'GET' && url.pathname === '/api/config') return json(res, 200, { currency: 'INR', paymentEnabled: Boolean(KEY_ID && KEY_SECRET), razorpayKeyId: KEY_ID });
    if (method === 'GET' && url.pathname === '/api/menu') return json(res, 200, { items: MENU });
    if (method === 'GET' && url.pathname === '/api/orders/track') {
      const code = (url.searchParams.get('code') || '').trim().toUpperCase();
      const phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
      if (!/^BRW-[A-F0-9]{8}$/.test(code) || phone.length < 10) throw error('Enter the order code and the phone number used at checkout.');
      const rows = await db('brewberry_orders', { query: `tracking_code=eq.${encodeURIComponent(code)}&select=*&limit=1` });
      const order = fromRow(rows[0]);
      if (!order || order.phone.replace(/\D/g, '') !== phone) throw error('We could not find an order with those details.', 404);
      return json(res, 200, { trackingCode: order.trackingCode, status: order.status, paymentStatus: order.paymentStatus, total: order.total, currency: order.currency, items: order.items.map(item => ({ name: item.name, quantity: item.quantity })), createdAt: order.createdAt });
    }
    if (method === 'POST' && url.pathname === '/api/orders') {
      const input = body(req);
      if (input.paymentMethod !== 'cod') throw error('Choose cash on delivery or use online checkout.');
      const order = normalizeOrder(input); order.paymentMethod = 'cod'; order.paymentStatus = 'due on delivery'; order.status = 'received';
      await db('brewberry_orders', { method: 'POST', data: row(order) });
      return json(res, 201, { message: 'Your order is in! You can check its progress from the Track order link.', order: { id: order.id, trackingCode: order.trackingCode, total: order.total, currency: order.currency, status: order.status } });
    }
    if (method === 'POST' && url.pathname === '/api/payments/create-order') {
      if (!KEY_ID || !KEY_SECRET) throw error('Online payment is not configured yet. Please choose cash on delivery.', 503);
      const order = normalizeOrder(body(req)); order.paymentMethod = 'razorpay'; order.paymentStatus = 'pending'; order.status = 'awaiting payment';
      const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}` }, body: JSON.stringify({ amount: order.total * 100, currency: 'INR', receipt: order.id.replaceAll('-', '').slice(0, 40), notes: { customerOrderId: order.id } }) });
      const paymentOrder = await response.json();
      if (!response.ok) throw error('Online checkout could not start. Please try again or choose cash on delivery.', 502);
      order.razorpayOrderId = paymentOrder.id;
      await db('brewberry_orders', { method: 'POST', data: row(order) });
      return json(res, 201, { keyId: KEY_ID, orderId: paymentOrder.id, amount: paymentOrder.amount, currency: paymentOrder.currency, customerOrderId: order.id, trackingCode: order.trackingCode, name: order.name, email: order.email, phone: order.phone });
    }
    if (method === 'POST' && url.pathname === '/api/payments/verify') {
      const input = body(req);
      if (typeof input.customerOrderId !== 'string' || typeof input.razorpayOrderId !== 'string' || typeof input.razorpayPaymentId !== 'string' || typeof input.razorpaySignature !== 'string') throw error('Payment confirmation is incomplete.');
      const rows = await db('brewberry_orders', { query: `id=eq.${encodeURIComponent(input.customerOrderId)}&select=*&limit=1` });
      const order = fromRow(rows[0]);
      if (!order || order.razorpayOrderId !== input.razorpayOrderId || order.paymentStatus !== 'pending') throw error('This order cannot be confirmed. Please contact the shop.');
      const expected = createHmac('sha256', KEY_SECRET).update(`${order.razorpayOrderId}|${input.razorpayPaymentId}`).digest('hex');
      if (!KEY_SECRET || !secureEqual(expected, input.razorpaySignature)) throw error('Payment could not be verified. Please contact the shop before trying again.');
      const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.razorpayPaymentId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}` } });
      const payment = await response.json();
      if (!response.ok || payment.order_id !== order.razorpayOrderId || payment.amount !== order.total * 100 || payment.currency !== 'INR') throw error('We could not confirm payment with the payment provider. Please contact the shop before placing another order.', 502);
      if (payment.status !== 'captured') throw error('Payment is still processing. The shop will confirm your order once it is captured.', 409);
      order.razorpayPaymentId = input.razorpayPaymentId; order.paymentStatus = 'paid'; order.status = 'received'; order.paidAt = new Date().toISOString();
      await db('brewberry_orders', { method: 'PATCH', query: `id=eq.${encodeURIComponent(order.id)}`, data: row(order) });
      return json(res, 200, { message: 'Payment received. Your order is confirmed!', order: { id: order.id, trackingCode: order.trackingCode, total: order.total, currency: order.currency, status: order.status } });
    }
    if (method === 'POST' && url.pathname === '/api/contact') {
      const input = body(req);
      if (typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || typeof input.message !== 'string' || input.message.trim().length < 8) throw error('Enter your name, a valid email and a message of at least 8 characters.');
      await db('brewberry_messages', { method: 'POST', data: { id: randomUUID(), name: input.name.trim().slice(0, 100), email: input.email.trim().slice(0, 200), message: input.message.trim().slice(0, 2000), created_at: new Date().toISOString() } });
      return json(res, 201, { message: 'Your message was saved. The shop has not been notified yet.' });
    }
    return json(res, url.pathname.startsWith('/api/') ? 405 : 404, { error: url.pathname.startsWith('/api/') ? 'Method not allowed.' : 'Not found.' });
  } catch (err) {
    console.error(err);
    return json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong. Please try again.' });
  }
};
