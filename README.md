# Brewberry Coffee House

Responsive customer-facing coffee shop website and Node.js ordering backend. The site supports Indian rupee pricing, cash on delivery, optional Razorpay Checkout, a browser-persisted cart, and order status lookup by order code and checkout phone number.

Menu prices are converted from the reference's USD prices using approximately ₹95.32/USD on 14 October 2026 and rounded to the nearest rupee: Cappuccino ₹334, Iced Coffee ₹286, Latte ₹362, Mocha ₹400, Americano ₹238, and Caramel Macchiato ₹429. Monday orders receive the original 20% offer. Sample delivery: ₹40 within 5 km, free above a discounted drinks subtotal of ₹1,906.

## Run locally on Windows

1. Install Node.js 22.9 or newer.
2. In PowerShell, open this project folder and run `Copy-Item .env.example .env` if you do not already have a `.env` file.
3. Run `npm start` and leave that terminal open.
4. Open `http://localhost:3000`.

The cart stays in the same browser using local storage. Orders and contact messages are stored under `data/`. Tracking automatically checks the latest order placed in the same browser; its lookup details stay hidden from the customer UI. Tracking reports the latest saved status only. The map is illustrative; no staff status editor or live courier location is configured. The contact form stores messages locally on the server and does not notify the shop.

Without Razorpay keys the site still runs and cash on delivery is available. To enable online payments, add a Razorpay account's Test Mode API keys to the private `.env`, restart the server, and complete test transactions before switching to Live Mode. Never put the secret key in browser code or commit `.env`.

## Prepare an online deployment

This repository includes `render.yaml` for a Node web service in Render's Singapore region with a persistent data disk and health check. Persistent disks require a paid service plan; review Render's current price before creating the service.

1. Put this project in a GitHub repository and push the files.
2. Create a Render account, connect the repository, and create a Blueprint from `render.yaml`.
3. Review the service and disk plan before confirming creation.
4. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the Render service's secret environment settings when ready to test online checkout.
5. Test the public URL, `/api/health`, menu, COD order, and Razorpay Test Mode payment.
6. Attach a domain if you own one. Replace all sample contact details before launch.

The sample address, phone, email, opening hours, and delivery terms are not real business details. Replace them before launch. Add the shop's privacy, refund/cancellation, delivery, and terms pages required for the business and payment provider.

## API

- `GET /api/health`, `GET /api/config`, and `GET /api/menu`
- `POST /api/orders` for cash on delivery
- `GET /api/orders/track?code=...&phone=...` for limited order status lookup (the customer UI supplies these details from the same browser)
- `POST /api/payments/create-order` and `POST /api/payments/verify` for Razorpay
- `POST /api/contact` to save a contact message
