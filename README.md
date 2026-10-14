# Brewberry Coffee House

Responsive customer-facing coffee shop website and Node.js ordering backend. The site supports Indian rupee pricing, cash on delivery, optional Razorpay Checkout, a browser-persisted cart, and order status lookup by order code and checkout phone number.

Menu prices are converted from the reference's USD prices using approximately ₹95.32/USD on 14 October 2026 and rounded to the nearest rupee: Cappuccino ₹334, Iced Coffee ₹286, Latte ₹362, Mocha ₹400, Americano ₹238, and Caramel Macchiato ₹429. Monday orders receive the original 20% offer. Sample delivery: ₹40 within 5 km, free above a discounted drinks subtotal of ₹1,906.

## Run locally on Windows

1. Install Node.js 22.9 or newer.
2. In PowerShell, open this project folder and run `Copy-Item .env.example .env` if you do not already have a `.env` file.
3. Run `npm start` and leave that terminal open.
4. Open `http://localhost:3000`.

The cart stays in the same browser using local storage. Orders and contact messages are stored under `data/`. Tracking automatically checks the latest order placed in the same browser; its lookup details stay hidden from the customer UI. Tracking reports the latest saved status only. The map is illustrative; no staff status editor or live courier location is configured. The contact form stores messages locally on the server and does not notify the shop.

