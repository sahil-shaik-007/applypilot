// Test widgets that behave like the real ones on ATS forms:
//  - [data-combo]: a react-select clone (role=combobox input inside .select__control, menu of
//    role=option rendered on mousedown/ArrowDown, filter on input, chosen value in .select__single-value)
//    data-async="1": options only appear after typing (location typeahead), after a delay
//  - every form records submit attempts in window.__submits and shows a thank-you page
(function () {
  window.__submits = 0;
  window.__submitClicks = 0;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button[type=submit],input[type=submit]');
    if (b) window.__submitClicks++;
  }, true);
  document.querySelectorAll('form[data-thanks]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      window.__submits++;
      var missing = [].slice.call(f.querySelectorAll('[required]')).filter(function (x) { return x.type === 'file' ? !x.files.length : !x.value; });
      if (missing.length) { window.__invalid = missing.map(function (x) { return x.name || x.id; }); return; }
      setTimeout(function () { document.body.innerHTML = '<main><h1>Thank you for applying!</h1><p>Your application has been submitted.</p></main>'; }, 200);
    });
  });

  document.querySelectorAll('[data-combo]').forEach(function (ctrl) {
    var input = ctrl.querySelector('input');
    var menu = document.getElementById(ctrl.getAttribute('data-menu'));
    var hidden = ctrl.parentElement.querySelector('input[type=hidden]');
    var opts = JSON.parse(ctrl.getAttribute('data-options') || '[]');
    var async = ctrl.getAttribute('data-async') === '1';
    var single = ctrl.querySelector('.select__single-value');
    var ph = ctrl.querySelector('.select__placeholder');
    function render(list) {
      menu.innerHTML = '';
      list.forEach(function (o, i) {
        var d = document.createElement('div');
        d.className = 'select__option'; d.setAttribute('role', 'option'); d.id = menu.id + '-opt-' + i; d.textContent = o;
        d.addEventListener('click', function () { choose(o); });
        menu.appendChild(d);
      });
      menu.hidden = !list.length && !async;
      if (async && !list.length) { menu.hidden = false; menu.innerHTML = '<div class="select__menu-notice">No options</div>'; }
      input.setAttribute('aria-expanded', 'true');
    }
    function open() { if (async) { render(input.value.length >= 2 ? filter(input.value) : []); } else render(filter(input.value)); }
    function close() { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function filter(q) { q = String(q || '').toLowerCase(); return opts.filter(function (o) { return !q || o.toLowerCase().indexOf(q) >= 0; }); }
    function choose(o) {
      if (!single) { single = document.createElement('div'); single.className = 'select__single-value'; ctrl.querySelector('.select__value-container').insertBefore(single, input); }
      single.textContent = o; if (ph) ph.style.display = 'none';
      if (hidden) hidden.value = o;
      input.value = '';
      close();
    }
    ctrl.addEventListener('mousedown', function (e) { if (e.target.closest('[role=option]')) return; input.focus(); open(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') open(); if (e.key === 'Escape') close(); });
    input.addEventListener('input', function () {
      if (async) { var v = input.value; setTimeout(function () { if (input.value === v) render(v.length >= 2 ? filter(v) : []); }, 300); } else render(filter(input.value));
    });
  });
})();
