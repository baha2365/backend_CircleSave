/**
 * app-shell.js
 * Injects the sidebar, topbar, bottom-nav, and shared modals into every
 * app page. Each page only needs:
 *
 *   <div id="app-layout">
 *     <div id="main">
 *       <div id="page" class="page-fade"> ... page content ... </div>
 *     </div>
 *   </div>
 *
 * Call initShell({ title, actionHtml, backBtn, backHref, backLabel })
 * from each page's inline <script>.
 *
 * ── WHY THE SIDEBAR MUST GO INSIDE #app-layout ────────────────────────
 *
 *  #app-layout is a CSS flex container (display:flex).
 *  For the sidebar + main layout to work it must look like:
 *
 *    #app-layout  (display:flex, height:100vh)
 *    ├── #sidebar          ← flex child 1  (width:260px)
 *    └── #main             ← flex child 2  (flex:1)
 *
 *  On DESKTOP  →  #sidebar has position:relative, so it takes up real
 *                 space in the document flow.
 *  On MOBILE   →  #sidebar has position:fixed + translateX(-100%), so it
 *                 is pulled out of the flow and takes up zero space.
 *
 *  If the sidebar is injected into <body> (outside #app-layout) on desktop
 *  it becomes a 100vh-tall block sitting ABOVE #app-layout, pushing the
 *  entire app below the visible viewport → blank screen.
 *  On mobile the fixed positioning hides this problem, which is why
 *  content was only visible after shrinking the window.
 *
 *  FIX: inject into #app-layout so the sidebar is always a proper
 *  flex sibling of #main, regardless of screen size.
 * ──────────────────────────────────────────────────────────────────────
 */

const SIDEBAR_HTML = `
<div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>
<nav id="sidebar">
  <div class="sidebar-logo">
    <h1><a href="index.html" style="color:inherit">Circle<span>Save</span></a></h1>
    <p>Community savings platform</p>
  </div>
  <div class="nav-section">
    <div class="nav-label">Main</div>
    <a href="dashboard.html"     class="nav-item" id="nav-dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      Dashboard
    </a>
    <a href="circles.html"       class="nav-item" id="nav-circles">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>
      My Circles
    </a>
    <a href="payments.html"      class="nav-item" id="nav-payments">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
      Payments
    </a>
    <a href="notifications.html" class="nav-item" id="nav-notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      Notifications
      <span id="sidebar-notif-dot" style="display:none;width:6px;height:6px;background:var(--red);border-radius:50%;margin-left:auto;flex-shrink:0"></span>
    </a>
  </div>
  <div class="nav-section">
    <div class="nav-label">Account</div>
    <a href="profile.html" class="nav-item" id="nav-profile">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      Profile
    </a>
    <a href="admin.html" class="nav-item" id="nav-admin" style="display:none">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      Admin
    </a>
  </div>
  <div class="sidebar-user">
    <div class="ava" id="sidebar-ava">?</div>
    <div class="info">
      <div class="name" id="sidebar-name">Loading…</div>
      <div class="role" id="sidebar-role">MEMBER</div>
    </div>
    <button class="btn-icon btn-ghost" title="Sign out" onclick="handleLogout()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </button>
  </div>
</nav>`;

const BOTTOM_NAV_HTML = `
<div id="bottom-nav">
  <a href="dashboard.html"     class="bnav-item" id="bnav-dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Home</a>
  <a href="circles.html"       class="bnav-item" id="bnav-circles"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>Circles</a>
  <a href="payments.html"      class="bnav-item" id="bnav-payments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>Payments</a>
  <a href="profile.html"       class="bnav-item" id="bnav-profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Profile</a>
</div>`;

const SHARED_MODALS_HTML = `
<div class="modal-overlay" id="modal-payment">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-title">Submit Contribution</div>
      <button class="modal-close" onclick="closeModal('modal-payment')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="form-group">
      <label class="form-label">Circle</label>
      <select class="form-select" id="pay-circle-id"></select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Amount</label>
        <input type="number" class="form-input" id="pay-amount" placeholder="500" min="0.01" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Currency</label>
        <select class="form-select" id="pay-currency">
          <option>USD</option><option>EUR</option><option>KZT</option><option>GBP</option><option>RUB</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Payment method</label>
      <select class="form-select" id="pay-method">
        <option value="BANK_TRANSFER">Bank Transfer</option>
        <option value="CARD">Card</option>
        <option value="CASH">Cash</option>
        <option value="CRYPTO">Crypto</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Reference (optional)</label>
      <input type="text" class="form-input" id="pay-ref" placeholder="TXN-2024-001">
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal('modal-payment')">Cancel</button>
      <button class="btn btn-green"     style="flex:1" onclick="handleSubmitPayment()">Submit Payment</button>
    </div>
  </div>
</div>
<div id="toast-container"></div>`;

function buildTopbar({ title, actionHtml = '', backBtn = false, backHref = 'circles.html', backLabel = 'My Circles' }) {
  return `
  <header id="topbar">
    <button class="topbar-menu" onclick="toggleSidebar()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="6"  x2="21" y2="6"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    ${backBtn ? `
    <a href="${backHref}" class="btn btn-ghost btn-sm" style="display:flex;align-items:center;gap:6px;padding:6px 10px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      ${backLabel}
    </a>` : ''}
    <div class="topbar-title" style="${backBtn ? 'font-size:17px' : ''}">${title}</div>
    <a href="notifications.html" class="notif-btn" title="Notifications">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <div class="notif-badge" id="notif-badge" style="display:none"></div>
    </a>
    ${actionHtml}
  </header>`;
}

function initShell(opts = {}) {
  // ── STEP 1 ──────────────────────────────────────────────────────────
  // Inject sidebar INSIDE #app-layout so it becomes a flex sibling of
  // #main. This is the critical fix — injecting into document.body puts
  // the sidebar OUTSIDE the flex container, which breaks the layout on
  // desktop (sidebar occupies 100vh as a block, pushing content below
  // the viewport).
  const appLayout = document.getElementById('app-layout');
  if (appLayout) {
    appLayout.insertAdjacentHTML('afterbegin', SIDEBAR_HTML);
  }

  // ── STEP 2 ──────────────────────────────────────────────────────────
  // Inject topbar as the first child of #main (above #page).
  const main = document.getElementById('main');
  if (main) {
    main.insertAdjacentHTML('afterbegin', buildTopbar(opts));
  }

  // ── STEP 3 ──────────────────────────────────────────────────────────
  // Inject bottom-nav, shared modals, and toast container at the very
  // end of <body>. These are all position:fixed so their DOM position
  // doesn't affect the flex layout.
  document.body.insertAdjacentHTML('beforeend', BOTTOM_NAV_HTML + SHARED_MODALS_HTML);

  // ── STEP 4 ──────────────────────────────────────────────────────────
  // Auth check, user hydration, nav active state, notif badge.
  const user = requireAuth();
  if (!user) return null;

  updateSidebarUser(user);
  initNav();
  checkNotifBadge();
  initModalOverlays();
  return user;
}