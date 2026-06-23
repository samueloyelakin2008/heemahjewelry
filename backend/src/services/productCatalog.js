/**
 * PRODUCT CATALOG — single source of truth for prices.
 *
 * SECURITY NOTE: never trust a price sent by the browser. A user can
 * open devtools and edit localStorage or the network request to claim
 * a ₦5,000 tennis bracelet costs ₦1. This file is what the backend
 * actually charges against — the cart payload from the frontend is
 * only used to look up *which* product and *how many*, never the price.
 *
 * Prices are in Naira (₦). They are converted to kobo (×100) right
 * before calling Paystack, since Paystack's API expects the smallest
 * currency unit.
 *
 * Keep the `id` values here in sync with the `data-id` attributes on
 * each "Add to Cart" button in the frontend.
 */
const PRODUCTS = {
  "cz-stud-earring": { name: "CZ Stud Earring", price: 1500 },
  "fashion-earring": { name: "Fashion Earring", price: 1500 },
  "vca-bracelet": { name: "VCA Bracelet", price: 2000 },
  "silver-necklace": { name: "Silver Necklace", price: 2500 },
  "zirconia-handchain": { name: "Zirconia Handchain", price: 2500 },
  "stainless-steel-bangle": { name: "Stainless Steel Bangle", price: 3500 },
  "pearl-drop-earring": { name: "Pearl Drop Earring", price: 2000 },
  "gold-hoop-earring": { name: "Gold Hoop Earring", price: 1800 },
  "crystal-choker": { name: "Crystal Choker", price: 3000 },
  "rose-gold-ring": { name: "Rose Gold Ring", price: 2200 },
  "anklet-chain": { name: "Anklet Chain", price: 1500 },
  "statement-cuff": { name: "Statement Cuff", price: 4000 },
  "layered-necklace": { name: "Layered Necklace", price: 3200 },
  "emerald-stud": { name: "Emerald Stud", price: 2800 },
  "tennis-bracelet": { name: "Tennis Bracelet", price: 5000 },
  "charm-bracelet": { name: "Charm Bracelet", price: 2500 },
  "twist-ring": { name: "Twist Ring", price: 1800 },
  "bar-necklace": { name: "Bar Necklace", price: 2000 },
  "drop-pendant": { name: "Drop Pendant", price: 2700 },
  "ear-cuff": { name: "Ear Cuff", price: 1200 },
  "signet-ring": { name: "Signet Ring", price: 3500 },
};

/**
 * Recompute a trusted order from a client-submitted cart, using only
 * the product `id` and `quantity` fields. Throws if a product id is
 * unknown so a forged id can't silently slip through as ₦0.
 */
function priceCart(clientCart) {
  let subtotal = 0;
  const lineItems = clientCart.map((item) => {
    const product = PRODUCTS[item.id];
    if (!product) {
      throw new Error(`Unknown product id: ${item.id}`);
    }
    const quantity = Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1));
    const lineTotal = product.price * quantity;
    subtotal += lineTotal;
    return {
      id: item.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal,
    };
  });

  return { lineItems, subtotal, total: subtotal };
}

module.exports = { PRODUCTS, priceCart };
