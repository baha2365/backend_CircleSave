// ========== CONFIG ==========
const API_BASE = '/api/v1';

// ========== STATE ==========
let currentUser = null;
let accessToken  = localStorage.getItem('cs_access_token');
let refreshToken = localStorage.getItem('cs_refresh_token');

// ========== API CLIENT ==========
const api = {
  async req(method, path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(API_BASE + path, opts);
      const data = await r.json();
      if (r.status === 401 && auth) {
        const refreshed = await this.refreshTokens();
        if (refreshed) return this.req(method, path, body, auth);
        else { logout(); return null; }
      }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { success: false, error: { message: 'API unavailable — showing demo data' } } };
    }
  },
  async refreshTokens() {
    if (!refreshToken) return false;
    try {
      const r = await fetch(API_BASE + '/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      const d = await r.json();
      if (d.success) {
        accessToken  = d.data.accessToken;
        refreshToken = d.data.refreshToken;
        localStorage.setItem('cs_access_token',  accessToken);
        localStorage.setItem('cs_refresh_token', refreshToken);
        return true;
      }
    } catch (e) {}
    return false;
  },
  get:    (p)    => api.req('GET',    p),
  post:   (p, b) => api.req('POST',   p, b),
  patch:  (p, b) => api.req('PATCH',  p, b),
  delete: (p)    => api.req('DELETE', p),
};

// ========== DEMO DATA ==========
const DEMO = {
  user: { id: 'demo-1', email: 'alice@example.com', username: 'alice_saves', role: 'ORGANIZER', trustScore: 87, trustTier: 'GOOD', createdAt: '2025-01-15T08:00:00Z' },
  circles: [
    { id: 'c1', name: 'Family Savings', description: 'Monthly savings for family goals and emergencies', contributionAmount: 500, currency: 'USD', maxMembers: 8, currentMembers: 6, frequencyDays: 30, status: 'ACTIVE', inviteCode: 'inv-fam-001', currentRound: 4, totalRounds: 8, nextPaymentDate: '2026-06-01T00:00:00Z' },
    { id: 'c2', name: 'Work Colleagues Fund', description: 'Office savings group for quarterly celebrations', contributionAmount: 200, currency: 'USD', maxMembers: 10, currentMembers: 10, frequencyDays: 30, status: 'ACTIVE', inviteCode: 'inv-work-002', currentRound: 2, totalRounds: 10, nextPaymentDate: '2026-06-05T00:00:00Z' },
    { id: 'c3', name: 'Startup Group', description: 'Entrepreneurs savings circle for business capital', contributionAmount: 1000, currency: 'USD', maxMembers: 5, currentMembers: 3, frequencyDays: 60, status: 'PENDING', inviteCode: 'inv-start-003', currentRound: 0, totalRounds: 5, nextPaymentDate: null },
  ],
  payments: [
    { id: 'p1', circleId: 'c1', circleName: 'Family Savings',      amount: 500, currency: 'USD', status: 'COMPLETED', paymentMethod: 'BANK_TRANSFER', createdAt: '2026-05-01T09:00:00Z', isPartial: false },
    { id: 'p2', circleId: 'c2', circleName: 'Work Colleagues Fund', amount: 200, currency: 'USD', status: 'COMPLETED', paymentMethod: 'CARD',          createdAt: '2026-05-05T10:00:00Z', isPartial: false },
    { id: 'p3', circleId: 'c1', circleName: 'Family Savings',      amount: 250, currency: 'USD', status: 'PARTIAL',   paymentMethod: 'BANK_TRANSFER', createdAt: '2026-04-01T09:00:00Z', isPartial: true,  remainingAmount: 250 },
    { id: 'p4', circleId: 'c2', circleName: 'Work Colleagues Fund', amount: 200, currency: 'USD', status: 'COMPLETED', paymentMethod: 'CARD',          createdAt: '2026-04-05T10:00:00Z', isPartial: false },
  ],
  notifications: [
    { id: 'n1', read: false, createdAt: '2026-05-19T08:00:00Z', data: { title: 'Payment due tomorrow',  body: 'Your contribution for Family Savings is due tomorrow.' } },
    { id: 'n2', read: false, createdAt: '2026-05-18T14:00:00Z', data: { title: 'New member joined',     body: 'Bob Smith has joined Family Savings and is pending approval.' } },
    { id: 'n3', read: true,  createdAt: '2026-05-15T10:00:00Z', data: { title: 'Payout released',       body: 'Round 3 payout of $4,000 has been released to Carol.' } },
    { id: 'n4', read: true,  createdAt: '2026-05-10T09:00:00Z', data: { title: 'Circle activated',      body: 'Family Savings circle has been activated. Round 1 begins June 1st.' } },
  ],
  rotation: {
    circle: { id: 'c1', name: 'Family Savings', currentRound: 4, status: 'ACTIVE' },
    slots: [
      { round: 1, recipient: { id: 'm1', username: 'alice_saves' }, isPaid: true,  isCurrent: false },
      { round: 2, recipient: { id: 'm2', username: 'bob_smith'   }, isPaid: true,  isCurrent: false },
      { round: 3, recipient: { id: 'm3', username: 'carol_jones' }, isPaid: true,  isCurrent: false },
      { round: 4, recipient: { id: 'm4', username: 'dave_m'      }, isPaid: false, isCurrent: true  },
      { round: 5, recipient: { id: 'm5', username: 'ella_b'      }, isPaid: false, isCurrent: false },
      { round: 6, recipient: { id: 'm1', username: 'alice_saves' }, isPaid: false, isCurrent: false },
      { round: 7, recipient: { id: 'm6', username: 'frank_p'     }, isPaid: false, isCurrent: false },
      { round: 8, recipient: { id: 'm2', username: 'bob_smith'   }, isPaid: false, isCurrent: false },
    ]
  },
  members: [
    { id: 'm1', userId: 'demo-1', username: 'alice_saves',  email: 'alice@example.com', role: 'ORGANIZER', status: 'APPROVED', trustScore: 87,  joinedAt: '2025-01-15T00:00:00Z', rotationPosition: 1 },
    { id: 'm2', userId: 'u2',     username: 'bob_smith',    email: 'bob@example.com',   role: 'MEMBER',    status: 'APPROVED', trustScore: 92,  joinedAt: '2025-01-20T00:00:00Z', rotationPosition: 2 },
    { id: 'm3', userId: 'u3',     username: 'carol_jones',  email: 'carol@example.com', role: 'MEMBER',    status: 'APPROVED', trustScore: 78,  joinedAt: '2025-01-22T00:00:00Z', rotationPosition: 3 },
    { id: 'm4', userId: 'u4',     username: 'dave_m',       email: 'dave@example.com',  role: 'MEMBER',    status: 'APPROVED', trustScore: 95,  joinedAt: '2025-01-25T00:00:00Z', rotationPosition: 4 },
    { id: 'm5', userId: 'u5',     username: 'ella_b',       email: 'ella@example.com',  role: 'MEMBER',    status: 'APPROVED', trustScore: 65,  joinedAt: '2025-02-01T00:00:00Z', rotationPosition: 5 },
    { id: 'm6', userId: 'u6',     username: 'frank_p',      email: 'frank@example.com', role: 'MEMBER',    status: 'PENDING',  trustScore: 100, joinedAt: '2025-02-05T00:00:00Z', rotationPosition: null },
  ],
  circlePayments: [
    { id: 'cp1', userId: 'demo-1', username: 'alice_saves',  amount: 500, currency: 'USD', status: 'COMPLETED', round: 4, createdAt: '2026-05-01T09:00:00Z' },
    { id: 'cp2', userId: 'u2',     username: 'bob_smith',    amount: 500, currency: 'USD', status: 'COMPLETED', round: 4, createdAt: '2026-05-02T10:00:00Z' },
    { id: 'cp3', userId: 'u3',     username: 'carol_jones',  amount: 500, currency: 'USD', status: 'PARTIAL',   round: 4, createdAt: '2026-05-03T11:00:00Z', remainingAmount: 250 },
    { id: 'cp4', userId: 'u4',     username: 'dave_m',       amount: 500, currency: 'USD', status: 'COMPLETED', round: 4, createdAt: '2026-05-04T12:00:00Z' },
    { id: 'cp5', userId: 'u5',     username: 'ella_b',       amount: 500, currency: 'USD', status: 'PENDING',   round: 4, createdAt: null },
  ],
  ledger: [
    { id: 'l1', type: 'CONTRIBUTION', description: 'Contribution from alice_saves — Round 4', debitAmount: 500,  creditAmount: 500,  currency: 'USD', createdAt: '2026-05-01T09:00:00Z' },
    { id: 'l2', type: 'CONTRIBUTION', description: 'Contribution from bob_smith — Round 4',   debitAmount: 500,  creditAmount: 500,  currency: 'USD', createdAt: '2026-05-02T10:00:00Z' },
    { id: 'l3', type: 'PAYOUT',       description: 'Round 3 payout to carol_jones',           debitAmount: 3000, creditAmount: 3000, currency: 'USD', createdAt: '2026-04-30T16:00:00Z' },
    { id: 'l4', type: 'LATE_FEE',     description: 'Late fee from ella_b — Round 3',          debitAmount: 25,   creditAmount: 25,   currency: 'USD', createdAt: '2026-04-20T09:00:00Z' },
    { id: 'l5', type: 'PLATFORM_FEE', description: 'Platform fee — Round 3',                  debitAmount: 30,   creditAmount: 30,   currency: 'USD', createdAt: '2026-04-30T16:01:00Z' },
  ],
  trustHistory: [
    { id: 't1', eventType: 'PAYMENT_ON_TIME',  delta: 5,   scoreAfter: 87, circleId: 'c1', createdAt: '2026-05-01T09:00:00Z' },
    { id: 't2', eventType: 'PAYMENT_ON_TIME',  delta: 5,   scoreAfter: 82, circleId: 'c2', createdAt: '2026-04-05T10:00:00Z' },
    { id: 't3', eventType: 'PAYMENT_LATE',     delta: -8,  scoreAfter: 77, circleId: 'c1', createdAt: '2026-03-20T09:00:00Z' },
    { id: 't4', eventType: 'CIRCLE_COMPLETED', delta: 10,  scoreAfter: 85, circleId: null, createdAt: '2025-12-31T00:00:00Z' },
  ],
  adminStats: { totalUsers: 248, totalCircles: 41, activeCircles: 28, completedCircles: 11, totalPayments: 1847, totalRevenue: 284300, bannedUsers: 3 },
  adminUsers: [
    { id: 'u1', username: 'alice_saves', email: 'alice@example.com',      role: 'ORGANIZER', trustScore: 87,  createdAt: '2025-01-15T00:00:00Z' },
    { id: 'u2', username: 'bob_smith',   email: 'bob@example.com',        role: 'MEMBER',    trustScore: 92,  createdAt: '2025-01-20T00:00:00Z' },
    { id: 'u3', username: 'carol_jones', email: 'carol@example.com',      role: 'MEMBER',    trustScore: 78,  createdAt: '2025-01-22T00:00:00Z' },
    { id: 'u4', username: 'admin_user',  email: 'admin@circlesave.com',   role: 'ADMIN',     trustScore: 100, createdAt: '2024-12-01T00:00:00Z' },
  ],
};

// ========== AUTH HELPERS ==========
function saveTokens(access, refresh, user) {
  accessToken = access; refreshToken = refresh;
  localStorage.setItem('cs_access_token',  access);
  localStorage.setItem('cs_refresh_token', refresh);
  currentUser = user;
  localStorage.setItem('cs_user', JSON.stringify(user));
}

function logout() {
  if (accessToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
  accessToken = null; refreshToken = null; currentUser = null;
  localStorage.removeItem('cs_access_token');
  localStorage.removeItem('cs_refresh_token');
  localStorage.removeItem('cs_user');
  window.location.href = 'login.html';
}

function requireAuth() {
  const token  = localStorage.getItem('cs_access_token');
  const stored = localStorage.getItem('cs_user');
  if (!token || !stored) { window.location.href = 'login.html'; return null; }
  try {
    currentUser  = JSON.parse(stored);
    accessToken  = token;
    refreshToken = localStorage.getItem('cs_refresh_token');
    return currentUser;
  } catch (e) { window.location.href = 'login.html'; return null; }
}

// ========== SIDEBAR / NAV ==========
function updateSidebarUser(user) {
  if (!user) return;
  const initials = (user.username || user.email || '?').slice(0, 2).toUpperCase();
  const ava      = document.getElementById('sidebar-ava');
  const name     = document.getElementById('sidebar-name');
  const role     = document.getElementById('sidebar-role');
  const adminEl  = document.getElementById('nav-admin');
  if (ava)     ava.textContent  = initials;
  if (name)    name.textContent = user.username || user.email;
  if (role)    role.textContent = user.role;
  if (adminEl && (user.role === 'ADMIN')) adminEl.style.display = 'flex';
}

function initNav() {
  const page = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
  const sideMap = { dashboard: 'nav-dashboard', circles: 'nav-circles', 'circle-detail': 'nav-circles', payments: 'nav-payments', notifications: 'nav-notifications', profile: 'nav-profile', admin: 'nav-admin' };
  const bnavMap = { dashboard: 'bnav-dashboard', circles: 'bnav-circles', 'circle-detail': 'bnav-circles', payments: 'bnav-payments', profile: 'bnav-profile' };
  const sEl = document.getElementById(sideMap[page]);
  if (sEl) sEl.classList.add('active');
  const bEl = document.getElementById(bnavMap[page]);
  if (bEl) bEl.classList.add('active');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
async function handleLogout() { logout(); }

async function checkNotifBadge() {
  const hasUnread = DEMO.notifications.some(n => !n.read);
  const badge = document.getElementById('notif-badge');
  const dot   = document.getElementById('sidebar-notif-dot');
  if (badge) badge.style.display = hasUnread ? 'block' : 'none';
  if (dot)   dot.style.display   = hasUnread ? 'block' : 'none';
}

// ========== MODAL HELPERS ==========
function showModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function initModalOverlays() {
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });
}

// ========== SHARED PAYMENT MODAL ==========
let _userCircles = [];
function populatePaymentCircles(circles) {
  _userCircles = circles || [];
  const sel = document.getElementById('pay-circle-id');
  if (!sel) return;
  const list = (_userCircles.length ? _userCircles : DEMO.circles).filter(c => c.status === 'ACTIVE');
  sel.innerHTML = list.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}
async function handleSubmitPayment() {
  const circleId     = document.getElementById('pay-circle-id').value;
  const amount       = parseFloat(document.getElementById('pay-amount').value);
  const currency     = document.getElementById('pay-currency').value;
  const paymentMethod = document.getElementById('pay-method').value;
  const reference    = document.getElementById('pay-ref').value.trim();
  if (!circleId || !amount) { toast('Please fill all required fields', 'error'); return; }
  const res = await api.post('/payments', { circleId, amount, currency, paymentMethod, reference: reference || undefined });
  if (res && res.ok && res.data.success) {
    toast('Payment submitted!', 'success');
  } else {
    toast('Payment submitted (demo mode)', 'info');
  }
  closeModal('modal-payment');
}

// ========== UTILITIES ==========
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
function statusColor(s)  { return { ACTIVE: 'var(--green)', PENDING: 'var(--amber)', COMPLETED: 'var(--blue)', DISSOLVED: 'var(--red)' }[s] || 'var(--text3)'; }
function statusBadge(s)  { return { ACTIVE: 'green', PENDING: 'amber', COMPLETED: 'blue', DISSOLVED: 'red' }[s] || 'gray'; }
function roleBadge(r)    { return { ADMIN: 'red', ORGANIZER: 'accent', MEMBER: 'gray' }[r] || 'gray'; }
function tierBadge(t)    { return { EXCELLENT: 'green', GREAT: 'green', GOOD: 'amber', FAIR: 'amber', POOR: 'red' }[t] || 'gray'; }
function getTrustTier(score) {
  if (score >= 91) return 'EXCELLENT';
  if (score >= 81) return 'GREAT';
  if (score >= 61) return 'GOOD';
  if (score >= 41) return 'FAIR';
  return 'POOR';
}
function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => toast('Copied to clipboard!', 'success'))
    .catch(() => toast('Copy failed', 'error'));
}
function statCard(label, val, color, sub) {
  return `<div class="stat-card">
    <div style="width:36px;height:36px;background:${color}18;border-radius:var(--r8);display:flex;align-items:center;justify-content:center;margin-bottom:10px">
      <div style="width:12px;height:12px;border-radius:2px;background:${color}"></div>
    </div>
    <div class="stat-label">${label}</div>
    <div class="stat-val">${val}</div>
    <div class="stat-sub">${sub}</div>
  </div>`;
}
function paymentRow(p, showUser = false) {
  const statusColors = { COMPLETED: 'green', PENDING: 'amber', PARTIAL: 'blue', FAILED: 'red', REFUNDED: 'gray' };
  const iconBg    = { COMPLETED: 'var(--green-l)', PENDING: 'var(--amber-l)', PARTIAL: 'var(--blue-l)', FAILED: 'var(--red-l)', REFUNDED: 'var(--bg3)' };
  const iconColor = { COMPLETED: 'var(--green)',   PENDING: 'var(--amber)',   PARTIAL: 'var(--blue)',   FAILED: 'var(--red)',   REFUNDED: 'var(--text3)' };
  const icon      = { COMPLETED: '✓', PENDING: '⏳', PARTIAL: '½', FAILED: '✕', REFUNDED: '↩' };
  return `<div class="payment-row">
    <div class="payment-icon" style="background:${iconBg[p.status] || 'var(--bg3)'}">
      <span style="font-size:16px;color:${iconColor[p.status] || 'var(--text3)'}">${icon[p.status] || '?'}</span>
    </div>
    <div class="payment-info">
      <div class="payment-desc">${showUser ? (p.username || 'Member') : (p.circleName || 'Contribution')}</div>
      <div class="payment-date">${p.createdAt ? fmtDate(p.createdAt) : 'Pending'} · ${p.paymentMethod || ''} ${p.isPartial ? '· Partial' : ''}</div>
    </div>
    <div style="text-align:right">
      <div class="payment-amount" style="color:${iconColor[p.status] || 'var(--text)'}">
        ${p.currency || ''}${(p.amount || 0).toLocaleString()}
      </div>
      <div class="badge badge-${statusColors[p.status] || 'gray'}" style="font-size:11px;margin-top:4px">${p.status}</div>
    </div>
  </div>`;
}

// ========== TOAST ==========
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span style="font-size:16px">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}