const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

function formatNaira(amount) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

function receiptHtml({ orderId, customerName, lineItems, total, reference, date }) {
  const rows = lineItems
    .map(
      (i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${i.name}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatNaira(i.lineTotal)}</td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family:Poppins,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f1f1f;">
    <div style="background:linear-gradient(135deg,#caa24a,#8a6d1f);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:1px;">HEEMAH JEWELRY</h1>
      <p style="color:#fdf3da;margin:4px 0 0;font-size:13px;">Order Confirmation</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <p>Hi ${customerName},</p>
      <p>Thank you for your order — here's your receipt.</p>
      <p style="font-size:13px;color:#666;">
        Order ID: <strong>${orderId}</strong><br/>
        Reference: <strong>${reference}</strong><br/>
        Date: ${date}
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
        <thead>
          <tr style="background:#faf6ec;">
            <th style="padding:8px;text-align:left;">Item</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:8px;font-weight:600;">Total Paid</td>
            <td style="padding:8px;text-align:right;font-weight:600;">${formatNaira(total)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:24px;font-size:13px;color:#666;">
        Payment confirmed via Paystack. If anything looks off, just reply to this email.
      </p>
      <p style="margin-top:24px;">With love,<br/>Heemah Jewelry</p>
    </div>
  </div>`;
}

async function sendCustomerReceipt({ to, customerName, orderId, reference, lineItems, total }) {
  const html = receiptHtml({
    orderId,
    customerName,
    reference,
    lineItems,
    total,
    date: new Date().toLocaleString("en-NG"),
  });

  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "Heemah Jewelry"}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your Heemah Jewelry receipt — Order ${orderId}`,
    html,
  });
}

async function sendAdminNotification({ orderId, customerName, customerEmail, customerPhone, address, reference, lineItems, total }) {
  const itemsList = lineItems.map((i) => `${i.quantity} × ${i.name} (${formatNaira(i.lineTotal)})`).join("<br/>");

  await getTransporter().sendMail({
    from: `"Heemah Jewelry System" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🔔 New paid order ${orderId} — ${formatNaira(total)}`,
    html: `
      <h2>New order received</h2>
      <p><strong>Order ID:</strong> ${orderId}<br/>
      <strong>Reference:</strong> ${reference}<br/>
      <strong>Customer:</strong> ${customerName} (${customerEmail}, ${customerPhone})<br/>
      <strong>Address:</strong> ${address}</p>
      <p><strong>Items:</strong><br/>${itemsList}</p>
      <p><strong>Total:</strong> ${formatNaira(total)}</p>
    `,
  });
}

module.exports = { sendCustomerReceipt, sendAdminNotification };
