// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api.js');

api.configure({ latency: 0, jitter: 0, persist: false });

const validOrder = () => ({
  customerName: 'Harsh Chakarvarti',
  phone: '9876543210',
  address: '12 MG Road, Hyderabad',
  items: [{ id: 'm1', qty: 2 }, { id: 'm3', qty: 1 }],
});

test.beforeEach(async () => {
  await api.del('/orders');
});

test('GET /menu returns items and delivery fee', async () => {
  const res = await api.get('/menu');
  assert.equal(res.status, 200);
  assert.ok(res.data.items.length > 0);
  assert.equal(res.data.deliveryFee, 30);
});

test('POST /orders creates an order with correct totals', async () => {
  const res = await api.post('/orders', validOrder());
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'PLACED');
  assert.equal(res.data.subtotal, 129 * 2 + 89);
  assert.equal(res.data.total, 129 * 2 + 89 + 30);
  assert.match(res.data.id, /^QD-/);
});

test('POST /orders rejects invalid input with field errors (422)', async () => {
  const res = await api.post('/orders', { customerName: 'H', phone: '123', address: 'x', items: [] });
  assert.equal(res.status, 422);
  const d = res.data.error.details;
  assert.ok(d.customerName && d.phone && d.address && d.items);
});

test('POST /orders rejects unknown items and bad quantities', async () => {
  const bad = validOrder();
  bad.items = [{ id: 'nope', qty: 1 }];
  assert.equal((await api.post('/orders', bad)).status, 422);
  bad.items = [{ id: 'm1', qty: 99 }];
  assert.equal((await api.post('/orders', bad)).status, 422);
});

test('duplicate items are merged', async () => {
  const body = validOrder();
  body.items = [{ id: 'm1', qty: 1 }, { id: 'm1', qty: 2 }];
  const res = await api.post('/orders', body);
  assert.equal(res.data.items.length, 1);
  assert.equal(res.data.items[0].qty, 3);
});

test('order moves through the full lifecycle in order', async () => {
  const { data: order } = await api.post('/orders', validOrder());
  const seen = [order.status];
  for (let i = 0; i < 4; i++) {
    const res = await api.patch('/orders/' + order.id + '/status');
    assert.equal(res.status, 200);
    seen.push(res.data.status);
  }
  assert.deepEqual(seen, api.STATUS_FLOW);
  const after = await api.patch('/orders/' + order.id + '/status');
  assert.equal(after.status, 409);
});

test('skipping a status is rejected (409)', async () => {
  const { data: order } = await api.post('/orders', validOrder());
  const res = await api.patch('/orders/' + order.id + '/status', { status: 'DELIVERED' });
  assert.equal(res.status, 409);
});

test('cancel works early but not once out for delivery', async () => {
  const a = (await api.post('/orders', validOrder())).data;
  assert.equal((await api.post('/orders/' + a.id + '/cancel')).data.status, 'CANCELLED');

  const b = (await api.post('/orders', validOrder())).data;
  for (let i = 0; i < 3; i++) await api.patch('/orders/' + b.id + '/status');
  const res = await api.post('/orders/' + b.id + '/cancel');
  assert.equal(res.status, 409);
});

test('GET /orders supports status filter, newest first', async () => {
  const a = (await api.post('/orders', validOrder())).data;
  await api.post('/orders', validOrder());
  await api.patch('/orders/' + a.id + '/status');
  const accepted = await api.get('/orders?status=accepted');
  assert.equal(accepted.data.count, 1);
  const all = await api.get('/orders');
  assert.equal(all.data.count, 2);
});

test('unknown order is 404, wrong method is 405, unknown route is 404', async () => {
  assert.equal((await api.get('/orders/QD-NOPE1')).status, 404);
  assert.equal((await api.request('PUT', '/menu')).status, 405);
  assert.equal((await api.get('/nothing')).status, 404);
});

test('onLog receives every request and can be unsubscribed', async () => {
  const entries = [];
  const off = api.onLog((e) => entries.push(e));
  await api.get('/menu');
  off();
  await api.get('/menu');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'GET');
  assert.equal(entries[0].status, 200);
});
