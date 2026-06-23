const axios = require("axios");

/**
 * Sends a plain-text WhatsApp message to the admin via Meta's WhatsApp
 * Cloud API. This is a placeholder integration point — swap the
 * request body for Twilio, 360dialog, or any other provider if you use
 * one instead. If WHATSAPP_API_URL / WHATSAPP_TOKEN aren't set, this
 * quietly no-ops so it never blocks an order from completing.
 */
async function notifyAdminWhatsApp(message) {
  const { WHATSAPP_API_URL, WHATSAPP_TOKEN, WHATSAPP_ADMIN_NUMBER } = process.env;

  if (!WHATSAPP_API_URL || !WHATSAPP_TOKEN || !WHATSAPP_ADMIN_NUMBER) {
    console.warn("[whatsapp] Skipped — WhatsApp credentials not configured.");
    return { skipped: true };
  }

  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: WHATSAPP_ADMIN_NUMBER,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    return { sent: true };
  } catch (err) {
    console.error("[whatsapp] Failed to send admin notification:", err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { notifyAdminWhatsApp };
