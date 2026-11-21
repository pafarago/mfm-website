/**
 * MFM main menu. One copy of the menu; CSS lays it out, this only switches
 * states.
 *
 * Phones (< 64em): the menu button opens a drawer; a parent item slides its
 * sub-menu in over the list. Each step adds a history entry, so the phone's
 * Back gesture closes the sub-panel, then the drawer, instead of leaving the
 * page. Esc does the same from a keyboard.
 *
 * Wide screens: parent items are buttons that open dropdowns. Hovering with a
 * mouse opens them too; a click "pins" one open until you click elsewhere.
 * Arrow keys move through a dropdown; Esc closes it.
 */
(() => {
  'use strict';

  const nav = document.getElementById('site-nav');
  const panel = document.getElementById('nav-panel');
  const openBtn = document.querySelector('.nav-open');
  if (!nav || !panel || !openBtn) return;

  const wide = window.matchMedia('(min-width: 64em)');
  const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)');
  const parents = Array.from(nav.querySelectorAll('.has-sub'));
  const HOVER_CLOSE_MS = 250;
  // Never let focus() scroll: a sliding panel would be scrolled sideways
  // while it is still off-screen and stay shifted once it arrives.
  const FOCUS = { preventScroll: true };

  // Phone: number of history entries we have pushed (1 = drawer, 2 = + sub-panel).
  let depth = 0;
  // Phone: link chosen inside the drawer, followed once our entries are popped.
  let pendingHref = null;

  const isPhone = () => !wide.matches;
  const buttonOf = (li) => li.querySelector(':scope > .menu-button');
  const linksOf = (li) => Array.from(li.querySelectorAll('.menu--sub .menu-link'));
  const openParent = () => parents.find((li) => li.classList.contains('is-open'));

  function setOpen(li, open) {
    li.classList.toggle('is-open', open);
    buttonOf(li).setAttribute('aria-expanded', String(open));
    if (!open) {
      delete li.dataset.hover;
      clearTimeout(li._closeTimer);
    }
  }

  function closeAll(except) {
    parents.forEach((li) => { if (li !== except) setOpen(li, false); });
  }

  /* ---------------------------------------------------------------- phone */

  function setPageInert(on) {
    document.querySelectorAll('.site-brand, .skip-link, #content, .site-footer')
      .forEach((el) => { el.inert = on; });
  }

  function openDrawer() {
    if (nav.classList.contains('is-open')) return;
    nav.classList.add('is-open');
    openBtn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('nav-locked');
    setPageInert(true);
    history.pushState({ mfmNav: 1 }, '');
    depth = 1;
    const first = panel.querySelector('.nav-close');
    if (first) first.focus(FOCUS);
  }

  // Undo everything the drawer did (called once history is back at the page).
  function resetDrawer() {
    closeAll();
    nav.classList.remove('is-open');
    openBtn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('nav-locked');
    setPageInert(false);
    depth = 0;
  }

  function openPhoneSub(li) {
    setOpen(li, true);
    history.pushState({ mfmNav: 2 }, '');
    depth = 2;
    const back = li.querySelector('.submenu__back');
    if (back) back.focus(FOCUS);
  }

  // User asked to close the drawer (✕, backdrop, Esc): pop our entries; the
  // popstate handler does the actual closing.
  function requestCloseDrawer() {
    if (depth > 0) history.go(-depth);
    else { resetDrawer(); openBtn.focus(FOCUS); }
  }

  function requestCloseSub() {
    if (depth === 2) history.back();
    else {
      const li = openParent();
      if (li) { setOpen(li, false); buttonOf(li).focus(FOCUS); }
    }
  }

  window.addEventListener('popstate', () => {
    if (!isPhone() || depth === 0) return;
    const now = (history.state && history.state.mfmNav) || 0;

    if (now < 2) {
      const li = openParent();
      if (li) {
        setOpen(li, false);
        if (now === 1) buttonOf(li).focus(FOCUS);
      }
    }
    if (now < 1) {
      resetDrawer();
      if (pendingHref) {
        const href = pendingHref;
        pendingHref = null;
        window.location.assign(href);
        return;
      }
      openBtn.focus(FOCUS);
    }
    depth = now;
  });

  // Returning to this page from the back/forward cache: start closed.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { resetDrawer(); pendingHref = null; }
  });

  /* ----------------------------------------------------------- wide screens */

  function focusLink(li, index) {
    const links = linksOf(li);
    if (!links.length) return;
    links[(index + links.length) % links.length].focus(FOCUS);
  }

  function topLevelControls() {
    return Array.from(nav.querySelectorAll('.menu--top > li > .menu-link, .menu--top > li > .menu-button'));
  }

  parents.forEach((li) => {
    const btn = buttonOf(li);

    li.addEventListener('mouseenter', () => {
      if (isPhone() || !fineHover.matches) return;
      clearTimeout(li._closeTimer);
      if (!li.classList.contains('is-open')) {
        closeAll(li);
        setOpen(li, true);
        li.dataset.hover = '1';
      }
    });

    li.addEventListener('mouseleave', () => {
      if (isPhone() || li.dataset.hover !== '1') return;
      li._closeTimer = setTimeout(() => setOpen(li, false), HOVER_CLOSE_MS);
    });

    li.addEventListener('focusout', (e) => {
      // Ignore focus loss caused by clicking inside the open dropdown (Safari
      // does not focus links on click, so relatedTarget is null there).
      if (isPhone() || li.contains(e.relatedTarget) || li.matches(':hover')) return;
      setOpen(li, false);
    });

    btn.addEventListener('keydown', (e) => {
      if (isPhone()) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        closeAll(li);
        setOpen(li, true);
        focusLink(li, 0);
      }
    });

    li.addEventListener('keydown', (e) => {
      if (isPhone() || !li.classList.contains('is-open') || !e.target.closest('.menu--sub')) return;
      const links = linksOf(li);
      const i = links.indexOf(document.activeElement);
      if (i === -1) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); focusLink(li, i + 1); }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i === 0) btn.focus(FOCUS); else focusLink(li, i - 1);
      }
      if (e.key === 'Home') { e.preventDefault(); focusLink(li, 0); }
      if (e.key === 'End') { e.preventDefault(); focusLink(li, links.length - 1); }
    });
  });

  // Left/Right move between top-level items on wide screens.
  nav.addEventListener('keydown', (e) => {
    if (isPhone() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const controls = topLevelControls();
    const i = controls.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    closeAll();
    controls[(i + (e.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length].focus(FOCUS);
  });

  /* ----------------------------------------------------------------- shared */

  openBtn.addEventListener('click', openDrawer);

  nav.addEventListener('click', (e) => {
    const target = e.target;

    if (target.closest('.nav-backdrop') || target.closest('.nav-close')) {
      e.preventDefault();
      requestCloseDrawer();
      return;
    }

    if (target.closest('.submenu__back')) {
      e.preventDefault();
      requestCloseSub();
      return;
    }

    const btn = target.closest('.menu-button');
    if (btn) {
      const li = btn.parentElement;
      if (isPhone()) {
        openPhoneSub(li);
      } else if (li.dataset.hover === '1') {
        // Opened by hovering; a click pins it open.
        delete li.dataset.hover;
        clearTimeout(li._closeTimer);
      } else {
        const open = !li.classList.contains('is-open');
        closeAll(li);
        setOpen(li, open);
      }
      return;
    }

    // Following a link from inside the phone drawer: pop our history entries
    // first so Back on the next page returns here, not to an open drawer.
    const link = target.closest('a[href]');
    if (link && isPhone() && depth > 0 && !e.defaultPrevented &&
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey &&
        (!link.target || link.target === '_self')) {
      e.preventDefault();
      pendingHref = link.href;
      history.go(-depth);
    }
  });

  // Wide screens: a click anywhere else closes an open dropdown.
  document.addEventListener('click', (e) => {
    if (!isPhone() && !nav.contains(e.target)) closeAll();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isPhone()) {
      if (depth === 2 || openParent()) requestCloseSub();
      else if (nav.classList.contains('is-open')) requestCloseDrawer();
      return;
    }
    const li = openParent();
    if (li) { setOpen(li, false); buttonOf(li).focus(FOCUS); }
  });

  // Rotating a tablet or resizing across the breakpoint: start fresh.
  wide.addEventListener('change', () => {
    resetDrawer();
    pendingHref = null;
  });
})();
