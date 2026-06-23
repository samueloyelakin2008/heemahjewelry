const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const { priceCart } = require("../services/productCatalog");
const paystack = require("../services/paystackService");
const { logSaleToSheet } = require("../services/googleSheetsService");
const { sendCustomerReceipt, sendAdminNotification } = require("../services/emailService");
const { notifyAdminWhatsApp } = require("../services/whatsappService");
const orderStore = require("../services/orderStore");
const {
  validateInitiatePayment,
  validateVerifyPayment,
  handleValidationErrors,
} = require("../middleware/validate");

/**
 * POST /api/cart-checkout
 * Re-prices whatever cart the browser has in localStorage against the
 * server-side catalog and returns a trusted breakdown. The frontend
 * calls this when moving from "Cart Review" into "Payment Summary" so
 * the number shown on screen is always the number that will be charged.
 */
router.post("/cart-checkout", (req, res) => {
  try {
    const { cart } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ success: false, message: "Your cart is empty." });
    }
    const priced = priceCart(cart);
    return res.json({ success: true, ...priced });
  } catch (err) {
    return res.status(400).json({ success: false, message: "We couldn't price one or more items in your cart." });
  }
});

/**
 * POST /api/initiate-payment
 * Validates customer details, re-prices the cart server-side (ignoring
 * any price the browser sent), creates a Paystack transaction for the
 * TRUSTED total, and returns the access_code/reference the frontend
 * needs to launch Paystack Inline.
 */
router.post(
  "/initiate-payment",
  validateInitiatePayment,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { customer, cart } = req.body;

      let priced;
      try {
        priced = priceCart(cart);
      } catch {
        return res.status(400).json({
          success: false,
          message: "One or more items in your cart are no longer available.",
        });
      }

      const reference = `HJ-${Date.now()}-${uuidv4().slice(0, 8)}`;
      const orderId = reference;

      orderStore.saveOrder(reference, {
        status: "pending",
        customer,
        lineItems: priced.lineItems,
        total: priced.total,
      });

      const transaction = await paystack.initializeTransaction({
        email: customer.email,
        amountKobo: Math.round(priced.total * 100),
        reference,
        metadata: {
          orderId,
          customerName: customer.fullName,
          phone: customer.phone,
          whatsapp: customer.whatsapp,
          address: customer.address,
        },
      });

      return res.json({
        success: true,
        reference,
        accessCode: transaction.access_code,
        authorizationUrl: transaction.authorization_url,
        publicKey: process.env.PAYSTACK_PUBLIC_KEY,
        amount: priced.total,
      });
    } catch (err) {
      console.error("[initiate-payment] error:", err.message);
      return res.status(502).json({
        success: false,
        message: "We couldn't start your payment right now. Please try again shortly.",
      });
    }
  }
);

/**
 * Shared logic to finalize an order once Paystack confirms it as
 * successful — used by BOTH /verify-payment (frontend polling right
 * after checkout) and /webhook (Paystack's own server-to-server
 * confirmation). Idempotent: if the order is already marked "paid",
 * it skips re-sending receipts/notifications.
 */
async function finalizeOrderIfPaid(verifiedTransaction) {
  const reference = verifiedTransaction.reference;
  const existing = orderStore.getOrder(reference);

  if (existing && existing.status === "paid") {
    return { alreadyProcessed: true, order: existing };
  }

  if (verifiedTransaction.status !== "success") {
    orderStore.saveOrder(reference, { status: "failed" });
    return { alreadyProcessed: false, paid: false };
  }

  const order = existing || {
    customer: verifiedTransaction.metadata || {},
    lineItems: [],
    total: verifiedTransaction.amount / 100,
  };

  orderStore.saveOrder(reference, { status: "paid" });

  const customerName = order.customer.fullName || verifiedTransaction.metadata?.customerName || "Customer";
  const customerEmail = order.customer.email || verifiedTransaction.customer?.email;

  // Fire off receipts / logging / notifications. None of these should
  // ever throw back to the caller — a flaky SMTP server must not make
  // us tell the customer their payment failed when it actually succeeded.
  const results = await Promise.allSettled([
    sendCustomerReceipt({
      to: customerEmail,
      customerName,
      orderId: reference,
      reference,
      lineItems: order.lineItems,
      total: order.total,
    }),
    sendAdminNotification({
      orderId: reference,
      customerName,
      customerEmail,
      customerPhone: order.customer.phone,
      address: order.customer.address,
      reference,
      lineItems: order.lineItems,
      total: order.total,
    }),
    notifyAdminWhatsApp(
      `🔔 New paid order ${reference}\nCustomer: ${customerName}\nTotal: ₦${order.total.toLocaleString("en-NG")}`
    ),
    logSaleToSheet({
      orderId: reference,
      reference,
      customerName,
      customerEmail,
      customerPhone: order.customer.phone,
      whatsapp: order.customer.whatsapp,
      address: order.customer.address,
      items: order.lineItems,
      total: order.total,
      date: new Date().toISOString(),
    }),
  ]);

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[finalizeOrder] step ${i} failed:`, r.reason);
    }
  });

  return { alreadyProcessed: false, paid: true, order };
}

/**
 * POST /api/verify-payment
 * Called by the frontend right after the Paystack Inline popup closes.
 * Always re-verifies server-side with Paystack — the popup's own
 * "success" callback is never trusted on its own, since it runs in the
 * browser and can be spoofed.
 */
router.post(
  "/verify-payment",
  validateVerifyPayment,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { reference } = req.body;
      const verified = await paystack.verifyTransaction(reference);

      if (verified.status !== "success") {
        orderStore.saveOrder(reference, { status: "failed" });
        return res.status(402).json({
          success: false,
          message: "Payment was not successful. You can retry checkout.",
        });
      }

      const result = await finalizeOrderIfPaid(verified);
      return res.json({
        success: true,
        message: "Payment confirmed — thank you for your order!",
        orderId: reference,
        alreadyProcessed: result.alreadyProcessed,
      });
    } catch (err) {
      console.error("[verify-payment] error:", err.message);
      return res.status(502).json({
        success: false,
        message: "We couldn't confirm your payment right now. If you were charged, contact support with your reference.",
      });
    }
  }
);

/**
 * POST /api/webhook
 * Paystack's server-to-server confirmation. This is the authoritative
 * source of truth for order completion (more reliable than the
 * frontend's verify call, which can fail to fire if the customer closes
 * their tab right after paying). Verifies the X-Paystack-Signature
 * header against the raw request body before trusting anything in it.
 */
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.rawBody; // Buffer, set by express.raw() in server.js

    const expectedSignature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    if (!signature || signature !== expectedSignature) {
      console.warn("[webhook] Invalid Paystack signature — ignoring request.");
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(rawBody.toString("utf-8"));

    // Acknowledge immediately so Paystack doesn't retry/timeout, then
    // process. Paystack expects a fast 200 response.
    res.sendStatus(200);

    if (event.event === "charge.success") {
      const verified = await paystack.verifyTransaction(event.data.reference);
      await finalizeOrderIfPaid(verified);
    }
  } catch (err) {
    console.error("[webhook] error:", err.message);
    if (!res.headersSent) res.sendStatus(500);
  }
});

module.exports = router;
