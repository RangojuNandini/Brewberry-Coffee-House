const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
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
const PUBLIC_FILES = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/app.js', 'app.js']]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let dataQueue = Promise.resolve();

function serializeData(operation) {
  const next = dataQueue.then(operation, operation);
  dataQueue = next.catch(() => {});
  return next;
}

async function readRecords(type) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${type}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function saveRecord(type, record) {
  return serializeData(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const records = await readRecords(type);
    records.push(record);
    await fs.writeFile(path.join(DATA_DIR, `${type}.json`), `${JSON.stringify(records, null, 2)}\n`);
    return record;
  });
}

function updateRecord(type, id, update) {
  return serializeData(async () => {
    const records = await readRecords(type);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return null;
    records[index] = update(records[index]);
    await fs.writeFile(path.join(DATA_DIR, `${type}.json`), `${JSON.stringify(records, null, 2)}\n`);
    return records[index];
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Please send valid JSON.'), { status: 400 }); }
}

function normalizeOrder(body) {
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MENU.length) throw Object.assign(new Error('Add valid drinks to your order.'), { status: 400 });
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw Object.assign(new Error('Enter your name and a valid email address.'), { status: 400 });
  if (typeof body.phone !== 'string' || body.phone.replace(/\D/g, '').length < 10) throw Object.assign(new Error('Enter a valid phone number so we can confirm delivery.'), { status: 400 });
  if (typeof body.address !== 'string' || body.address.trim().length < 8) throw Object.assign(new Error('Enter your delivery address.'), { status: 400 });
  const items = [];
  for (const line of body.items) {
    const product = MENU.find(item => item.id === line.id);
    const quantity = Number(line.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || items.some(item => item.id === product.id)) throw Object.assign(new Error('One of the selected drinks is invalid.'), { status: 400 });
    items.push({ id: product.id, name: product.name, quantity, unitPrice: product.price });
  }
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const monday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()) === 'Monday';
  const discount = monday ? Math.round(subtotal * 0.2) : 0;
  const deliveryFee = subtotal - discount > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  return {
    id: randomUUID(), trackingCode: `BRW-${randomBytes(4).toString('hex').toUpperCase()}`, name: body.name.trim().slice(0, 100), email: body.email.trim().slice(0, 200),
    phone: body.phone.trim().slice(0, 40), address: body.address.trim().slice(0, 500),
    notes: String(body.notes || '').trim().slice(0, 500), items, subtotal, discount, deliveryFee,
    total: subtotal - discount + deliveryFee, currency: 'INR', createdAt: new Date().toISOString(),
  };
}

function secureEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; base-uri 'self'; form-action 'self' https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'");
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { status: 'ok', service: 'Brewberry Coffee House' });
    if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, { currency: 'INR', paymentEnabled: Boolean(KEY_ID && KEY_SECRET), razorpayKeyId: KEY_ID });
    if (req.method === 'GET' && url.pathname === '/api/menu') return sendJson(res, 200, { items: MENU });

    if (req.method === 'GET' && url.pathname === '/api/orders/track') {
      const code = (url.searchParams.get('code') || '').trim().toUpperCase();
      const phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
      if (!/^BRW-[A-F0-9]{8}$/.test(code) || phone.length < 10) return sendJson(res, 400, { error: 'Enter the order code and the phone number used at checkout.' });
      const orders = await readRecords('orders');
      const order = orders.find(item => item.trackingCode === code && item.phone.replace(/\D/g, '') === phone);
      if (!order) return sendJson(res, 404, { error: 'We could not find an order with those details.' });
      return sendJson(res, 200, { trackingCode: order.trackingCode, status: order.status, paymentStatus: order.paymentStatus, total: order.total, currency: order.currency, items: order.items.map(item => ({ name: item.name, quantity: item.quantity })), createdAt: order.createdAt });
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req);
      if (body.paymentMethod !== 'cod') return sendJson(res, 400, { error: 'Choose cash on delivery or use online checkout.' });
      const order = normalizeOrder(body);
      order.paymentMethod = 'cod';
      order.paymentStatus = 'due on delivery';
      order.status = 'received';
      await saveRecord('orders', order);
      return sendJson(res, 201, { message: 'Your order is in! You can check its progress from the Track order link.', order: { id: order.id, trackingCode: order.trackingCode, total: order.total, currency: order.currency, status: order.status } });
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/create-order') {
      if (!KEY_ID || !KEY_SECRET) return sendJson(res, 503, { error: 'Online payment is not configured yet. Please choose cash on delivery.' });
      const order = normalizeOrder(await readBody(req));
      order.paymentMethod = 'razorpay';
      order.paymentStatus = 'pending';
      order.status = 'awaiting payment';
      const apiResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}` },
        body: JSON.stringify({ amount: order.total * 100, currency: 'INR', receipt: order.id.replaceAll('-', '').slice(0, 40), notes: { customerOrderId: order.id } }),
      });
      const paymentOrder = await apiResponse.json();
      if (!apiResponse.ok) return sendJson(res, 502, { error: 'Online checkout could not start. Please try again or choose cash on delivery.' });
      order.razorpayOrderId = paymentOrder.id;
      await saveRecord('orders', order);
      return sendJson(res, 201, { keyId: KEY_ID, orderId: paymentOrder.id, amount: paymentOrder.amount, currency: paymentOrder.currency, customerOrderId: order.id, trackingCode: order.trackingCode, name: order.name, email: order.email, phone: order.phone });
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/verify') {
      const body = await readBody(req);
      if (typeof body.customerOrderId !== 'string' || typeof body.razorpayOrderId !== 'string' || typeof body.razorpayPaymentId !== 'string' || typeof body.razorpaySignature !== 'string') return sendJson(res, 400, { error: 'Payment confirmation is incomplete.' });
      const orders = await readRecords('orders');
      const order = orders.find(item => item.id === body.customerOrderId && item.razorpayOrderId === body.razorpayOrderId && item.paymentStatus === 'pending');
      if (!order) return sendJson(res, 400, { error: 'This order cannot be confirmed. Please contact the shop.' });
      const expected = createHmac('sha256', KEY_SECRET).update(`${order.razorpayOrderId}|${body.razorpayPaymentId}`).digest('hex');
      if (!KEY_SECRET || !secureEqual(expected, body.razorpaySignature)) return sendJson(res, 400, { error: 'Payment could not be verified. Please contact the shop before trying again.' });
      const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(body.razorpayPaymentId)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}` },
      });
      const payment = await paymentResponse.json();
      if (!paymentResponse.ok || payment.order_id !== order.razorpayOrderId || payment.amount !== order.total * 100 || payment.currency !== 'INR') return sendJson(res, 502, { error: 'We could not confirm payment with the payment provider. Please contact the shop before placing another order.' });
      if (payment.status !== 'captured') return sendJson(res, 409, { error: 'Payment is still processing. The shop will confirm your order once it is captured.' });
      const updated = await updateRecord('orders', order.id, current => ({ ...current, razorpayPaymentId: body.razorpayPaymentId, paymentStatus: 'paid', status: 'received', paidAt: new Date().toISOString() }));
      return sendJson(res, 200, { message: 'Payment received. Your order is confirmed!', order: { id: updated.id, trackingCode: updated.trackingCode, total: updated.total, currency: updated.currency, status: updated.status } });
    }

    if (req.method === 'POST' && url.pathname === '/api/contact') {
      const body = await readBody(req);
      if (typeof body.name !== 'string' || body.name.trim().length < 2 || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || typeof body.message !== 'string' || body.message.trim().length < 8) return sendJson(res, 400, { error: 'Enter your name, a valid email and a message of at least 8 characters.' });
      await saveRecord('messages', { id: randomUUID(), name: body.name.trim().slice(0, 100), email: body.email.trim().slice(0, 200), message: body.message.trim().slice(0, 2000), createdAt: new Date().toISOString() });
      return sendJson(res, 201, { message: 'Your message was saved on this server, but the shop has not been notified. Add a real email or WhatsApp service to receive messages.' });
    }

    if (url.pathname.startsWith('/api/')) return sendJson(res, 405, { error: 'Method not allowed.' });
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
    const publicFile = PUBLIC_FILES.get(url.pathname);
    if (!publicFile) return sendJson(res, 404, { error: 'Not found.' });
    const content = await fs.readFile(path.join(ROOT, publicFile));
    res.writeHead(200, { 'Content-Type': mime[path.extname(publicFile)], 'Cache-Control': 'no-cache' });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found.' });
    console.error(error);
    return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Brewberry is ready at http://localhost:${PORT}`));
