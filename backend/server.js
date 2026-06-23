require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");

const { generalLimiter, checkoutLimiter } = require("./src/middleware/rateLimiter");
const { sanitizeBody } = require("./src/middleware/validate");
const paymentRoutes = require("./src/routes/payment");
const { processRetryQueue } = require("./src/services/googleSheetsService");

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy hop (needed on Render/Heroku/Railway/etc. so
// express-rate-limit and req.ip see the real client IP, not the proxy's).
app.set("trust proxy", 1);

// --- Security headers ---
app.use(helmet());

// --- CORS: only allow the configured storefront origins ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Allow no-origin requests (curl, server-to-server, Paystack webhook)
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// --- Request logging ---
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// --- Paystack webhook needs the RAW body to verify the HMAC signature,
// so it's wired up BEFORE the global express.json() parser, and only
// for that one path. ---
app.use(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body; // Buffer
    next();
  }
);

// --- Standard body parsing for everything else ---
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// --- Anti-injection hardening ---
app.use(mongoSanitize()); // strips $ and . operators from req.body/query/params
app.use(hpp()); // prevents HTTP parameter pollution
app.use(sanitizeBody); // strips XSS payloads from string fields

// --- Rate limiting ---
app.use("/api/", generalLimiter);
app.use("/api/initiate-payment", checkoutLimiter);
app.use("/api/cart-checkout", checkoutLimiter);

// --- Health check (handy for uptime monitors / load balancers) ---
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// --- Routes ---
app.use("/api", paymentRoutes);

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Not found." });
});

// --- Central error handler (catches CORS rejection, JSON parse errors, etc.) ---
app.use((err, req, res, next) => {
  console.error("[unhandled error]", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: "Something went wrong on our end. Please try again.",
  });
});

// --- Background retry of any sales rows that failed to log to Google
// Sheets, every 5 minutes ---
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  processRetryQueue().then(({ processed, remaining }) => {
    if (processed > 0 || remaining > 0) {
      console.log(`[sheets-retry] processed=${processed} remaining=${remaining}`);
    }
  });
}, RETRY_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Heemah Jewelry backend running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
});

module.exports = app;
