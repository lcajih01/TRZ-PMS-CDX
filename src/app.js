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
let guestProfileContext = null;
let editBookingContext = null;
let cancelBookingContext = null;
let transactionContext = null;
let bookingSearchQuery = "";
let financeFilters = {
  start_date: "",
  end_date: "",
  wallet_id: "",
  account_type: "",
  search: ""
};
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

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
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("PWA service worker registration failed.", error);
    });
  });
}

async function loadData() {
  loading = true;
  renderShell();
  try {
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
      select("audit_logs", { order: "order=created_at.desc" })
    ]);

    state = {
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
      audit_logs
    };
  } catch (error) {
    showMessage(error.message);
  } finally {
    loading = false;
    render();
  }
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
    audit_logs: []
  };
}

function render() {
  renderShell();
  if (loading) {
    document.getElementById("view").innerHTML = `<section class="panel"><p class="muted">Loading Supabase records...</p></section>`;
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
  if (createBookingContext) view.innerHTML += createBookingModal(createBookingContext);
  if (bookingActionContext) view.innerHTML += bookingActionModal(bookingActionContext);
  if (guestProfileContext) view.innerHTML += guestProfileModal(guestProfileContext);
  if (editBookingContext) view.innerHTML += editBookingModal(editBookingContext);
  if (cancelBookingContext) view.innerHTML += cancelBookingModal(cancelBookingContext);
  if (transactionContext) view.innerHTML += transactionModal(transactionContext);
  if (checkinPayment) view.innerHTML += checkinPaymentModal(checkinPayment);
  if (checkoutSettlement) view.innerHTML += checkoutSettlementModal(checkoutSettlement);
  bindForms();
}

function renderShell() {
  const badge = document.getElementById("userBadge");
  badge.innerHTML = isAccessUnlocked()
    ? `<span>Access unlocked${isManagerViewUnlocked() ? " / Manager View" : ""}</span><button class="icon-button" title="Unlock Manager View" data-action="unlock-manager-view">⚙</button><button data-action="lock">Lock / Logout</button>`
    : `<span>Locked</span>`;
  badge.querySelector("[data-action='unlock-manager-view']")?.addEventListener("click", unlockManagerView);
  badge.querySelector("[data-action='lock']")?.addEventListener("click", () => {
    sessionStorage.removeItem(accessSessionKey);
    sessionStorage.removeItem(managerViewSessionKey);
    securityUnlocked = false;
    createBookingContext = null;
    bookingActionContext = null;
    guestProfileContext = null;
    editBookingContext = null;
    cancelBookingContext = null;
    transactionContext = null;
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
    .map(([id, label]) => `<button class="${id === activeTab ? "active" : ""}" data-tab="${id}">${label}</button>`)
    .join("");
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      sessionStorage.setItem("trz-active-tab", activeTab);
      render();
    });
  });
}

function setupMissingView() {
  return `
    <section class="panel">
      <h2>Supabase Setup Required</h2>
      <p class="muted">Business records are not stored locally. Add Supabase credentials first.</p>
      <pre>VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=</pre>
    </section>`;
}

function accessCodeView() {
  const lock = getAttemptLock(pmsAttemptsKey);
  return `
    <section class="panel auth-panel">
      <h2>PMS Access</h2>
      ${lock.locked ? `<p class="message">Too many wrong attempts. Try again in ${lock.minutes} minute(s).</p>` : ""}
      <form data-action="unlock">
        <label class="field"><span>PMS Access Code</span><input name="access_code" type="password" inputmode="numeric" required ${lock.locked ? "disabled" : ""} /></label>
        <div class="actions"><button class="primary" ${lock.locked ? "disabled" : ""}>Enter App</button></div>
      </form>
    </section>`;
}

function dashboardView() {
  const activeBookings = state.bookings.filter((booking) => !["Cancelled", "Refunded", "Archived"].includes(booking.status));
  return `
    <div class="grid three">
      <article class="panel"><h3>Total Bookings</h3><strong>${state.bookings.length}</strong><p class="muted">Loaded from Supabase.</p></article>
      <article class="panel"><h3>Active Calendar Holds</h3><strong>${activeBookings.length}</strong><p class="muted">Whole-resort reservations only.</p></article>
      <article class="panel"><h3>Deposit Default</h3><strong>${money(DEFAULT_SECURITY_DEPOSIT)}</strong><p class="muted">Configurable per booking.</p></article>
    </div>
    <div class="panel" style="margin-top:12px">
      ${calendarView()}
    </div>`;
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
        <button type="button" data-calendar-nav="prev">Previous Month</button>
        <button type="button" data-calendar-nav="today">Today</button>
        <button type="button" data-calendar-nav="next">Next Month</button>
      </div>
      <div class="calendar-legend">
        <span><i class="available"></i>Available</span>
        <span><i class="checkin"></i>Checked In</span>
        <span><i class="checkout"></i>Check-Out side</span>
        <span><i class="occupied"></i>Occupied stay</span>
        <span><i class="history"></i>Completed history</span>
        <span><i class="reserved"></i>Future hold</span>
      </div>
    </div>
    <div class="calendar-grid calendar-weekdays">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div>${day}</div>`).join("")}
    </div>
    <div class="calendar-grid">
      ${cells.map((day) => (day ? calendarDay(day) : `<div class="calendar-day blank"></div>`)).join("")}
    </div>`;
}

function calendarDay(day) {
  const segments = calendarSegmentsForDay(day);
  const label = calendarDayLabel(segments[0]);
  const fullLabel = segments[0] ? `${segments[0].booking.booking_code} ${segments[0].label}` : "Available";
  const targetAttr = segments[0]
    ? `data-open-booking="${segments[0].booking.id}"`
    : `data-open-date="${dateInputValue(day)}"`;
  return `
    <button type="button" class="calendar-day available" title="${escapeHtml(fullLabel)}" aria-label="${escapeHtml(`${day.getDate()} ${fullLabel}`)}" ${targetAttr}>
      ${segments.map((segment) => `<i class="day-segment ${segment.kind}"></i>`).join("")}
      <strong>${day.getDate()}</strong>
      <span>${escapeHtml(label)}</span>
    </button>`;
}

function calendarDayLabel(segment) {
  if (!segment) return "Available";
  const full = `${segment.booking.booking_code} ${segment.label}`;
  if (window.innerWidth > 760) return full;
  return `${shortBookingCode(segment.booking.booking_code)} ${shortCalendarStatus(segment.label)}`;
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
      kind = occupiedStatus ? "occupied" : "reserved";
      label = booking.status;
    } else if (startsToday) {
      kind = occupiedStatus ? "checkin" : "reserved-checkin";
      label = occupiedStatus ? "Check-In" : `${booking.status} Check-In`;
    } else if (endsToday) {
      kind = "checkout";
      label = `${booking.status} Check-Out`;
    } else if (occupiedStatus) {
      kind = "occupied";
      label = "Occupied";
    } else if (futureHoldStatus) {
      kind = "reserved";
      label = booking.status;
    }
    return { booking, kind, label };
  });
  const activeSegments = segments.filter((segment) => segment.booking.status !== "Completed");
  return activeSegments.length ? activeSegments : segments;
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
  return `
    <section class="panel">
      <h2>New Booking / Guest</h2>
      ${bookingForm()}
    </section>
    <section class="panel">
      <h2>Monthly Booking List</h2>
      ${bookingSearchControl()}
      ${monthlyBookingList()}
    </section>
    <div style="margin-top:12px">
      ${guestDirectorySection()}
    </div>`;
}

function monthlyBookingList() {
  const bookings = filteredBookings();
  if (!bookings.length) return `<p class="muted">No bookings found.</p>`;
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

function bookingCard(booking) {
  const balanceDue = packageBalanceDue(booking);
  return `
    <article class="booking-card">
      <div class="booking-card-header">
        <div>
          <strong>${booking.booking_code}</strong>
          <span>${guestLinkById(booking.guest_id)}</span>
        </div>
        <span class="pill">${booking.status}</span>
      </div>
      <div class="booking-card-grid">
        <div><span>Dates</span><strong>${formatRange(booking)}</strong></div>
        <div><span>Package</span><strong>${packageNameForBooking(booking)}</strong></div>
        <div><span>Package Price</span><strong>${money(booking.base_price)}</strong></div>
        <div><span>Revenue Paid</span><strong>${money(booking.total_revenue)}</strong></div>
        <div><span>Balance Due</span><strong>${money(balanceDue)}</strong></div>
        <div><span>Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
        <div><span>Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
        <div><span>Deposit Refunded</span><strong>${money(booking.total_deposit_refunded)}</strong></div>
      </div>
    </article>`;
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
  return `
    <form data-action="booking" data-booking-date-form>
      <label class="field"><span>Select existing guest</span><select name="guest_id"><option value="">Create new guest below</option>${state.guests.map((guest) => `<option value="${guest.id}">${escapeHtml(guest.full_name)} - ${escapeHtml(guest.phone)}</option>`).join("")}</select></label>
      <div class="subsection">
        <h3>Or Create New Guest</h3>
        <div class="grid two">
          <label class="field"><span>Full name</span><input name="new_guest_name" /></label>
          <label class="field"><span>Phone</span><input name="new_guest_phone" /></label>
          <label class="field"><span>Alternate contact number</span><input name="new_guest_alternate" /></label>
          <label class="field"><span>Email</span><input name="new_guest_email" type="email" /></label>
        </div>
      </div>
      <label class="field"><span>Package</span><select name="package_version_id" data-booking-package required>${state.packages.map((pkg) => {
        const version = latestPackageVersion(pkg.id);
        if (!version) return "";
        return `<option value="${version.id}">${escapeHtml(pkg.name)} v${version.version_number} - ${money(version.price)}</option>`;
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
    ${safeFinanceSection("Finance", () => `
      <section class="panel">
        <h2>Finance</h2>
        <p class="muted">${showSensitive ? "Manager View is active. Full finance visibility is unlocked." : "Normal View is active. Sensitive finance totals are hidden."}</p>
      </section>`)}
    ${!showSensitive ? `<div style="margin-top:12px">
      ${safeFinanceSection("Operational Cash", operationalCashCard)}
    </div>` : ""}
    ${showSensitive ? safeFinanceSection("Wallet Balances", () => `
      <section class="panel" style="margin-top:12px">
        <h2>Wallet Balances</h2>
        <div class="wallet-summary-grid">
          ${walletSummaryCards()}
        </div>
        <div class="subsection">
          <h3>Finance Summary</h3>
          <div class="finance-summary-grid">
            ${financeSummaryCards()}
          </div>
        </div>
      </section>`) : ""}
    ${showSensitive ? `<div style="margin-top:12px">
      ${safeFinanceSection("Transactions", ledgerView)}
    </div>` : ""}
    <div style="margin-top:12px">
      ${safeFinanceSection("Expenses", expensesView)}
    </div>
    ${showSensitive ? `<div style="margin-top:12px">
      ${safeFinanceSection("Owner Harvest", ownerHarvestView)}
    </div>` : ""}
    ${showSensitive ? `<div style="margin-top:12px">
      ${safeFinanceSection("Transfers", transfersView)}
    </div>` : ""}
    <div style="margin-top:12px">
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
    ["This Month Revenue", summary.month_revenue],
    ["This Month Expenses", summary.month_expenses],
    ["This Month Net", summary.month_net],
    ["Current Security Deposit Liability", summary.security_deposit_liability]
  ];
  return cards.map(([label, value]) => `
          <article class="wallet-summary-card">
            <span>${label}</span>
            <strong>${money(value)}</strong>
          </article>`).join("");
}

function operationsView() {
  return `
    <section class="panel">
      <h2>Operations</h2>
      <p class="muted">Small operational tools for resort add-ons and utilities.</p>
    </section>
    <div style="margin-top:12px">
      ${electricityView()}
    </div>
    <div style="margin-top:12px">
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
    <section class="panel">
      <h2>Audit Logs</h2>
      <table>
        <thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>${state.audit_logs.map((log) => `<tr><td>${new Date(log.created_at).toLocaleString()}</td><td>${log.entity_type}</td><td>${log.action}</td><td>${escapeHtml(log.reason || "")}</td></tr>`).join("") || emptyRow(4)}</tbody>
      </table>
    </section>`;
}

function settingsView() {
  return `
    <div>
      ${packagesView()}
    </div>
    <div style="margin-top:12px">
      ${walletsView()}
    </div>
    <div style="margin-top:12px">
      ${automationView()}
    </div>
    <div style="margin-top:12px">
      ${securitySettingsSection()}
    </div>`;
}

function automationView() {
  const rows = state.automation_queue.filter((item) => item.automation_type === "booking_confirmation");
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
  return `
    <table>
      <thead><tr><th>Email</th><th>Status</th><th>Scheduled</th><th>Sent</th></tr></thead>
      <tbody>
        ${automationStatusRow("Booking confirmation", confirmation)}
      </tbody>
    </table>
    <div class="actions">
      <button type="button" data-booking-email-send="booking_confirmation" data-booking-id="${booking.id}" ${canQueueOrSendAutomation(confirmation) ? "" : "disabled"}>Send Confirmation Email</button>
      <button type="button" data-automation-send="${failed?.id || ""}" ${failed && canSendAutomation(failed) ? "" : "disabled"}>Retry Failed Email</button>
    </div>`;
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
            <h2>Create New Booking</h2>
            <span>${context.checkin_date}</span>
          </div>
          <button type="button" data-action="close-modal">Close</button>
        </div>
        ${bookingForm({ checkin_date: context.checkin_date })}
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
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>${booking.booking_code}</h2>
            <span>${guestLinkById(booking.guest_id)} - ${guestPhone(booking.guest_id)}</span>
          </div>
          <button type="button" data-action="close-modal">Close</button>
        </div>
        <div class="booking-card-grid">
          <div><span>Package</span><strong>${packageNameForBooking(booking)}</strong></div>
          <div><span>Date Range</span><strong>${formatRange(booking)}</strong></div>
          <div><span>Status</span><strong>${booking.status}</strong></div>
          <div><span>Package Price</span><strong>${money(booking.base_price)}</strong></div>
          <div><span>Revenue Paid</span><strong>${money(booking.total_revenue)}</strong></div>
          <div><span>Balance Due</span><strong>${money(packageBalanceDue(booking))}</strong></div>
          <div><span>Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
          <div><span>Deposit Refunded</span><strong>${money(booking.total_deposit_refunded)}</strong></div>
          <div><span>Refundable Deposit</span><strong>${money(refundableDepositBalance(booking))}</strong></div>
        </div>
        <div class="subsection">
          <h3>Internal Notes</h3>
          <form data-action="booking-notes">
            <input type="hidden" name="booking_id" value="${booking.id}" />
            <label class="field"><span>Notes</span><textarea name="notes">${escapeHtml(booking.notes || "")}</textarea></label>
            <div class="actions"><button class="primary">Save Notes</button></div>
          </form>
        </div>
        <div class="subsection">
          <h3>Booking Timeline</h3>
          ${bookingTimeline(booking)}
        </div>
        <div class="subsection">
          <h3>Email / Automation</h3>
          ${bookingAutomationSection(booking)}
        </div>
        <div class="actions">
          ${actions.map((action) => `<button type="button" ${action.disabled ? "disabled" : ""} data-booking-id="${booking.id}" data-booking-action="${action.id}">${action.label}</button>`).join("")}
        </div>
        <details class="testing-actions">
          <summary>Testing actions</summary>
          <div class="actions">
            <button type="button" class="danger" data-booking-id="${booking.id}" data-booking-action="delete">Delete Booking</button>
          </div>
        </details>
      </section>
    </div>`;
}

function guestProfileModal(context) {
  const guest = context.guest;
  const bookings = bookingsForGuest(guest.id);
  const totalRevenue = bookings.reduce((total, booking) => total + Number(booking.total_revenue || 0), 0);
  const lastStay = [...bookings].sort((a, b) => new Date(b.end_at) - new Date(a.end_at))[0];
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <div class="booking-card-header">
          <div>
            <h2>${escapeHtml(guest.full_name)}</h2>
            <span>${escapeHtml(guest.phone)}${guest.alternate_contact_number ? ` / ${escapeHtml(guest.alternate_contact_number)}` : ""}</span>
          </div>
          <button type="button" data-action="close-modal">Close</button>
        </div>
        <div class="booking-card-grid">
          <div><span>Email</span><strong>${escapeHtml(guest.email || "None")}</strong></div>
          <div><span>Total Bookings</span><strong>${bookings.length}</strong></div>
          <div><span>Total Revenue</span><strong>${money(totalRevenue)}</strong></div>
          <div><span>Last Stay</span><strong>${lastStay ? formatRange(lastStay) : "No stays yet"}</strong></div>
        </div>
        <div class="subsection">
          <h3>Booking History</h3>
          <div class="timeline-list">
            ${bookings.map((booking) => `
              <button type="button" class="history-row" data-open-booking="${booking.id}">
                <span>${booking.booking_code} - ${booking.status}</span>
                <strong>${formatRange(booking)} / ${money(booking.total_revenue)}</strong>
              </button>`).join("") || `<p class="muted">No bookings yet.</p>`}
          </div>
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
            <span>${booking.booking_code}</span>
          </div>
          <button type="button" data-action="close-modal">Close</button>
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
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <h2>Cancel Booking</h2>
        <p class="muted">${booking.booking_code} - ${guestName(booking.guest_id)}</p>
        <form data-action="booking-cancel">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <label class="field"><span>Reason</span><textarea name="reason" required></textarea></label>
          <div class="actions">
            <button class="primary">Confirm Cancel Booking</button>
            <button type="button" data-action="close-modal">Cancel</button>
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
            <span>${context.booking.booking_code} - ${guestName(context.booking.guest_id)}</span>
          </div>
          <button type="button" data-action="close-modal">Close</button>
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
  return [
    { id: "edit", label: "Edit Booking" },
    { id: "payment", label: "Record Payment" },
    { id: "deposit", label: "Record Deposit" },
    { id: "checkin", label: "Check In" },
    { id: "cancel", label: "Cancel Booking" }
  ];
}

function checkoutSettlementModal(context) {
  const booking = context.booking;
  const refundable = refundableDepositBalance(booking);
  const defaultRefund = Math.max(refundable - Number(context.damage_amount || 0), 0);
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <h2>Checkout Settlement</h2>
        <p class="muted">${booking.booking_code} - ${guestName(booking.guest_id)}</p>
        ${booking.total_deposit_received > 0 ? "" : `<p class="message">No security deposit to refund.</p>`}
        <div class="grid two settlement-summary">
          <div><span>Security Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Security Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
          <div><span>Already Refunded</span><strong>${money(booking.total_deposit_refunded)}</strong></div>
          <div><span>Refundable Balance</span><strong>${money(refundable)}</strong></div>
        </div>
        <form data-action="checkout-settlement">
          <input type="hidden" name="booking_id" value="${booking.id}" />
          <label class="field"><span>Damage / Penalty Deduction</span><input name="damage_amount" data-damage-amount type="number" min="0" max="${refundable}" value="0" /></label>
          <label class="field"><span>Reason / Notes</span><textarea name="reason" placeholder="Damage/Penalty Charge notes"></textarea></label>
          <label class="field"><span>Refund Amount</span><input name="refund_amount" data-refund-amount type="number" min="0" max="${refundable}" value="${defaultRefund}" /></label>
          <label class="field"><span>Refund Wallet</span><select name="refund_wallet_id">${walletOptions()}</select></label>
          <p class="muted">Damage/Penalty deduction is recorded as a Revenue ledger line labeled Damage/Penalty Charge. Deposit refund is recorded as a negative Security Deposit Liability line.</p>
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
  return `
    <div class="modal-backdrop">
      <section class="panel modal">
        <h2>Check-In Payment</h2>
        <p class="muted">${booking.booking_code} - ${guestName(booking.guest_id)}</p>
        <div class="grid two settlement-summary">
          <div><span>Package Price</span><strong>${money(booking.base_price)}</strong></div>
          <div><span>Revenue Paid</span><strong>${money(booking.total_revenue)}</strong></div>
          <div><span>Balance Due</span><strong>${money(packageDue)}</strong></div>
          <div><span>Security Deposit Required</span><strong>${money(booking.security_deposit_amount)}</strong></div>
          <div><span>Security Deposit Received</span><strong>${money(booking.total_deposit_received)}</strong></div>
          <div><span>Security Deposit Balance</span><strong>${money(depositDue)}</strong></div>
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
    showMessage(`Manager settings locked. Try again in ${lock.minutes} minute(s).`);
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
    showMessage("Manager View unlocked.");
  } catch (error) {
    showMessage(error.message);
    render();
  }
}

function bindForms() {
  hydrateBookingDateForm();
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
  document.querySelectorAll("form[data-action]").forEach((form) => {
    if (form.dataset.action === "unlock") return;
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
        if (form.dataset.action === "unlock-security") await unlockSecurity(fields);
        if (form.dataset.action === "change-pms-code") await changePmsCode(fields);
        if (form.dataset.action === "change-manager-code") await changeManagerCode(fields);
        if (!shouldRefresh) return;
        form.reset();
        await loadData();
        showMessage(successMessage);
      } catch (error) {
        showMessage(error.message);
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
      createBookingContext = null;
      bookingActionContext = null;
      guestProfileContext = null;
      editBookingContext = null;
      cancelBookingContext = null;
      transactionContext = null;
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
        showMessage("Email sent.");
      } catch (error) {
        await loadData();
        showMessage(error.message);
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
        showMessage("Email sent.");
      } catch (error) {
        await loadData();
        showMessage(error.message);
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
        showMessage("Automation queue updated.");
      } catch (error) {
        showMessage(error.message);
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
      createBookingContext = { checkin_date: button.dataset.openDate };
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
        showMessage("Drink product updated.");
      } catch (error) {
        showMessage(error.message);
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
        showMessage("Manager View is required for transaction reversals.");
        return;
      }
      const entry = state.ledger_entries.find((item) => item.id === button.dataset.reverseEntry);
      if (!entry) return;
      const managerCode = window.prompt("Enter Manager Security Code");
      if (!managerCode) return;
      const reason = window.prompt("Enter reversal reason");
      if (!reason?.trim()) {
        showMessage("Reversal reason is required.");
        return;
      }
      try {
        await reverseLedgerEntry(entry, managerCode, reason);
        await loadData();
        showMessage("Transaction reversed.");
      } catch (error) {
        showMessage(error.message);
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
        showMessage(error.message);
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

async function archiveBooking(booking) {
  if (!["Completed", "Cancelled", "Refunded"].includes(booking.status)) {
    throw new Error("Only Completed, Cancelled, or Refunded bookings can be archived.");
  }
  const [after] = await update("bookings", booking.id, { status: "Archived" });
  await createAudit("booking", booking.id, "status_change", booking, after, "Booking archived");
  bookingActionContext = null;
  await loadData();
  showMessage("Booking archived.");
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
  const managerCode = window.prompt("Enter Manager Security Code");
  if (!managerCode) return;

  const allowed = await rpc("verify_booking_delete_code", {
    input_booking_id: booking.id,
    manager_code: managerCode
  });
  if (!allowed) {
    showMessage("Wrong Manager Security Code.");
    return;
  }

  const confirmed = window.confirm(`Delete Booking ${booking.booking_code}?\n\nThis action cannot be undone.`);
  if (!confirmed) return;

  const deleted = await rpc("delete_test_booking", {
    input_booking_id: booking.id,
    manager_code: managerCode
  });
  if (!deleted) throw new Error("This booking contains financial records. Use Cancel/Archive instead.");

  bookingActionContext = null;
  await loadData();
  showMessage("Booking deleted.");
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
  const response = await fetch("/api/automation/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queue_id: id })
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Email sending failed.");
  return data;
}

async function sendBookingAutomationNow(bookingId, type) {
  if (type !== "booking_confirmation") throw new Error("Only booking confirmation email can be sent.");
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
    booking_confirmation: "Booking Confirmation"
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
  return `<tr><td colspan="${columns}" class="muted">No records yet.</td></tr>`;
}

function showMessage(message) {
  const el = document.getElementById("statusMessage");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
