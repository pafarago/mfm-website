/* MFM Docs: close the ? help menu on a tap outside it or on Escape.
   The menu itself is a <details> element and works without this. */
(function () {
  'use strict';
  function closeAll(except) {
    document.querySelectorAll('details.mfm-docs__help[open]').forEach(function (d) {
      if (d !== except) { d.removeAttribute('open'); }
    });
  }
  document.addEventListener('click', function (e) {
    closeAll(e.target.closest ? e.target.closest('details.mfm-docs__help') : null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = document.querySelector('details.mfm-docs__help[open]');
      if (open) {
        open.removeAttribute('open');
        var btn = open.querySelector('summary');
        if (btn) { btn.focus(); }
      }
    }
  });
})();
