
  (function () {
    var isOpen = false;

    window.toggleExtraProducts = function () {
      isOpen = !isOpen;

      var section = document.getElementById('extra-section');
      var btn     = document.getElementById('reveal-btn');
      var icon    = document.getElementById('btn-icon');
      var label   = document.getElementById('btn-label');
      var hint    = document.getElementById('reveal-hint');
      var badge   = document.getElementById('btn-count');

      if (isOpen) {
        /* ---- OPEN ---- */
        section.classList.add('open');
        btn.classList.add('open');
        label.textContent = 'Show Less';
        badge.style.display = 'none';
        hint.textContent = 'Tap to collapse the collection';

        /* Staggered card entrance */
        setTimeout(function () {
          var cards = document.querySelectorAll('.extra-card');
          cards.forEach(function (card, i) {
            setTimeout(function () {
              card.classList.add('visible');
            }, i * 60);
          });
        }, 100);

      } else {
        /* ---- CLOSE ---- */
        var cards = document.querySelectorAll('.extra-card');
        cards.forEach(function (card) {
          card.classList.remove('visible');
        });

        setTimeout(function () {
          section.classList.remove('open');
        }, 180);

        btn.classList.remove('open');
        label.textContent = 'See 15 More Pieces';
        badge.textContent = '15';
        badge.style.display = '';
        hint.textContent = 'Tap to expand the full collection';

        /* Scroll back to button smoothly */
        document.getElementById('reveal-wrap').scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    };
  })();
 document.getElementById("menu-toggle").addEventListener("click", function () {
        const menu = document.getElementById("mobile-menu");
        if (menu.classList.contains("hidden")) {
            menu.classList.remove("hidden");
            menu.classList.add("flex");
        } else {
            menu.classList.add("hidden");
        }
    });