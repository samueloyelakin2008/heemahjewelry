/* =====================================================================
   HEEMAH JEWELRY — Checkout Flow
   Step 1 Cart Review -> Step 2 Customer Details -> Step 3 Payment
   Summary -> Step 4 Paystack Payment -> Success.

   Depends on cart.js (window.HJCart) and the Paystack Inline script
   (https://js.paystack.co/v1/inline.js) being loaded on the page.
   ===================================================================== */
(function () {
  "use strict";

  // Change this if the backend is hosted on a different origin than the
  // storefront (e.g. frontend on Netlify, API on Render/Railway).
  var API_BASE = window.HJ_API_BASE || "/api";

  var STEPS = ["cart", "details", "payment", "success"];
  var STEP_LABELS = { cart: "Cart", details: "Details", payment: "Payment", success: "Done" };

  var state = {
    step: "cart",
    customer: loadSavedCustomer(),
    pricedOrder: null, // { lineItems, total } from /cart-checkout
    paystackRef: null,
    submitting: false,
  };

  // ---------------------------------------------------------------
  // Customer details persistence (so a network hiccup doesn't make
  // someone retype their address)
  // ---------------------------------------------------------------
  var CUSTOMER_KEY = "heemah_customer_v1";
  function loadSavedCustomer() {
    try {
      var raw = localStorage.getItem(CUSTOMER_KEY);
      return raw ? JSON.parse(raw) : { fullName: "", email: "", phone: "", whatsapp: "", address: "" };
    } catch {
      return { fullName: "", email: "", phone: "", whatsapp: "", address: "" };
    }
  }
  function saveCustomer(customer) {
    try { localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer)); } catch {}
  }

  // ---------------------------------------------------------------
  // Modal scaffold (injected once)
  // ---------------------------------------------------------------
  function injectMarkup() {
    if (document.getElementById("hj-checkout-modal")) return;

    if (!document.getElementById("hj-overlay")) {
      var overlay = document.createElement("div");
      overlay.id = "hj-overlay";
      overlay.className = "hj-overlay";
      document.body.appendChild(overlay);
    }

    var modal = document.createElement("div");
    modal.id = "hj-checkout-modal";
    modal.innerHTML =
      '<div class="hj-modal-card">' +
        '<div class="hj-modal-header">' +
          '<div class="hj-modal-header-top">' +
            '<h3 id="hj-modal-title">Your Bag</h3>' +
            '<button class="hj-modal-close" id="hj-modal-close" aria-label="Close">&times;</button>' +
          "</div>" +
          '<div class="hj-steps" id="hj-steps"></div>' +
        "</div>" +
        '<div class="hj-modal-body" id="hj-modal-body"></div>' +
      "</div>";
    document.body.appendChild(modal);

    document.getElementById("hj-modal-close").addEventListener("click", close);
    document.getElementById("hj-overlay").addEventListener("click", function () {
      if (isOpen()) close();
    });
  }

  function isOpen() {
    var m = document.getElementById("hj-checkout-modal");
    return !!(m && m.classList.contains("hj-open"));
  }

  function open() {
    injectMarkup();
    document.getElementById("hj-overlay").classList.add("hj-open");
    document.getElementById("hj-checkout-modal").classList.add("hj-open");
    document.body.style.overflow = "hidden";
    // Close the cart drawer underneath so they don't both fight for the
    // overlay's click-to-close behavior.
    var drawer = document.getElementById("hj-cart-drawer");
    if (drawer) drawer.classList.remove("hj-open");
  }

  function close() {
    document.getElementById("hj-overlay").classList.remove("hj-open");
    document.getElementById("hj-checkout-modal").classList.remove("hj-open");
    document.body.style.overflow = "";
  }

  function start() {
    if (window.HJCart.getCart().length === 0) return;
    state.step = "cart";
    open();
    render();
  }

  // ---------------------------------------------------------------
  // Step indicator
  // ---------------------------------------------------------------
  function renderSteps() {
    var container = document.getElementById("hj-steps");
    var currentIndex = STEPS.indexOf(state.step);
    container.innerHTML = STEPS.map(function (key, i) {
      var cls = i < currentIndex ? "hj-done" : i === currentIndex ? "hj-active" : "";
      var circleContent = i < currentIndex ? "✓" : i + 1;
      var line = i < STEPS.length - 1
        ? '<div class="hj-step-line ' + (i < currentIndex ? "hj-done" : "") + '"></div>'
        : "";
      return (
        '<div class="hj-step ' + cls + '">' +
          '<div class="hj-step-circle">' + circleContent + "</div>" +
          '<span class="hj-step-label">' + STEP_LABELS[key] + "</span>" +
        "</div>" + line
      );
    }).join("");
  }

  // ---------------------------------------------------------------
  // Main render dispatcher
  // ---------------------------------------------------------------
  function render() {
    renderSteps();
    var title = document.getElementById("hj-modal-title");
    var body = document.getElementById("hj-modal-body");

    if (state.step === "cart") {
      title.textContent = "Review Your Bag";
      body.innerHTML = renderCartReviewHtml();
      bindCartReviewEvents();
    } else if (state.step === "details") {
      title.textContent = "Your Details";
      body.innerHTML = renderDetailsHtml();
      bindDetailsEvents();
    } else if (state.step === "payment") {
      title.textContent = "Payment Summary";
      body.innerHTML = '<div class="hj-alert hj-alert-info">Loading your order summary…</div>';
      loadPricedOrderAndRenderPayment();
    } else if (state.step === "success") {
      title.textContent = "Order Confirmed";
      body.innerHTML = renderSuccessHtml();
      bindSuccessEvents();
    }
  }

  // ---------------------------------------------------------------
  // STEP 1 — Cart Review
  // ---------------------------------------------------------------
  function renderCartReviewHtml() {
    var cart = window.HJCart.getCart();
    if (cart.length === 0) {
      return '<div class="hj-empty-cart"><p>Your bag is empty.</p></div>';
    }
    var rows = cart
      .map(function (item) {
        return (
          '<div class="hj-cart-item" data-id="' + item.id + '">' +
            '<img src="' + item.image + '" alt="' + item.name + '" onerror="this.style.opacity=0">' +
            "<div>" +
              '<p class="hj-item-name">' + item.name + "</p>" +
              '<p class="hj-item-price">' + window.HJCart.formatNaira(item.price) + "</p>" +
              '<div class="hj-qty-row">' +
                '<button class="hj-qty-btn" data-action="dec">&minus;</button>' +
                '<span class="hj-qty-val">' + item.quantity + "</span>" +
                '<button class="hj-qty-btn" data-action="inc">+</button>' +
              "</div>" +
            "</div>" +
            '<button class="hj-remove-btn" data-action="remove">Remove</button>' +
          "</div>"
        );
      })
      .join("");

    var total = window.HJCart.getCartTotal();
    return (
      rows +
      '<div class="hj-summary-total" style="margin-top:16px;"><span>Subtotal</span><span>' +
        window.HJCart.formatNaira(total) +
      "</span></div>" +
      '<button class="hj-btn-primary" id="hj-to-details">Proceed to Checkout</button>'
    );
  }

  function bindCartReviewEvents() {
    var body = document.getElementById("hj-modal-body");
    body.querySelectorAll(".hj-cart-item").forEach(function (el) {
      var id = el.getAttribute("data-id");
      el.querySelector('[data-action="dec"]').addEventListener("click", function () {
        window.HJCart.changeQuantity(id, -1);
        render();
      });
      el.querySelector('[data-action="inc"]').addEventListener("click", function () {
        window.HJCart.changeQuantity(id, 1);
        render();
      });
      el.querySelector('[data-action="remove"]').addEventListener("click", function () {
        window.HJCart.removeFromCart(id);
        render();
      });
    });
    var toDetails = document.getElementById("hj-to-details");
    if (toDetails) {
      toDetails.addEventListener("click", function () {
        state.step = "details";
        render();
      });
    }
  }

  // ---------------------------------------------------------------
  // STEP 2 — Customer Details
  // ---------------------------------------------------------------
  var FIELD_RULES = {
    fullName: { test: function (v) { return /^[a-zA-Z\u00C0-\u017F\s'.-]{2,100}$/.test(v.trim()); }, msg: "Enter your full name (letters only)." },
    email: { test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }, msg: "Enter a valid email address." },
    phone: { test: function (v) { return /^\+?[0-9]{10,15}$/.test(v.trim()); }, msg: "Enter a valid phone number." },
    whatsapp: { test: function (v) { return /^\+?[0-9]{10,15}$/.test(v.trim()); }, msg: "Enter a valid WhatsApp number." },
    address: { test: function (v) { return v.trim().length >= 5; }, msg: "Enter your full delivery address." },
  };

  function renderDetailsHtml() {
    var c = state.customer;
    function field(name, label, type, placeholder) {
      return (
        '<div class="hj-field" id="hj-field-' + name + '">' +
          "<label>" + label + "</label>" +
          '<input type="' + type + '" name="' + name + '" placeholder="' + placeholder + '" value="' +
            (c[name] || "").replace(/"/g, "&quot;") + '">' +
          '<p class="hj-field-error"></p>' +
        "</div>"
      );
    }
    return (
      field("fullName", "Full Name", "text", "e.g. Jane Doe") +
      field("email", "Email Address", "email", "you@example.com") +
      field("phone", "Phone Number", "tel", "e.g. 08012345678") +
      field("whatsapp", "WhatsApp Number", "tel", "e.g. 08012345678") +
      '<div class="hj-field" id="hj-field-address">' +
        "<label>Delivery Address</label>" +
        '<textarea name="address" placeholder="Street, city, state">' + (c.address || "") + "</textarea>" +
        '<p class="hj-field-error"></p>' +
      "</div>" +
      '<button class="hj-btn-primary" id="hj-to-payment">Continue to Payment</button>' +
      '<button class="hj-btn-secondary" id="hj-back-to-cart">Back to Bag</button>'
    );
  }

  function bindDetailsEvents() {
    var body = document.getElementById("hj-modal-body");
    document.getElementById("hj-back-to-cart").addEventListener("click", function () {
      state.step = "cart";
      render();
    });
    document.getElementById("hj-to-payment").addEventListener("click", function () {
      var customer = {};
      var valid = true;
      Object.keys(FIELD_RULES).forEach(function (name) {
        var input = body.querySelector('[name="' + name + '"]');
        var value = input.value;
        customer[name] = value.trim();
        var fieldEl = document.getElementById("hj-field-" + name);
        var rule = FIELD_RULES[name];
        if (!rule.test(value)) {
          valid = false;
          fieldEl.classList.add("hj-invalid");
          fieldEl.querySelector(".hj-field-error").textContent = rule.msg;
        } else {
          fieldEl.classList.remove("hj-invalid");
        }
      });
      if (!valid) return;
      state.customer = customer;
      saveCustomer(customer);
      state.step = "payment";
      render();
    });
  }

  // ---------------------------------------------------------------
  // STEP 3 — Payment Summary (re-prices server-side, then shows the
  // Paystack button)
  // ---------------------------------------------------------------
  function loadPricedOrderAndRenderPayment() {
    var cart = window.HJCart.getCart().map(function (i) { return { id: i.id, quantity: i.quantity }; });

    fetch(API_BASE + "/cart-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart: cart }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (result) {
        var body = document.getElementById("hj-modal-body");
        if (!result.ok) {
          body.innerHTML = renderPaymentErrorHtml(result.data && result.data.message, result.status);
          bindPaymentErrorEvents();
          return;
        }
        state.pricedOrder = result.data;
        body.innerHTML = renderPaymentSummaryHtml();
        bindPaymentSummaryEvents();
      })
      .catch(function () {
        var body = document.getElementById("hj-modal-body");
        body.innerHTML = renderPaymentErrorHtml(
          "We couldn't reach the server. Your bag is safely saved — please check your connection and try again.",
          0
        );
        bindPaymentErrorEvents();
      });
  }

  function renderPaymentErrorHtml(message, status) {
    var friendly = message || "Something went wrong loading your order summary.";
    return (
      '<div class="hj-alert hj-alert-error">' + friendly + "</div>" +
      '<button class="hj-btn-primary" id="hj-retry-summary">Try Again</button>' +
      '<button class="hj-btn-secondary" id="hj-back-to-details">Back</button>'
    );
  }

  function bindPaymentErrorEvents() {
    document.getElementById("hj-retry-summary").addEventListener("click", function () { render(); });
    document.getElementById("hj-back-to-details").addEventListener("click", function () {
      state.step = "details";
      render();
    });
  }

  function renderPaymentSummaryHtml() {
    var order = state.pricedOrder;
    var rows = order.lineItems
      .map(function (li) {
        return (
          '<div class="hj-summary-row"><span>' + li.quantity + " × " + li.name + "</span><span>" +
          window.HJCart.formatNaira(li.lineTotal) + "</span></div>"
        );
      })
      .join("");
    return (
      rows +
      '<div class="hj-summary-total" style="margin-top:10px;"><span>Total</span><span>' +
        window.HJCart.formatNaira(order.total) +
      "</span></div>" +
      '<div id="hj-payment-alert"></div>' +
      '<button class="hj-btn-primary" id="hj-pay-now">Pay with Paystack</button>' +
      '<button class="hj-btn-secondary" id="hj-back-to-details-2">Back</button>' +
      '<div class="hj-trust-badges">' +
        '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V5l-8-3Z"/></svg>' +
        "Secured by Paystack — your card details never touch our servers." +
      "</div>"
    );
  }

  function bindPaymentSummaryEvents() {
    document.getElementById("hj-back-to-details-2").addEventListener("click", function () {
      state.step = "details";
      render();
    });
    document.getElementById("hj-pay-now").addEventListener("click", initiateAndOpenPaystack);
  }

  // ---------------------------------------------------------------
  // STEP 4 — Initiate payment server-side, then launch Paystack Inline
  // ---------------------------------------------------------------
  function setPaying(isPaying, label) {
    var btn = document.getElementById("hj-pay-now");
    if (!btn) return;
    btn.disabled = isPaying;
    btn.innerHTML = isPaying ? '<span class="hj-loading-spinner"></span>' + (label || "Processing…") : "Pay with Paystack";
  }

  function showPaymentAlert(message, type) {
    var alertBox = document.getElementById("hj-payment-alert");
    if (!alertBox) return;
    alertBox.innerHTML = '<div class="hj-alert hj-alert-' + (type || "error") + '">' + message + "</div>";
  }

  function initiateAndOpenPaystack() {
    if (state.submitting) return;
    state.submitting = true;
    setPaying(true, "Starting payment…");

    var cart = window.HJCart.getCart().map(function (i) { return { id: i.id, quantity: i.quantity }; });

    fetch(API_BASE + "/initiate-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer: state.customer, cart: cart }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (result) {
        state.submitting = false;
        setPaying(false);

        if (!result.ok) {
          showPaymentAlert(result.data && result.data.message ? result.data.message : "We couldn't start your payment. Please try again.");
          return;
        }

        state.paystackRef = result.data.reference;
        launchPaystackPopup(result.data);
      })
      .catch(function () {
        state.submitting = false;
        setPaying(false);
        showPaymentAlert("Network error — your bag is saved. Please check your connection and try again.");
      });
  }

  function launchPaystackPopup(payload) {
    if (typeof PaystackPop === "undefined") {
      showPaymentAlert("Payment library failed to load. Please refresh the page and try again.");
      return;
    }
    var handler = PaystackPop.setup({
      key: payload.publicKey,
      email: state.customer.email,
      amount: Math.round(payload.amount * 100),
      ref: payload.reference,
      access_code: payload.accessCode,
      callback: function (response) {
        verifyPayment(response.reference);
      },
      onClose: function () {
        showPaymentAlert("Payment window closed. You can try again whenever you're ready.", "info");
      },
    });
    handler.openIframe();
  }

  function verifyPayment(reference) {
    var body = document.getElementById("hj-modal-body");
    body.innerHTML = '<div class="hj-alert hj-alert-info"><span class="hj-loading-spinner" style="border-top-color:var(--hj-gold-dark);border-color:rgba(0,0,0,0.1);"></span>Confirming your payment…</div>';

    fetch(API_BASE + "/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: reference }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (result) {
        if (result.ok && result.data.success) {
          state.lastOrderId = result.data.orderId || reference;
          window.HJCart.clearCart();
          state.step = "success";
          render();
        } else if (result.status === 402) {
          // Genuinely failed/declined payment — safe to offer a retry.
          state.step = "payment";
          render();
          showPaymentAlert("Payment was not successful. You can try again.");
        } else {
          // We can't confirm right now (network/server hiccup), but
          // Paystack's own popup already reported success — don't tell
          // the customer their payment failed. Paystack's webhook will
          // still finalize the order server-side even if this call never
          // lands.
          renderPendingConfirmation(reference);
        }
      })
      .catch(function () {
        renderPendingConfirmation(reference);
      });
  }

  function renderPendingConfirmation(reference) {
    var body = document.getElementById("hj-modal-body");
    body.innerHTML =
      '<div class="hj-alert hj-alert-info">' +
        "Your payment went through, but we couldn't confirm it from here just now. " +
        "We'll keep trying in the background and email your receipt shortly. " +
        "Reference: <strong>" + reference + "</strong>" +
      "</div>" +
      '<button class="hj-btn-primary" id="hj-pending-retry">Check Again</button>' +
      '<button class="hj-btn-secondary" id="hj-pending-close">Close</button>';
    document.getElementById("hj-pending-retry").addEventListener("click", function () { verifyPayment(reference); });
    document.getElementById("hj-pending-close").addEventListener("click", close);
  }

  // ---------------------------------------------------------------
  // Success
  // ---------------------------------------------------------------
  function renderSuccessHtml() {
    return (
      '<div class="hj-success-wrap">' +
        '<div class="hj-success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        "<h3 style=\"margin:0 0 6px;\">Thank you!</h3>" +
        '<p style="color:#666;font-size:0.88rem;">Your order has been confirmed.<br>Order ID: <strong>' + (state.lastOrderId || "") + "</strong></p>" +
        '<p style="color:#888;font-size:0.8rem;margin-top:10px;">A receipt has been sent to your email.</p>' +
        '<button class="hj-btn-primary" id="hj-success-close" style="margin-top:18px;">Continue Shopping</button>' +
      "</div>"
    );
  }

  function bindSuccessEvents() {
    document.getElementById("hj-success-close").addEventListener("click", close);
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------
  window.HJCheckout = {
    start: start,
    close: close,
    isOpen: isOpen,
  };
})();
