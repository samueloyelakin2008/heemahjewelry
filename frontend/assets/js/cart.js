/* =====================================================================
   HEEMAH JEWELRY — Cart System
   - Persists to localStorage, shared across every page that includes
     this file.
   - Renders a slide-in drawer (not a new page) with live totals.
   - Exposes window.HJCart so checkout.js (and the inline "Add to Cart"
     buttons) can talk to it.
   ===================================================================== */
(function () {
  "use strict";

  var CART_KEY = "heemah_cart_v1";

  // ---------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------
  function getCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      console.warn("[cart] Could not read cart from localStorage, starting fresh.", e);
      return [];
    }
  }

  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {
      // Storage can fail (quota, private mode). The cart still works
      // in-memory for the current page load; we just can't persist it.
      console.warn("[cart] Could not save cart to localStorage.", e);
    }
    renderCart();
    document.dispatchEvent(new CustomEvent("hj:cart-updated", { detail: { cart: cart } }));
  }

  // ---------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------
  function addToCart(product) {
    if (!product || !product.id) return;
    var cart = getCart();
    var existing = cart.find(function (i) { return i.id === product.id; });
    if (existing) {
      existing.quantity = Math.min(50, existing.quantity + 1);
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: Number(product.price) || 0,
        image: product.image || "",
        quantity: 1,
      });
    }
    saveCart(cart);
    openDrawer();
    pulseBadge();
  }

  function removeFromCart(id) {
    var cart = getCart().filter(function (i) { return i.id !== id; });
    saveCart(cart);
  }

  function changeQuantity(id, delta) {
    var cart = getCart();
    var item = cart.find(function (i) { return i.id === id; });
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      cart = cart.filter(function (i) { return i.id !== id; });
    } else if (item.quantity > 50) {
      item.quantity = 50;
    }
    saveCart(cart);
  }

  function clearCart() {
    saveCart([]);
  }

  function getCartTotal() {
    return getCart().reduce(function (sum, i) { return sum + i.price * i.quantity; }, 0);
  }

  function getCartCount() {
    return getCart().reduce(function (sum, i) { return sum + i.quantity; }, 0);
  }

  function formatNaira(n) {
    return "₦" + Number(n).toLocaleString("en-NG");
  }

  // ---------------------------------------------------------------
  // Drawer markup (injected once, on load)
  // ---------------------------------------------------------------
  function injectMarkup() {
    if (document.getElementById("hj-cart-drawer")) return;

    var overlay = document.createElement("div");
    overlay.id = "hj-overlay";
    overlay.className = "hj-overlay";

    var drawer = document.createElement("div");
    drawer.id = "hj-cart-drawer";
    drawer.innerHTML =
      '<div class="hj-drawer-header">' +
        '<h3>Your Bag</h3>' +
        '<button class="hj-drawer-close" id="hj-drawer-close" aria-label="Close cart">&times;</button>' +
      '</div>' +
      '<div class="hj-drawer-body" id="hj-drawer-body"></div>' +
      '<div class="hj-drawer-footer" id="hj-drawer-footer"></div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener("click", closeDrawer);
    document.getElementById("hj-drawer-close").addEventListener("click", closeDrawer);
  }

  function openDrawer() {
    document.getElementById("hj-overlay").classList.add("hj-open");
    document.getElementById("hj-cart-drawer").classList.add("hj-open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    // Don't close the shared overlay if the checkout modal is the one
    // using it right now.
    if (window.HJCheckout && window.HJCheckout.isOpen && window.HJCheckout.isOpen()) return;
    document.getElementById("hj-overlay").classList.remove("hj-open");
    document.getElementById("hj-cart-drawer").classList.remove("hj-open");
    document.body.style.overflow = "";
  }

  function pulseBadge() {
    var badge = document.getElementById("cart-badge");
    if (!badge) return;
    badge.style.transform = "scale(1.4)";
    setTimeout(function () { badge.style.transform = "scale(1)"; }, 180);
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  function renderCart() {
    var cart = getCart();
    var badge = document.getElementById("cart-badge");
    if (badge) {
      var count = getCartCount();
      badge.textContent = count;
      badge.style.display = count > 0 ? "flex" : "none";
      badge.style.transition = "transform 0.18s ease";
    }

    var body = document.getElementById("hj-drawer-body");
    var footer = document.getElementById("hj-drawer-footer");
    if (!body || !footer) return;

    if (cart.length === 0) {
      body.innerHTML =
        '<div class="hj-empty-cart">' +
          '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></svg>' +
          '<p>Your bag is empty.</p>' +
        '</div>';
      footer.innerHTML = "";
      return;
    }

    body.innerHTML = cart
      .map(function (item) {
        return (
          '<div class="hj-cart-item" data-id="' + escapeHtml(item.id) + '">' +
            '<img src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.name) + '" onerror="this.style.opacity=0">' +
            "<div>" +
              '<p class="hj-item-name">' + escapeHtml(item.name) + "</p>" +
              '<p class="hj-item-price">' + formatNaira(item.price) + "</p>" +
              '<div class="hj-qty-row">' +
                '<button class="hj-qty-btn" data-action="dec" aria-label="Decrease quantity">&minus;</button>' +
                '<span class="hj-qty-val">' + item.quantity + "</span>" +
                '<button class="hj-qty-btn" data-action="inc" aria-label="Increase quantity">+</button>' +
              "</div>" +
            "</div>" +
            '<button class="hj-remove-btn" data-action="remove">Remove</button>' +
          "</div>"
        );
      })
      .join("");

    var total = getCartTotal();
    footer.innerHTML =
      '<div class="hj-summary-row"><span>Items</span><span>' + getCartCount() + "</span></div>" +
      '<div class="hj-summary-total"><span>Total</span><span>' + formatNaira(total) + "</span></div>" +
      '<button class="hj-btn-primary" id="hj-proceed-checkout">Proceed to Checkout</button>';

    var proceedBtn = document.getElementById("hj-proceed-checkout");
    if (proceedBtn) {
      proceedBtn.addEventListener("click", function () {
        if (window.HJCheckout) window.HJCheckout.start();
      });
    }

    // Wire up qty/remove buttons (re-bound on every render since markup
    // is rebuilt each time).
    body.querySelectorAll(".hj-cart-item").forEach(function (el) {
      var id = el.getAttribute("data-id");
      el.querySelector('[data-action="dec"]').addEventListener("click", function () { changeQuantity(id, -1); });
      el.querySelector('[data-action="inc"]').addEventListener("click", function () { changeQuantity(id, 1); });
      el.querySelector('[data-action="remove"]').addEventListener("click", function () { removeFromCart(id); });
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ---------------------------------------------------------------
  // Wire up "Add to Cart" buttons + cart icon (event delegation, so
  // this works even for product cards added after this script runs)
  // ---------------------------------------------------------------
  function bindGlobalEvents() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".purchase-button");
      if (btn) {
        e.preventDefault();
        addToCart({
          id: btn.getAttribute("data-id"),
          name: btn.getAttribute("data-name"),
          price: btn.getAttribute("data-price"),
          image: btn.getAttribute("data-image"),
        });
        return;
      }

      var cartIconBtn = e.target.closest("#cart-icon-btn");
      if (cartIconBtn) {
        e.preventDefault();
        openDrawer();
      }
    });
  }

  function init() {
    injectMarkup();
    bindGlobalEvents();
    renderCart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---------------------------------------------------------------
  // Public API for checkout.js / other pages
  // ---------------------------------------------------------------
  window.HJCart = {
    getCart: getCart,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    changeQuantity: changeQuantity,
    clearCart: clearCart,
    getCartTotal: getCartTotal,
    getCartCount: getCartCount,
    formatNaira: formatNaira,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    renderCart: renderCart,
  };
})();
