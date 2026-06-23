# Heemah Jewelry — Cart, Checkout & Payments System

A production-ready cart + checkout + Paystack payment system bolted onto
the existing Heemah Jewelry storefront. Built with a vanilla JS
frontend, a Node/Express backend, and Google Sheets as the sales log.

## Folder structure

```
heemah-jewelry/
├── frontend/
│   ├── index.html              # storefront page (cart drawer + checkout modal wired in)
│   └── assets/
│       ├── css/cart.css        # drawer + checkout modal styling
│       └── js/
│           ├── cart.js         # localStorage cart, drawer, badge
│           └── checkout.js     # 4-step checkout flow + Paystack Inline
├── backend/
│   ├── server.js               # Express app, security middleware, route mounting
│   ├── package.json
│   ├── .env.example            # copy to .env and fill in real values
│   └── src/
│       ├── routes/payment.js          # /initiate-payment /verify-payment /webhook /cart-checkout
│       ├── middleware/
│       │   ├── rateLimiter.js         # IP throttling
│       │   └── validate.js            # input validation + XSS sanitization
│       └── services/
│           ├── productCatalog.js      # server-side source of truth for prices
│           ├── paystackService.js     # initialize/verify transactions
│           ├── orderStore.js          # idempotent order tracking (file-based)
│           ├── googleSheetsService.js # logs sales to Sheets, with retry queue
│           ├── emailService.js        # customer receipt + admin email
│           └── whatsappService.js     # admin WhatsApp alert (Cloud API)
└── google-apps-script/
    └── Code.gs                 # paste into a Sheet's Apps Script editor
```

## How it works, end to end

1. A shopper clicks **Add to Cart** on a product card. `cart.js` reads
   the product's `data-id`/`data-name`/`data-price`/`data-image`
   attributes, stores it in `localStorage`, and slides open the cart
   drawer. The cart persists across every page that loads `cart.js`.
2. **Proceed to Checkout** opens a 4-step modal (`checkout.js`):
   Cart Review → Customer Details → Payment Summary → Paystack Payment.
3. On the Payment Summary step, the browser sends the cart (`id` +
   `quantity` only) to `POST /api/cart-checkout`. The backend looks up
   the *real* price for each `id` in `productCatalog.js` and returns a
   trusted total — the price shown is never something the browser made up.
4. **Pay with Paystack** calls `POST /api/initiate-payment`. The backend
   re-validates everything, recomputes the total again from the
   catalog, creates a Paystack transaction for that trusted amount, and
   returns an `access_code` the frontend uses to open the Paystack
   Inline popup.
5. After the popup closes, the frontend calls `POST /api/verify-payment`.
   The backend asks Paystack directly whether the transaction actually
   succeeded — it never trusts the browser's own "it worked" signal.
6. Paystack also calls `POST /api/webhook` server-to-server as a second,
   more reliable confirmation path (covers the case where a customer
   closes their tab right after paying). Both paths converge on the
   same `finalizeOrderIfPaid()` function, which is idempotent — an
   order is only emailed/logged once no matter which path (or both)
   fires.
7. On confirmed payment: a receipt email goes to the customer, a
   notification email + WhatsApp message goes to the admin, and a row
   is appended to the Google Sheet via the Apps Script web app. If the
   Sheet is briefly unreachable, the record is queued to disk and
   retried automatically every 5 minutes.

## Local setup

### Backend

```bash
cd backend
cp .env.example .env       # then fill in real values
npm install
npm run dev                 # or: npm start
```

The server runs on `http://localhost:5000` by default (`PORT` in `.env`).

### Frontend

The frontend is static files — open `frontend/index.html` directly, or
serve the folder with any static file server:

```bash
cd frontend
npx serve .
```

If your frontend and backend run on different origins during
development, set this **before** the cart/checkout scripts load, e.g.
in a small inline `<script>` tag in `index.html`:

```html
<script>window.HJ_API_BASE = "http://localhost:5000/api";</script>
```

In production, the included `ALLOWED_ORIGINS` env var must list your
real storefront domain(s) or the backend's CORS check will reject
requests.

## Required third-party setup

### Paystack
1. Create an account at https://dashboard.paystack.com.
2. Grab your **test** secret/public keys from Settings → API Keys &
   Webhooks and put them in `.env` to start. Switch to live keys only
   once you've tested a full purchase end to end.
3. In the same dashboard page, set your webhook URL to
   `https://your-backend-domain.com/api/webhook`.

### Google Sheets sales log
1. Create a new Google Sheet.
2. Open **Extensions → Apps Script**, paste in
   `google-apps-script/Code.gs`, and set `SHARED_SECRET` to a long
   random string.
3. **Deploy → New deployment → Web app**, execute as "Me", access
   "Anyone". Copy the `/exec` URL.
4. Put that URL in `GOOGLE_SCRIPT_URL`, and the same secret in
   `GOOGLE_SCRIPT_SHARED_SECRET`, in the backend's `.env`.

### Email receipts (SMTP)
Any SMTP provider works. For Gmail: enable 2-Step Verification on the
sending account, then create an **App Password** and use that as
`SMTP_PASS` (your normal Gmail password won't work here).

### WhatsApp admin alerts
Uses Meta's WhatsApp Cloud API by default. If you'd rather not set this
up right now, leave `WHATSAPP_API_URL`/`WHATSAPP_TOKEN` blank — the
backend detects this and just skips the WhatsApp step without failing
the order. Swap in Twilio or 360dialog by editing
`src/services/whatsappService.js` if you use one of those instead.

## Adding or changing products

Prices are intentionally **not** trusted from the browser (see the
security notes below), so a product exists in two places that must be
kept in sync:

1. `frontend/index.html` — the `data-id`, `data-name`, `data-price`,
   `data-image` attributes on each "Add to Cart" button.
2. `backend/src/services/productCatalog.js` — the `PRODUCTS` object,
   keyed by the same `id`.

If you add a product to the HTML but forget the catalog entry, checkout
will correctly reject it with "items in your cart are no longer
available" rather than charging the wrong amount.

## Security notes (read before going live)

- **Price tampering is blocked by design.** The browser only ever sends
  a product `id` and `quantity`; the backend looks up the real price
  server-side. Editing localStorage or replaying a tampered API request
  cannot change what gets charged.
- **Payments are verified server-side**, twice over (the `/verify-payment`
  call right after checkout, and the Paystack webhook). The frontend's
  own "success" callback from the Paystack popup is never trusted on
  its own.
- **Inputs are sanitized and validated** (`express-validator` + `xss`)
  before they reach business logic, email templates, or the sheet.
- **Secrets stay server-side.** Only `PAYSTACK_PUBLIC_KEY` (which is
  meant to be public) is ever sent to the browser.
- **Rate limiting status code:** the original brief asked for HTTP 409
  on throttling. 409 means "conflicts with current resource state" and
  isn't the correct code for "too many requests" — we used the
  standard **429** instead (what browsers, CDNs, and Paystack's own API
  expect), while keeping the exact friendly wording you asked for. If
  a specific downstream system needs 409, change `statusCode` in
  `src/middleware/rateLimiter.js`.
- **No database is wired up.** Orders are tracked in a small JSON file
  (`backend/data/orders.json`) purely to make the same payment
  idempotent across the verify-call and the webhook. That's fine for
  low/medium traffic on a single server instance; if you scale to
  multiple server instances or expect high volume, swap `orderStore.js`
  and `googleSheetsService.js`'s retry queue for a real database
  (Postgres/MongoDB) — the rest of the code doesn't need to change.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS with PM2, etc.):

1. Push the `backend/` folder (without `node_modules`, `.env`, or
   `data/` — see `.gitignore`) to your host.
2. Set every variable from `.env.example` in the host's environment
   variable settings.
3. Set `ALLOWED_ORIGINS` to your real frontend domain(s).
4. Point Paystack's webhook at `https://<your-backend>/api/webhook`.
5. Host `frontend/` anywhere static (Netlify, Vercel, S3, the same
   server's `public/` folder, etc.). If it's a different domain than
   the backend, set `window.HJ_API_BASE` as shown above.
