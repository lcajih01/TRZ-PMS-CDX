import {
  ACCOUNT_TYPES,
  BOOKING_STATUSES,
  DEFAULT_SECURITY_DEPOSIT,
  bookingNightCount,
  calculateBasePrice,
  drinkCurrentStock,
  drinkProductMetrics,
  filterLedgerLines,
  financeSummary,
  money
} from "./core.js";
import {
  hasSupabaseConfig,
  insert,
  rpc,
  select,
  supabaseConfig,
  update,
  walletBalance
} from "./supabase.js";

const accessSessionKey = "trz-pms-access-unlocked";
const managerViewSessionKey = "trz-manager-view-unlocked";
const pmsAttemptsKey = "trz-pms-access-attempts";
const managerAttemptsKey = "trz-manager-security-attempts";

let state = emptyState();
let activeTab = sessionStorage.getItem("trz-active-tab") || "dashboard";
if (["guests", "wallets", "ledger", "deposits"].includes(activeTab)) activeTab = activeTab === "guests" ? "bookings" : "finance";
if (["packages", "security", "settings"].includes(activeTab)) activeTab = "settings";
let securityUnlocked = false;
let loading = true;
let checkoutSettlement = null;
let checkinPayment = null;
let createBookingContext = null;
let bookingActionContext = null;
let quickBookingContext = null;
let guestProfileContext = null;
let editBookingContext = null;
let cancelBookingContext = null;
let transactionContext = null;
let confirmBookingDeposit = null;
let adminCleanupPreview = null;
let bookingSearchQuery = "";
let financeFilters = {
  start_date: "",
  end_date: "",
  wallet_id: "",
  account_type: "",
  search: ""
};
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let autoRefreshTimer = null;
let stateFingerprint = "";
let postStaySendConfirmId = null;
let autoSending = false;
let guestMemoryDraft = null;

const AUTO_REFRESH_MS = 10000;
const AUTO_SEND_CHECK_MS = 60000;

const tabs = [
  ["dashboard", "Dashboard"],
  ["bookings", "Bookings"],
  ["finance", "Finance"],
  ["operations", "Operations"],
  ["audit", "Audit Logs"],
  ["settings", "Settings"]
];

init();
registerServiceWorker();

async function init() {
  if (!hasSupabaseConfig() || !isAccessUnlocked()) {
    loading = false;
    render();
    return;
  }
  await loadData();
  startAutoRefresh();
  startAutoSend();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("PWA service worker registration failed.", error);
    });
  });
}

async function loadData({ silent = false } = {}) {
  if (!silent) {
    loading = true;
    renderShell();
  }
  try {
    state = await fetchAppState();
    stateFingerprint = appStateFingerprint(state);
  } catch (error) {
    if (!silent) showMessage(error.message, "error");
    else console.warn("Auto-refresh failed.", error);
  } finally {
    loading = false;
    if (!silent) render();
  }
}

async function fetchAppState() {
  const [
    packages,
    package_versions,
    guests,
    bookings,
    wallets,
    ledger_entries,
    ledger_lines,
    security_deposits,
    expenses,
    daily_closings,
    drink_products,
    drink_inventory_movements,
    drink_sales,
    electricity_monthly_baselines,
    electricity_readings,
    owner_harvests,
    automation_queue,
    guest_memories,
    audit_logs
  ] = await Promise.all([
    select("packages", { order: "order=name.asc" }),
    select("package_versions", { order: "order=version_number.asc" }),
    select("guests", { order: "order=created_at.desc" }),
    select("bookings", { order: "order=start_at.desc" }),
    select("wallets", { order: "order=sort_order.asc" }),
    select("ledger_entries", { order: "order=created_at.desc" }),
    select("ledger_lines"),
    select("security_deposits"),
    safeSelect("expenses", { order: "order=expense_date.desc" }),
    safeSelect("daily_closings", { order: "order=created_at.desc" }),
    safeSelect("drink_products", { order: "order=name.asc" }),
    safeSelect("drink_inventory_movements", { order: "order=movement_date.desc" }),
    safeSelect("drink_sales", { order: "order=sale_date.desc" }),
    safeSelect("electricity_monthly_baselines", { order: "order=billing_period_month.desc" }),
    safeSelect("electricity_readings", { order: "order=reading_date.desc" }),
    safeSelect("owner_harvests", { order: "order=harvest_date.desc" }),
    safeSelect("automation_queue", { order: "order=created_at.desc" }),
    safeSelect("guest_memories", { order: "order=created_at.desc" }),
    select("audit_logs", { order: "order=created_at.desc" })
  ]);

  return {
    packages,
    package_versions,
    guests,
    bookings,
    wallets,
    ledger_entries,
    ledger_lines,
    security_deposits,
    expenses,
    daily_closings,
    drink_products,
    drink_inventory_movements,
    drink_sales,
    electricity_monthly_baselines,
    electricity_readings,
    owner_harvests,
    automation_queue,
    guest_memories,
    audit_logs
  };
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(refreshDataIfIdle, AUTO_REFRESH_MS);
  window.addEventListener("focus", refreshDataIfIdle);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshDataIfIdle();
  });
}

async function refreshDataIfIdle() {
  if (!hasSupabaseConfig() || !isAccessUnlocked() || loading || document.hidden || shouldSkipAutoRefresh()) return;
  let nextState;
  try {
    nextState = await fetchAppState();
  } catch (error) {
    console.warn("Auto-refresh failed.", error);
    return;
  }
  const nextFingerprint = appStateFingerprint(nextState);
  if (stateFingerprint === nextFingerprint) return;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  state = nextState;
  stateFingerprint = nextFingerprint;
  render();
  requestAnimationFrame(() => {
    window.scrollTo(scrollX, scrollY);
  });
}

function shouldSkipAutoRefresh() {
  if (document.querySelector(".modal-backdrop")) return true;
  const active = document.activeElement;
  return Boolean(active?.closest?.("form"));
}

function appStateFingerprint(source) {
  return JSON.stringify(Object.fromEntries(
    Object.keys(source).sort().map((key) => [
      key,
      Array.isArray(source[key])
        ? [...source[key]].sort((a, b) => String(a.id || a.booking_code || "").localeCompare(String(b.id || b.booking_code || "")))
        : source[key]
    ])
  ));
}

async function safeSelect(table, options) {
  try {
    return await select(table, options);
  } catch (error) {
    console.warn(`Optional table ${table} could not be loaded.`, error);
    return [];
  }
}

function emptyState() {
  return {
    packages: [],
    package_versions: [],
    guests: [],
    bookings: [],
    wallets: [],
    ledger_entries: [],
    ledger_lines: [],
    security_deposits: [],
    expenses: [],
    daily_closings: [],
    drink_products: [],
    drink_inventory_movements: [],
    drink_sales: [],
    electricity_monthly_baselines: [],
    electricity_readings: [],
    owner_harvests: [],
    automation_queue: [],
    guest_memories: [],
    audit_logs: []
  };
}

function render() {
  renderShell();
  if (loading) {
    document.getElementById("view").innerHTML = `<section class="panel loading-state"><div class="loading-spinner"></div><p>Loading resort records…</p></section>`;
    return;
  }
  if (!hasSupabaseConfig()) {
    document.getElementById("view").innerHTML = setupMissingView();
    return;
  }
  if (!isAccessUnlocked()) {
    document.getElementById("view").innerHTML = accessCodeView();
    bindAccessForms();
    return;
  }

  const view = document.getElementById("view");
  if (activeTab === "dashboard") view.innerHTML = dashboardView();
  if (activeTab === "bookings") view.innerHTML = bookingsView();
  if (activeTab === "finance") view.innerHTML = financeView();
  if (activeTab === "operations") view.innerHTML = operationsView();
  if (activeTab === "audit") view.innerHTML = auditView();
  if (activeTab === "settings") view.innerHTML = settingsView();
  if (quickBookingContext) view.innerHTML += quickBookingPopup(quickBookingContext);
  if (createBookingContext) view.innerHTML += createBookingModal(createBookingContext);
  if (bookingActionContext) view.innerHTML += bookingActionModal(bookingActionContext);
  if (guestProfileContext) view.innerHTML += guestProfileModal(guestProfileContext);
  if (editBookingContext) view.innerHTML += editBookingModal(editBookingContext);
  if (cancelBookingContext) view.innerHTML += cancelBookingModal(cancelBookingContext);
  if (transactionContext) view.innerHTML += transactionModal(transactionContext);
  if (confirmBookingDeposit) view.innerHTML += confirmBookingDepositModal(confirmBookingDeposit);
  if (checkinPayment) view.innerHTML += checkinPaymentModal(checkinPayment);
  if (checkoutSettlement) view.innerHTML += checkoutSettlementModal(checkoutSettlement);
  bindForms();
}

function renderShell() {
  document.body.dataset.activeTab = activeTab;
  document.body.classList.toggle("is-locked", !isAccessUnlocked());
  const badge = document.getElementById("userBadge");
  badge.innerHTML = isAccessUnlocked()
    ? `<span>${isManagerViewUnlocked() ? "Manager View" : "Staff View"}</span>
       ${isManagerViewUnlocked() ? "" : `<button class="primary" title="Unlock Manager View" data-action="unlock-manager-view" style="font-size:11px;min-height:28px;padding:4px 10px">Manager View</button>`}
       <button class="btn-close" data-action="lock" style="font-size:11px;min-height:28px;padding:4px 10px" title="Lock PMS">Lock</button>`
    : `<span>Locked</span>`;
  badge.querySelector("[data-action='unlock-manager-view']")?.addEventListener("click", unlockManagerView);
  badge.querySelector("[data-action='lock']")?.addEventListener("click", () => {
    sessionStorage.removeItem(accessSessionKey);
    sessionStorage.removeItem(managerViewSessionKey);
    securityUnlocked = false;
    createBookingContext = null;
    bookingActionContext = null;
    quickBookingContext = null;
    guestProfileContext = null;
    editBookingContext = null;
    cancelBookingContext = null;
    transactionContext = null;
    confirmBookingDeposit = null;
    adminCleanupPreview = null;
    checkinPayment = null;
    checkoutSettlement = null;
    activeTab = "dashboard";
    render();
  });
  renderTabs();
}

function renderTabs() {
  const tabsEl = document.getElementById("tabs");
  if (!isAccessUnlocked()) {
    tabsEl.innerHTML = "";
    return;
  }
  tabsEl.innerHTML = tabs
    .map(([id, label]) => `<button class="${id === activeTab ? "active" : ""}" data-tab="${id}"><span class="nav-icon">${navIcon(id)}</span><span>${label}</span></button>`)
    .join("");
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      sessionStorage.setItem("trz-active-tab", activeTab);
      render();
    });
  });
}

function navIcon(id) {
  const icons = {
    dashboard: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
    bookings:  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><line x1="6" y1="6" x2="10" y2="6"/><line x1="6" y1="9" x2="10" y2="9"/></svg>`,
    finance:   `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v1.5m0 3V11m-1.5-4.5h2.25a1.25 1.25 0 0 1 0 2.5H7.5a1.25 1.25 0 0 0 0 2.5H10"/></svg>`,
    operations:`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M3.22 3.22l1.42 1.42m6.72 6.72 1.42 1.42M3.22 12.78l1.42-1.42m6.72-6.72 1.42-1.42"/></svg>`,
    audit:     `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M2 8h8M2 12h5"/></svg>`,
    settings:  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M13.3 7.3a1.2 1.2 0 0 0 .24-1.33l-.8-1.38a1.2 1.2 0 0 0-1.3-.56l-1.01.24a4.6 4.6 0 0 0-.78-.45L9.4 2.78A1.2 1.2 0 0 0 8.2 2h-1.6a1.2 1.2 0 0 0-1.18 1l-.15 1.02c-.28.13-.54.28-.78.45L3.47 4.23a1.2 1.2 0 0 0-1.3.56l-.8 1.38a1.2 1.2 0 0 0 .25 1.54l.8.67v.24l-.8.67a1.2 1.2 0 0 0-.25 1.54l.8 1.38c.27.46.8.68 1.3.56l1.01-.24c.24.17.5.32.78.45l.16 1.02c.14.58.66 1 1.26 1h1.6a1.2 1.2 0 0 0 1.18-1l.15-1.02c.28-.13.54-.28.78-.45l1.01.24c.5.12 1.03-.1 1.3-.56l.8-1.38a1.2 1.2 0 0 0-.24-1.54l-.8-.67v-.24l.8-.67Z"/></svg>`
  };
  return icons[id] || "";
}

function setupMissingView() {
  return `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">
          <div class="login-logo-badge">TRZ</div>
          <h1>Supabase Setup Required</h1>
          <p>Add credentials to connect to the database</p>
        </div>
        <div class="panel">
          <p class="muted" style="margin:0 0 14px">Business records are not stored locally. Add your Supabase credentials to the <code style="color:var(--accent);font-size:12px">.env</code> file:</p>
          <pre>VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=</pre>
          <p class="muted" style="font-size:12px;margin:12px 0 0">Restart the server after updating the file.</p>
        </div>
        <p class="login-footer">TRZ PMS &middot; ${new Date().getFullYear()}</p>
      </div>
    </div>`;
}

function accessCodeView() {
  const lock = getAttemptLock(pmsAttemptsKey);
  return `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">
          <div class="login-logo-badge">TRZ</div>
          <h1>The Resthouse Zamboanga</h1>
          <p>Property Management System</p>
        </div>
        <div class="panel">
          ${lock.locked ? `<p class="message">Too many wrong attempts. Try again in ${lock.minutes} minute(s).</p>` : ""}
          <form data-action="unlock" class="login-form">
            <label class="field">
              <span>Access Code</span>
              <input name="access_code" type="password" inputmode="numeric"
                placeholder="Enter your access code" autocomplete="current-password"
                required ${lock.locked ? "disabled" : ""} />
            </label>
            <div class="actions" style="margin-top:16px">
              <button class="primary" style="width:100%;justify-content:center;min-height:42px;font-size:14px" ${lock.locked ? "disabled" : ""}>Enter PMS</button>
            </div>
          </form>
        </div>
        <p class="login-footer">TRZ PMS &middot; ${new Date().getFullYear()}</p>
      </div>
    </div>`;
}

function dashboardView() {
  const activeBookings = state.bookings.filter((booking) => !["Cancelled", "Refunded", "Archived"].includes(booking.status));
  const today = new Date();
  const todayArrivals = activeBookings.filter((booking) => sameLocalDate(new Date(booking.start_at), today));
  const todayDepartures = activeBookings.filter((booking) => sameLocalDate(new Date(booking.end_at), today) && !sameLocalDate(new Date(booking.start_at), today));
  const inHouse = activeBookings.filter((booking) => booking.status === "Checked In");
  const upcoming = dashboardUpcomingArrivals();
  const activity = dashboardRecentActivity();

  let todayHeadline;
  if (inHouse.length > 0) {
    todayHeadline = `${guestNameText(inHouse[0].guest_id)} is currently in-house`;
  } else if (todayArrivals.length > 0) {
    todayHeadline = `${guestNameText(todayArrivals[0].guest_id)} arrives today &mdash; ${todayArrivals[0].booking_code}`;
  } else if (upcoming.length > 0) {
    const daysUntil = Math.max(0, Math.ceil((new Date(upcoming[0].start_at) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000));
    todayHeadline = daysUntil === 0
      ? `${guestNameText(upcoming[0].guest_id)} arrives today`
      : `Next arrival in ${daysUntil} day${daysUntil === 1 ? "" : "s"} &mdash; ${escapeHtml(guestNameText(upcoming[0].guest_id))}`;
  } else {
    todayHeadline = "The resort is available &mdash; no upcoming bookings";
  }

  return `
    <section class="dashboard-page">
      <div class="dashboard-heading">
        <div>
          <p class="eyebrow">The Resthouse Zamboanga</p>
          <h1>Dashboard</h1>
        </div>
        <span class="date-pill">${today.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>

      <div class="today-banner${inHouse.length > 0 ? " today-banner--occupied" : ""}">
        <div class="today-banner-content">
          <p class="today-banner-eyebrow">${inHouse.length > 0 ? "Resort Occupied" : "Today at TRZ"}</p>
          <p class="today-banner-headline">${today.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })} &mdash; ${todayHeadline}</p>
        </div>
        <div class="today-stat-row">
          <div class="today-stat"><span>Arrivals Today</span><strong>${todayArrivals.length}</strong></div>
          <div class="today-stat"><span>Departures</span><strong>${todayDepartures.length}</strong></div>
          <div class="today-stat"><span>Active Holds</span><strong>${activeBookings.length}</strong></div>
        </div>
      </div>

      <div class="dashboard-kpis">
        <article class="dashboard-kpi"><span>Resort Status</span><strong style="font-size:22px">${inHouse.length > 0 ? "Occupied" : "Available"}</strong><em>${inHouse.length > 0 ? `${guestNameText(inHouse[0].guest_id)} is in-house` : "No active check-ins"}</em></article>
        <article class="dashboard-kpi"><span>Active Calendar Holds</span><strong>${activeBookings.length}</strong><em>Whole-resort reservations</em></article>
        <article class="dashboard-kpi"><span>Total Bookings</span><strong>${state.bookings.length}</strong><em>All-time records</em></article>
        <article class="dashboard-kpi"><span>Upcoming Arrivals</span><strong>${upcoming.length}</strong><em>Next active check-ins</em></article>
      </div>

      <div class="dashboard-content-grid">
        <section class="dashboard-card dashboard-calendar-card">
          ${calendarView()}
        </section>
        <div class="dashboard-side-stack">
          <section class="dashboard-card">
            <h2>Upcoming Arrivals</h2>
            <div class="dashboard-list">
              ${upcoming.map((booking) => {
                const sc = bookingStatusClass(booking.status);
                return `
                  <article class="dashboard-list-row">
                    <span>${formatDate(booking.start_at)}</span>
                    <div>
                      <strong>${guestNameText(booking.guest_id)}</strong>
                      <em>${booking.booking_code} &mdash; ${packageNameForBooking(booking)}</em>
                    </div>
                    <mark class="${sc ? `pill-${sc}` : ""}">${booking.status}</mark>
                  </article>`;
              }).join("") || `<p class="muted" style="padding:12px 0;font-size:13px">No upcoming arrivals.</p>`}
            </div>
          </section>
          <section class="dashboard-card">
            <h2>Recent Activity</h2>
            <div class="dashboard-list">
              ${activity.map((item) => `
                <article class="dashboard-list-row">
                  <span>${formatDate(item.at)}</span>
                  <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <em>${escapeHtml(item.detail || "")}</em>
                  </div>
                  <mark>${escapeHtml(item.type)}</mark>
                </article>`).join("") || `<p class="muted" style="padding:12px 0;font-size:13px">No recent activity.</p>`}
            </div>
          </section>
        </div>
      </div>
    </section>`;
}

function dashboardUpcomingArrivals() {
  const now = new Date();
  return state.bookings
    .filter((booking) => !["Cancelled", "Refunded", "Archived", "Completed"].includes(booking.status))
    .filter((booking) => new Date(booking.start_at) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 5);
}

function dashboardRecentActivity() {
  const auditItems = state.audit_logs.map((log) => ({
    at: log.created_at,
    title: `${log.entity_type} ${log.action}`,
    detail: log.reason || "",
    type: "Audit"
  }));
  const ledgerItems = state.ledger_entries.slice(0, 8).map((entry) => ({
    at: entry.created_at || entry.entry_date,
    title: entry.description || "Transaction recorded",
    detail: bookingCode(ledgerBookingId(entry)),
    type: "Money"
  }));
  return [...auditItems, ...ledgerItems]
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 5);
}

function calendarView() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const blanks = Array.from({ length: first.getDay() }, () => null);
  const days = Array.from({ length: last.getDate() }, (_, index) => new Date(year, month, index + 1));
  const cells = [...blanks, ...days];

  return `
    <div class="calendar-header">
      <h2>${first.toLocaleString([], { month: "long", year: "numeric" })}</h2>
      <div class="calendar-nav">
        <button type="button" data-calendar-nav="prev">← Prev</button>
        <button type="button" data-calendar-nav="today">Today</button>
        <button type="button" data-calendar-nav="next">Next →</button>
      </div>
      <div class="calendar-legend">
        <span><i class="ld-available"></i>Available</span>
        <span><i class="ld-pending"></i>Pending</span>
        <span><i class="ld-hold"></i>Confirmed</span>
        <span><i class="ld-occupied"></i>Checked In</span>
        <span><i class="ld-history"></i>Completed</span>
      </div>
    </div>
    <div class="calendar-grid calendar-weekdays">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div>${day}</div>`).join("")}
    </div>
    <div class="calendar-grid">
      ${cells.map((day) => (day ? calendarDay(day) : `<div class="calendar-day blank"></div>`)).join("")}
    </div>`;
}

// Maps booking status to a CSS modifier class for full-cell background tinting.
function calDayStatusClass(status) {
  if (!status) return "";
  if (status === "Checked In") return "cal-day--active";
  if (status === "Confirmed" || status === "Deposit Received") return "cal-day--confirmed";
  if (status === "Deposit Requested" || status === "Tentative" || status === "Inquiry") return "cal-day--pending";
  if (status === "Completed" || status === "Checked Out") return "cal-day--completed";
  return "";
}

function calendarDay(day) {
  // Only show a booking on its start date — end/checkout dates render as Available.
  const segments = calendarSegmentsForDay(day).filter(
    (s) => sameLocalDate(new Date(s.booking.start_at), day)
  );
  const isToday = sameLocalDate(day, new Date());
  const todayClass = isToday ? " today" : "";
  const dateStr = dateInputValue(day);
  const num = day.getDate();
  const primarySeg = segments[0] || null;

  if (!primarySeg) {
    return `
    <button type="button" class="calendar-day${todayClass}" data-open-date="${dateStr}" aria-label="${num} Available">
      <strong>${num}</strong>
      <span>Available</span>
    </button>`;
  }

  const booking = primarySeg.booking;
  const statusClass = calDayStatusClass(booking.status);
  const guestName = guestNameText(booking.guest_id);
  const ref = shortBookingCode(booking.booking_code);
  const statusLabel = shortCalendarStatus(booking.status);
  const fullLabel = `${guestName} · ${booking.booking_code} · ${booking.status}`;

  return `
    <button type="button" class="calendar-day${statusClass ? ` ${statusClass}` : ""}${todayClass}" data-open-booking="${booking.id}" title="${escapeHtml(fullLabel)}" aria-label="${escapeHtml(`${num} ${fullLabel}`)}">
      <strong>${num}</strong>
      <span>${escapeHtml(guestName)}</span>
      <span>${escapeHtml(ref)} · ${escapeHtml(statusLabel)}</span>
    </button>`;
}

function shortBookingCode(code) {
  return String(code || "").replace(/^TRZ-\d{4}-/, "#");
}

function shortCalendarStatus(label) {
  const labels = {
    "Deposit Requested": "Dep. Req.",
    "Deposit Received": "Dep. Rec.",
    "Confirmed Check-In": "Conf. In",
    "Confirmed Check-Out": "Conf. Out",
    "Deposit Received Check-In": "Dep. In",
    "Deposit Received Check-Out": "Dep. Out",
    "Deposit Requested Check-In": "Req. In",
    "Deposit Requested Check-Out": "Req. Out",
    "Tentative Check-In": "Tent. In",
    "Tentative Check-Out": "Tent. Out"
  };
  return labels[label] || label;
}

function calendarSegmentsForDay(day) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0);
  const segments = state.bookings.filter((booking) => {
    if (["Cancelled", "Archived", "Refunded"].includes(booking.status)) return false;
    return new Date(booking.start_at) < dayEnd && new Date(booking.end_at) > dayStart;
  }).map((booking) => {
    const start = new Date(booking.start_at);
    const end = new Date(booking.end_at);
    const startsToday = sameLocalDate(start, day);
    const endsToday = sameLocalDate(end, day);
    let kind = "reserved";
    let label = booking.status;
    const futureHoldStatus = ["Inquiry", "Tentative", "Deposit Requested", "Deposit Received", "Confirmed"].includes(booking.status);
    const occupiedStatus = ["Checked In", "Checked Out"].includes(booking.status);
    if (booking.status === "Completed") {
      kind = "completed";
      label = "Completed";
    } else if (startsToday && endsToday) {
      kind = occupiedStatus ? "occupied" : calendarHoldKind(booking.status);
      label = booking.status;
    } else if (startsToday) {
      kind = occupiedStatus ? "checkin" : `${calendarHoldKind(booking.status)}-checkin`;
      label = occupiedStatus ? "Check-In" : `${booking.status} Check-In`;
    } else if (endsToday) {
      kind = "checkout";
      label = `${booking.status} Check-Out`;
    } else if (occupiedStatus) {
      kind = "occupied";
      label = "Occupied";
    } else if (futureHoldStatus) {
      kind = calendarHoldKind(booking.status);
      label = booking.status;
    }
    return { booking, kind, label };
  });
  const activeSegments = segments.filter((segment) => segment.booking.status !== "Completed");
  return activeSegments.length ? activeSegments : segments;
}

function calendarHoldKind(status) {
  if (status === "Confirmed" || status === "Deposit Received") return "confirmed-hold";
  if (status === "Deposit Requested" || status === "Tentative" || status === "Inquiry") return "pending";
  return "reserved";
}


function packagesView() {
  return `
    <div class="grid two">
      <section class="panel">
        <h2>Current Packages</h2>
        <table>
          <thead><tr><th>Name</th><th>Version</th><th>Price</th><th>Pax</th><th>Rooms</th><th>Time</th></tr></thead>
          <tbody>${state.packages.map(packageRow).join("") || emptyRow(6)}</tbody>
        </table>
      </section>
      <section class="panel">
        <h2>Create New Version</h2>
        ${packageForm()}
      </section>
    </div>`;
}

function packageForm() {
  return `
    <form data-action="package">
      <label class="field"><span>Package</span><select name="package_id">${state.packages.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select></label>
      <div class="grid two">
        <label class="field"><span>Price</span><input name="price" type="number" min="0" required /></label>
        <label class="field"><span>Included pax</span><input name="included_pax" type="number" min="1" required /></label>
        <label class="field"><span>Included rooms</span><input name="included_rooms" type="number" min="0" required /></label>
        <label class="field"><span>Breakfast</span><select name="has_breakfast"><option value="false">No</option><option value="true">Yes</option></select></label>
        <label class="field"><span>Start time</span><input name="start_time" type="time" required /></label>
        <label class="field"><span>End time</span><input name="end_time" type="time" required /></label>
        <label class="field"><span>Overnight</span><select name="is_overnight"><option value="false">No</option><option value="true">Yes</option></select></label>
      </div>
      <div class="actions"><button class="primary">Save Version</button></div>
    </form>`;
}

function guestDirectorySection() {
  const guests = filteredGuests();
  return `
    <section class="panel">
      <h2>Guest Directory</h2>
      <p class="muted">Guest creation is part of New Booking. This directory is for quick lookup.</p>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Alternate</th><th>Email</th></tr></thead>
        <tbody>${guests.map((guest) => `<tr><td>${guestLink(guest)}</td><td>${escapeHtml(guest.phone)}</td><td>${escapeHtml(guest.alternate_contact_number || "")}</td><td>${escapeHtml(guest.email || "")}</td></tr>`).join("") || emptyRow(4)}</tbody>
      </table>
    </section>`;
}

function bookingsView() {
  const activeCount = state.bookings.filter((b) => !["Archived"].includes(b.status)).length;
  return `
    <div class="page-stack">
      <div class="page-header">
        <div>
          <p class="eyebrow">Reservation Management</p>
          <h1 class="page-title">Bookings</h1>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="muted" style="font-size:13px">${activeCount} active</span>
          <button type="button" class="primary" data-action="new-booking" style="font-size:13px">+ New Booking</button>
        </div>
      </div>
      <section class="panel">
        <h2>Monthly Booking List</h2>
        ${bookingSearchControl()}
        ${monthlyBookingList()}
      </section>
      ${guestDirectorySection()}
    </div>`;
}

function monthlyBookingList() {
  const bookings = filteredBookings();
  if (!bookings.length) return `<div class="empty-state"><strong>No bookings found</strong>${bookingSearchQuery ? "Try a different search term." : "Create the first booking with the New Booking button above."}</div>`;
  const groups = {};
  [...bookings]
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .forEach((booking) => {
      const key = new Date(booking.start_at).toLocaleString([], { month: "long", year: "numeric" });
      groups[key] ||= [];
      groups[key].push(booking);
    });
  return Object.entries(groups)
    .map(([month, bookings]) => `
      <section class="booking-month">
        <h3>${month}</h3>
        <div class="booking-list">${bookings.map(bookingCard).join("")}</div>
      </section>`)
    .join("");
}

function bookingStatusClass(status) {
  const map = {
    "Inquiry": "inquiry",
    "Tentative": "tentative",
    "Deposit Requested": "deposit-requested",
    "Deposit Received": "deposit-received",
    "Confirmed": "confirmed",
    "Checked In": "checked-in",
    "Checked Out": "checked-out",
    "Completed": "completed",
    "Cancelled": "cancelled",
    "Refunded": "refunded",
    "Archived": "archived"
  };
  return map[status] || "";
}

function bookingCard(booking) {
  const balanceDue = packageBalanceDue(booking);
  const depositDue = depositBalanceDue(booking);
  const sc = bookingStatusClass(booking.status);
  const gName = guestNameText(booking.guest_id);
  const initial = gName.charAt(0).toUpperCase();
  return `
    <button type="button" class="booking-card${sc ? ` s-${sc}` : ""}" data-open-booking="${booking.id}">
      <div class="booking-card-header">
        <div class="booking-card-header-left">
          <div class="guest-avatar guest-avatar--sm">${initial}</div>
          <div>
            <strong>${booking.booking_code}</strong>
            <span>${escapeHtml(gName)}</span>
          </div>
        </div>
        <span class="pill${sc ? ` pill-${sc}` : ""}">${booking.status}</span>
      </div>
      <div class="booking-card-grid">
        <div><span>Dates</span><strong>${formatRange(booking)}</strong></div>
        <div><span>Package</span><strong>${packageNameForBooking(booking)}</strong></div>
        <div><span>Package Price</span><strong>${money(booking.base_price)}</strong></div>
        <div><span>Pax</span><strong>${booking.pax_count}</strong></div>
        <div class="${balanceDue > 0 ? "card-field--due" : ""}"><span>Balance Due</span><strong>${money(balanceDue)}</strong></div>
        <div class="${depositDue > 0 ? "card-field--due" : ""}"><span>Deposit Balance</span><strong>${depositDue > 0 ? `${money(depositDue)} outstanding` : "Settled"}</strong></div>
      </div>
    </button>`;
}

function bookingSearchControl() {
  return `
    <form class="search-bar" data-booking-search-form>
      <label class="field"><span>Search</span><input name="query" value="${escapeHtml(bookingSearchQuery)}" placeholder="Guest name, phone, or booking code" /></label>
      <div class="actions">
        <button class="primary">Search</button>
        <button type="button" data-action="clear-booking-search">Clear</button>
      </div>
    </form>`;
}

function bookingForm(options = {}) {
  const checkinValue = options.checkin_date || "";
  const p = options.prefill || {};
  return `
    <form data-action="booking" data-booking-date-form>
      <label class="field"><span>Select existing guest</span><select name="guest_id"><option value="">Create new guest below</option>${state.guests.map((guest) => `<option value="${guest.id}">${escapeHtml(guest.full_name)} - ${escapeHtml(guest.phone)}</option>`).join("")}</select></label>
      <div class="subsection">
        <h3>Or Create New Guest</h3>
        <div class="grid two">
          <label class="field"><span>Full name</span><input name="new_guest_name" value="${escapeHtml(p.guest_name || "")}" /></label>
          <label class="field"><span>Phone</span><input name="new_guest_phone" value="${escapeHtml(p.guest_phone || "")}" /></label>
          <label class="field"><span>Alternate contact number</span><input name="new_guest_alternate" /></label>
          <label class="field"><span>Email</span><input name="new_guest_email" type="email" /></label>
        </div>
      </div>
      <label class="field"><span>Package</span><select name="package_version_id" data-booking-package required>${state.packages.map((pkg) => {
        const version = latestPackageVersion(pkg.id);
        if (!version) return "";
        const selected = p.package_version_id === version.id ? " selected" : "";
        return `<option value="${version.id}"${selected}>${escapeHtml(pkg.name)} v${version.version_number} - ${money(version.price)}</option>`;
      }).join("")}</select></label>
      <div class="grid two">
        <label class="field"><span>Check-in date</span><input name="checkin_date" type="date" value="${checkinValue}" required /></label>
        <label class="field" data-checkout-field><span>Check-out date</span><input name="checkout_date" type="date" /></label>
        <label class="field"><span>Pax</span><input name="pax_count" type="number" min="1" required /></label>
        <label class="field"><span>Security deposit</span><input name="security_deposit_amount" type="number" min="0" value="${DEFAULT_SECURITY_DEPOSIT}" required /></label>
      </div>
      <p class="muted" data-booking-time-summary></p>
      <p class="message" data-booking-price-summary>Choose package and dates to calculate price.</p>
      <label class="field"><span>Status</span><select name="status">${BOOKING_STATUSES.map((status) => `<option>${status}</option>`).join("")}</select></label>
      <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
      <div class="subsection">
        <h3>Optional Payments</h3>
        <label class="check-field"><input name="deposit_received" type="checkbox" /> Security deposit received?</label>
        <div class="grid two">
          <label class="field"><span>Deposit amount</span><input name="deposit_amount" type="number" min="0" value="${DEFAULT_SECURITY_DEPOSIT}" /></label>
          <label class="field"><span>Deposit wallet</span><select name="deposit_wallet_id">${walletOptions()}</select></label>
        </div>
        <label class="check-field"><input name="package_payment_received" type="checkbox" /> Package payment received?</label>
        <div class="grid two">
          <label class="field"><span>Package payment amount</span><input name="package_payment_amount" type="number" min="0" /></label>
          <label class="field"><span>Package payment wallet</span><select name="package_payment_wallet_id">${walletOptions()}</select></label>
        </div>
      </div>
      <div class="actions"><button class="primary">Create Booking</button></div>
    </form>`;
}

function walletsView() {
  const rows = [...state.wallets]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((wallet) => `<tr><td>${wallet.sort_order}</td><td>${escapeHtml(wallet.name)}</td><td>${wallet.is_active ? "Active" : "Inactive"}</td>${isManagerViewUnlocked() ? `<td>${money(walletBalance(state, wallet.id))}</td>` : ""}</tr>`)
    .join("");
  return `
    <div class="grid two">
      <section class="panel">
        <h2>Wallets</h2>
        ${!isManagerViewUnlocked() ? `<p class="muted">Wallet balances and wallet setup are available in Manager View.</p>` : ""}
        <table><thead><tr><th>Order</th><th>Name</th><th>Status</th>${isManagerViewUnlocked() ? "<th>Balance</th>" : ""}</tr></thead><tbody>${rows || emptyRow(isManagerViewUnlocked() ? 4 : 3)}</tbody></table>
      </section>
      ${isManagerViewUnlocked() ? `<section class="panel">
        <h2>Add Wallet</h2>
        <form data-action="wallet">
          <label class="field"><span>Name</span><input name="name" required /></label>
          <label class="field"><span>Sort order</span><input name="sort_order" type="number" value="100" required /></label>
          <div class="actions"><button class="primary">Add Wallet</button></div>
        </form>
      </section>` : ""}
    </div>`;
}

function ledgerView() {
  const rows = filterLedgerLines(state, financeFilters).slice(0, 10);
  const showSensitive = isManagerViewUnlocked();
  return `
    <div class="grid">
      <section class="panel">
        <h2>Transactions</h2>
        ${financeFilterForm()}
        <p class="muted">Showing latest 10 matching transactions.</p>
        <div class="scroll-table ten-rows">
          <table>
            <thead><tr><th>Date</th><th>Booking</th><th>Wallet</th><th>Type</th><th>Amount</th><th>Reference</th>${showSensitive ? "<th>Action</th>" : ""}</tr></thead>
            <tbody>${rows.map(({ line, entry }) => {
              const canReverse = entry?.status === "posted" && !entry?.reversed_at;
              return `<tr><td>${entry?.entry_date || ""}</td><td>${bookingCode(ledgerBookingId(entry))}</td><td>${walletName(line.wallet_id)}</td><td><span class="pill type-badge">${escapeHtml(line.account_type)}</span></td><td>${money(line.amount)}</td><td>${escapeHtml(entry?.reference_number || "")}</td>${showSensitive ? `<td>${canReverse ? `<button type="button" data-reverse-entry="${entry.id}">Void/Reversal</button>` : `<span class="pill">Reversed</span>`}</td>` : ""}</tr>`;
            }).join("") || emptyRow(showSensitive ? 7 : 6)}</tbody>
          </table>
        </div>
      </section>
    </div>`;
}

function financeFilterForm() {
  return `
    <form data-action="finance-filters" class="finance-filter-form">
      <label class="field"><span>Start date</span><input name="start_date" type="date" value="${escapeHtml(financeFilters.start_date)}" /></label>
      <label class="field"><span>End date</span><input name="end_date" type="date" value="${escapeHtml(financeFilters.end_date)}" /></label>
      <label class="field"><span>Wallet</span><select name="wallet_id"><option value="">All wallets</option>${state.wallets.map((wallet) => `<option value="${wallet.id}" ${financeFilters.wallet_id === wallet.id ? "selected" : ""}>${escapeHtml(wallet.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Account type</span><select name="account_type"><option value="">All types</option>${ACCOUNT_TYPES.map((type) => `<option value="${type}" ${financeFilters.account_type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
      <label class="field"><span>Booking code / guest</span><input name="search" value="${escapeHtml(financeFilters.search)}" /></label>
      <div class="actions">
        <button class="primary">Apply Filters</button>
        <button type="button" data-action="clear-finance-filters">Clear</button>
      </div>
    </form>`;
}

function ledgerForm() {
  return `
    <form data-action="ledger">
      <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
      <label class="field"><span>Booking</span><select name="booking_id">${state.bookings.map((booking) => `<option value="${booking.id}">${booking.booking_code} - ${guestName(booking.guest_id)}</option>`).join("")}</select></label>
      <label class="field"><span>Wallet</span><select name="wallet_id">${state.wallets.filter((wallet) => wallet.is_active).sort((a, b) => a.sort_order - b.sort_order).map((wallet) => `<option value="${wallet.id}">${escapeHtml(wallet.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Account type</span><select name="account_type">${ACCOUNT_TYPES.map((type) => `<option ${["Transfer", "Expense"].includes(type) ? "disabled" : ""}>${type}</option>`).join("")}</select></label>
      <label class="field"><span>Amount</span><input name="amount" type="number" required /></label>
      <label class="field"><span>Reference number</span><input name="reference_number" /></label>
      <label class="field"><span>Proof note</span><input name="proof_note" /></label>
      <label class="field"><span>Description</span><input name="description" /></label>
      <div class="actions"><button class="primary">Record</button></div>
    </form>`;
}

function expensesView() {
  const categories = ["Groceries", "Cleaning Supplies", "Repairs & Maintenance", "Pool Chemicals", "Fuel", "Staff Meal", "Transportation", "Utilities", "Miscellaneous"];
  return `
    <section class="panel">
        <h2>Record Expense</h2>
        <form data-action="expense" class="grid two">
          <label class="field"><span>Date</span><input name="expense_date" type="date" value="${todayInputValue()}" required /></label>
          <label class="field"><span>Category</span><select name="category">${categories.map((category) => `<option>${category}</option>`).join("")}</select></label>
          <label class="field"><span>Description</span><input name="description" required /></label>
          <label class="field"><span>Vendor/Payee</span><input name="vendor_payee" /></label>
          <label class="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label class="field"><span>Wallet used</span><select name="wallet_id">${walletOptions()}</select></label>
          <label class="field"><span>Booking link</span><select name="booking_id"><option value="">None</option>${state.bookings.map((booking) => `<option value="${booking.id}">${booking.booking_code} - ${guestName(booking.guest_id)}</option>`).join("")}</select></label>
          <label class="field"><span>Reference number</span><input name="reference_number" /></label>
          <label class="field"><span>Proof note</span><input name="proof_note" /></label>
          <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
          <div class="actions"><button class="primary">Record Expense</button></div>
        </form>
        <div class="subsection">
          <h3>Expense List</h3>
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Wallet</th><th>Amount</th></tr></thead>
            <tbody>${state.expenses.map((expense) => `<tr><td>${expense.expense_date}</td><td>${escapeHtml(expense.category)}</td><td>${escapeHtml(expense.description)}</td><td>${walletName(expense.wallet_id)}</td><td>${money(expense.amount)}</td></tr>`).join("") || emptyRow(5)}</tbody>
          </table>
        </div>
    </section>`;
}

function transfersView() {
  return `
    <section class="panel">
      <h2>Transfers</h2>
      <form data-action="transfer" class="grid two">
        <label class="field"><span>Date</span><input name="transfer_date" type="date" value="${todayInputValue()}" required /></label>
        <label class="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label class="field"><span>Source wallet</span><select name="source_wallet_id">${walletOptions()}</select></label>
        <label class="field"><span>Destination wallet</span><select name="destination_wallet_id">${walletOptions()}</select></label>
        <label class="field"><span>Reference / notes</span><input name="reference_number" /></label>
        <label class="field"><span>Proof note</span><input name="proof_note" /></label>
        <label class="field"><span>Description</span><input name="description" value="Wallet transfer" /></label>
        <div class="actions"><button class="primary">Record Transfer</button></div>
      </form>
    </section>`;
}

function ownerHarvestView() {
  const totals = ownerHarvestTotals();
  const harvestTypes = ["Owner Draw", "Business Reserve", "Debt Payment", "Personal Expense", "Bank Deposit", "Other"];
  return `
    <section class="panel">
      <h2>Owner Harvest</h2>
      <p class="muted">Owner harvest reduces a wallet but is not revenue and not an expense.</p>
      <div class="wallet-summary-grid">
        <article class="wallet-summary-card"><span>This Month</span><strong>${money(totals.thisMonth)}</strong><em>Total harvested this month</em></article>
        <article class="wallet-summary-card"><span>All Time</span><strong>${money(totals.allTime)}</strong><em>Total owner harvest</em></article>
      </div>
      <div class="grid two" style="margin-top:12px">
        <form data-action="owner-harvest">
          <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
          <label class="field"><span>Harvest date</span><input name="harvest_date" type="date" value="${todayInputValue()}" required /></label>
          <label class="field"><span>Source wallet</span><select name="source_wallet_id" required>${walletOptions()}</select></label>
          <label class="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label class="field"><span>Harvest type</span><select name="harvest_type">${harvestTypes.map((type) => `<option>${type}</option>`).join("")}</select></label>
          <label class="field"><span>Optional destination</span><input name="destination" /></label>
          <label class="field"><span>Reason / notes</span><textarea name="reason_notes" required></textarea></label>
          <div class="actions"><button class="primary">Record Owner Harvest</button></div>
        </form>
        <div>
          <h3>Harvest History</h3>
          <table>
            <thead><tr><th>Date</th><th>Wallet</th><th>Type</th><th>Amount</th><th>Reason</th><th>Destination</th></tr></thead>
            <tbody>${state.owner_harvests.map((harvest) => `<tr><td>${harvest.harvest_date}</td><td>${walletName(harvest.source_wallet_id)}</td><td>${escapeHtml(harvest.harvest_type)}</td><td>${money(harvest.amount)}</td><td>${escapeHtml(harvest.reason_notes)}</td><td>${escapeHtml(harvest.destination || "")}</td></tr>`).join("") || emptyRow(6)}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function dailyClosingView() {
  return `
    <div class="grid two">
      <section class="panel">
        <h2>Daily Closing</h2>
        <form data-action="daily-closing">
          <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
          <label class="field"><span>Closing date</span><input name="closing_date" type="date" value="${todayInputValue()}" required /></label>
          <label class="field"><span>Wallet</span><select name="wallet_id" data-closing-wallet>${walletOptions()}</select></label>
          <label class="field"><span>Expected balance from ledger</span><input name="expected_balance" data-closing-expected type="number" readonly /></label>
          <label class="field"><span>Actual counted amount</span><input name="actual_counted_amount" data-closing-actual type="number" step="0.01" required /></label>
          <label class="field"><span>Difference</span><input name="difference" data-closing-difference type="number" readonly /></label>
          <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
          <div class="actions"><button class="primary">Save Closing</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Closing History</h2>
        <table>
          <thead><tr><th>Date</th><th>Wallet</th><th>Expected</th><th>Actual</th><th>Difference</th></tr></thead>
          <tbody>${state.daily_closings.map((closing) => `<tr><td>${closing.closing_date}</td><td>${walletName(closing.wallet_id)}</td><td>${money(closing.expected_balance)}</td><td>${money(closing.actual_counted_amount)}</td><td>${money(closing.difference)}</td></tr>`).join("") || emptyRow(5)}</tbody>
        </table>
      </section>
    </div>`;
}

function depositsView() {
  const depositRows = state.bookings;
  const totalRequired = depositRows.reduce((total, booking) => total + Number(booking.security_deposit_amount || 0), 0);
  const totalReceived = depositRows.reduce((total, booking) => total + Number(booking.total_deposit_received || 0), 0);
  const totalRefunded = depositRows.reduce((total, booking) => total + Number(booking.total_deposit_refunded || 0), 0);
  const currentLiability = financeSummary(state).security_deposit_liability;
  const showSensitive = isManagerViewUnlocked();
  return `
    <section class="panel">
      <h2>Security Deposits</h2>
      <p class="muted">Required amount comes from the booking. Received/refunded amounts come from ledger entries. If a deposit was not paid yet, received remains zero.</p>
      ${showSensitive ? `<div class="wallet-summary-grid">
        <article class="wallet-summary-card"><span>Total Required</span><strong>${money(totalRequired)}</strong><em>Booking helper total</em></article>
        <article class="wallet-summary-card"><span>Total Received</span><strong>${money(totalReceived)}</strong><em>From booking snapshots</em></article>
        <article class="wallet-summary-card"><span>Total Refunded</span><strong>${money(totalRefunded)}</strong><em>From booking snapshots</em></article>
        <article class="wallet-summary-card"><span>Current Liability</span><strong>${money(currentLiability)}</strong><em>From ledger</em></article>
      </div>` : ""}
      <table>
        <thead><tr><th>Booking</th><th>Required</th><th>Received</th><th>Refunded</th><th>Remaining</th><th>Status</th></tr></thead>
        <tbody>${depositRows.map((booking) => {
          const remaining = Math.max(Number(booking.security_deposit_amount || 0) - Number(booking.total_deposit_received || 0), 0);
          return `<tr><td>${booking.booking_code}</td><td>${money(booking.security_deposit_amount)}</td><td>${money(booking.total_deposit_received)}</td><td>${money(booking.total_deposit_refunded)}</td><td>${money(remaining)}</td><td><span class="pill">${depositDisplayStatus(booking)}</span></td></tr>`;
        }).join("") || emptyRow(6)}</tbody>
      </table>
    </section>`;
}

function financeView() {
  const showSensitive = isManagerViewUnlocked();
  return `
    <div class="page-stack">
      <div class="page-header">
        <div>
          <p class="eyebrow">Financial Overview</p>
          <h1 class="page-title">Finance</h1>
        </div>
        <span class="view-mode-badge${showSensitive ? " view-mode-badge--manager" : ""}">
          ${showSensitive ? "Manager View" : "Normal View"}
        </span>
      </div>

      ${safeFinanceSection("Finance Status", () => `
        <p class="muted" style="font-size:13px;margin:0">${showSensitive ? "Manager View is active. Full finance visibility is unlocked." : "Normal View is active. Sensitive finance totals are hidden."}</p>
      `)}

      ${!showSensitive ? safeFinanceSection("Operational Cash", operationalCashCard) : ""}

      ${showSensitive ? safeFinanceSection("Wallet Balances", () => `
        <section class="panel">
          <h2>Wallet Balances</h2>
          <div class="wallet-summary-grid">${walletSummaryCards()}</div>
          <div class="subsection">
            <h3>Finance Summary</h3>
            <div class="finance-summary-grid">${financeSummaryCards()}</div>
          </div>
        </section>`) : ""}

      ${showSensitive ? safeFinanceSection("Transactions", ledgerView) : ""}
      ${safeFinanceSection("Expenses", expensesView)}
      ${showSensitive ? safeFinanceSection("Owner Harvest", ownerHarvestView) : ""}
      ${showSensitive ? safeFinanceSection("Transfers", transfersView) : ""}
      ${safeFinanceSection("Security Deposits", depositsView)}
    </div>`;
}

function operationalCashCard() {
  const cashWallet = state.wallets.find((wallet) => wallet.name.toLowerCase() === "cash");
  const cashBalance = cashWallet ? walletBalance(state, cashWallet.id) : 0;
  return `
    <section class="panel">
      <h2>Operational Cash on Hand</h2>
      <div class="wallet-summary-grid">
        <article class="wallet-summary-card">
          <span>Operational Cash on Hand</span>
          <strong>${money(cashBalance)}</strong>
          <em>Cash available for approved operating expenses.</em>
        </article>
      </div>
      ${cashWallet && cashBalance < 2000 ? `<p class="message">Low cash available</p>` : ""}
    </section>`;
}

function financeSummaryCards() {
  const summary = financeSummary(state);
  const cards = [
    ["This Month Revenue", summary.month_revenue, ""],
    ["This Month Expenses", summary.month_expenses, ""],
    ["This Month Net", summary.month_net, summary.month_net >= 0 ? "text-success" : "text-danger"],
    ["Current Security Deposit Liability", summary.security_deposit_liability, ""]
  ];
  return cards.map(([label, value, cls]) => `
          <article class="wallet-summary-card">
            <span>${label}</span>
            <strong class="${cls}">${money(value)}</strong>
          </article>`).join("");
}

function operationsView() {
  const baseline = latestElectricityBaseline();
  const readings = electricityReadingsForBaseline(baseline?.id);
  const elecSummary = electricitySummary(baseline, readings[0]);
  const totalDrinkStock = state.drink_products.filter((p) => p.is_active).reduce((total, p) => total + drinkCurrentStock(state, p.id), 0);
  const drinkSalesToday = state.drink_sales.filter((s) => s.sale_date === todayInputValue()).reduce((t, s) => t + Number(s.sales_amount || 0), 0);
  return `
    <div class="page-stack">
      <div class="page-header">
        <div>
          <p class="eyebrow">Resort Operations</p>
          <h1 class="page-title">Operations</h1>
        </div>
      </div>
      <div class="ops-kpi-row">
        <article class="ops-kpi-card">
          <span>Electricity Usage</span>
          <strong>${meterValue(elecSummary.kwh_used)} kWh</strong>
          <em>${baseline ? `Est. ${money(elecSummary.estimated_amount)} this period` : "No baseline set yet"}</em>
        </article>
        <article class="ops-kpi-card">
          <span>Drinks Stock (active)</span>
          <strong>${formatCases(totalDrinkStock)} cases</strong>
          <em>Total inventory on hand</em>
        </article>
        <article class="ops-kpi-card">
          <span>Drink Sales Today</span>
          <strong>${money(drinkSalesToday)}</strong>
          <em>Revenue from drink sales</em>
        </article>
      </div>
      ${electricityView()}
      ${drinksView()}
    </div>`;
}

function electricityView() {
  const baseline = latestElectricityBaseline();
  const readings = electricityReadingsForBaseline(baseline?.id);
  const latestReading = readings[0];
  const summary = electricitySummary(baseline, latestReading);
  return `
    <section class="panel">
      <h2>Electricity</h2>
      <p class="muted">Monthly meter tracker only. This does not create expenses and does not reduce wallet balances.</p>
      <div class="wallet-summary-grid">
        <article class="wallet-summary-card">
          <span>Starting Reading</span>
          <strong>${meterValue(baseline?.start_meter)}</strong>
          <em>${baseline ? `${money(baseline.rate_per_kwh)} per kWh / ${formatMonth(baseline.billing_period_month)}` : "No monthly baseline yet"}</em>
        </article>
        <article class="wallet-summary-card">
          <span>Current Reading</span>
          <strong>${meterValue(latestReading?.current_meter)}</strong>
          <em>${latestReading?.reading_date || "No current reading yet"}</em>
        </article>
        <article class="wallet-summary-card">
          <span>Usage / Estimate</span>
          <strong>${meterValue(summary.kwh_used)} kWh</strong>
          <em>${money(summary.estimated_amount)}</em>
        </article>
      </div>
      <div class="grid two" style="margin-top:12px">
        <form data-action="electricity-baseline">
          <h3>Monthly Starting Reading</h3>
          <label class="field"><span>Billing period/month</span><input name="billing_period_month" type="month" value="${currentMonthInput()}" required /></label>
          <label class="field"><span>Starting meter reading</span><input name="start_meter" type="number" min="0.01" step="0.01" required /></label>
          <label class="field"><span>Rate per kWh</span><input name="rate_per_kwh" type="number" min="0.01" step="0.01" required /></label>
          <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
          <div class="actions"><button class="primary">Save Monthly Baseline</button></div>
        </form>
        <form data-action="electricity-reading">
          <h3>Current Reading</h3>
          <label class="field"><span>Reading date</span><input name="reading_date" type="date" value="${todayInputValue()}" required /></label>
          <label class="field"><span>Current meter reading</span><input name="current_meter" type="number" min="0.01" step="0.01" required ${baseline ? "" : "disabled"} /></label>
          <label class="field"><span>Notes</span><textarea name="notes" ${baseline ? "" : "disabled"}></textarea></label>
          ${baseline ? `<input type="hidden" name="baseline_id" value="${baseline.id}" />` : `<p class="message">Add a monthly starting reading first.</p>`}
          <div class="actions"><button class="primary" ${baseline ? "" : "disabled"}>Save Current Reading</button></div>
        </form>
      </div>
      <div class="subsection">
        <h3>Reading Log</h3>
        <div class="scroll-table five-rows">
          <table>
            <thead><tr><th>Date</th><th>Reading</th><th>kWh Used</th><th>Estimated Amount</th><th>Notes</th></tr></thead>
            <tbody>${readings.map((reading) => {
              const row = electricitySummary(baseline, reading);
              return `<tr><td>${reading.reading_date}</td><td>${meterValue(reading.current_meter)}</td><td>${meterValue(row.kwh_used)}</td><td>${money(row.estimated_amount)}</td><td>${escapeHtml(reading.notes || "")}</td></tr>`;
            }).join("") || emptyRow(5)}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function drinksView() {
  const showSensitive = isManagerViewUnlocked();
  return `
    <section class="panel">
      <h2>Drinks</h2>
      <p class="muted">${showSensitive ? "Track drinks stock, sales, profit estimate, and receptionist commission due." : "Record drink sales and stock movements. Profit and commission details are Manager View only."}</p>
      ${drinkInventorySummaryView()}
    </section>
    <div class="grid two" style="margin-top:12px">
      ${drinkSaleFormView()}
      ${drinkMovementFormView()}
    </div>
    <div class="grid two" style="margin-top:12px">
      ${drinkSalesView()}
      ${drinkMovementsView()}
    </div>
    <div style="margin-top:12px">
      ${drinkProductsView()}
    </div>`;
}

function drinkInventorySummaryView() {
  const showSensitive = isManagerViewUnlocked();
  return `
    <table>
      <thead><tr><th>Product</th><th>Stock</th>${showSensitive ? "<th>Cost/Case</th>" : ""}<th>Selling/Case</th>${showSensitive ? "<th>Inventory Value</th>" : ""}<th>Sales Today</th><th>Sales This Month</th>${showSensitive ? "<th>Profit Estimate</th>" : ""}</tr></thead>
      <tbody>${activeDrinkProducts().map((product) => {
        const metrics = drinkProductMetrics(state, product.id) || {};
        return `<tr><td>${escapeHtml(product.name)}</td><td>${formatCases(metrics.current_stock_cases)}</td>${showSensitive ? `<td>${money(product.cost_per_case)}</td>` : ""}<td>${money(product.selling_price_per_case)}</td>${showSensitive ? `<td>${money(metrics.inventory_value)}</td>` : ""}<td>${formatCases(metrics.sales_today_cases)}</td><td>${formatCases(metrics.sales_month_cases)}</td>${showSensitive ? `<td>${money(metrics.profit_estimate)}</td>` : ""}</tr>`;
      }).join("") || emptyRow(showSensitive ? 8 : 5)}</tbody>
    </table>`;
}

function drinkSaleFormView() {
  return `
    <section class="panel">
      <h2>Record Drink Sale</h2>
      <form data-action="drink-sale">
        <label class="field"><span>Date</span><input name="sale_date" type="date" value="${todayInputValue()}" required /></label>
        <label class="field"><span>Booking link</span><select name="booking_id"><option value="">None</option>${state.bookings.map((booking) => `<option value="${booking.id}">${booking.booking_code} - ${guestName(booking.guest_id)}</option>`).join("")}</select></label>
        <label class="field"><span>Product</span><select name="product_id" required>${activeDrinkProducts().map((product) => `<option value="${product.id}">${escapeHtml(product.name)} - ${money(product.selling_price_per_case)}/case</option>`).join("")}</select></label>
        <label class="field"><span>Quantity cases</span><input name="quantity_cases" type="number" min="0.01" step="0.01" required /></label>
        <label class="field"><span>Wallet received</span><select name="wallet_id" required>${walletOptions()}</select></label>
        <label class="field"><span>Reference number</span><input name="reference_number" /></label>
        <label class="field"><span>Proof note</span><input name="proof_note" /></label>
        <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
        <p class="muted">${isManagerViewUnlocked() ? "Sale amount, cost, commission, and net profit are calculated from the selected product." : "Sale amount is calculated from the selected product."}</p>
        <div class="actions"><button class="primary">Record Drink Sale</button></div>
      </form>
    </section>`;
}

function drinkMovementFormView() {
  return `
    <section class="panel">
      <h2>Stock Movement</h2>
      <form data-action="drink-movement">
        <label class="field"><span>Date</span><input name="movement_date" type="date" value="${todayInputValue()}" required /></label>
        <label class="field"><span>Product</span><select name="product_id" required>${state.drink_products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Movement type</span><select name="movement_type">
          <option value="purchase_add_stock">Purchase / Add Stock</option>
          <option value="damage_spoilage">Damage / Spoilage</option>
          <option value="adjustment">Adjustment</option>
        </select></label>
        <label class="field"><span>Quantity cases</span><input name="quantity_cases" type="number" step="0.01" required /></label>
        <label class="field"><span>Wallet if money involved</span><select name="wallet_id"><option value="">None</option>${walletOptions()}</select></label>
        <label class="field"><span>Booking link</span><select name="booking_id"><option value="">None</option>${state.bookings.map((booking) => `<option value="${booking.id}">${booking.booking_code} - ${guestName(booking.guest_id)}</option>`).join("")}</select></label>
        <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
        <p class="muted">Stock movements do not create finance transactions yet. Drink sales create Revenue automatically.</p>
        <div class="actions"><button class="primary">Save Stock Movement</button></div>
      </form>
    </section>`;
}

function drinkSalesView() {
  const showSensitive = isManagerViewUnlocked();
  return `
    <section class="panel">
      <h2>Drink Sales</h2>
      <table>
        <thead><tr><th>Date</th><th>Product</th><th>Cases</th><th>Sales</th>${showSensitive ? "<th>Cost</th><th>Commission Due</th><th>Net Profit</th>" : ""}<th>Booking</th></tr></thead>
        <tbody>${state.drink_sales.map((sale) => `<tr><td>${sale.sale_date}</td><td>${drinkProductName(sale.product_id)}</td><td>${formatCases(sale.quantity_cases)}</td><td>${money(sale.sales_amount)}</td>${showSensitive ? `<td>${money(sale.cost_amount)}</td><td>${money(sale.commission_amount)}</td><td>${money(sale.net_profit)}</td>` : ""}<td>${bookingCode(sale.booking_id)}</td></tr>`).join("") || emptyRow(showSensitive ? 8 : 5)}</tbody>
      </table>
    </section>`;
}

function drinkMovementsView() {
  return `
    <section class="panel">
      <h2>Inventory Movements</h2>
      <table>
        <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Cases</th><th>Wallet</th><th>Booking</th><th>Notes</th></tr></thead>
        <tbody>${state.drink_inventory_movements.map((movement) => `<tr><td>${movement.movement_date}</td><td>${drinkProductName(movement.product_id)}</td><td>${drinkMovementLabel(movement.movement_type)}</td><td>${formatCases(movement.quantity_cases)}</td><td>${movement.wallet_id ? walletName(movement.wallet_id) : "None"}</td><td>${bookingCode(movement.booking_id)}</td><td>${escapeHtml(movement.notes || "")}</td></tr>`).join("") || emptyRow(7)}</tbody>
      </table>
    </section>`;
}

function drinkProductsView() {
  const showSensitive = isManagerViewUnlocked();
  return `
    <section class="panel">
      <h2>Drink Products</h2>
      <div class="grid two">
        <div>
          <table>
            <thead><tr><th>Product</th><th>Category</th>${showSensitive ? "<th>Cost</th>" : ""}<th>Selling</th>${showSensitive ? "<th>Commission</th>" : ""}<th>Status</th>${showSensitive ? "<th>Action</th>" : ""}</tr></thead>
            <tbody>${state.drink_products.map((product) => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td>${showSensitive ? `<td>${money(product.cost_per_case)}</td>` : ""}<td>${money(product.selling_price_per_case)}</td>${showSensitive ? `<td>${money(product.commission_per_case)}</td>` : ""}<td>${product.is_active ? "Active" : "Inactive"}</td>${showSensitive ? `<td><button type="button" data-toggle-drink-product="${product.id}">${product.is_active ? "Set Inactive" : "Set Active"}</button></td>` : ""}</tr>`).join("") || emptyRow(showSensitive ? 7 : 4)}</tbody>
          </table>
        </div>
        ${showSensitive ? `<form data-action="drink-product">
          <label class="field"><span>Product name</span><input name="name" required /></label>
          <label class="field"><span>Category</span><input name="category" value="Beer" required /></label>
          <label class="field"><span>Cost per case</span><input name="cost_per_case" type="number" min="0" step="0.01" required /></label>
          <label class="field"><span>Selling price per case</span><input name="selling_price_per_case" type="number" min="0" step="0.01" required /></label>
          <label class="field"><span>Commission per case</span><input name="commission_per_case" type="number" min="0" step="0.01" value="100" required /></label>
          <div class="actions"><button class="primary">Add Drink Product</button></div>
        </form>` : `<p class="muted">Product setup is available in Manager View.</p>`}
      </div>
    </section>`;
}

function safeFinanceSection(title, renderSection) {
  try {
    return renderSection();
  } catch (error) {
    console.error(`Finance section failed: ${title}`, error);
    return `
      <section class="panel">
        <h2>${escapeHtml(title)}</h2>
        <p class="message">This finance section could not load: ${escapeHtml(error.message)}</p>
      </section>`;
  }
}

function walletSummaryCards() {
  return ["Cash", "GCash", "Maya", "Bank"].map((name) => {
    const wallet = state.wallets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return `
      <article class="wallet-summary-card">
        <span>${name}</span>
        <strong>${wallet ? money(walletBalance(state, wallet.id)) : money(0)}</strong>
        <em>${wallet ? (wallet.is_active ? "Active" : "Inactive") : "Not configured"}</em>
      </article>`;
  }).join("");
}

function auditView() {
  return `
    <div class="page-stack">
      <div class="page-header">
        <div>
          <p class="eyebrow">Security &amp; Compliance</p>
          <h1 class="page-title">Audit Logs</h1>
        </div>
        <span class="muted" style="font-size:13px">${state.audit_logs.length} records</span>
      </div>
      <section class="panel">
        <div class="scroll-table ten-rows">
          <table>
            <thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>Reason</th></tr></thead>
            <tbody>${state.audit_logs.map((log) => `
              <tr>
                <td style="white-space:nowrap;color:var(--muted);font-size:12px">${new Date(log.created_at).toLocaleString()}</td>
                <td><span class="pill" style="font-size:10px">${escapeHtml(log.entity_type)}</span></td>
                <td style="font-size:13px;font-weight:500">${escapeHtml(log.action).replaceAll("_", " ")}</td>
                <td style="color:var(--muted);font-size:12px">${escapeHtml(log.reason || "")}</td>
              </tr>`).join("") || `<tr><td colspan="4" class="audit-empty">No audit records yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
}

function settingsView() {
  return `
    <div class="page-stack">
      <div class="page-header">
        <div>
          <p class="eyebrow">System Configuration</p>
          <h1 class="page-title">Settings</h1>
        </div>
      </div>
      ${packagesView()}
      ${walletsView()}
      ${automationView()}
      ${securitySettingsSection()}
      ${isManagerViewUnlocked() ? adminToolsView() : ""}
    </div>`;
}

function adminToolsView() {
  const now = new Date();
  const selectedMonth = adminCleanupPreview?.input_month || now.getMonth() + 1;
  const selectedYear = adminCleanupPreview?.input_year || now.getFullYear();
  return `
    <section class="panel admin-danger-zone">
      <div class="section-heading">
        <div>
          <p class="eyebrow danger-text">Manager Only</p>
          <h2>Admin Tools</h2>
        </div>
        <span class="pill danger-pill">Danger Zone</span>
      </div>
      <p class="muted">Delete training and testing records connected to bookings whose check-in date falls inside one selected month. This does not delete packages, wallets, settings, counters, or drink product setup.</p>
      <form data-action="admin-cleanup-preview" class="grid four">
        <label class="field"><span>Month</span><select name="input_month" required>${monthOptions(selectedMonth)}</select></label>
        <label class="field"><span>Year</span><input name="input_year" type="number" min="2020" max="2100" value="${selectedYear}" required /></label>
        <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
        <label class="field"><span>&nbsp;</span><button class="primary" type="submit">Preview Delete</button></label>
      </form>
      ${adminCleanupPreview ? adminCleanupPreviewView(adminCleanupPreview) : `
        <div class="danger-note">
          <strong>No preview loaded.</strong>
          <span>Run preview first. Nothing can be deleted until the matching confirmation phrase is typed.</span>
        </div>`}
    </section>`;
}

function adminCleanupPreviewView(preview) {
  const confirmation = escapeHtml(preview.expected_confirmation || "");
  const rows = [
    ["Month selected", preview.month_label],
    ["Bookings found", preview.bookings_found],
    ["Guests affected", preview.guests_affected],
    ["Guests to delete", preview.guests_to_delete],
    ["Ledger entries affected", preview.ledger_entries_affected],
    ["Deposits affected", preview.deposits_affected],
    ["Automation records affected", preview.automation_records_affected],
    ["Expenses affected", preview.expenses_affected],
    ["Drink sales affected", preview.drink_sales_affected],
    ["Drink movements affected", preview.drink_movements_affected],
    ["Audit logs affected", preview.audit_logs_affected]
  ];
  return `
    <div class="admin-preview">
      <div class="scroll-table">
        <table>
          <thead><tr><th>Preview Item</th><th>Count / Value</th></tr></thead>
          <tbody>${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="danger-note strong">
        <strong>Final confirmation required:</strong>
        <span>Type <code>${confirmation}</code> exactly. This action cannot be undone.</span>
      </div>
      <form data-action="admin-cleanup-delete" class="grid two">
        <input type="hidden" name="input_month" value="${preview.input_month}" />
        <input type="hidden" name="input_year" value="${preview.input_year}" />
        <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
        <label class="field"><span>Confirmation Text</span><input name="confirmation_text" placeholder="${confirmation}" required /></label>
        <div class="actions">
          <button class="danger-button" type="submit">Delete Selected Month Data</button>
        </div>
      </form>
    </div>`;
}

function automationView() {
  const rows = state.automation_queue.filter((item) => item.automation_type === "booking_confirmation" || item.automation_type === "thank_you");
  return `
    <section class="panel">
      <h2>Automation Queue</h2>
      <p class="muted">Emails send through the local server when RESEND_API_KEY is configured.</p>
      <table>
        <thead><tr><th>Type</th><th>Guest Email</th><th>Booking</th><th>Status</th><th>Scheduled</th><th>Sent</th><th>Error</th><th>Actions</th></tr></thead>
        <tbody>${rows.map((item) => `
          <tr>
            <td><span class="pill type-badge">${automationTypeLabel(item.automation_type)}</span></td>
            <td>${escapeHtml(item.guest_email || "No email")}</td>
            <td>${bookingCode(item.booking_id)}</td>
            <td>${automationQueueStatus(item)}</td>
            <td>${formatDate(item.scheduled_for)}</td>
            <td>${item.sent_at ? formatDate(item.sent_at) : ""}</td>
            <td>${escapeHtml(item.error_message || "")}</td>
            <td>
              <div class="actions">
                <button type="button" data-automation-send="${item.id}" ${canSendAutomation(item) ? "" : "disabled"}>Send Email</button>
                <button type="button" data-automation-id="${item.id}" data-automation-status="sent">Mark as Sent</button>
                <button type="button" data-automation-id="${item.id}" data-automation-status="failed">Mark as Failed</button>
                <button type="button" data-automation-id="${item.id}" data-automation-status="skipped">Skip</button>
                <button type="button" data-automation-id="${item.id}" data-automation-status="pending">Retry</button>
              </div>
            </td>
          </tr>`).join("") || emptyRow(8)}</tbody>
      </table>
    </section>`;
}

function bookingAutomationSection(booking) {
  const records = automationRecordsForBooking(booking.id);
  const confirmation = records.find((item) => item.automation_type === "booking_confirmation");
  const failed = records.find((item) => item.automation_type === "booking_confirmation" && item.status === "failed");
  const canSendConfirmation = booking.status === "Confirmed";
  const postStay = records.find((item) => item.automation_type === "thank_you");
  const isCompleted = booking.status === "Completed" || booking.status === "Checked Out";
  return `
    <table>
      <thead><tr><th>Email</th><th>Status</th><th>Scheduled</th><th>Sent</th></tr></thead>
      <tbody>
        ${automationStatusRow("Booking Confirmation", confirmation)}
        ${isCompleted ? automationStatusRow("Post-Stay Email", postStay) : ""}
      </tbody>
    </table>
    ${canSendConfirmation ? "" : `<p class="message">Confirm booking first before sending confirmation email.</p>`}
    <div class="actions">
      <button type="button" data-booking-email-send="booking_confirmation" data-booking-id="${booking.id}" ${canSendConfirmation && canQueueOrSendAutomation(confirmation) ? "" : "disabled"}>Send Confirmation Email</button>
      <button type="button" data-automation-send="${failed?.id || ""}" ${canSendConfirmation && failed && canSendAutomation(failed) ? "" : "disabled"}>Retry Failed Email</button>
    </div>
    ${isCompleted ? postStayEmailSection(postStay) : ""}`;
}

function automationStatusRow(label, record) {
  return `
    <tr>
      <td>${label}</td>
      <td>${record ? automationQueueStatus(record) : `<span class="pill">Not queued</span>`}</td>
      <td>${record ? formatDate(record.scheduled_for) : ""}</td>
      <td>${record?.sent_at ? formatDate(record.sent_at) : ""}</td>
    </tr>`;
}

function automationQueueStatus(record) {
  const ready = record.status === "pending" && new Date(record.scheduled_for) <= new Date();
  return `<span class="pill">${escapeHtml(record.status)}</span>${ready ? ` <span class="muted">Ready to send</span>` : ""}`;
}

function canSendAutomation(record) {
  return Boolean(record?.guest_email && !["sent", "skipped"].includes(record.status));
}

function canQueueOrSendAutomation(record) {
  return !record || canSendAutomation(record);
}

function securitySettingsSection() {
  if (!securityUnlocked) return securityUnlockView();
  return `
    <section class="panel">
      <h2>Security</h2>
    <div class="grid two">
      <div class="subsection">
        <h2>Change PMS Access Code</h2>
        <form data-action="change-pms-code">
          <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required /></label>
          <label class="field"><span>New PMS Access Code</span><input name="new_pms_code" type="password" inputmode="numeric" required /></label>
          <div class="actions"><button class="primary">Change PMS Code</button></div>
        </form>
      </div>
      <div class="subsection">
        <h2>Change Manager Security Code</h2>
        <form data-action="change-manager-code">
          <label class="field"><span>Current Manager Security Code</span><input name="current_manager_code" type="password" inputmode="numeric" required /></label>
          <label class="field"><span>New Manager Security Code</span><input name="new_manager_code" type="password" inputmode="numeric" required /></label>
          <div class="actions"><button class="primary">Change Manager Code</button></div>
        </form>
      </div>
    </div>
    </section>`;
}

function createBookingModal(context) {
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>New Booking</h2>
            ${context.checkin_date ? `<span class="muted" style="font-size:12px">${context.checkin_date}</span>` : ""}
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        ${bookingForm({ checkin_date: context.checkin_date, prefill: context.prefill })}
        <div class="subsection">
          <h3>Block Date</h3>
          <p class="muted">Reserved for a later Phase 1 cleanup. Not active yet.</p>
          <button type="button" disabled>Block Date</button>
        </div>
      </section>
    </div>`;
}

function bookingActionModal(context) {
  const booking = context.booking;
  const actions = bookingActionsForStatus(booking);
  const sc = bookingStatusClass(booking.status);
  const gName = guestNameText(booking.guest_id);
  const initial = gName.charAt(0).toUpperCase();

  // Prev / Next in sorted list (newest start_at first, no Archived)
  const sorted = state.bookings
    .filter((b) => b.status !== "Archived")
    .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
  const idx = sorted.findIndex((b) => b.id === booking.id);
  const prevBooking = sorted[idx - 1] || null;
  const nextBooking = sorted[idx + 1] || null;

  return `
    <div class="modal-backdrop">
      <section class="panel modal">

        <!-- Header: avatar + code + status + prev/next + close -->
        <div class="bm-header">
          <div class="bm-header-left">
            <div class="guest-avatar">${initial}</div>
            <div>
              <h2>${booking.booking_code}</h2>
              <span class="bm-subtitle">${guestLinkById(booking.guest_id)} &middot; ${guestPhone(booking.guest_id)}</span>
            </div>
          </div>
          <div class="bm-header-right">
            <span class="pill${sc ? ` pill-${sc}` : ""}">${booking.status}</span>
            <div class="bm-nav-btns">
              <button type="button" class="bm-nav-btn" data-booking-prev="${prevBooking?.id || ""}" ${!prevBooking ? "disabled" : ""} title="Previous booking">&#8592;</button>
              <button type="button" class="bm-nav-btn" data-booking-next="${nextBooking?.id || ""}" ${!nextBooking ? "disabled" : ""} title="Next booking">&#8594;</button>
            </div>
            <button type="button" class="btn-close" data-action="close-modal">✕</button>
          </div>
        </div>

        <!-- Snapshot card -->
        ${bookingSnapshotCard(booking)}

        <!-- Smart warnings -->
        ${bookingWarnings(booking)}

        <!-- Copy buttons -->
        <div class="bm-copy-row">
          <button type="button" class="copy-btn" data-copy="summary" data-booking-id="${booking.id}">Copy Summary</button>
          <button type="button" class="copy-btn" data-copy="payment" data-booking-id="${booking.id}">Copy Payment</button>
          <button type="button" class="copy-btn" data-copy="guest" data-booking-id="${booking.id}">Copy Guest</button>
          <button type="button" class="copy-btn" data-copy="arrival" data-booking-id="${booking.id}">Copy Arrival</button>
        </div>

        <!-- Notes -->
        <div class="subsection">
          <h3>Internal Notes</h3>
          <form data-action="booking-notes">
            <input type="hidden" name="booking_id" value="${booking.id}" />
            <label class="field"><span>Notes</span><textarea name="notes">${escapeHtml(booking.notes || "")}</textarea></label>
            <div class="actions"><button class="primary">Save Notes</button></div>
          </form>
        </div>

        <!-- Timeline -->
        <div class="subsection">
          <h3>Booking Timeline</h3>
          ${bookingTimeline(booking)}
        </div>

        <!-- Email / Automation -->
        <div class="subsection">
          <h3>Email / Automation</h3>
          ${bookingAutomationSection(booking)}
        </div>

        <!-- Guest Memories: Manager View + Completed only -->
        ${booking.status === "Completed" && isManagerViewUnlocked() ? `
        <div class="subsection">
          <h3>Guest Memories</h3>
          ${guestMemoriesSection(booking)}
        </div>` : ""}

        <!-- Sticky action buttons -->
        <div class="bm-sticky-actions">
          ${actions.map((action) => `<button type="button" ${action.disabled ? "disabled" : ""} class="${action.id === "cancel" ? "danger" : ""}" data-booking-id="${booking.id}" data-booking-action="${action.id}">${action.label}</button>`).join("")}
        </div>

        ${isManagerViewUnlocked() ? `<details class="testing-actions">
          <summary>Testing actions</summary>
          <div class="actions">
            <button type="button" class="danger" data-booking-id="${booking.id}" data-booking-action="delete">Delete Booking</button>
          </div>
        </details>` : ""}
      </section>
    </div>`;
}

function guestProfileModal(context) {
  const guest = context.guest;
  const bookings = bookingsForGuest(guest.id);
  const totalRevenue = bookings.reduce((total, booking) => total + Number(booking.total_revenue || 0), 0);
  const lastStay = [...bookings].sort((a, b) => new Date(b.end_at) - new Date(a.end_at))[0];
  const initial = (guest.full_name || "?").charAt(0).toUpperCase();
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="bm-header">
          <div class="bm-header-left">
            <div class="guest-avatar guest-avatar--lg">${initial}</div>
            <div>
              <h2>${escapeHtml(guest.full_name)}</h2>
              <span class="bm-subtitle">${escapeHtml(guest.phone)}${guest.alternate_contact_number ? ` &middot; ${escapeHtml(guest.alternate_contact_number)}` : ""}${guest.email ? ` &middot; ${escapeHtml(guest.email)}` : ""}</span>
            </div>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <div class="bm-grid">
          <div class="bm-field"><span>Email</span><strong>${escapeHtml(guest.email || "None")}</strong></div>
          <div class="bm-field"><span>Total Bookings</span><strong>${bookings.length}</strong></div>
          <div class="bm-field"><span>Total Revenue</span><strong>${money(totalRevenue)}</strong></div>
          <div class="bm-field"><span>Last Stay</span><strong>${lastStay ? formatRange(lastStay) : "No stays yet"}</strong></div>
        </div>
        <div class="subsection">
          <h3>Booking History</h3>
          ${bookings.map((booking) => {
            const sc = bookingStatusClass(booking.status);
            return `
              <button type="button" class="history-row" data-open-booking="${booking.id}">
                <span><span class="pill pill-${sc}" style="font-size:10px">${booking.status}</span> &nbsp; ${booking.booking_code}</span>
                <strong>${formatRange(booking)} &middot; ${money(booking.total_revenue)}</strong>
              </button>`;
          }).join("") || `<p class="muted" style="padding:12px 0;font-size:13px">No bookings yet.</p>`}
        </div>
      </section>
    </div>`;
}

function editBookingModal(context) {
  const booking = context.booking;
  const version = state.package_versions.find((item) => item.id === booking.package_version_id);
  const checkinDate = dateInputValue(new Date(booking.start_at));
  const checkoutDate = dateInputValue(new Date(booking.end_at));
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>Edit Booking</h2>
            <span class="muted" style="font-size:12px">${booking.booking_code}</span>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <form data-action="booking-edit" data-booking-date-form>
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <label class="field"><span>Guest</span><select name="guest_id" required>${state.guests.map((guest) => `<option value="${guest.id}" ${guest.id === booking.guest_id ? "selected" : ""}>${escapeHtml(guest.full_name)} - ${escapeHtml(guest.phone)}</option>`).join("")}</select></label>
          <label class="field"><span>Package</span><select name="package_version_id" data-booking-package required>${state.packages.map((pkg) => {
            const item = latestPackageVersion(pkg.id);
            if (!item) return "";
            return `<option value="${item.id}" ${item.id === booking.package_version_id ? "selected" : ""}>${escapeHtml(pkg.name)} v${item.version_number} - ${money(item.price)}</option>`;
          }).join("")}</select></label>
          <div class="grid two">
            <label class="field"><span>Check-in date</span><input name="checkin_date" type="date" value="${checkinDate}" required /></label>
            <label class="field" data-checkout-field><span>Check-out date</span><input name="checkout_date" type="date" value="${version?.is_overnight ? checkoutDate : ""}" /></label>
            <label class="field"><span>Pax</span><input name="pax_count" type="number" min="1" value="${booking.pax_count}" required /></label>
            <label class="field"><span>Security deposit</span><input name="security_deposit_amount" type="number" min="0" value="${Number(booking.security_deposit_amount || DEFAULT_SECURITY_DEPOSIT)}" required /></label>
          </div>
          <p class="muted" data-booking-time-summary></p>
          <p class="message" data-booking-price-summary>Choose package and dates to calculate price.</p>
          <label class="field"><span>Notes</span><textarea name="notes">${escapeHtml(booking.notes || "")}</textarea></label>
          <div class="actions">
            <button class="primary">Save Booking Changes</button>
            <button type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </section>
    </div>`;
}

function cancelBookingModal(context) {
  const booking = context.booking;
  const initial = guestNameText(booking.guest_id).charAt(0).toUpperCase();
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="bm-header">
          <div class="bm-header-left">
            <div class="guest-avatar">${initial}</div>
            <div>
              <h2>Cancel Booking</h2>
              <span class="bm-subtitle">${booking.booking_code} &middot; ${guestName(booking.guest_id)}</span>
            </div>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <p class="message">This will mark the booking as Cancelled. Deposits and revenue are not automatically refunded.</p>
        <form data-action="booking-cancel">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <label class="field"><span>Cancellation Reason</span><textarea name="reason" required placeholder="Reason for cancellation…"></textarea></label>
          <div class="actions">
            <button class="danger-button">Confirm Cancellation</button>
            <button type="button" data-action="close-modal">Keep Booking</button>
          </div>
        </form>
      </section>
    </div>`;
}

function transactionModal(context) {
  const max = context.noLimit ? null : context.account_type === "Security Deposit Liability"
    ? depositBalanceDue(context.booking)
    : packageBalanceDue(context.booking);
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>${context.title}</h2>
            <span class="muted" style="font-size:12px">${context.booking.booking_code} · ${guestName(context.booking.guest_id)}</span>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <form data-action="transaction">
          <input type="hidden" name="booking_id" value="${context.booking.id}" />
          <input type="hidden" name="account_type" value="${context.account_type}" />
          <input type="hidden" name="no_limit" value="${context.noLimit ? "true" : "false"}" />
          <label class="field"><span>Amount</span><input name="amount" type="number" min="0" ${max ? `max="${max}"` : ""} required /></label>
          <label class="field"><span>Wallet</span><select name="wallet_id">${walletOptions()}</select></label>
          <label class="field"><span>Reference number</span><input name="reference_number" /></label>
          <label class="field"><span>Proof note</span><input name="proof_note" /></label>
          <label class="field"><span>Description</span><input name="description" value="${escapeHtml(context.description)}" /></label>
          <div class="actions"><button class="primary">Record Transaction</button></div>
        </form>
      </section>
    </div>`;
}

function confirmBookingDepositModal(context) {
  const booking = context.booking;
  const received = Number(booking.total_deposit_received || 0);
  const depositDue = depositBalanceDue(booking);
  const defaultAmount = depositDue > 0 ? depositDue : 0;
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>Confirm Booking Deposit</h2>
            <span class="muted" style="font-size:12px">${booking.booking_code} · ${guestName(booking.guest_id)}</span>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <div class="settlement-summary">
          <div><span>Security Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Security Deposit Received</span><strong>${money(received)}</strong></div>
          <div><span>Remaining Deposit Balance</span><strong class="${depositDue > 0 ? "text-warning" : "text-success"}">${money(depositDue)}</strong></div>
          <div><span>New Status After Save</span><strong>Confirmed</strong></div>
        </div>
        <form data-action="confirm-booking-deposit">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <label class="field"><span>Security deposit / reservation fee received</span><input name="deposit_amount" type="number" min="0" max="${depositDue}" value="${defaultAmount}" required /></label>
          <label class="field"><span>Deposit wallet</span><select name="deposit_wallet_id">${walletOptions()}</select></label>
          <label class="field"><span>Reference number</span><input name="reference_number" /></label>
          <label class="field"><span>Proof note</span><input name="proof_note" /></label>
          <label class="field"><span>Notes</span><textarea name="notes" placeholder="Payment verification notes"></textarea></label>
          <p class="message">Security deposit is recorded as Security Deposit Liability, not revenue.</p>
          <div class="actions">
            <button class="primary">Save Deposit and Confirm Booking</button>
            <button type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </section>
    </div>`;
}

function bookingActionsForStatus(booking) {
  if (booking.status === "Archived") {
    return [{ id: "history", label: "View Booking History", disabled: true }];
  }
  if (["Completed", "Cancelled", "Refunded"].includes(booking.status)) {
    return [
      { id: "history", label: "View History", disabled: true },
      { id: "archive", label: "Archive Booking" }
    ];
  }
  if (booking.status === "Checked In") {
    return [
      { id: "payment", label: "Record Additional Payment" },
      { id: "damage", label: "Record Damage/Penalty" },
      { id: "checkout", label: "Check Out" }
    ];
  }
  const actions = [
    { id: "edit", label: "Edit Booking" },
    { id: "payment", label: "Record Payment" },
    { id: "deposit", label: "Record Deposit" },
    { id: "checkin", label: "Check In" },
    { id: "cancel", label: "Cancel Booking" }
  ];
  if (booking.status === "Deposit Requested") {
    actions.unshift({ id: "confirm", label: "Confirm Booking" });
  }
  return actions;
}

function checkoutSettlementModal(context) {
  const booking = context.booking;
  const refundable = refundableDepositBalance(booking);
  const defaultRefund = Math.max(refundable - Number(context.damage_amount || 0), 0);
  const initial = guestNameText(booking.guest_id).charAt(0).toUpperCase();
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="bm-header">
          <div class="bm-header-left">
            <div class="guest-avatar">${initial}</div>
            <div>
              <h2>Checkout Settlement</h2>
              <span class="bm-subtitle">${booking.booking_code} &middot; ${guestName(booking.guest_id)}</span>
            </div>
          </div>
          <button type="button" class="btn-close" data-action="cancel-checkout">✕</button>
        </div>
        ${booking.total_deposit_received > 0 ? "" : `<p class="message">No security deposit on file to refund.</p>`}
        <div class="settlement-summary">
          <div><span>Security Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Security Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
          <div><span>Already Refunded</span><strong>${money(booking.total_deposit_refunded)}</strong></div>
          <div><span>Refundable Balance</span><strong class="text-success">${money(refundable)}</strong></div>
        </div>
        <form data-action="checkout-settlement">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <div class="grid two">
            <label class="field"><span>Damage / Penalty Deduction</span><input name="damage_amount" data-damage-amount type="number" min="0" max="${refundable}" value="0" /></label>
            <label class="field"><span>Refund Amount</span><input name="refund_amount" data-refund-amount type="number" min="0" max="${refundable}" value="${defaultRefund}" /></label>
          </div>
          <label class="field"><span>Reason / Notes</span><textarea name="reason" placeholder="Damage/Penalty Charge notes"></textarea></label>
          <label class="field"><span>Refund Wallet</span><select name="refund_wallet_id">${walletOptions()}</select></label>
          <p class="muted" style="font-size:12px;margin-top:10px">Damage/Penalty deduction is recorded as a Revenue ledger line labeled Damage/Penalty Charge. Deposit refund is recorded as a negative Security Deposit Liability line.</p>
          <div class="actions">
            <button class="primary">Confirm Checkout Settlement</button>
            <button type="button" data-action="cancel-checkout">Cancel</button>
          </div>
        </form>
      </section>
    </div>`;
}

function checkinPaymentModal(context) {
  const booking = context.booking;
  const packageDue = packageBalanceDue(booking);
  const depositDue = depositBalanceDue(booking);
  const initial = guestNameText(booking.guest_id).charAt(0).toUpperCase();
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="bm-header">
          <div class="bm-header-left">
            <div class="guest-avatar">${initial}</div>
            <div>
              <h2>Check-In Payment</h2>
              <span class="bm-subtitle">${booking.booking_code} &middot; ${guestName(booking.guest_id)}</span>
            </div>
          </div>
          <button type="button" class="btn-close" data-action="cancel-checkin">✕</button>
        </div>
        <div class="settlement-summary">
          <div><span>Package Price</span><strong>${money(booking.base_price)}</strong></div>
          <div><span>Revenue Paid</span><strong>${money(booking.total_revenue)}</strong></div>
          <div><span>Balance Due</span><strong class="${packageDue > 0 ? "text-warning" : "text-success"}">${money(packageDue)}</strong></div>
          <div><span>Security Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Security Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
          <div><span>Security Deposit Balance</span><strong class="${depositDue > 0 ? "text-warning" : "text-success"}">${money(depositDue)}</strong></div>
        </div>
        <form data-action="checkin-payment">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <div class="grid two">
            <label class="field"><span>Package payment amount</span><input name="package_payment_amount" type="number" min="0" max="${packageDue}" value="${packageDue}" /></label>
            <label class="field"><span>Package payment wallet</span><select name="package_wallet_id">${walletOptions()}</select></label>
            <label class="field"><span>Security deposit payment amount</span><input name="deposit_payment_amount" type="number" min="0" max="${depositDue}" value="${depositDue}" /></label>
            <label class="field"><span>Security deposit wallet</span><select name="deposit_wallet_id">${walletOptions()}</select></label>
          </div>
          <label class="field"><span>Notes</span><textarea name="payment_notes" placeholder="Check-in payment notes"></textarea></label>
          <p class="message">Confirm check-in even if payment amount is zero. If both amounts are zero, no payment will be recorded.</p>
          <div class="actions">
            <button class="primary">Confirm Check-In</button>
            <button type="button" data-action="cancel-checkin">Cancel</button>
          </div>
        </form>
      </section>
    </div>`;
}

function securityUnlockView() {
  const lock = getAttemptLock(managerAttemptsKey);
  return `
    <section class="panel auth-panel">
      <h2>Security Settings</h2>
      ${lock.locked ? `<p class="message">Too many wrong attempts. Try again in ${lock.minutes} minute(s).</p>` : ""}
      <form data-action="unlock-security">
        <label class="field"><span>Manager Security Code</span><input name="manager_code" type="password" inputmode="numeric" required ${lock.locked ? "disabled" : ""} /></label>
        <div class="actions"><button class="primary" ${lock.locked ? "disabled" : ""}>Open Security Settings</button></div>
      </form>
    </section>`;
}

function bindAccessForms() {
  document.querySelector("form[data-action='unlock']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const lock = getAttemptLock(pmsAttemptsKey);
    if (lock.locked) {
      showMessage(`Login locked. Try again in ${lock.minutes} minute(s).`);
      render();
      return;
    }
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const ok = await rpc("verify_pms_access_code", { input_code: fields.access_code });
      if (!ok) {
        registerFailedAttempt(pmsAttemptsKey, 5, 5);
        throw new Error("Wrong PMS Access Code.");
      }
      resetAttempts(pmsAttemptsKey);
      sessionStorage.setItem(accessSessionKey, "true");
      await loadData();
      startAutoRefresh();
    } catch (error) {
      showMessage(error.message);
      render();
    }
  });
}

async function unlockManagerView() {
  if (isManagerViewUnlocked()) {
    showMessage("Manager View is already active.");
    return;
  }
  const lock = getAttemptLock(managerAttemptsKey);
  if (lock.locked) {
    showMessage(`Manager settings locked. Try again in ${lock.minutes} minute(s).`, "error");
    render();
    return;
  }
  const managerCode = window.prompt("Manager Security Code");
  if (!managerCode) return;
  try {
    const ok = await rpc("verify_manager_security_code", { input_code: managerCode });
    if (!ok) {
      registerFailedAttempt(managerAttemptsKey, 5, 15);
      throw new Error("Wrong Manager Security Code.");
    }
    resetAttempts(managerAttemptsKey);
    sessionStorage.setItem(managerViewSessionKey, "true");
    render();
    showMessage("Manager View unlocked.", "success");
  } catch (error) {
    showMessage(error.message, "error");
    render();
  }
}

function bindForms() {
  document.querySelector("[data-action='new-booking']")?.addEventListener("click", () => {
    createBookingContext = { checkin_date: "" };
    render();
  });
  hydrateBookingDateForm();
  bindDatePickerOpeners();
  hydrateCheckoutSettlementForm();
  bindBookingSearch();
  bindCalendarNavigation();
  bindCalendarActions();
  bindGuestActions();
  hydrateDailyClosingForm();
  bindReversalActions();
  bindDrinkProductActions();
  bindAutomationActions();
  bindBookingActionButtons();
  bindModalBackdropClose();
  bindCopyButtons();
  bindBookingNavButtons();
  bindQuickBookingPopup();
  bindPostStayEmail();
  bindGuestMemory();
  renderFloatingActions();
  document.querySelectorAll("form[data-action]").forEach((form) => {
    if (form.dataset.action === "unlock") return;
    if (form.dataset.action === "quick-booking-prefill") return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "true") return;
      form.dataset.submitting = "true";
      const submitButtons = [...form.querySelectorAll("button")];
      const buttonStates = submitButtons.map((button) => [button, button.disabled]);
      submitButtons.forEach((button) => {
        button.disabled = true;
      });
      const fields = Object.fromEntries(new FormData(form).entries());
      try {
        let shouldRefresh = true;
        let successMessage = "Saved to Supabase.";
        if (form.dataset.action === "package") await createPackageVersion(fields);
        if (form.dataset.action === "guest") await createGuest(fields);
        if (form.dataset.action === "booking") {
          const result = await createBooking(fields);
          successMessage = result.confirmationMessage;
          createBookingContext = null;
        }
        if (form.dataset.action === "booking-edit") await updateBookingDetails(fields);
        if (form.dataset.action === "booking-cancel") await cancelBooking(fields);
        if (form.dataset.action === "booking-notes") await updateBookingNotes(fields);
        if (form.dataset.action === "wallet") await createWallet(fields);
        if (form.dataset.action === "ledger") await recordLedger(fields);
        if (form.dataset.action === "expense") await recordExpense(fields);
        if (form.dataset.action === "transfer") await recordTransfer(fields);
        if (form.dataset.action === "owner-harvest") await recordOwnerHarvest(fields);
        if (form.dataset.action === "drink-product") await createDrinkProduct(fields);
        if (form.dataset.action === "drink-movement") await recordDrinkMovement(fields);
        if (form.dataset.action === "drink-sale") await recordDrinkSale(fields);
        if (form.dataset.action === "electricity-baseline") await recordElectricityBaseline(fields);
        if (form.dataset.action === "electricity-reading") await recordElectricityReading(fields);
        if (form.dataset.action === "daily-closing") await recordDailyClosing(fields);
        if (form.dataset.action === "transaction") await recordActionTransaction(fields);
        if (form.dataset.action === "finance-filters") {
          financeFilters = {
            start_date: fields.start_date || "",
            end_date: fields.end_date || "",
            wallet_id: fields.wallet_id || "",
            account_type: fields.account_type || "",
            search: fields.search || ""
          };
          shouldRefresh = false;
          render();
        }
        if (form.dataset.action === "checkin-payment") await confirmCheckinPayment(fields);
        if (form.dataset.action === "checkout-settlement") await confirmCheckoutSettlement(fields);
        if (form.dataset.action === "confirm-booking-deposit") await confirmBookingWithDeposit(fields);
        if (form.dataset.action === "unlock-security") await unlockSecurity(fields);
        if (form.dataset.action === "change-pms-code") await changePmsCode(fields);
        if (form.dataset.action === "change-manager-code") await changeManagerCode(fields);
        if (form.dataset.action === "admin-cleanup-preview") {
          await previewAdminMonthCleanup(fields);
          shouldRefresh = false;
          successMessage = "Preview ready.";
          render();
          showMessage(successMessage);
        }
        if (form.dataset.action === "admin-cleanup-delete") {
          await deleteAdminMonthData(fields);
          adminCleanupPreview = null;
          successMessage = "Selected month data deleted.";
        }
        if (!shouldRefresh) return;
        form.reset();
        await loadData();
        showMessage(successMessage, "success");
      } catch (error) {
        showMessage(error.message, "error");
        render();
      } finally {
        if (form.isConnected) {
          form.dataset.submitting = "false";
          buttonStates.forEach(([button, wasDisabled]) => {
            button.disabled = wasDisabled;
          });
        }
      }
    });
  });

  document.querySelector("[data-action='cancel-checkout']")?.addEventListener("click", () => {
    checkoutSettlement = null;
    render();
  });
  document.querySelector("[data-action='cancel-checkin']")?.addEventListener("click", () => {
    checkinPayment = null;
    render();
  });
  document.querySelectorAll("[data-action='close-modal']").forEach((button) => {
    button.addEventListener("click", () => {
      closeAllModals();
      render();
    });
  });

  document.querySelector("[data-action='clear-finance-filters']")?.addEventListener("click", () => {
    financeFilters = {
      start_date: "",
      end_date: "",
      wallet_id: "",
      account_type: "",
      search: ""
    };
    render();
  });
}

function bindAutomationActions() {
  document.querySelectorAll("[data-automation-send]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        await sendQueuedEmail(button.dataset.automationSend);
        await loadData();
        showMessage("Email sent.", "success");
      } catch (error) {
        await loadData();
        showMessage(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-booking-email-send]").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = button.dataset.bookingId;
      const type = button.dataset.bookingEmailSend;
      try {
        button.disabled = true;
        await sendBookingAutomationNow(bookingId, type);
        await loadData();
        showMessage("Email sent.", "success");
      } catch (error) {
        await loadData();
        showMessage(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-automation-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.dataset.automationStatus;
      let errorMessage = "";
      if (status === "failed") {
        errorMessage = window.prompt("Failure note") || "Marked failed manually.";
      }
      if (status === "skipped") {
        errorMessage = window.prompt("Skip reason") || "Skipped manually.";
      }
      try {
        await updateAutomationStatus(button.dataset.automationId, status, errorMessage);
        await loadData();
        showMessage("Automation queue updated.", "success");
      } catch (error) {
        showMessage(error.message, "error");
        render();
      }
    });
  });
}

function bindCalendarNavigation() {
  document.querySelectorAll("[data-calendar-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.calendarNav === "prev") {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      }
      if (button.dataset.calendarNav === "next") {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      }
      if (button.dataset.calendarNav === "today") {
        const today = new Date();
        calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
      }
      render();
    });
  });
}

function bindBookingSearch() {
  document.querySelector("[data-booking-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    bookingSearchQuery = fields.query?.trim() || "";
    render();
  });
  document.querySelector("[data-action='clear-booking-search']")?.addEventListener("click", () => {
    bookingSearchQuery = "";
    render();
  });
}

function bindCalendarActions() {
  document.querySelectorAll("[data-open-date]").forEach((button) => {
    button.addEventListener("click", () => {
      quickBookingContext = { date: button.dataset.openDate };
      createBookingContext = null;
      bookingActionContext = null;
      render();
    });
  });
  document.querySelectorAll("[data-open-booking]").forEach((button) => {
    button.addEventListener("click", () => {
      const booking = state.bookings.find((item) => item.id === button.dataset.openBooking);
      if (!booking) return;
      bookingActionContext = { booking };
      createBookingContext = null;
      guestProfileContext = null;
      render();
    });
  });
}


function bindGuestActions() {
  document.querySelectorAll("[data-open-guest]").forEach((button) => {
    button.addEventListener("click", () => {
      const guest = state.guests.find((item) => item.id === button.dataset.openGuest);
      if (!guest) return;
      guestProfileContext = { guest };
      bookingActionContext = null;
      createBookingContext = null;
      render();
    });
  });
}

function bindDrinkProductActions() {
  document.querySelectorAll("[data-toggle-drink-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      const product = state.drink_products.find((item) => item.id === button.dataset.toggleDrinkProduct);
      if (!product) return;
      try {
        await update("drink_products", product.id, { is_active: !product.is_active });
        await createAudit("drink_product", product.id, product.is_active ? "set_inactive" : "set_active", product, { ...product, is_active: !product.is_active });
        await loadData();
        showMessage("Drink product updated.", "success");
      } catch (error) {
        showMessage(error.message, "error");
        render();
      }
    });
  });
}

function hydrateDailyClosingForm() {
  const walletSelect = document.querySelector("[data-closing-wallet]");
  const expectedInput = document.querySelector("[data-closing-expected]");
  const actualInput = document.querySelector("[data-closing-actual]");
  const differenceInput = document.querySelector("[data-closing-difference]");
  if (!walletSelect || !expectedInput || !actualInput || !differenceInput) return;

  const refresh = () => {
    const expected = walletBalance(state, walletSelect.value);
    const actual = Number(actualInput.value || 0);
    expectedInput.value = String(expected);
    differenceInput.value = String(actual - expected);
  };

  walletSelect.addEventListener("change", refresh);
  actualInput.addEventListener("input", refresh);
  refresh();
}

function bindReversalActions() {
  document.querySelectorAll("[data-reverse-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!isManagerViewUnlocked()) {
        showMessage("Manager View is required for transaction reversals.", "error");
        return;
      }
      const entry = state.ledger_entries.find((item) => item.id === button.dataset.reverseEntry);
      if (!entry) return;
      const managerCode = window.prompt("Enter Manager Security Code");
      if (!managerCode) return;
      const reason = window.prompt("Enter reversal reason");
      if (!reason?.trim()) {
        showMessage("Reversal reason is required.", "error");
        return;
      }
      try {
        await reverseLedgerEntry(entry, managerCode, reason);
        await loadData();
        showMessage("Transaction reversed.", "success");
      } catch (error) {
        showMessage(error.message, "error");
      }
    });
  });
}

function bindBookingActionButtons() {
  document.querySelectorAll("[data-booking-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const booking = state.bookings.find((item) => item.id === button.dataset.bookingId);
      if (!booking) return;
      const action = button.dataset.bookingAction;
      try {
        if (action === "checkin") {
          bookingActionContext = null;
          checkinPayment = { booking };
          render();
        }
        if (action === "checkout") {
          bookingActionContext = null;
          checkoutSettlement = { booking };
          render();
        }
        if (action === "edit") {
          bookingActionContext = null;
          editBookingContext = { booking };
          render();
        }
        if (action === "cancel") {
          bookingActionContext = null;
          cancelBookingContext = { booking };
          render();
        }
        if (action === "archive") {
          await archiveBooking(booking);
        }
        if (action === "confirm") {
          bookingActionContext = null;
          confirmBookingDeposit = { booking };
          render();
        }
        if (action === "payment") {
          transactionContext = { booking, account_type: "Revenue", title: "Record Payment", description: "Booking payment" };
          bookingActionContext = null;
          render();
        }
        if (action === "deposit") {
          transactionContext = { booking, account_type: "Security Deposit Liability", title: "Record Security Deposit", description: "Security deposit payment" };
          bookingActionContext = null;
          render();
        }
        if (action === "damage") {
          transactionContext = { booking, account_type: "Revenue", title: "Record Damage/Penalty", description: "Damage/Penalty Charge", noLimit: true };
          bookingActionContext = null;
          render();
        }
        if (action === "delete") {
          await deleteBookingForTesting(booking);
        }
      } catch (error) {
        showMessage(error.message, "error");
      }
    });
  });
}

async function createPackageVersion(fields) {
  const previous = latestPackageVersion(fields.package_id);
  if (!previous) throw new Error("Package version not found.");
  const payload = {
    package_id: fields.package_id,
    version_number: Number(previous.version_number) + 1,
    price: Number(fields.price),
    included_pax: Number(fields.included_pax),
    included_rooms: Number(fields.included_rooms),
    has_breakfast: fields.has_breakfast === "true",
    start_time: fields.start_time,
    end_time: fields.end_time,
    is_overnight: fields.is_overnight === "true"
  };
  const [created] = await insert("package_versions", payload);
  await createAudit("package", fields.package_id, "create_version", previous, created, "Package edited");
}

async function createGuest(fields) {
  const [guest] = await insert("guests", {
    full_name: fields.full_name.trim(),
    phone: fields.phone.trim(),
    alternate_contact_number: fields.alternate_contact_number?.trim() || null,
    email: fields.email?.trim() || null,
    notes: fields.notes?.trim() || null
  });
  await createAudit("guest", guest.id, "create", null, guest);
  return guest;
}

async function createBooking(fields) {
  const version = state.package_versions.find((item) => item.id === fields.package_version_id);
  if (!version) throw new Error("Package version not found.");
  let guestId = fields.guest_id;
  let bookingGuest = state.guests.find((guest) => guest.id === guestId);
  if (fields.new_guest_name?.trim()) {
    if (!fields.new_guest_phone?.trim()) throw new Error("Phone is required when creating a new guest.");
    const guest = await createGuest({
      full_name: fields.new_guest_name,
      phone: fields.new_guest_phone,
      alternate_contact_number: fields.new_guest_alternate,
      email: fields.new_guest_email,
      notes: ""
    });
    guestId = guest.id;
    bookingGuest = guest;
  }
  if (!guestId) throw new Error("Select an existing guest or create a new guest.");
  const range = buildBookingRange(fields, version);
  const payload = {
    guest_id: guestId,
    package_version_id: fields.package_version_id,
    status: fields.status,
    start_at: range.start_at,
    end_at: range.end_at,
    pax_count: Number(fields.pax_count),
    base_price: calculateBasePrice(version, range.start_at, range.end_at),
    security_deposit_amount: Number(fields.security_deposit_amount || DEFAULT_SECURITY_DEPOSIT),
    notes: fields.notes?.trim() || null
  };
  const [booking] = await insert("bookings", payload);
  await createAudit("booking", booking.id, "create", null, booking);

  if (fields.deposit_received === "on") {
    await recordAutomatedLedger({
      booking_id: booking.id,
      wallet_id: fields.deposit_wallet_id,
      account_type: "Security Deposit Liability",
      amount: Number(fields.deposit_amount),
      description: "Security deposit received at booking creation"
    });
  }

  if (fields.package_payment_received === "on") {
    await recordAutomatedLedger({
      booking_id: booking.id,
      wallet_id: fields.package_payment_wallet_id,
      account_type: "Revenue",
      amount: Number(fields.package_payment_amount),
      description: "Package payment received at booking creation"
    });
  }

  return {
    booking,
    confirmationMessage: bookingGuest?.email ? "Confirmation email queued" : "No guest email; confirmation skipped"
  };
}

async function updateBookingNotes(fields) {
  const before = state.bookings.find((booking) => booking.id === fields.booking_id);
  if (!before) throw new Error("Booking not found.");
  const [after] = await update("bookings", fields.booking_id, {
    notes: fields.notes?.trim() || null
  });
  await createAudit("booking", fields.booking_id, "notes_update", before, after, "Internal notes updated");
  bookingActionContext = { booking: after };
}

async function updateBookingDetails(fields) {
  const before = state.bookings.find((booking) => booking.id === fields.booking_id);
  if (!before) throw new Error("Booking not found.");
  const version = state.package_versions.find((item) => item.id === fields.package_version_id);
  if (!version) throw new Error("Package version not found.");
  const range = buildBookingRange(fields, version);
  const payload = {
    guest_id: fields.guest_id,
    package_version_id: fields.package_version_id,
    start_at: range.start_at,
    end_at: range.end_at,
    pax_count: Number(fields.pax_count),
    base_price: calculateBasePrice(version, range.start_at, range.end_at),
    security_deposit_amount: Number(fields.security_deposit_amount || DEFAULT_SECURITY_DEPOSIT),
    notes: fields.notes?.trim() || null
  };

  const oldRange = formatRange(before);
  const newRange = `${formatDate(range.start_at)} to ${formatDate(range.end_at)}`;
  const dateChanged = before.start_at !== range.start_at || before.end_at !== range.end_at;
  try {
    const [after] = await update("bookings", fields.booking_id, payload);
    await createAudit(
      "booking",
      fields.booking_id,
      dateChanged ? "booking_reschedule" : "booking_edit",
      before,
      after,
      dateChanged ? `Rescheduled from ${oldRange} to ${newRange}` : "Booking edited"
    );
    editBookingContext = null;
    bookingActionContext = { booking: after };
  } catch (error) {
    if (error.message?.toLowerCase().includes("bookings_no_active_overlap")) {
      throw new Error("Selected dates are unavailable because they overlap another active booking.");
    }
    throw error;
  }
}

async function cancelBooking(fields) {
  const before = state.bookings.find((booking) => booking.id === fields.booking_id);
  if (!before) throw new Error("Booking not found.");
  if (!fields.reason?.trim()) throw new Error("Cancellation reason is required.");
  const [after] = await update("bookings", fields.booking_id, { status: "Cancelled" });
  await createAudit("booking", fields.booking_id, "status_change", before, after, `Cancelled: ${fields.reason.trim()}`);
  cancelBookingContext = null;
  bookingActionContext = { booking: after };
}

function bindDatePickerOpeners() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.addEventListener("click", () => {
      input.showPicker?.();
    });
  });
}

function bindModalBackdropClose() {
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target !== backdrop) return;
      closeAllModals();
      render();
    });
  });
}

function closeAllModals() {
  createBookingContext = null;
  bookingActionContext = null;
  quickBookingContext = null;
  guestProfileContext = null;
  editBookingContext = null;
  cancelBookingContext = null;
  transactionContext = null;
  confirmBookingDeposit = null;
  checkinPayment = null;
  checkoutSettlement = null;
  postStaySendConfirmId = null;
  guestMemoryDraft = null;
}

async function confirmBookingWithDeposit(fields) {
  const booking = state.bookings.find((item) => item.id === fields.booking_id);
  if (!booking) throw new Error("Booking not found.");
  if (booking.status !== "Deposit Requested") throw new Error("Only Deposit Requested bookings can be confirmed here.");
  const amount = Number(fields.deposit_amount || 0);
  const depositDue = depositBalanceDue(booking);
  const alreadyReceived = Number(booking.total_deposit_received || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Security deposit amount cannot be negative.");
  if (amount > depositDue) throw new Error("Security deposit payment cannot be higher than remaining deposit balance.");
  if (amount <= 0 && alreadyReceived <= 0) throw new Error("Record the received security deposit or reservation fee before confirming.");
  if (amount > 0 && !fields.deposit_wallet_id) throw new Error("Deposit wallet is required.");
  if (amount > 0) {
    await recordAutomatedLedger({
      booking_id: booking.id,
      wallet_id: fields.deposit_wallet_id,
      account_type: "Security Deposit Liability",
      amount,
      description: fields.notes?.trim() || "Security deposit received before booking confirmation",
      reference_number: fields.reference_number,
      proof_note: fields.proof_note
    });
  }
  const [after] = await update("bookings", booking.id, { status: "Confirmed" });
  await createAudit("booking", booking.id, "status_change", booking, after, "Booking confirmed after payment verification");
  confirmBookingDeposit = null;
  bookingActionContext = null;
}

async function archiveBooking(booking) {
  if (!["Completed", "Cancelled", "Refunded"].includes(booking.status)) {
    throw new Error("Only Completed, Cancelled, or Refunded bookings can be archived.");
  }
  const [after] = await update("bookings", booking.id, { status: "Archived" });
  await createAudit("booking", booking.id, "status_change", booking, after, "Booking archived");
  bookingActionContext = null;
  await loadData();
  showMessage("Booking archived.", "success");
}

async function createWallet(fields) {
  const [wallet] = await insert("wallets", {
    name: fields.name.trim(),
    sort_order: Number(fields.sort_order || 100),
    is_active: true
  });
  await createAudit("wallet", wallet.id, "create", null, wallet);
}

async function createDrinkProduct(fields) {
  const [product] = await insert("drink_products", {
    name: fields.name.trim(),
    category: fields.category.trim(),
    cost_per_case: Number(fields.cost_per_case || 0),
    selling_price_per_case: Number(fields.selling_price_per_case || 0),
    commission_per_case: Number(fields.commission_per_case || 0),
    is_active: true
  });
  await createAudit("drink_product", product.id, "create", null, product);
}

async function recordDrinkMovement(fields) {
  if (fields.movement_type === "sale") throw new Error("Use Record Drink Sale for sales.");
  const quantity = Number(fields.quantity_cases || 0);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Quantity must not be zero.");
  if (fields.movement_type !== "adjustment" && quantity <= 0) throw new Error("Quantity must be positive.");
  const [movement] = await insert("drink_inventory_movements", {
    movement_date: fields.movement_date,
    product_id: fields.product_id,
    movement_type: fields.movement_type,
    quantity_cases: quantity,
    wallet_id: fields.wallet_id || null,
    booking_id: fields.booking_id || null,
    notes: fields.notes?.trim() || null
  });
  await createAudit("drink_inventory_movement", movement.id, "create", null, movement, "Drink inventory movement recorded");
}

async function recordDrinkSale(fields) {
  const product = state.drink_products.find((item) => item.id === fields.product_id && item.is_active);
  if (!product) throw new Error("Active drink product is required.");
  const quantity = Number(fields.quantity_cases || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be positive.");
  if (drinkCurrentStock(state, product.id) < quantity) throw new Error("Not enough drink stock.");

  const salesAmount = quantity * Number(product.selling_price_per_case || 0);
  const costAmount = quantity * Number(product.cost_per_case || 0);
  const commissionAmount = quantity * Number(product.commission_per_case || 0);
  const netProfit = salesAmount - costAmount - commissionAmount;
  const [entry] = await insert("ledger_entries", {
    booking_id: null,
    entry_date: fields.sale_date,
    description: `Drink sale - ${product.name}`,
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.wallet_id,
    account_type: "Revenue",
    amount: salesAmount
  });
  const [sale] = await insert("drink_sales", {
    sale_date: fields.sale_date,
    product_id: product.id,
    booking_id: fields.booking_id || null,
    quantity_cases: quantity,
    wallet_id: fields.wallet_id,
    sales_amount: salesAmount,
    cost_amount: costAmount,
    commission_amount: commissionAmount,
    net_profit: netProfit,
    notes: fields.notes?.trim() || null,
    ledger_entry_id: entry.id
  });
  const [movement] = await insert("drink_inventory_movements", {
    movement_date: fields.sale_date,
    product_id: product.id,
    movement_type: "sale",
    quantity_cases: quantity,
    wallet_id: fields.wallet_id,
    booking_id: fields.booking_id || null,
    notes: fields.notes?.trim() || null,
    ledger_entry_id: entry.id
  });
  await createAudit("drink_sale", sale.id, "create", null, { sale, movement, entry, line }, "Drink sale recorded");
}

async function recordElectricityBaseline(fields) {
  const startMeter = Number(fields.start_meter || 0);
  const rate = Number(fields.rate_per_kwh || 0);
  if (!Number.isFinite(startMeter) || startMeter <= 0) throw new Error("Starting reading must be positive.");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Rate per kWh must be positive.");
  const [baseline] = await insert("electricity_monthly_baselines", {
    billing_period_month: `${fields.billing_period_month}-01`,
    start_meter: startMeter,
    rate_per_kwh: rate,
    notes: fields.notes?.trim() || null
  });
  await createAudit("electricity_baseline", baseline.id, "create", null, baseline, "Monthly electricity baseline recorded");
}

async function recordElectricityReading(fields) {
  const baseline = state.electricity_monthly_baselines.find((item) => item.id === fields.baseline_id);
  if (!baseline) throw new Error("Monthly starting reading is required first.");
  const currentMeter = Number(fields.current_meter || 0);
  if (!Number.isFinite(currentMeter) || currentMeter <= 0) throw new Error("Current reading must be positive.");
  if (currentMeter < Number(baseline.start_meter)) throw new Error("Current reading cannot be lower than starting reading.");
  const [reading] = await insert("electricity_readings", {
    baseline_id: baseline.id,
    reading_date: fields.reading_date,
    current_meter: currentMeter,
    notes: fields.notes?.trim() || null
  });
  await createAudit("electricity_reading", reading.id, "create", null, reading, "Electricity current reading recorded");
}

async function deleteBookingForTesting(booking) {
  if (!isManagerViewUnlocked()) throw new Error("Manager View is required for testing deletes.");
  const managerCode = window.prompt("Enter Manager Security Code");
  if (!managerCode) return;

  const expected = `DELETE ${booking.booking_code}`;
  const confirmation = window.prompt(`Type ${expected} to permanently delete this test booking and all linked records.`);
  if (confirmation !== expected) throw new Error(`Confirmation text must exactly match ${expected}.`);

  const deleted = await rpc("delete_test_booking", {
    input_booking_id: booking.id,
    manager_code: managerCode,
    confirmation_text: confirmation
  });
  if (!deleted) throw new Error("Booking delete failed.");

  bookingActionContext = null;
  await loadData();
  showMessage("Booking deleted.", "success");
}

async function recordLedger(fields) {
  const managerOk = await rpc("verify_manager_security_code", { input_code: fields.manager_code });
  if (!managerOk) throw new Error("Wrong Manager Security Code.");
  if (fields.account_type === "Transfer") throw new Error("Transfer is reserved for a future phase.");
  if (fields.account_type === "Expense") throw new Error("Use Record Expense for expenses.");
  const [entry] = await insert("ledger_entries", {
    booking_id: fields.booking_id,
    entry_date: new Date().toISOString().slice(0, 10),
    description: fields.description?.trim() || fields.account_type,
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.wallet_id,
    account_type: fields.account_type,
    amount: Number(fields.amount)
  });
  await createAudit("ledger_entry", entry.id, "create", null, { entry, line });
}

async function recordExpense(fields) {
  const amount = Number(fields.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Expense amount must be positive.");
  const [entry] = await insert("ledger_entries", {
    booking_id: fields.booking_id || null,
    entry_date: fields.expense_date,
    description: `Expense - ${fields.category}: ${fields.description}`,
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.wallet_id,
    account_type: "Expense",
    amount: -amount
  });
  const [expense] = await insert("expenses", {
    expense_date: fields.expense_date,
    category: fields.category,
    description: fields.description.trim(),
    vendor_payee: fields.vendor_payee?.trim() || null,
    amount,
    wallet_id: fields.wallet_id,
    booking_id: fields.booking_id || null,
    notes: fields.notes?.trim() || null,
    ledger_entry_id: entry.id
  });
  await createAudit("ledger_entry", entry.id, "expense_create", null, { entry, line, expense }, "Expense recorded");
}

async function recordTransfer(fields) {
  const amount = Number(fields.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Transfer amount must be positive.");
  if (fields.source_wallet_id === fields.destination_wallet_id) throw new Error("Source and destination wallet cannot be the same.");
  const [entry] = await insert("ledger_entries", {
    booking_id: null,
    entry_date: fields.transfer_date,
    description: fields.description?.trim() || "Wallet transfer",
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const lines = await insert("ledger_lines", [
    {
      ledger_entry_id: entry.id,
      wallet_id: fields.source_wallet_id,
      account_type: "Transfer",
      amount: -amount
    },
    {
      ledger_entry_id: entry.id,
      wallet_id: fields.destination_wallet_id,
      account_type: "Transfer",
      amount
    }
  ]);
  await createAudit("ledger_entry", entry.id, "transfer_create", null, { entry, lines }, "Wallet transfer recorded");
}

async function recordOwnerHarvest(fields) {
  const managerOk = await rpc("verify_manager_security_code", { input_code: fields.manager_code });
  if (!managerOk) throw new Error("Wrong Manager Security Code.");
  const amount = Number(fields.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Harvest amount must be positive.");
  if (!fields.source_wallet_id) throw new Error("Source wallet is required.");
  if (!fields.reason_notes?.trim()) throw new Error("Reason is required.");
  const balance = walletBalance(state, fields.source_wallet_id);
  if (amount > balance) throw new Error("Cannot harvest more than current wallet balance.");
  const [entry] = await insert("ledger_entries", {
    booking_id: null,
    entry_date: fields.harvest_date,
    description: `Owner Harvest - ${fields.harvest_type}`,
    status: "posted"
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.source_wallet_id,
    account_type: "Owner Harvest",
    amount: -amount
  });
  const [harvest] = await insert("owner_harvests", {
    harvest_date: fields.harvest_date,
    source_wallet_id: fields.source_wallet_id,
    amount,
    harvest_type: fields.harvest_type,
    reason_notes: fields.reason_notes.trim(),
    destination: fields.destination?.trim() || null,
    ledger_entry_id: entry.id
  });
  await createAudit("owner_harvest", harvest.id, "create", null, { harvest, entry, line }, "Owner harvest recorded");
}

async function updateAutomationStatus(id, status, errorMessage = "") {
  const ok = await rpc("set_automation_queue_status", {
    input_queue_id: id,
    input_status: status,
    input_error_message: errorMessage
  });
  if (!ok) throw new Error("Automation queue update failed.");
}

async function sendQueuedEmail(id) {
  if (!id) throw new Error("Queue an email first.");
  let response;
  try {
    response = await fetch("/api/automation/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue_id: id })
    });
  } catch (error) {
    const reason = `Email server unreachable: ${error.message}`;
    await markAutomationFailed(id, reason);
    throw new Error(reason);
  }

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    const reason = `Email server returned an unreadable response: ${raw.slice(0, 180) || response.statusText}`;
    await markAutomationFailed(id, reason);
    throw new Error(reason);
  }

  if (!response.ok || data?.ok === false) {
    const reason = data?.error || response.statusText || "Email sending failed.";
    await markAutomationFailed(id, reason);
    throw new Error(reason);
  }
  return data;
}

async function markAutomationFailed(id, reason) {
  try {
    await updateAutomationStatus(id, "failed", reason);
  } catch (error) {
    throw new Error(`${reason} Also failed to update automation status: ${error.message}`);
  }
}

async function sendBookingAutomationNow(bookingId, type) {
  if (type !== "booking_confirmation") throw new Error("Only booking confirmation email can be sent.");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (booking?.status !== "Confirmed") throw new Error("Confirm booking first before sending confirmation email.");
  await queueBookingAutomation(bookingId, type);
  const rows = await select("automation_queue", {
    query: `booking_id=eq.${encodeURIComponent(bookingId)}&automation_type=eq.${encodeURIComponent(type)}&limit=1`
  });
  const record = rows?.[0];
  if (!record) throw new Error("Email queue record was not created.");
  if (!canSendAutomation(record)) throw new Error("Email is already sent, skipped, or missing guest email.");
  await sendQueuedEmail(record.id);
}

async function queueBookingAutomation(bookingId, type) {
  await rpc("queue_booking_automation", {
    input_booking_id: bookingId,
    input_type: type
  });
}

async function recordDailyClosing(fields) {
  const managerOk = await rpc("verify_manager_security_code", { input_code: fields.manager_code });
  if (!managerOk) throw new Error("Wrong Manager Security Code.");
  const expected = walletBalance(state, fields.wallet_id);
  const actual = Number(fields.actual_counted_amount || 0);
  const [closing] = await insert("daily_closings", {
    closing_date: fields.closing_date,
    wallet_id: fields.wallet_id,
    expected_balance: expected,
    actual_counted_amount: actual,
    difference: actual - expected,
    notes: fields.notes?.trim() || null,
    closed_by: "Manager"
  });
  await createAudit("daily_closing", closing.id, "create", null, closing, "Daily closing recorded");
}

async function reverseLedgerEntry(entry, managerCode, reason) {
  const managerOk = await rpc("verify_manager_security_code", { input_code: managerCode });
  if (!managerOk) throw new Error("Wrong Manager Security Code.");
  const originalLines = state.ledger_lines.filter((line) => line.ledger_entry_id === entry.id);
  if (!originalLines.length) throw new Error("Transaction has no ledger lines to reverse.");
  if (entry.status !== "posted" || entry.reversed_at) throw new Error("Transaction is already voided or reversed.");

  const [reversalEntry] = await insert("ledger_entries", {
    booking_id: entry.booking_id,
    entry_date: new Date().toISOString().slice(0, 10),
    description: `Reversal: ${entry.description}`,
    status: "posted",
    reference_number: entry.reference_number || null,
    proof_note: reason.trim(),
    reversed_entry_id: entry.id,
    reversal_reason: reason.trim()
  });
  const reversalLines = await insert("ledger_lines", originalLines.map((line) => ({
    ledger_entry_id: reversalEntry.id,
    wallet_id: line.wallet_id,
    account_type: line.account_type,
    amount: -Number(line.amount)
  })));
  const [updatedEntry] = await update("ledger_entries", entry.id, {
    reversed_at: new Date().toISOString(),
    reversal_reason: reason.trim()
  });
  await createAudit("ledger_entry", entry.id, "reverse", entry, { updatedEntry, reversalEntry, reversalLines }, reason.trim());
}

async function recordActionTransaction(fields) {
  const booking = state.bookings.find((item) => item.id === fields.booking_id);
  if (!booking) throw new Error("Booking not found.");
  const amount = Number(fields.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive.");
  if (fields.account_type === "Security Deposit Liability" && amount > depositBalanceDue(booking)) {
    throw new Error("Security deposit payment cannot be higher than remaining deposit balance.");
  }
  if (fields.account_type === "Revenue" && fields.no_limit !== "true" && amount > packageBalanceDue(booking)) {
    throw new Error("Package payment cannot be higher than balance due.");
  }

  const [entry] = await insert("ledger_entries", {
    booking_id: fields.booking_id,
    entry_date: new Date().toISOString().slice(0, 10),
    description: fields.description?.trim() || "Booking transaction",
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.wallet_id,
    account_type: fields.account_type,
    amount
  });
  await createAudit("ledger_entry", entry.id, "create", null, { entry, line });
  transactionContext = null;
}

async function recordAutomatedLedger(fields) {
  if (!fields.wallet_id) throw new Error(`${fields.account_type} wallet is required.`);
  if (!Number.isFinite(fields.amount) || fields.amount <= 0) throw new Error(`${fields.account_type} amount must be positive.`);

  const [entry] = await insert("ledger_entries", {
    booking_id: fields.booking_id,
    entry_date: new Date().toISOString().slice(0, 10),
    description: fields.description,
    status: "posted",
    reference_number: fields.reference_number?.trim() || null,
    proof_note: fields.proof_note?.trim() || null
  });
  const [line] = await insert("ledger_lines", {
    ledger_entry_id: entry.id,
    wallet_id: fields.wallet_id,
    account_type: fields.account_type,
    amount: fields.amount
  });
  await createAudit("ledger_entry", entry.id, "create", null, { entry, line });
}

async function confirmCheckinPayment(fields) {
  const booking = state.bookings.find((item) => item.id === fields.booking_id);
  if (!booking) throw new Error("Booking not found.");
  const packageDue = packageBalanceDue(booking);
  const depositDue = depositBalanceDue(booking);
  const packageAmount = Number(fields.package_payment_amount || 0);
  const depositAmount = Number(fields.deposit_payment_amount || 0);

  if (packageAmount < 0 || depositAmount < 0) throw new Error("Payment amounts cannot be negative.");
  if (packageAmount > packageDue) throw new Error("Package payment cannot be higher than balance due.");
  if (depositAmount > depositDue) throw new Error("Security deposit payment cannot be higher than remaining deposit balance.");
  if (packageAmount > 0 && !fields.package_wallet_id) throw new Error("Package payment wallet is required.");
  if (depositAmount > 0 && !fields.deposit_wallet_id) throw new Error("Security deposit wallet is required.");

  const ok = await rpc("perform_checkin_payment", {
    input_booking_id: fields.booking_id,
    package_payment_amount: packageAmount,
    package_wallet_id: packageAmount > 0 ? fields.package_wallet_id : null,
    deposit_payment_amount: depositAmount,
    deposit_wallet_id: depositAmount > 0 ? fields.deposit_wallet_id : null,
    payment_notes: fields.payment_notes || "Check-in payment confirmation",
    start_meter_reading: fields.start_meter_reading ? Number(fields.start_meter_reading) : null
  });
  if (!ok) throw new Error("Check-in confirmation failed.");

  checkinPayment = null;
}

async function confirmCheckoutSettlement(fields) {
  const booking = state.bookings.find((item) => item.id === fields.booking_id);
  if (!booking) throw new Error("Booking not found.");
  const refundable = refundableDepositBalance(booking);
  const damageAmount = Number(fields.damage_amount || 0);
  const refundAmount = Number(fields.refund_amount || 0);

  if (damageAmount < 0) throw new Error("Damage/Penalty deduction cannot be negative.");
  if (refundAmount < 0) throw new Error("Refund amount cannot be negative.");
  if (refundAmount > refundable) throw new Error("Refund amount cannot be higher than refundable balance.");
  if (refundAmount > 0 && !fields.refund_wallet_id) throw new Error("Refund wallet is required.");

  const ok = await rpc("perform_checkout_settlement", {
    input_booking_id: fields.booking_id,
    damage_amount: damageAmount,
    damage_reason: fields.reason || "Checkout settlement",
    refund_amount: refundAmount,
    refund_wallet_id: refundAmount > 0 ? fields.refund_wallet_id : null,
    end_meter_reading: fields.end_meter_reading ? Number(fields.end_meter_reading) : null,
    electricity_rate_per_kwh: fields.electricity_rate_per_kwh ? Number(fields.electricity_rate_per_kwh) : null
  });
  if (!ok) throw new Error("Checkout settlement failed.");

  checkoutSettlement = null;
}

async function unlockSecurity(fields) {
  const lock = getAttemptLock(managerAttemptsKey);
  if (lock.locked) throw new Error(`Security settings locked. Try again in ${lock.minutes} minute(s).`);
  const ok = await rpc("verify_manager_security_code", { input_code: fields.manager_code });
  if (!ok) {
    registerFailedAttempt(managerAttemptsKey, 5, 15);
    throw new Error("Wrong Manager Security Code.");
  }
  resetAttempts(managerAttemptsKey);
  securityUnlocked = true;
}

async function changePmsCode(fields) {
  const ok = await rpc("change_pms_access_code", {
    manager_code: fields.manager_code,
    new_pms_code: fields.new_pms_code
  });
  if (!ok) throw new Error("Wrong Manager Security Code.");
  resetAttempts(pmsAttemptsKey);
}

async function changeManagerCode(fields) {
  const ok = await rpc("change_manager_security_code", {
    current_manager_code: fields.current_manager_code,
    new_manager_code: fields.new_manager_code
  });
  if (!ok) throw new Error("Wrong Manager Security Code.");
  resetAttempts(managerAttemptsKey);
  securityUnlocked = false;
}

async function previewAdminMonthCleanup(fields) {
  if (!isManagerViewUnlocked()) throw new Error("Manager View is required for Admin Tools.");
  const result = await rpc("admin_delete_data_by_month", {
    input_year: Number(fields.input_year),
    input_month: Number(fields.input_month),
    manager_code: fields.manager_code,
    confirmation_text: "",
    dry_run: true
  });
  adminCleanupPreview = {
    ...result,
    input_year: Number(fields.input_year),
    input_month: Number(fields.input_month)
  };
}

async function deleteAdminMonthData(fields) {
  if (!isManagerViewUnlocked()) throw new Error("Manager View is required for Admin Tools.");
  if (!adminCleanupPreview) throw new Error("Run preview before deleting month data.");
  if (Number(fields.input_year) !== Number(adminCleanupPreview.input_year)
      || Number(fields.input_month) !== Number(adminCleanupPreview.input_month)) {
    throw new Error("Preview month changed. Run preview again.");
  }
  if (fields.confirmation_text !== adminCleanupPreview.expected_confirmation) {
    throw new Error(`Confirmation text must exactly match ${adminCleanupPreview.expected_confirmation}.`);
  }
  await rpc("admin_delete_data_by_month", {
    input_year: Number(fields.input_year),
    input_month: Number(fields.input_month),
    manager_code: fields.manager_code,
    confirmation_text: fields.confirmation_text,
    dry_run: false
  });
}

async function createAudit(entity_type, entity_id, action, before_data, after_data, reason = "") {
  await insert("audit_logs", {
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    reason,
    user_agent: navigator.userAgent
  }, { returning: "minimal" });
}

function isAccessUnlocked() {
  return sessionStorage.getItem(accessSessionKey) === "true";
}

function isManagerViewUnlocked() {
  return sessionStorage.getItem(managerViewSessionKey) === "true";
}

function getAttemptLock(key) {
  const record = readAttemptRecord(key);
  if (!record.locked_until || Date.now() >= record.locked_until) return { locked: false, minutes: 0 };
  return {
    locked: true,
    minutes: Math.ceil((record.locked_until - Date.now()) / 60000)
  };
}

function registerFailedAttempt(key, maxAttempts, lockMinutes) {
  const record = readAttemptRecord(key);
  const attempts = Number(record.attempts || 0) + 1;
  const next = { attempts, locked_until: null };
  if (attempts >= maxAttempts) {
    next.attempts = 0;
    next.locked_until = Date.now() + lockMinutes * 60000;
  }
  localStorage.setItem(key, JSON.stringify(next));
}

function resetAttempts(key) {
  localStorage.removeItem(key);
}

function readAttemptRecord(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function hydrateBookingDateForm() {
  document.querySelectorAll("[data-booking-date-form]").forEach((form) => {
    const packageSelect = form.querySelector("[data-booking-package]");
    if (!packageSelect) return;

    const checkoutField = form.querySelector("[data-checkout-field]");
    const checkoutInput = checkoutField?.querySelector("input");
    const summary = form.querySelector("[data-booking-time-summary]");
    const priceSummary = form.querySelector("[data-booking-price-summary]");
    const checkinInput = form.querySelector("input[name='checkin_date']");

    const refresh = () => {
      const version = state.package_versions.find((item) => item.id === packageSelect.value);
      const overnight = Boolean(version?.is_overnight);
      if (checkoutField) checkoutField.hidden = !overnight;
      if (checkoutInput) checkoutInput.required = overnight;
      if (checkinInput?.value && overnight && !checkoutInput.value) {
        checkoutInput.value = addDaysToDateInput(checkinInput.value, 1);
      }
      if (summary && version) {
        summary.textContent = overnight
          ? "Time will be set automatically: 3:00 PM check-in to 12:00 PM check-out."
          : "Time will be set automatically: 3:00 PM to 11:00 PM on the selected date.";
      }
      if (priceSummary && version) {
        try {
          if (!checkinInput?.value) {
            priceSummary.textContent = "Choose dates to calculate price.";
            return;
          }
          const range = buildBookingRange({
            checkin_date: checkinInput.value,
            checkout_date: checkoutInput?.value || ""
          }, version);
          const basePrice = calculateBasePrice(version, range.start_at, range.end_at);
          if (overnight) {
            const nights = bookingNightCount(version, range.start_at, range.end_at);
            priceSummary.textContent = `${nights} night${nights === 1 ? "" : "s"} x ${money(version.price)} = ${money(basePrice)} package price.`;
          } else {
            priceSummary.textContent = `Day Use flat package price: ${money(basePrice)}.`;
          }
        } catch (error) {
          priceSummary.textContent = error.message;
        }
      }
    };

    packageSelect.addEventListener("change", refresh);
    checkinInput?.addEventListener("change", refresh);
    checkoutInput?.addEventListener("change", refresh);
    refresh();
  });
}

function hydrateCheckoutSettlementForm() {
  const damageInput = document.querySelector("[data-damage-amount]");
  const refundInput = document.querySelector("[data-refund-amount]");
  if (!damageInput || !refundInput || !checkoutSettlement?.booking) return;

  const refundable = refundableDepositBalance(checkoutSettlement.booking);
  const refresh = () => {
    const damage = Math.max(Number(damageInput.value || 0), 0);
    const refund = Math.max(refundable - damage, 0);
    refundInput.value = String(refund);
  };

  damageInput.addEventListener("input", refresh);
}

function walletOptions() {
  return state.wallets
    .filter((wallet) => wallet.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((wallet) => `<option value="${wallet.id}">${escapeHtml(wallet.name)}</option>`)
    .join("");
}

function activeDrinkProducts() {
  return state.drink_products
    .filter((product) => product.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function latestElectricityBaseline() {
  return [...state.electricity_monthly_baselines]
    .sort((a, b) => String(b.billing_period_month).localeCompare(String(a.billing_period_month)) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

function electricityReadingsForBaseline(baselineId) {
  if (!baselineId) return [];
  return state.electricity_readings
    .filter((reading) => reading.baseline_id === baselineId)
    .sort((a, b) => String(b.reading_date).localeCompare(String(a.reading_date)) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function electricitySummary(baseline, reading) {
  if (!baseline || !reading) return { kwh_used: 0, estimated_amount: 0 };
  const kwhUsed = Math.max(Number(reading.current_meter || 0) - Number(baseline.start_meter || 0), 0);
  return {
    kwh_used: kwhUsed,
    estimated_amount: kwhUsed * Number(baseline.rate_per_kwh || 0)
  };
}

function ownerHarvestTotals() {
  const month = todayInputValue().slice(0, 7);
  return state.owner_harvests.reduce((totals, harvest) => {
    const amount = Number(harvest.amount || 0);
    totals.allTime += amount;
    if (String(harvest.harvest_date || "").startsWith(month)) totals.thisMonth += amount;
    return totals;
  }, { thisMonth: 0, allTime: 0 });
}

function currentMonthInput() {
  return todayInputValue().slice(0, 7);
}

function formatMonth(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "No month";
}

function drinkProductName(id) {
  return escapeHtml(state.drink_products.find((product) => product.id === id)?.name || "Unknown drink");
}

function drinkMovementLabel(type) {
  const labels = {
    purchase_add_stock: "Purchase / Add Stock",
    sale: "Sale",
    damage_spoilage: "Damage / Spoilage",
    adjustment: "Adjustment"
  };
  return labels[type] || type;
}

function automationTypeLabel(type) {
  const labels = {
    booking_confirmation: "Booking Confirmation",
    thank_you: "Post-Stay Email"
  };
  return labels[type] || type;
}

function automationGuestName(item) {
  const booking = state.bookings.find((entry) => entry.id === item.booking_id);
  if (!booking) return escapeHtml(item.guest_email || "Unknown guest");
  const guest = state.guests.find((entry) => entry.id === booking.guest_id);
  return escapeHtml(guest?.full_name || item.guest_email || "Unknown guest");
}

function automationRecordsForBooking(bookingId) {
  return state.automation_queue.filter((item) => item.booking_id === bookingId);
}

function formatCases(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function packageBalanceDue(booking) {
  return Math.max(Number(booking.base_price || 0) - Number(booking.total_revenue || 0), 0);
}

function depositBalanceDue(booking) {
  return Math.max(Number(booking.security_deposit_amount || 0) - Number(booking.total_deposit_received || 0), 0);
}

function refundableDepositBalance(booking) {
  return Math.max(Number(booking.total_deposit_received || 0) - Number(booking.total_deposit_refunded || 0), 0);
}

function depositDisplayStatus(booking) {
  if (Number(booking.total_deposit_received || 0) <= 0) return "Not Requested / Pending";
  if (Number(booking.total_deposit_refunded || 0) >= Number(booking.total_deposit_received || 0)) return "Refunded";
  if (Number(booking.total_deposit_received || 0) >= Number(booking.security_deposit_amount || 0)) return "Received";
  return "Partially Received";
}

function meterValue(value) {
  if (value == null || value === "") return "Not recorded";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function filteredBookings() {
  const query = bookingSearchQuery.trim().toLowerCase();
  if (!query) return state.bookings.filter((booking) => booking.status !== "Archived");
  return state.bookings.filter((booking) => {
    const guest = state.guests.find((item) => item.id === booking.guest_id);
    return [
      booking.booking_code,
      guest?.full_name,
      guest?.phone,
      guest?.alternate_contact_number
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function filteredGuests() {
  const query = bookingSearchQuery.trim().toLowerCase();
  if (!query) return state.guests;
  const bookingGuestIds = new Set(filteredBookings().map((booking) => booking.guest_id));
  return state.guests.filter((guest) => {
    return bookingGuestIds.has(guest.id)
      || [guest.full_name, guest.phone, guest.alternate_contact_number].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function bookingsForGuest(guestId) {
  return state.bookings
    .filter((booking) => booking.guest_id === guestId)
    .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
}

function bookingTimeline(booking) {
  const events = timelineEventsForBooking(booking);
  if (!events.length) return `<p class="muted">No timeline events yet.</p>`;
  return `
    <ol class="timeline-list">
      ${events.map((event) => `
        <li>
          <span>${formatDate(event.at)}</span>
          <strong>${escapeHtml(event.title)}</strong>
          <p>${escapeHtml(event.detail)}</p>
        </li>`).join("")}
    </ol>`;
}

function timelineEventsForBooking(booking) {
  const events = [];
  if (booking.created_at) {
    events.push({
      at: booking.created_at,
      title: "Booking created",
      detail: `${booking.booking_code} for ${guestNameText(booking.guest_id)}`
    });
  }

  state.audit_logs
    .filter((log) => log.entity_type === "booking" && log.entity_id === booking.id)
    .forEach((log) => {
      events.push({
        at: log.created_at,
        title: auditTimelineTitle(log),
        detail: log.reason || auditTimelineDetail(log)
      });
    });

  state.ledger_entries
    .filter((entry) => entry.booking_id === booking.id)
    .forEach((entry) => {
      state.ledger_lines
        .filter((line) => line.ledger_entry_id === entry.id)
        .forEach((line) => {
          events.push({
            at: entry.created_at || entry.entry_date,
            title: ledgerTimelineTitle(line),
            detail: `${entry.description || line.account_type} / ${walletNameText(line.wallet_id)} / ${money(line.amount)}`
          });
        });
    });

  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

function auditTimelineTitle(log) {
  const titles = {
    create: "Booking created",
    status_change: "Status changed",
    checkin_payment: "Check-in",
    checkout_settlement: "Checkout completed",
    notes_update: "Notes updated",
    delete_failed: "Delete attempt failed",
    delete_blocked: "Delete blocked",
    delete: "Booking deleted"
  };
  return titles[log.action] || log.action.replaceAll("_", " ");
}

function auditTimelineDetail(log) {
  if (log.after_data?.status) return `Status: ${log.after_data.status}`;
  if (log.after_data?.amount) return `Amount: ${money(log.after_data.amount)}`;
  return "Audit event recorded";
}

function ledgerTimelineTitle(line) {
  if (line.account_type === "Security Deposit Liability" && Number(line.amount) > 0) return "Deposit received";
  if (line.account_type === "Security Deposit Liability" && Number(line.amount) < 0) return "Refund recorded";
  if (line.account_type === "Revenue" && Number(line.amount) > 0) return "Package payment received";
  if (line.account_type === "Adjustment") return "Adjustment recorded";
  return line.account_type;
}

function buildBookingRange(fields, version) {
  if (!fields.checkin_date) throw new Error("Check-in date is required.");
  if (version.is_overnight && !fields.checkout_date) throw new Error("Check-out date is required for overnight packages.");

  const checkinDate = parseDateInput(fields.checkin_date);
  const checkoutDate = version.is_overnight
    ? parseDateInput(fields.checkout_date || addDaysToDateInput(fields.checkin_date, 1))
    : checkinDate;

  const start = dateAt(checkinDate, 15, 0);
  const end = version.is_overnight ? dateAt(checkoutDate, 12, 0) : dateAt(checkinDate, 23, 0);

  if (end <= start) throw new Error("Check-out date must be after check-in date.");

  return {
    start_at: start.toISOString(),
    end_at: end.toISOString()
  };
}

function parseDateInput(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateAt(date, hour, minute) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0);
}

function sameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function monthOptions(selectedMonth) {
  return Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    const label = new Date(2026, index, 1).toLocaleString([], { month: "long" });
    return `<option value="${value}" ${Number(selectedMonth) === value ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function addDaysToDateInput(value, days) {
  const date = parseDateInput(value);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function latestPackageVersion(packageId) {
  return state.package_versions
    .filter((version) => version.package_id === packageId)
    .sort((a, b) => Number(b.version_number) - Number(a.version_number))[0];
}

function packageRow(pkg) {
  const version = latestPackageVersion(pkg.id);
  if (!version) return `<tr><td>${escapeHtml(pkg.name)}</td><td colspan="5" class="muted">No version</td></tr>`;
  const time = version.is_overnight ? `${version.start_time} to next day ${version.end_time}` : `${version.start_time} to ${version.end_time}`;
  return `<tr><td>${escapeHtml(pkg.name)}</td><td>v${version.version_number}</td><td>${money(version.price)}</td><td>${version.included_pax}</td><td>${version.included_rooms}</td><td>${time}</td></tr>`;
}

function packageNameForBooking(booking) {
  const version = state.package_versions.find((item) => item.id === booking.package_version_id);
  const pkg = state.packages.find((item) => item.id === version?.package_id);
  return pkg ? `${pkg.name} v${version.version_number}` : "Package";
}

function bookingRow(booking) {
  const pkg = state.package_versions.find((version) => version.id === booking.package_version_id);
  const packageName = state.packages.find((item) => item.id === pkg?.package_id)?.name || "Package";
  return `<tr><td>${booking.booking_code}</td><td>${guestName(booking.guest_id)}</td><td><span class="pill">${booking.status}</span></td><td>${formatDate(booking.start_at)}</td><td>${formatDate(booking.end_at)}</td><td>${packageName} v${pkg?.version_number || ""}</td></tr>`;
}

function guestName(id) {
  return escapeHtml(guestNameText(id));
}

function guestNameText(id) {
  return state.guests.find((guest) => guest.id === id)?.full_name || "Unknown guest";
}

function guestLink(guest) {
  return `<button type="button" class="text-link" data-open-guest="${guest.id}">${escapeHtml(guest.full_name)}</button>`;
}

function guestLinkById(id) {
  const guest = state.guests.find((item) => item.id === id);
  return guest ? guestLink(guest) : "Unknown guest";
}

function guestPhone(id) {
  return escapeHtml(state.guests.find((guest) => guest.id === id)?.phone || "No contact number");
}

function walletName(id) {
  return escapeHtml(walletNameText(id));
}

function walletNameText(id) {
  return state.wallets.find((wallet) => wallet.id === id)?.name || "Unknown wallet";
}

function bookingCode(id) {
  if (!id) return "No booking";
  return escapeHtml(state.bookings.find((booking) => booking.id === id)?.booking_code || "Unknown booking");
}

function ledgerBookingId(entry) {
  if (entry?.booking_id) return entry.booking_id;
  return state.drink_sales.find((sale) => sale.ledger_entry_id === entry?.id)?.booking_id || null;
}

function formatRange(booking) {
  return `${formatDate(booking.start_at)} to ${formatDate(booking.end_at)}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

function emptyRow(columns) {
  return `<tr><td colspan="${columns}" style="padding:24px 8px;text-align:center;color:var(--muted);font-size:12px">No records yet</td></tr>`;
}

function showMessage(message, type = "") {
  const el = document.getElementById("statusMessage");
  el.textContent = message;
  el.className = `message${type === "error" ? " message--error" : type === "success" ? " message--success" : ""}`;
  el.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ── Feature 1: Booking Snapshot Card ──────────────────────────────

function bookingSnapshotCard(booking) {
  const balanceDue = packageBalanceDue(booking);
  const depStatus = depositDisplayStatus(booking);
  const checkin = formatDate(booking.start_at);
  const checkout = formatDate(booking.end_at);
  return `
    <div class="bm-snapshot">
      <div class="bm-snap-item"><span>Check-in</span><strong>${escapeHtml(checkin)}</strong></div>
      <div class="bm-snap-item"><span>Check-out</span><strong>${escapeHtml(checkout)}</strong></div>
      <div class="bm-snap-item"><span>Guests</span><strong>${booking.pax_count}</strong></div>
      <div class="bm-snap-item"><span>Package</span><strong>${escapeHtml(packageNameForBooking(booking))}</strong></div>
      <div class="bm-snap-item"><span>Total</span><strong>${money(booking.base_price)}</strong></div>
      <div class="bm-snap-item"><span>Paid</span><strong>${money(booking.total_revenue)}</strong></div>
      <div class="bm-snap-item${balanceDue > 0 ? " bm-snap-due" : ""}"><span>Balance</span><strong>${money(balanceDue)}</strong></div>
      <div class="bm-snap-item"><span>Deposit</span><strong>${escapeHtml(depStatus)}</strong></div>
    </div>`;
}

// ── Feature 2: Smart Warnings ──────────────────────────────────────

function bookingWarnings(booking) {
  const warnings = [];
  const balanceDue = packageBalanceDue(booking);
  const depDue = depositBalanceDue(booking);
  const guest = state.guests.find((g) => g.id === booking.guest_id);

  if (balanceDue > 0) {
    warnings.push(`Balance of ${money(balanceDue)} is unpaid.`);
  }
  if (depDue > 0 && Number(booking.security_deposit_amount) > 0) {
    warnings.push(`Security deposit is missing or partial — ${money(depDue)} outstanding.`);
  }
  if (guest && !guest.email) {
    warnings.push("Guest has no email address on file.");
  }
  if (booking.status === "Deposit Requested") {
    warnings.push("Booking is still Deposit Requested — not yet confirmed.");
  }
  if (booking.status === "Confirmed") {
    const records = automationRecordsForBooking(booking.id);
    const confirmation = records.find((r) => r.automation_type === "booking_confirmation");
    if (!confirmation) {
      warnings.push("Confirmation email has not been queued or sent.");
    } else if (confirmation.status === "failed") {
      warnings.push("Confirmation email failed to send — retry required.");
    }
  }

  if (!warnings.length) return "";
  return `
    <div class="bm-warnings">
      ${warnings.map((w) => `<div class="bm-warning">&#9888; ${escapeHtml(w)}</div>`).join("")}
    </div>`;
}

// ── Feature 4: Copy Buttons ────────────────────────────────────────

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showMessage("Copied to clipboard.", "success"),
      () => showMessage("Copy failed — clipboard unavailable.", "error")
    );
  } else {
    showMessage("Clipboard not available in this browser.", "error");
  }
}

function bookingCopyText(bookingId, type) {
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking) return;
  const guest = state.guests.find((g) => g.id === booking.guest_id);
  const gName = guestNameText(booking.guest_id);
  const balanceDue = packageBalanceDue(booking);
  const pkg = packageNameForBooking(booking);
  const checkin = formatDate(booking.start_at);
  const checkout = formatDate(booking.end_at);

  if (type === "summary") {
    copyText([
      `Booking Summary`,
      `Reference: ${booking.booking_code}`,
      `Guest: ${gName}`,
      `Package: ${pkg}`,
      `Check-in: ${checkin}`,
      `Check-out: ${checkout}`,
      `Guests: ${booking.pax_count}`,
      `Status: ${booking.status}`,
      `Total: ${money(booking.base_price)}`,
      `Paid: ${money(booking.total_revenue)}`,
      `Balance Due: ${money(balanceDue)}`,
      `Deposit: ${depositDisplayStatus(booking)}`
    ].join("\n"));
  } else if (type === "payment") {
    copyText([
      `Payment Instructions — ${booking.booking_code}`,
      `Guest: ${gName}`,
      `Balance Due: ${money(balanceDue)}`,
      `Please settle the balance before check-in.`,
      `Contact TRZ for payment details.`
    ].join("\n"));
  } else if (type === "guest") {
    copyText([
      `Guest: ${gName}`,
      `Phone: ${guest?.phone || "N/A"}`,
      `Alt: ${guest?.alternate_contact_number || "N/A"}`,
      `Email: ${guest?.email || "N/A"}`
    ].join("\n"));
  } else if (type === "arrival") {
    copyText([
      `Arrival Details — ${booking.booking_code}`,
      `Guest: ${gName}`,
      `Check-in: ${checkin}`,
      `The Resthouse Zamboanga`,
      `Please inform us of your arrival time in advance.`
    ].join("\n"));
  }
}

function bindCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      bookingCopyText(btn.dataset.bookingId, btn.dataset.copy);
    });
  });
}

// ── Feature 5: Prev / Next Booking Navigation ──────────────────────

function bindBookingNavButtons() {
  document.querySelectorAll("[data-booking-prev]").forEach((btn) => {
    if (!btn.dataset.bookingPrev) return;
    btn.addEventListener("click", () => {
      const booking = state.bookings.find((b) => b.id === btn.dataset.bookingPrev);
      if (!booking) return;
      bookingActionContext = { booking };
      render();
    });
  });
  document.querySelectorAll("[data-booking-next]").forEach((btn) => {
    if (!btn.dataset.bookingNext) return;
    btn.addEventListener("click", () => {
      const booking = state.bookings.find((b) => b.id === btn.dataset.bookingNext);
      if (!booking) return;
      bookingActionContext = { booking };
      render();
    });
  });
}

// ── Feature 6: Floating Quick Actions ─────────────────────────────

function renderFloatingActions() {
  document.getElementById("trz-fab")?.remove();
  if (!isAccessUnlocked()) return;

  const fab = document.createElement("div");
  fab.id = "trz-fab";
  fab.innerHTML = `
    <button type="button" id="trz-fab-toggle" title="Quick actions" aria-label="Quick actions">+</button>
    <div id="trz-fab-menu" hidden>
      <button type="button" data-fab-action="new-booking">New Booking</button>
      <button type="button" data-fab-action="go-bookings">Go to Bookings</button>
      <button type="button" data-fab-action="checkin-today">Check In Today</button>
      <button type="button" data-fab-action="checkout-today">Check Out Today</button>
    </div>`;
  document.body.appendChild(fab);

  fab.querySelector("#trz-fab-toggle").addEventListener("click", () => {
    const menu = fab.querySelector("#trz-fab-menu");
    menu.hidden = !menu.hidden;
    fab.querySelector("#trz-fab-toggle").textContent = menu.hidden ? "+" : "✕";
  });

  fab.querySelectorAll("[data-fab-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      fab.querySelector("#trz-fab-menu").hidden = true;
      fab.querySelector("#trz-fab-toggle").textContent = "+";
      const action = btn.dataset.fabAction;
      if (action === "new-booking") {
        createBookingContext = { checkin_date: "" };
        quickBookingContext = null;
        bookingActionContext = null;
        render();
      } else if (action === "go-bookings") {
        activeTab = "bookings";
        render();
      } else if (action === "checkin-today") {
        const today = new Date();
        const booking = state.bookings.find(
          (b) => sameLocalDate(new Date(b.start_at), today) &&
                 !["Checked In", "Completed", "Cancelled", "Archived", "Refunded"].includes(b.status)
        );
        if (booking) {
          bookingActionContext = { booking };
          createBookingContext = null;
          quickBookingContext = null;
          render();
        } else {
          showMessage("No check-in due today.", "");
        }
      } else if (action === "checkout-today") {
        const booking = state.bookings.find((b) => b.status === "Checked In");
        if (booking) {
          bookingActionContext = { booking };
          createBookingContext = null;
          quickBookingContext = null;
          render();
        } else {
          showMessage("No guest is currently checked in.", "");
        }
      }
    });
  });
}

// ── Feature 7: Quick Booking Popup ────────────────────────────────

function quickBookingPopup(context) {
  const packageOptions = state.packages.map((pkg) => {
    const version = latestPackageVersion(pkg.id);
    if (!version) return "";
    return `<option value="${version.id}">${escapeHtml(pkg.name)} v${version.version_number} — ${money(version.price)}</option>`;
  }).join("");

  return `
    <div class="modal-backdrop">
      <section class="panel modal quick-popup">
        <div class="bm-header">
          <div>
            <h2>Quick Booking</h2>
            <span class="bm-subtitle">${escapeHtml(context.date)}</span>
          </div>
          <button type="button" class="btn-close" data-action="close-modal">✕</button>
        </div>
        <p class="muted" style="font-size:12px;margin:0 0 16px">Fill in the basics, then continue to the full booking form.</p>
        <form data-action="quick-booking-prefill">
          <input type="hidden" name="date" value="${escapeHtml(context.date)}" />
          <label class="field"><span>Guest Name</span><input name="guest_name" required /></label>
          <label class="field"><span>Contact Number</span><input name="guest_phone" type="tel" required /></label>
          <label class="field"><span>Package</span><select name="package_version_id">${packageOptions}</select></label>
          <div class="actions">
            <button class="primary">Continue to Full Booking</button>
            <button type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </section>
    </div>`;
}

function bindQuickBookingPopup() {
  document.querySelector("[data-action='quick-booking-prefill']")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget).entries());
    quickBookingContext = null;
    createBookingContext = {
      checkin_date: fields.date,
      prefill: {
        guest_name: fields.guest_name,
        guest_phone: fields.guest_phone,
        package_version_id: fields.package_version_id
      }
    };
    render();
  });
}

// ── Post-Stay Email (Phase 6B) ────────────────────────────────────────

function sendingCountdown(scheduledFor) {
  const ms = new Date(scheduledFor) - Date.now();
  if (ms <= 0) return "soon";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function postStayEmailSection(record) {
  if (!record) {
    return `<div class="ps-section"><p class="muted">Post-Stay Email will appear here after checkout is completed.</p></div>`;
  }

  const isSent = record.status === "sent";
  const isPending = record.status === "pending";
  const isFailed = record.status === "failed";
  const isSkipped = record.status === "skipped";
  const scheduledMs = new Date(record.scheduled_for) - Date.now();
  const isDue = scheduledMs <= 0;
  const statusClass = isSent ? "ps-pill-sent" : isFailed ? "ps-pill-failed" : isSkipped ? "ps-pill-skipped" : "ps-pill-pending";

  if (postStaySendConfirmId === record.id) {
    const countdown = sendingCountdown(record.scheduled_for);
    return `
      <div class="ps-section ps-confirm-section">
        <p class="ps-confirm-msg">This Post-Stay Email is scheduled to send in <strong>${escapeHtml(countdown)}</strong>.</p>
        <p class="ps-confirm-msg muted">Send now instead?</p>
        <div class="actions">
          <button type="button" data-ps-cancel-confirm>Cancel</button>
          <button type="button" class="primary" data-ps-confirm-send="${escapeHtml(record.id)}">Send Now</button>
        </div>
      </div>`;
  }

  return `
    <div class="ps-section">
      <div class="ps-header">
        <span class="ps-label">Post-Stay Email</span>
        <span class="pill ${statusClass}">${escapeHtml(record.status)}</span>
      </div>
      <div class="ps-meta">
        <span>Scheduled: ${formatDate(record.scheduled_for)}</span>
        ${isPending && !isDue ? `<span class="ps-countdown">Sending in ${escapeHtml(sendingCountdown(record.scheduled_for))}</span>` : ""}
        ${isPending && isDue ? `<span class="ps-countdown ps-countdown--due">Sending soon</span>` : ""}
        ${isSent && record.sent_at ? `<span>Sent: ${formatDate(record.sent_at)}</span>` : ""}
        ${isFailed ? `<span class="ps-error">Error: ${escapeHtml(record.error_message || "")}</span>` : ""}
        ${isSkipped ? `<span class="muted">${escapeHtml(record.error_message || "Skipped — no guest email.")}</span>` : ""}
      </div>
      <div class="actions">
        ${isSent ? `<button type="button" disabled>Already Sent</button>` : ""}
        ${isSkipped ? `<button type="button" disabled>Cannot Send — No Email</button>` : ""}
        ${isPending ? `<button type="button" data-ps-request-send="${escapeHtml(record.id)}">Send Now</button>` : ""}
        ${isFailed ? `<button type="button" data-ps-request-send="${escapeHtml(record.id)}">Retry Send</button>` : ""}
      </div>
    </div>`;
}

function bindPostStayEmail() {
  document.querySelectorAll("[data-ps-request-send]").forEach((btn) => {
    btn.addEventListener("click", () => {
      postStaySendConfirmId = btn.dataset.psRequestSend;
      render();
    });
  });

  document.querySelectorAll("[data-ps-cancel-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      postStaySendConfirmId = null;
      render();
    });
  });

  document.querySelectorAll("[data-ps-confirm-send]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const queueId = btn.dataset.psConfirmSend;
      postStaySendConfirmId = null;
      btn.disabled = true;
      try {
        await sendQueuedEmail(queueId);
        await loadData();
        showMessage("Post-Stay Email sent.", "success");
      } catch (error) {
        await loadData();
        showMessage(error.message, "error");
      }
    });
  });
}

function startAutoSend() {
  setInterval(autoSendScheduledEmails, AUTO_SEND_CHECK_MS);
}

async function autoSendScheduledEmails() {
  if (autoSending || !isAccessUnlocked() || !hasSupabaseConfig()) return;
  const now = Date.now();
  const staleThreshold = new Date(now - 24 * 60 * 60 * 1000);
  const due = state.automation_queue.filter(
    (item) =>
      item.automation_type === "thank_you" &&
      item.status === "pending" &&
      new Date(item.scheduled_for) <= now &&
      new Date(item.scheduled_for) >= staleThreshold
  );
  if (!due.length) return;
  autoSending = true;
  try {
    for (const item of due) {
      try {
        await sendQueuedEmail(item.id);
      } catch (error) {
        console.warn("[auto-send] Failed:", item.id, error.message);
      }
    }
    if (shouldSkipAutoRefresh()) {
      await loadData({ silent: true });
    } else {
      await loadData();
    }
  } catch (error) {
    console.warn("[auto-send] Refresh failed.", error.message);
  } finally {
    autoSending = false;
  }
}

// ── Phase 6C: Guest Memories ──────────────────────────────────────

function guestMemoriesSection(booking) {
  const isDraft = guestMemoryDraft?.bookingId === booking.id;
  const record = state.guest_memories.find((r) => r.booking_id === booking.id);

  if (isDraft && guestMemoryDraft.cardDataUrl) {
    return `
      <div class="gm-section">
        <div class="gm-header">
          <span class="gm-label">Memory Card</span>
          <span class="pill gm-pill-draft">Preview</span>
        </div>
        <div class="gm-preview-wrap">
          <img class="gm-preview-img" src="${escapeHtml(guestMemoryDraft.cardDataUrl)}" alt="Memory card preview">
        </div>
        <div class="actions">
          <button type="button" class="primary" data-gm-save="${escapeHtml(booking.id)}">Save Memory Card</button>
          <button type="button" data-gm-discard>Discard Draft</button>
        </div>
      </div>`;
  }

  if (isDraft && !guestMemoryDraft.cardDataUrl) {
    return `
      <div class="gm-section">
        <div class="gm-header">
          <span class="gm-label">Memory Card</span>
          ${record ? `<span class="pill gm-pill-draft">Replacing</span>` : ""}
        </div>
        <p class="muted" style="margin:0 0 12px;font-size:13px;">Upload the finished Canva memory card.</p>
        <div class="gm-upload-zone">
          <label class="gm-upload-label" for="gm-photo-input">
            <span>Click to choose a finished card</span>
            <span style="display:block;font-size:11px;margin-top:4px;color:#5a7a6a;">JPEG · PNG · WebP · Max 10 MB</span>
          </label>
          <input type="file" id="gm-photo-input" class="gm-file-input" accept="image/jpeg,image/png,image/webp" data-gm-booking="${escapeHtml(booking.id)}">
        </div>
        <div class="actions">${record ? `<button type="button" data-gm-discard>Cancel</button>` : ""}</div>
      </div>`;
  }

  if (record) {
    const savedDate = record.updated_at
      ? new Date(record.updated_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const isSent = record.status === "sent";
    const gmGuest = state.guests.find((g) => g.id === booking.guest_id);
    const hasEmail = !!((gmGuest && gmGuest.email) || "").trim();
    const pillClass = isSent ? "gm-pill-sent" : "gm-pill-ready";
    const pillLabel = isSent ? "sent" : "ready";
    const savedSpan = savedDate ? "<span>Saved " + escapeHtml(savedDate) + "</span>" : "";
    const readySpan = !isSent ? "<span>Uploaded Canva card</span>" : "";
    const noEmailNote = hasEmail ? "" : "<p class=\"gm-no-email\">No email address on file for this guest.</p>";
    const canSend = hasEmail && !!record.card_url;
    const sendBtn = isSent
      ? "<button type=\"button\" disabled>Memory Email Sent</button>"
      : "<button type=\"button\" class=\"primary\" data-gm-send-email=\"" + escapeHtml(record.id) + "\"" + (canSend ? "" : " disabled") + ">Send Memory Email</button>";
    return `
      <div class="gm-section">
        <div class="gm-header">
          <span class="gm-label">Memory Card</span>
          <span class="pill ${pillClass}">${pillLabel}</span>
        </div>
        <div class="gm-saved-wrap">
          <img class="gm-thumb" src="${escapeHtml(record.card_url || "")}" alt="Saved memory card">
        </div>
        <div class="gm-meta">
          ${readySpan}
          ${savedSpan}
        </div>
        ${noEmailNote}
        <div class="actions">
          ${sendBtn}
          <button type="button" data-gm-replace="${escapeHtml(booking.id)}">Replace Memory Card</button>
        </div>
      </div>`;
  }

  return `
    <div class="gm-section">
      <p class="muted" style="margin:0 0 12px;font-size:13px;">Upload the finished Canva memory card exported as JPG, PNG, or WebP.</p>
      <div class="gm-upload-zone">
        <label class="gm-upload-label" for="gm-photo-input">
          <span>Upload Memory Card</span>
          <span style="display:block;font-size:11px;margin-top:4px;color:#5a7a6a;">JPEG · PNG · WebP · Max 10 MB</span>
        </label>
        <input type="file" id="gm-photo-input" class="gm-file-input" accept="image/jpeg,image/png,image/webp" data-gm-booking="${escapeHtml(booking.id)}">
      </div>
    </div>`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read memory card."));
    reader.readAsDataURL(file);
  });
}

function validateMemoryCardFile(file) {
  if (!file) throw new Error("Choose a finished memory card first.");
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Memory card must be JPG, PNG, or WebP.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Memory card must be 10 MB or smaller.");
  }
}

function memoryCardExtension(file) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

async function storageUpload(path, blob, contentType) {
  const { url, anonKey } = supabaseConfig;
  const response = await fetch(`${url}/storage/v1/object/guest-memories/${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": contentType,
      "x-upsert": "true"
    },
    body: blob
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Storage upload failed: ${text || response.statusText}`);
  }
  return `${url}/storage/v1/object/public/guest-memories/${path}`;
}

async function saveGuestMemory(booking) {
  if (!guestMemoryDraft?.cardFile) throw new Error("Upload a finished memory card first.");
  validateMemoryCardFile(guestMemoryDraft.cardFile);

  const ext = memoryCardExtension(guestMemoryDraft.cardFile);
  const cardUrl = await storageUpload(
    `${booking.id}/card-${Date.now()}.${ext}`,
    guestMemoryDraft.cardFile,
    guestMemoryDraft.cardFile.type || "image/jpeg"
  );

  const existing = state.guest_memories.find((r) => r.booking_id === booking.id);
  const now = new Date().toISOString();
  const payload = {
    booking_id: booking.id,
    photo_url: null,
    card_url: cardUrl,
    template_version: "canva",
    memory_message: null,
    status: "generated",
    updated_at: now
  };

  if (existing) {
    await update("guest_memories", existing.id, payload);
  } else {
    await insert("guest_memories", { ...payload, created_at: now });
  }

  guestMemoryDraft = null;
  await loadData();
  showMessage("Memory card uploaded and ready.", "success");
}

function bindGuestMemory() {
  // File input -> local preview -> save the finished Canva card as-is.
  document.querySelectorAll("[data-gm-booking]").forEach((input) => {
    input.addEventListener("change", async () => {
      const bookingId = input.dataset.gmBooking;
      const file = input.files?.[0];
      if (!file) return;

      guestMemoryDraft = {
        bookingId,
        cardFile: file,
        cardDataUrl: null
      };

      try {
        validateMemoryCardFile(file);
        guestMemoryDraft.cardDataUrl = await readFileAsDataUrl(file);
        render();
      } catch (err) {
        guestMemoryDraft = null;
        render();
        showMessage(`Preview failed: ${err.message}`, "error");
      }
    });
  });

  // Save memory card
  document.querySelectorAll("[data-gm-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.gmSave;
      const booking = state.bookings.find((b) => b.id === bookingId);
      if (!booking) return;
      btn.disabled = true;
      try {
        await saveGuestMemory(booking);
      } catch (err) {
        btn.disabled = false;
        showMessage(err.message, "error");
      }
    });
  });

  // Discard draft
  document.querySelectorAll("[data-gm-discard]").forEach((btn) => {
    btn.addEventListener("click", () => {
      guestMemoryDraft = null;
      render();
    });
  });

  // Replace existing card
  document.querySelectorAll("[data-gm-replace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      guestMemoryDraft = {
        bookingId: btn.dataset.gmReplace,
        cardFile: null,
        cardDataUrl: null
      };
      render();
    });
  });

  // Send memory email
  document.querySelectorAll("[data-gm-send-email]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const memoryId = btn.dataset.gmSendEmail;
      if (!memoryId) return;
      if (!confirm("Send the memory card email to this guest?")) return;
      btn.disabled = true;
      try {
        const res = await fetch("/api/memory/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memory_id: memoryId })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Email send failed.");
        showMessage("Memory email sent.", "success");
        await loadData();
      } catch (err) {
        btn.disabled = false;
        showMessage(err.message, "error");
      }
    });
  });
}
