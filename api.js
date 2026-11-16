/*
 * QuickDrop API layer
 * -------------------
 * A small, in-browser "backend" that behaves like a REST API:
 *   - routes, HTTP-style status codes (200, 201, 404, 405, 409, 422)
 *   - request validation with field-level error messages
 *   - an order lifecycle state machine
 *   - simulated network latency
 *   - persistence in localStorage
 *
 * The front end only talks to this file through `request()`, exactly like it
 * would talk to a real server with fetch(). Swapping in a real Node.js/Express
 * backend later means changing this one file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.QuickDropAPI = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'quickdrop.orders.v1';
  const DELIVERY_FEE = 30;
  const MAX_QTY = 10;

  // Order lifecycle. An order can only move forward one step at a time.
  const STATUS_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const CANCELLABLE = ['PLACED', 'ACCEPTED'];

  const MENU = [
    { id: 'm1', emoji: '🍔', name: 'Classic Veg Burger', description: 'Crispy patty, lettuce, house sauce', price: 129 },
    { id: 'm2', emoji: '🌯', name: 'Paneer Tikka Wrap', description: 'Smoky paneer, onions, mint chutney', price: 149 },
    { id: 'm3', emoji: '🍟', name: 'Masala Fries', description: 'Crinkle-cut fries with chaat masala', price: 89 },
    { id: 'm4', emoji: '🍛', name: 'Chicken Biryani', description: 'Slow-cooked basmati with raita', price: 219 },
    { id: 'm5', emoji: '🧋', name: 'Cold Coffee', description: 'Chilled, creamy and strong', price: 99 },
    { id: 'm6', emoji: '🍫', name: 'Chocolate Brownie', description: 'Warm, fudgy, nutty', price: 119 },
  ];

  const config = { latency: 300, jitter: 250, persist: true };
  const listeners = new Set();
  let memoryStore = [];

  class ApiError extends Error {
    constructor(status, message, details) {
      super(message);
      this.status = status;
      this.details = details || null;
    }
  }

  // ---------- storage ----------
  function load() {
    if (!config.persist) return memoryStore.slice();
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return memoryStore.slice();
    }
  }

  function save(list) {
    memoryStore = list.slice();
    if (!config.persist) return;
    try {
      if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      /* storage full or blocked: keep working from memory */
    }
  }

  // ---------- helpers ----------
  function newId(existing) {
    let id;
    do {
      id = 'QD-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    } while (existing.some((o) => o.id === id));
    return id;
  }

  function findOrder(orders, id) {
    const order = orders.find((o) => o.id === id);
    if (!order) throw new ApiError(404, 'Order ' + id + ' not found');
    return order;
  }

  function touch(order, status) {
    const at = new Date().toISOString();
    order.status = status;
    order.updatedAt = at;
    order.history.push({ status: status, at: at });
  }

  // ---------- validation ----------
  function validateOrder(body) {
    const b = body && typeof body === 'object' ? body : {};
    const errors = {};

    const name = typeof b.customerName === 'string' ? b.customerName.trim() : '';
    if (name.length < 2 || name.length > 60) errors.customerName = 'Enter your name (2-60 characters).';

    const phone = typeof b.phone === 'string' ? b.phone.replace(/\s+/g, '') : '';
    if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit mobile number.';

    const address = typeof b.address === 'string' ? b.address.trim() : '';
    if (address.length < 5 || address.length > 200) errors.address = 'Enter a delivery address (5-200 characters).';

    const merged = new Map();
    if (!Array.isArray(b.items) || b.items.length === 0) {
      errors.items = 'Add at least one item to your order.';
    } else {
      for (const line of b.items) {
        const item = MENU.find((m) => line && m.id === line.id);
        const qty = line ? line.qty : NaN;
        if (!item || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
          errors.items = 'Each item must exist and have a quantity between 1 and ' + MAX_QTY + '.';
          break;
        }
        merged.set(item.id, Math.min(MAX_QTY, (merged.get(item.id) || 0) + qty));
      }
    }

    if (Object.keys(errors).length) throw new ApiError(422, 'Validation failed', errors);
    return { name: name, phone: phone, address: address, merged: merged };
  }

  // ---------- route handlers ----------
  function getMenu() {
    return [200, { items: MENU, deliveryFee: DELIVERY_FEE }];
  }

  function listOrders(ctx) {
    let list = ctx.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const status = ctx.query.get('status');
    if (status) list = list.filter((o) => o.status === status.toUpperCase());
    return [200, { count: list.length, orders: list }];
  }

  function createOrder(ctx) {
    const v = validateOrder(ctx.body);
    const lines = [];
    let totalQty = 0;
    v.merged.forEach(function (qty, id) {
      const item = MENU.find((m) => m.id === id);
      lines.push({ id: id, name: item.name, price: item.price, qty: qty, lineTotal: item.price * qty });
      totalQty += qty;
    });
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const now = new Date().toISOString();
    const order = {
      id: newId(ctx.orders),
      customerName: v.name,
      phone: v.phone,
      address: v.address,
      items: lines,
      subtotal: subtotal,
      deliveryFee: DELIVERY_FEE,
      total: subtotal + DELIVERY_FEE,
      etaMinutes: 20 + Math.min(totalQty, 10) * 2,
      status: 'PLACED',
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'PLACED', at: now }],
    };
    ctx.orders.push(order);
    ctx.commit();
    return [201, order];
  }

  function getOrder(ctx) {
    return [200, findOrder(ctx.orders, ctx.params[0])];
  }

  function advanceOrder(ctx) {
    const order = findOrder(ctx.orders, ctx.params[0]);
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new ApiError(409, 'Order is already ' + order.status + ' and cannot change status.');
    }
    const next = STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1];
    const requested = ctx.body && ctx.body.status;
    if (requested && requested !== next) {
      throw new ApiError(409, 'Invalid transition ' + order.status + ' -> ' + requested + '. Next allowed status is ' + next + '.');
    }
    touch(order, next);
    ctx.commit();
    return [200, order];
  }

  function cancelOrder(ctx) {
    const order = findOrder(ctx.orders, ctx.params[0]);
    if (CANCELLABLE.indexOf(order.status) === -1) {
      throw new ApiError(409, 'Order can no longer be cancelled (status: ' + order.status + ').');
    }
    touch(order, 'CANCELLED');
    ctx.commit();
    return [200, order];
  }

  function clearOrders(ctx) {
    ctx.orders.length = 0;
    ctx.commit();
    return [204, null];
  }

  const ROUTES = [
    ['GET', /^\/menu$/, getMenu],
    ['GET', /^\/orders$/, listOrders],
    ['POST', /^\/orders$/, createOrder],
    ['DELETE', /^\/orders$/, clearOrders],
    ['GET', /^\/orders\/([\w-]+)$/, getOrder],
    ['PATCH', /^\/orders\/([\w-]+)\/status$/, advanceOrder],
    ['POST', /^\/orders\/([\w-]+)\/cancel$/, cancelOrder],
  ];

  // ---------- dispatcher ----------
  function dispatch(method, path, body) {
    const parts = path.split('?');
    const pathname = parts[0];
    const query = new URLSearchParams(parts[1] || '');
    const orders = load();
    let pathMatched = false;

    for (const route of ROUTES) {
      const m = route[1].exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route[0] !== method) continue;
      return route[2]({
        params: m.slice(1),
        query: query,
        body: body,
        orders: orders,
        commit: function () { save(orders); },
      });
    }
    if (pathMatched) throw new ApiError(405, 'Method ' + method + ' not allowed on ' + pathname);
    throw new ApiError(404, 'Route ' + method + ' ' + pathname + ' not found');
  }

  function sleep(ms) {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  async function request(method, path, body) {
    method = String(method).toUpperCase();
    const started = Date.now();
    await sleep(config.latency + Math.random() * config.jitter);

    let status;
    let data;
    try {
      const result = dispatch(method, path, body);
      status = result[0];
      data = result[1];
    } catch (err) {
      if (err instanceof ApiError) {
        status = err.status;
        data = { error: { message: err.message, details: err.details } };
      } else {
        status = 500;
        data = { error: { message: 'Internal server error' } };
      }
    }

    const entry = {
      method: method,
      path: path,
      requestBody: body === undefined ? null : body,
      status: status,
      response: data,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    };
    listeners.forEach(function (fn) {
      try { fn(entry); } catch (e) { /* a bad listener must not break requests */ }
    });
    return { status: status, ok: status >= 200 && status < 300, data: data };
  }

  return {
    request: request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    onLog: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    configure: function (opts) { Object.assign(config, opts || {}); },
    STATUS_FLOW: STATUS_FLOW,
    CANCELLABLE: CANCELLABLE,
    MENU: MENU,
    DELIVERY_FEE: DELIVERY_FEE,
  };
});
