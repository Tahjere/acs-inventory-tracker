# Aunt Carol's Sauce — Operations Dashboard

Real-time delivery tracking, inventory management, and sales history for TTP Foods LLC — Food Lion stores, Virginia.

## Features

- **📦 Inventory tab** — all 70 stores with current Spicy & Mild counts, status badges (Urgent / Low / OK), May vs June comparison deltas, Google Maps links
- **🚚 Deliveries tab** — queue stores for delivery, create multi-store runs, update status in real time (Pending → Out for delivery → Delivered → Failed / Rejected)
- **📊 Sales History tab** — auto-logs every completed delivery with revenue, gross profit, breakdown by store / city / date / SKU
- **+ Add Store** — add new Food Lion locations without touching code
- **Export Dispatch** — one-click driver dispatch list with all urgent/low stores and addresses
- **Email Rachel** — pre-filled request template to Rachel.Lovelady@foodlion.com

## Data persistence

All delivery records, sales history, and store overrides are saved to **localStorage** in the browser. Data persists across sessions on the same device. No backend required.

> **To share data across devices / drivers:** Replace localStorage calls in `app.js` with a free service like [JSONBin.io](https://jsonbin.io) or [Supabase](https://supabase.com) (free tier). See `CLOUD_SYNC.md` for instructions.

## Files

```
aunt-carols-dashboard/
├── index.html      ← Main app shell + modals
├── app.js          ← All logic, state, rendering
├── data.js         ← Store data + pricing constants
├── styles.css      ← Full stylesheet
└── README.md
```

## Deploying to Netlify

1. Push this folder to your GitHub repo
2. Go to [netlify.com](https://netlify.com) → **Add new site → Import from GitHub**
3. Select the repo, set **Publish directory** to `/` (or the folder name)
4. Click **Deploy** — done. Netlify gives you a live URL instantly.

To update inventory data (when Rachel sends a new report):
1. Parse the new `.docx` (upload to Claude → copy the table)
2. Update the `S_jun` / `M_jun` values in `data.js`
3. Push to GitHub → Netlify auto-deploys in ~30 seconds

## Updating store inventory counts

Open `data.js` and update the values for any store:

```js
// Format: { addr, city, zip, S_may, M_may, S_jun, M_jun }
1625: { addr:"123 E Newmarket Sq", city:"Hampton", zip:"23605", S_may:38, M_may:0, S_jun:20, M_jun:11 },
```

- `S_may` / `M_may` = previous report (Spicy / Mild)
- `S_jun` / `M_jun` = current report (Spicy / Mild)

## Pricing constants

All in `data.js` under `PRICING`:

```js
const PRICING = {
  casePrice: 76.32,         // wholesale per case
  unitsPerCase: 12,
  unitCost: 1.79,           // manufacturing cost per unit
  deliveryFeePerVisit: 20,  // flat $20 per store visit
  vendorNum: "07005300",
  invoicePhone: "757-968-7463",
  rachelEmail: "Rachel.Lovelady@foodlion.com",
};
```

## Vendor info

- **Vendor:** TTP Foods LLC
- **Vendor #:** 07005300
- **Product:** Aunt Carol's Sauce (Spicy UPC: 86000870950 | Mild UPC: 86000870951)
- **Case price:** $76.32 | **Retail:** $8.49/unit
- **Invoice photos:** text to 757-968-7463 after every delivery
- **Delivery hours:** Mon–Fri, 7:00 AM – 11:00 AM
