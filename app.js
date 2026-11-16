/*
 * QuickDrop front end
 * Talks to the backend only through QuickDropAPI.request() (see api.js).
 * All user-provided text is inserted with textContent, never innerHTML,
 * so a name like "<img onerror=...>" can't inject markup.
 */
(function () {
  'use strict';

  const api = window.QuickDropAPI;
  const STATUS_LABELS = {
    PLACED: 'Placed',
    ACCEPTED: 'Accepted',
    PREPARING: 'Preparing',
    OUT_FOR_DELIVERY: 'On the way',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
  };

  const state = { menu: [], fee: 0, cart: {}, orders: [], logs: [], simTimer: null, ticking: false };
  const qtyEls = {};
  const minusBtns = {};

  // ---------- tiny DOM helper ----------
  const $ = (sel, root) => (root || document).querySelector(sel);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(function (entry) {
      const k = entry[0];
      const v = entry[1];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach(function (c) {
      if (c == null || c === false) return;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  const inr = (n) => '₹' + n.toLocaleString('en-IN');
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // ---------- tabs ----------
  function showTab(name) {
    ['order', 'orders', 'api'].forEach(function (t) {
      $('#tab-' + t).hidden = t !== name;
    });
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
    });
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }

  // ---------- menu & cart ----------
  function renderMenu() {
    const root = $('#menu');
    root.replaceChildren();
    state.menu.forEach(function (item) {
      const qty = h('span', { class: 'qty', 'aria-live': 'polite' }, '0');
      const minus = h('button', { type: 'button', 'aria-label': 'Remove one ' + item.name, disabled: true, onclick: function () { changeQty(item.id, -1); } }, '−');
      const plus = h('button', { type: 'button', 'aria-label': 'Add one ' + item.name, onclick: function () { changeQty(item.id, 1); } }, '+');
      qtyEls[item.id] = qty;
      minusBtns[item.id] = minus;

      root.append(
        h('article', { class: 'menu-item' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, item.emoji),
          h('h3', null, item.name),
          h('p', null, item.description),
          h('div', { class: 'menu-foot' },
            h('span', { class: 'price' }, inr(item.price)),
            h('div', { class: 'stepper' }, minus, qty, plus)
          )
        )
      );
    });
  }

  function changeQty(id, delta) {
    const next = Math.max(0, Math.min(10, (state.cart[id] || 0) + delta));
    if (next === 0) delete state.cart[id];
    else state.cart[id] = next;
    syncQtyUI(id);
    renderCart();
  }

  function syncQtyUI(id) {
    const q = state.cart[id] || 0;
    if (qtyEls[id]) qtyEls[id].textContent = String(q);
    if (minusBtns[id]) minusBtns[id].disabled = q === 0;
  }

  function renderCart() {
    const root = $('#cart');
    root.replaceChildren();
    const ids = Object.keys(state.cart);
    let subtotal = 0;

    if (ids.length === 0) {
      root.append(h('p', { class: 'cart-empty' }, 'Your cart is empty. Add something tasty!'));
    }
    ids.forEach(function (id) {
      const item = state.menu.find((m) => m.id === id);
      const line = item.price * state.cart[id];
      subtotal += line;
      root.append(h('div', { class: 'cart-line' }, h('span', null, state.cart[id] + ' × ' + item.name), h('span', null, inr(line))));
    });

    $('#subtotal').textContent = inr(subtotal);
    $('#fee').textContent = ids.length ? inr(state.fee) : inr(0);
    $('#total').textContent = inr(ids.length ? subtotal + state.fee : 0);
    $('#place-btn').disabled = ids.length === 0;
  }

  function showFieldErrors(details) {
    document.querySelectorAll('[data-error-for]').forEach(function (el) {
      const key = el.dataset.errorFor;
      el.textContent = (details && details[key]) || '';
      const input = document.getElementById(key);
      if (input) input.setAttribute('aria-invalid', String(Boolean(details && details[key])));
    });
  }

  async function submitOrder(event) {
    event.preventDefault();
    showFieldErrors(null);
    const btn = $('#place-btn');
    btn.disabled = true;
    btn.textContent = 'Placing order…';

    const payload = {
      customerName: $('#customerName').value,
      phone: $('#phone').value,
      address: $('#address').value,
      items: Object.keys(state.cart).map((id) => ({ id: id, qty: state.cart[id] })),
    };
    const res = await api.post('/orders', payload);

    btn.textContent = 'Place order';
    if (res.ok) {
      toast('Order ' + res.data.id + ' placed! ETA ' + res.data.etaMinutes + ' min.');
      Object.keys(state.cart).forEach(function (id) { delete state.cart[id]; syncQtyUI(id); });
      $('#order-form').reset();
      renderCart();
      await loadOrders();
      showTab('orders');
    } else if (res.status === 422) {
      showFieldErrors(res.data.error.details);
      toast('Please fix the highlighted fields.');
      btn.disabled = Object.keys(state.cart).length === 0;
    } else {
      toast(res.data.error.message);
      btn.disabled = false;
    }
  }

  // ---------- orders ----------
  async function loadOrders() {
    const res = await api.get('/orders');
    if (!res.ok) return;
    state.orders = res.data.orders;
    $('#orders-count').textContent = String(state.orders.length);
    renderOrders();
  }

  function nextStatus(status) {
    const i = api.STATUS_FLOW.indexOf(status);
    return i >= 0 && i < api.STATUS_FLOW.length - 1 ? api.STATUS_FLOW[i + 1] : null;
  }

  async function advance(order) {
    const next = nextStatus(order.status);
    if (!next) return;
    const res = await api.patch('/orders/' + order.id + '/status', { status: next });
    if (!res.ok) toast(res.data.error.message);
    await loadOrders();
  }

  async function cancel(order) {
    const res = await api.post('/orders/' + order.id + '/cancel');
    toast(res.ok ? 'Order ' + order.id + ' cancelled.' : res.data.error.message);
    await loadOrders();
  }

  function renderOrders() {
    const root = $('#orders');
    root.replaceChildren();

    if (state.orders.length === 0) {
      root.append(h('div', { class: 'card empty' }, h('p', null, '📦 No orders yet.'), h('p', null, 'Head to the Order tab and place your first one.')));
      return;
    }

    state.orders.forEach(function (order) {
      const cancelled = order.status === 'CANCELLED';
      const currentIdx = api.STATUS_FLOW.indexOf(order.status);

      const track = cancelled
        ? h('p', { class: 'cancelled-note' }, 'This order was cancelled at ' + timeOf(order.updatedAt) + '.')
        : h('ol', { class: 'track', 'aria-label': 'Order progress' },
            api.STATUS_FLOW.map(function (s, i) {
              const cls = i < currentIdx ? 'done' : i === currentIdx ? 'current' : '';
              return h('li', { class: cls, 'aria-current': i === currentIdx ? 'step' : false }, STATUS_LABELS[s]);
            }));

      const next = nextStatus(order.status);
      const actions = h('div', { class: 'order-actions' });
      if (next && !cancelled) {
        actions.append(h('button', { class: 'btn primary small', type: 'button', onclick: function () { advance(order); } }, 'Courier: mark ' + STATUS_LABELS[next]));
      }
      if (api.CANCELLABLE.indexOf(order.status) !== -1) {
        actions.append(h('button', { class: 'btn danger small', type: 'button', onclick: function () { cancel(order); } }, 'Cancel order'));
      }

      const eta = order.status === 'DELIVERED' ? 'Delivered at ' + timeOf(order.updatedAt) : cancelled ? '' : 'ETA ~' + order.etaMinutes + ' min';

      root.append(
        h('article', { class: 'card' },
          h('div', { class: 'order-head' },
            h('span', { class: 'order-id' }, order.id),
            h('span', { class: 'badge ' + order.status }, STATUS_LABELS[order.status])
          ),
          h('p', { class: 'order-meta' }, 'Placed at ' + timeOf(order.createdAt) + ' · ' + order.customerName + ' · ' + order.address),
          track,
          h('ul', { class: 'order-items' }, order.items.map((l) => h('li', null, l.qty + ' × ' + l.name + ' (' + inr(l.lineTotal) + ')'))),
          h('div', { class: 'order-foot' },
            h('strong', null, 'Total ' + inr(order.total) + (eta ? ' · ' + eta : '')),
            actions
          )
        )
      );
    });
  }

  // "Simulate courier": advances every active order on a timer.
  async function simulateTick() {
    if (state.ticking) return;
    state.ticking = true;
    try {
      const active = state.orders.filter((o) => nextStatus(o.status) && o.status !== 'CANCELLED');
      for (const order of active) {
        await api.patch('/orders/' + order.id + '/status', { status: nextStatus(order.status) });
      }
      if (active.length) await loadOrders();
    } finally {
      state.ticking = false;
    }
  }

  function toggleSimulation(on) {
    clearInterval(state.simTimer);
    state.simTimer = on ? setInterval(simulateTick, 4000) : null;
    if (on) toast('Courier simulation on: orders advance every few seconds.');
  }

  async function resetData() {
    if (!window.confirm('Delete all demo orders?')) return;
    await api.del('/orders');
    toast('Demo data cleared.');
    await loadOrders();
  }

  // ---------- API inspector ----------
  function renderLog() {
    const root = $('#api-log');
    root.replaceChildren();
    if (state.logs.length === 0) {
      root.append(h('p', { class: 'muted' }, 'No API calls yet.'));
      return;
    }
    state.logs.forEach(function (e) {
      const ok = e.status >= 200 && e.status < 300;
      root.append(
        h('details', { class: 'log-entry' },
          h('summary', null,
            h('span', { class: 'method' }, e.method),
            h('code', null, e.path),
            h('span', { class: 'status ' + (ok ? 'ok' : 'err') }, String(e.status)),
            h('span', { class: 'muted' }, e.ms + ' ms · ' + timeOf(e.at))
          ),
          h('div', { class: 'log-body' },
            h('div', null, h('h4', null, 'Request body'), h('pre', null, e.requestBody === null ? '(none)' : JSON.stringify(e.requestBody, null, 2))),
            h('div', null, h('h4', null, 'Response'), h('pre', null, e.response === null ? '(no content)' : JSON.stringify(e.response, null, 2)))
          )
        )
      );
    });
  }

  api.onLog(function (entry) {
    state.logs.unshift(entry);
    state.logs.length = Math.min(state.logs.length, 40);
    renderLog();
  });

  // ---------- boot ----------
  async function init() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { showTab(btn.dataset.tab); });
    });
    $('#order-form').addEventListener('submit', submitOrder);
    $('#auto-sim').addEventListener('change', function (e) { toggleSimulation(e.target.checked); });
    $('#reset-btn').addEventListener('click', resetData);
    $('#clear-log').addEventListener('click', function () { state.logs = []; renderLog(); });

    renderLog();
    renderCart();

    const res = await api.get('/menu');
    if (res.ok) {
      state.menu = res.data.items;
      state.fee = res.data.deliveryFee;
      renderMenu();
      renderCart();
    } else {
      $('#menu').textContent = 'Could not load the menu. Please refresh.';
    }

    await loadOrders();

    const hash = location.hash.replace('#', '');
    if (['order', 'orders', 'api'].indexOf(hash) !== -1) showTab(hash);
  }

  init();
})();
