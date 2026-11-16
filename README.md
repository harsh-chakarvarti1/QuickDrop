# 🛵 QuickDrop

A delivery-ordering web app with a **REST-style API layer**, a validated **order lifecycle**, live **order tracking** and an **API inspector** that shows every request and response, like browser dev tools.

Built by **Harsh Chakarvarti** as a hands-on project inspired by the delivery-app backend work I did at **Santo Meridia**: designing APIs, validating input and connecting the app to the server.

> 🔗 **Live demo:** _add your GitHub Pages or Netlify link here_

---

## ✨ Features

- **Browse a menu** and build a cart with live totals
- **Place orders** with server-side style validation and clear field-level errors
- **Track orders** through a real lifecycle: `PLACED → ACCEPTED → PREPARING → OUT_FOR_DELIVERY → DELIVERED`
- **Cancel orders** only while it's still allowed (before the order is out for delivery)
- **"Simulate courier"** mode that moves orders along automatically
- **API inspector** that lists every call with method, path, status code, latency, request and response
- Dark mode, responsive layout, keyboard-friendly and screen-reader labels
- Orders persist across refreshes using `localStorage`

## 🧠 What this project shows

| Skill | Where to look |
| :-- | :-- |
| REST API design (routes, verbs, status codes) | `api.js` |
| Input validation and error handling (`422`, `409`, `404`, `405`) | `api.js` → `validateOrder`, `advanceOrder`, `cancelOrder` |
| State machine for an order lifecycle | `api.js` → `STATUS_FLOW` |
| Separating the UI from the API layer | `app.js` only calls `QuickDropAPI.request()` |
| Safe rendering (no `innerHTML` with user text) | `app.js` → `h()` helper |
| Automated tests | `test/api.test.js` |

## 🔌 API reference

| Method | Path | Description | Success |
| :-- | :-- | :-- | :-- |
| `GET` | `/menu` | Menu items and delivery fee | `200` |
| `GET` | `/orders?status=` | List orders, newest first | `200` |
| `POST` | `/orders` | Create an order | `201` |
| `GET` | `/orders/:id` | Get one order | `200` |
| `PATCH` | `/orders/:id/status` | Move to the next status | `200` |
| `POST` | `/orders/:id/cancel` | Cancel an order | `200` |
| `DELETE` | `/orders` | Clear all demo data | `204` |

**Error codes:** `404` not found · `405` method not allowed · `409` invalid state change · `422` validation failed

Example request and response:

```http
POST /orders
{
  "customerName": "Asha",
  "phone": "9876543210",
  "address": "12 MG Road, Hyderabad",
  "items": [{ "id": "m1", "qty": 2 }]
}

201 Created
{
  "id": "QD-7K2PA",
  "status": "PLACED",
  "subtotal": 258,
  "deliveryFee": 30,
  "total": 288,
  "etaMinutes": 24
}
```

## 📁 Project structure

```
quickdrop/
├── index.html          # Page structure
├── style.css           # Styling (light and dark)
├── app.js              # UI logic
├── api.js              # Simulated REST API (routes, validation, state machine)
├── test/
│   └── api.test.js     # Tests for the API layer
├── netlify.toml        # Netlify settings
├── .nojekyll           # Makes GitHub Pages serve files as-is
├── .gitignore
├── LICENSE
└── README.md
```

## ▶️ Run locally

No build step and no dependencies.

```bash
# Option 1: just open index.html in your browser

# Option 2: serve it locally
python -m http.server 8000
# then visit http://localhost:8000
```

## 🧪 Run the tests

Needs Node.js 18 or newer.

```bash
node --test
```

## 🚀 Deploy

**GitHub Pages**
1. Push this folder to a new GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Your site goes live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

**Netlify**
1. Log in to Netlify and choose **Add new site → Import an existing project** (or drag the folder onto the Netlify Drop page).
2. Pick your repository. Leave the build command empty and the publish directory as `.`
3. Deploy. Netlify gives you a live URL you can rename in **Site settings**.

## 🗺️ What's next

- [ ] Replace `api.js` with a real **Node.js + Express** server and a database (MongoDB or PostgreSQL)
- [ ] Add user accounts and JWT authentication
- [ ] Add real-time order updates with WebSockets
- [ ] Add rate limiting and request logging on the server
- [ ] Add a restaurant-side dashboard

## 📄 License

MIT © Harsh Chakarvarti
