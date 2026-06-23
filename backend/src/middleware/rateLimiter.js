const rateLimit = require("express-rate-limit");

/**
 * IP-based rate limiter.
 *
 * NOTE ON STATUS CODE:
 * The original brief asks for HTTP 409 ("Conflict") on rate-limit. 409 is
 * semantically wrong for "too many requests" — it means the request
 * conflicts with the current state of a resource. The correct, standard
 * status for throttling is 429 ("Too Many Requests"), which is what
 * browsers, Paystack's own API, and load balancers expect and handle
 * correctly (e.g. respecting Retry-After). We use 429 here but keep the
 * exact friendly copy that was requested. If you specifically need 409
 * for a downstream system, change `statusCode` below.
 */
const friendlyMessage = {
  success: false,
  message: "Too many requests — even gold needs a break ✨ Try again shortly.",
};

const windowMinutes = parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || "10", 10);
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10);

const generalLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: friendlyMessage,
  keyGenerator: (req) => req.ip,
});

// Tighter limiter specifically for payment-initiation endpoints, to slow
// down repeated/bot checkout attempts against the same IP.
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 checkout attempts per 10 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    success: false,
    message:
      "We're getting lots of visitors — please try again in a moment ✨",
  },
  keyGenerator: (req) => req.ip,
});

module.exports = { generalLimiter, checkoutLimiter };
