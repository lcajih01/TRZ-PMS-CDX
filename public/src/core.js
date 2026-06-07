export const BOOKING_STATUSES = [
  "Inquiry",
  "Tentative",
  "Deposit Requested",
  "Deposit Received",
  "Confirmed",
  "Checked In",
  "Checked Out",
  "Completed",
  "Cancelled",
  "Refunded",
  "Archived"
];

export const BLOCKING_STATUSES = new Set([
  "Tentative",
  "Deposit Requested",
  "Deposit Received",
  "Confirmed",
  "Checked In"
]);

export const ACCOUNT_TYPES = [
  "Revenue",
  "Security Deposit Liability",
  "Expense",
  "Refund",
  "Adjustment",
  "Transfer",
  "Owner Harvest"
];

export const DEFAULT_SECURITY_DEPOSIT = 5000;

export const DRINK_MOVEMENT_TYPES = [
  "purchase_add_stock",
  "sale",
  "damage_spoilage",
  "adjustment"
];

const permissionSets = {
  Manager: [
    "manage_users",
    "manage_packages",
    "manage_guests",
    "manage_bookings",
    "manage_wallets",
    "manage_ledger",
    "manage_deposits",
    "view_audit_logs"
  ],
  Receptionist: ["manage_guests", "manage_bookings"],
  Accounting: ["manage_wallets", "manage_ledger", "manage_deposits", "view_audit_logs"]
};

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function money(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

export function createInitialState() {
  const managerRole = newId();
  const receptionistRole = newId();
  const accountingRole = newId();
  const manager = newId();
  const receptionist = newId();
  const accounting = newId();
  const now = new Date().toISOString();

  const roles = [
    { id: managerRole, name: "Manager", created_at: now },
    { id: receptionistRole, name: "Receptionist", created_at: now },
    { id: accountingRole, name: "Accounting", created_at: now }
  ];

  const role_permissions = roles.flatMap((role) =>
    permissionSets[role.name].map((permission_key) => ({
      id: newId(),
      role_id: role.id,
      permission_key
    }))
  );

  const users = [
    {
      id: manager,
      auth_user_id: manager,
      full_name: "TRZ Manager",
      email: "manager@trz.local",
      role_id: managerRole,
      is_active: true,
      created_at: now
    },
    {
      id: receptionist,
      auth_user_id: receptionist,
      full_name: "Receptionist",
      email: "frontdesk@trz.local",
      role_id: receptionistRole,
      is_active: true,
      created_at: now
    },
    {
      id: accounting,
      auth_user_id: accounting,
      full_name: "Accounting",
      email: "accounting@trz.local",
      role_id: accountingRole,
      is_active: true,
      created_at: now
    }
  ];

  const packages = ["Day Use", "Lite Package", "Standard Package"].map((name) => ({
    id: newId(),
    name,
    is_active: true,
    created_at: now
  }));

  const drink_products = [
    {
      name: "Red Horse 500ml",
      category: "Beer",
      cost_per_case: 620,
      selling_price_per_case: 1600,
      commission_per_case: 100
    },
    {
      name: "San Mig Pale Pilsen",
      category: "Beer",
      cost_per_case: 880,
      selling_price_per_case: 1600,
      commission_per_case: 100
    },
    {
      name: "San Mig Light",
      category: "Beer",
      cost_per_case: 1050,
      selling_price_per_case: 1650,
      commission_per_case: 100
    }
  ].map((product) => ({
    id: newId(),
    is_active: true,
    created_at: now,
    ...product
  }));

  const package_versions = [
    {
      package_id: packages[0].id,
      price: 10000,
      included_pax: 15,
      included_rooms: 3,
      has_breakfast: false,
      start_time: "15:00",
      end_time: "23:00",
      is_overnight: false
    },
    {
      package_id: packages[1].id,
      price: 15000,
      included_pax: 15,
      included_rooms: 6,
      has_breakfast: true,
      start_time: "15:00",
      end_time: "11:00",
      is_overnight: true
    },
    {
      package_id: packages[2].id,
      price: 20000,
      included_pax: 25,
      included_rooms: 9,
      has_breakfast: true,
      start_time: "15:00",
      end_time: "11:00",
      is_overnight: true
    }
  ].map((version) => ({
    id: newId(),
    version_number: 1,
    effective_from: now,
    created_at: now,
    created_by: manager,
    ...version
  }));

  return {
    roles,
    role_permissions,
    user_profiles: users,
    packages,
    package_versions,
    guests: [],
    bookings: [],
    wallets: [
      { id: newId(), name: "Cash", sort_order: 10, is_active: true, created_at: now },
      { id: newId(), name: "GCash", sort_order: 20, is_active: true, created_at: now },
      { id: newId(), name: "Maya", sort_order: 30, is_active: true, created_at: now },
      { id: newId(), name: "Bank", sort_order: 40, is_active: true, created_at: now }
    ],
    ledger_entries: [],
    ledger_lines: [],
    security_deposits: [],
    expenses: [],
    daily_closings: [],
    drink_products,
    drink_inventory_movements: [],
    drink_sales: [],
    electricity_monthly_baselines: [],
    electricity_readings: [],
    owner_harvests: [],
    audit_logs: [],
    booking_counters: {}
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getRole(state, userId) {
  const user = state.user_profiles.find((item) => item.id === userId);
  return state.roles.find((role) => role.id === user?.role_id);
}

export function hasPermission(state, userId, permission) {
  const role = getRole(state, userId);
  if (!role) return false;
  return state.role_permissions.some((item) => item.role_id === role.id && item.permission_key === permission);
}

export function audit(state, userId, entity_type, entity_id, action, before_data, after_data, reason = "") {
  state.audit_logs.unshift({
    id: newId(),
    user_id: userId,
    entity_type,
    entity_id,
    action,
    before_data: before_data ? clone(before_data) : null,
    after_data: after_data ? clone(after_data) : null,
    reason,
    ip_address: null,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    created_at: new Date().toISOString()
  });
}

export function latestPackageVersion(state, packageId) {
  return state.package_versions
    .filter((version) => version.package_id === packageId)
    .sort((a, b) => b.version_number - a.version_number)[0];
}

export function bookingNightCount(version, startAt, endAt) {
  if (!version?.is_overnight) return 0;
  const start = new Date(startAt);
  const end = new Date(endAt);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(Math.round((endDay - startDay) / 86400000), 1);
}

export function calculateBasePrice(version, startAt, endAt) {
  const unitPrice = Number(version?.price || 0);
  if (!version?.is_overnight) return unitPrice;
  return unitPrice * bookingNightCount(version, startAt, endAt);
}

export function updatePackageVersion(state, packageId, fields, userId) {
  requirePermission(state, userId, "manage_packages");
  const previous = latestPackageVersion(state, packageId);
  const next = {
    ...clone(previous),
    ...fields,
    id: newId(),
    version_number: previous.version_number + 1,
    effective_from: new Date().toISOString(),
    created_at: new Date().toISOString(),
    created_by: userId
  };
  state.package_versions.push(next);
  audit(state, userId, "package", packageId, "create_version", previous, next, "Package edited");
  return next;
}

export function createGuest(state, fields, userId) {
  requirePermission(state, userId, "manage_guests");
  if (!fields.full_name?.trim()) throw new Error("Guest name is required.");
  if (!fields.phone?.trim()) throw new Error("Primary phone is required.");
  const guest = {
    id: newId(),
    full_name: fields.full_name.trim(),
    phone: fields.phone.trim(),
    alternate_contact_number: fields.alternate_contact_number?.trim() || "",
    email: fields.email?.trim() || "",
    notes: fields.notes?.trim() || "",
    created_at: new Date().toISOString(),
    created_by: userId
  };
  state.guests.push(guest);
  audit(state, userId, "guest", guest.id, "create", null, guest);
  return guest;
}

export function createBooking(state, fields, userId) {
  requirePermission(state, userId, "manage_bookings");
  const guest = state.guests.find((item) => item.id === fields.guest_id);
  const version = state.package_versions.find((item) => item.id === fields.package_version_id);
  if (!guest) throw new Error("Select a valid guest.");
  if (!version) throw new Error("Select a valid package version.");
  if (!BOOKING_STATUSES.includes(fields.status)) throw new Error("Invalid booking status.");
  if (new Date(fields.end_at) <= new Date(fields.start_at)) throw new Error("End must be after start.");

  const pending = {
    id: newId(),
    booking_code: "",
    guest_id: fields.guest_id,
    package_version_id: fields.package_version_id,
    status: fields.status,
    start_at: fields.start_at,
    end_at: fields.end_at,
    pax_count: Number(fields.pax_count || version.included_pax),
    base_price: calculateBasePrice(version, fields.start_at, fields.end_at),
    security_deposit_amount: Number(fields.security_deposit_amount || DEFAULT_SECURITY_DEPOSIT),
    total_revenue: 0,
    total_deposit_received: 0,
    total_deposit_refunded: 0,
    notes: fields.notes?.trim() || "",
    created_at: new Date().toISOString(),
    created_by: userId
  };

  const conflict = findBookingConflict(state, pending);
  if (conflict) throw new Error(`Date/time conflict with ${conflict.booking_code}.`);

  pending.booking_code = nextBookingCode(state, fields.start_at);
  state.bookings.push(pending);
  state.security_deposits.push({
    id: newId(),
    booking_id: pending.id,
    required_amount: pending.security_deposit_amount,
    received_amount: 0,
    refunded_amount: 0,
    status: "Not Requested",
    created_at: new Date().toISOString()
  });
  audit(state, userId, "booking", pending.id, "create", null, pending);
  return pending;
}

export function changeBookingStatus(state, bookingId, status, userId, reason = "Status changed") {
  requirePermission(state, userId, "manage_bookings");
  if (!BOOKING_STATUSES.includes(status)) throw new Error("Invalid booking status.");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  const before = clone(booking);
  booking.status = status;
  const conflict = findBookingConflict(state, booking);
  if (conflict) {
    booking.status = before.status;
    throw new Error(`Date/time conflict with ${conflict.booking_code}.`);
  }
  audit(state, userId, "booking", bookingId, "status_change", before, booking, reason);
  return booking;
}

export function editBooking(state, bookingId, fields, userId) {
  requirePermission(state, userId, "manage_bookings");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  const version = state.package_versions.find((item) => item.id === fields.package_version_id);
  if (!version) throw new Error("Select a valid package version.");

  const before = clone(booking);
  booking.guest_id = fields.guest_id || booking.guest_id;
  booking.package_version_id = fields.package_version_id;
  booking.start_at = fields.start_at;
  booking.end_at = fields.end_at;
  booking.pax_count = Number(fields.pax_count || booking.pax_count);
  booking.security_deposit_amount = Number(fields.security_deposit_amount ?? booking.security_deposit_amount);
  booking.base_price = calculateBasePrice(version, fields.start_at, fields.end_at);
  booking.notes = fields.notes?.trim() || "";

  const conflict = findBookingConflict(state, booking);
  if (conflict) {
    Object.assign(booking, before);
    throw new Error(`Date/time conflict with ${conflict.booking_code}.`);
  }

  recomputeBookingFinancials(state, booking.id);
  audit(state, userId, "booking", bookingId, before.start_at !== booking.start_at || before.end_at !== booking.end_at ? "booking_reschedule" : "booking_edit", before, booking, "Booking edited/rescheduled");
  return booking;
}

export function archiveBooking(state, bookingId, userId) {
  requirePermission(state, userId, "manage_bookings");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  if (!["Completed", "Cancelled", "Refunded"].includes(booking.status)) {
    throw new Error("Only Completed, Cancelled, or Refunded bookings can be archived.");
  }
  const before = clone(booking);
  booking.status = "Archived";
  audit(state, userId, "booking", bookingId, "status_change", before, booking, "Booking archived");
  return booking;
}

export function completeCheckoutSettlement(state, bookingId, userId, reason = "Checkout settlement confirmed") {
  requirePermission(state, userId, "manage_bookings");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  if (booking.status === "Completed") throw new Error("Completed bookings cannot be checked out again.");
  const before = clone(booking);
  booking.status = "Completed";
  audit(state, userId, "booking", bookingId, "checkout_settlement", before, booking, reason);
  return booking;
}

export function deleteTestBooking(state, bookingId, userId) {
  requirePermission(state, userId, "manage_bookings");
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  const expenseIds = state.expenses.filter((expense) => expense.booking_id === bookingId).map((expense) => expense.id);
  const drinkSaleIds = state.drink_sales.filter((sale) => sale.booking_id === bookingId).map((sale) => sale.id);
  const drinkMovementIds = state.drink_inventory_movements.filter((movement) => movement.booking_id === bookingId).map((movement) => movement.id);
  let ledgerEntryIds = state.ledger_entries
    .filter((entry) => entry.booking_id === bookingId)
    .map((entry) => entry.id);
  ledgerEntryIds.push(
    ...state.expenses.filter((expense) => expense.booking_id === bookingId && expense.ledger_entry_id).map((expense) => expense.ledger_entry_id),
    ...state.drink_sales.filter((sale) => sale.booking_id === bookingId && sale.ledger_entry_id).map((sale) => sale.ledger_entry_id),
    ...state.drink_inventory_movements.filter((movement) => movement.booking_id === bookingId && movement.ledger_entry_id).map((movement) => movement.ledger_entry_id)
  );
  ledgerEntryIds = [...new Set(ledgerEntryIds)];
  const reversalIds = state.ledger_entries
    .filter((entry) => ledgerEntryIds.includes(entry.reversed_entry_id) || (entry.reversed_entry_id && ledgerEntryIds.includes(entry.id)))
    .flatMap((entry) => [entry.id, entry.reversed_entry_id])
    .filter(Boolean);
  ledgerEntryIds = [...new Set([...ledgerEntryIds, ...reversalIds])];

  state.security_deposits = state.security_deposits.filter((item) => item.booking_id !== bookingId);
  if (state.automation_queue) state.automation_queue = state.automation_queue.filter((item) => item.booking_id !== bookingId);
  state.drink_inventory_movements = state.drink_inventory_movements.filter((movement) => !drinkMovementIds.includes(movement.id) && !ledgerEntryIds.includes(movement.ledger_entry_id));
  state.drink_sales = state.drink_sales.filter((sale) => !drinkSaleIds.includes(sale.id));
  state.expenses = state.expenses.filter((expense) => !expenseIds.includes(expense.id));
  state.ledger_lines = state.ledger_lines.filter((line) => !ledgerEntryIds.includes(line.ledger_entry_id));
  state.ledger_entries = state.ledger_entries.filter((entry) => !ledgerEntryIds.includes(entry.id));
  state.bookings = state.bookings.filter((item) => item.id !== bookingId);
  const hasOtherBookings = state.bookings.some((item) => item.guest_id === booking.guest_id);
  if (!hasOtherBookings) state.guests = state.guests.filter((guest) => guest.id !== booking.guest_id);
  return true;
}

export function createWallet(state, fields, userId) {
  requirePermission(state, userId, "manage_wallets");
  if (!fields.name?.trim()) throw new Error("Wallet name is required.");
  const wallet = {
    id: newId(),
    name: fields.name.trim(),
    sort_order: Number(fields.sort_order || 100),
    is_active: true,
    created_at: new Date().toISOString()
  };
  state.wallets.push(wallet);
  audit(state, userId, "wallet", wallet.id, "create", null, wallet);
  return wallet;
}

export function recordLedgerLine(state, fields, userId) {
  requirePermission(state, userId, fields.account_type === "Security Deposit Liability" ? "manage_deposits" : "manage_ledger");
  if (!ACCOUNT_TYPES.includes(fields.account_type)) throw new Error("Invalid account type.");
  if (fields.account_type === "Transfer") throw new Error("Transfer account type is reserved. Transfer screens are not part of Phase 1.");
  const booking = state.bookings.find((item) => item.id === fields.booking_id);
  const wallet = state.wallets.find((item) => item.id === fields.wallet_id && item.is_active);
  const amount = Number(fields.amount);
  if (["Revenue", "Security Deposit Liability", "Refund", "Adjustment"].includes(fields.account_type) && !booking) throw new Error("Booking is required.");
  if (!wallet) throw new Error("Active wallet is required.");
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Amount must not be zero.");

  const entry = {
    id: newId(),
    booking_id: booking?.id || null,
    entry_date: fields.entry_date || new Date().toISOString().slice(0, 10),
    description: fields.description?.trim() || fields.account_type,
    status: "posted",
    created_at: new Date().toISOString(),
    created_by: userId
  };
  const line = {
    id: newId(),
    ledger_entry_id: entry.id,
    wallet_id: wallet.id,
    account_type: fields.account_type,
    amount
  };
  state.ledger_entries.push(entry);
  state.ledger_lines.push(line);
  if (booking) recomputeBookingFinancials(state, booking.id);
  audit(state, userId, "ledger_entry", entry.id, "create", null, { entry, line });
  return { entry, line };
}

export function recordExpense(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const amount = Number(fields.amount);
  const wallet = state.wallets.find((item) => item.id === fields.wallet_id && item.is_active);
  if (!wallet) throw new Error("Active wallet is required.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Expense amount must be positive.");
  const { entry, line } = recordLedgerLine(
    state,
    {
      booking_id: fields.booking_id,
      wallet_id: fields.wallet_id,
      account_type: "Expense",
      amount: -amount,
      description: fields.description || "Expense",
      entry_date: fields.expense_date
    },
    userId
  );
  const expense = {
    id: newId(),
    expense_date: fields.expense_date || new Date().toISOString().slice(0, 10),
    category: fields.category,
    description: fields.description,
    vendor_payee: fields.vendor_payee || "",
    amount,
    wallet_id: fields.wallet_id,
    booking_id: fields.booking_id || null,
    notes: fields.notes || "",
    ledger_entry_id: entry.id,
    created_at: new Date().toISOString()
  };
  state.expenses.push(expense);
  return { entry, line, expense };
}

export function recordTransfer(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const amount = Number(fields.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Transfer amount must be positive.");
  if (fields.source_wallet_id === fields.destination_wallet_id) throw new Error("Source and destination wallet cannot be the same.");
  const source = state.wallets.find((item) => item.id === fields.source_wallet_id && item.is_active);
  const destination = state.wallets.find((item) => item.id === fields.destination_wallet_id && item.is_active);
  if (!source || !destination) throw new Error("Active source and destination wallets are required.");
  const entry = {
    id: newId(),
    booking_id: null,
    entry_date: fields.transfer_date || new Date().toISOString().slice(0, 10),
    description: fields.description || "Wallet transfer",
    status: "posted",
    created_at: new Date().toISOString(),
    created_by: userId
  };
  const lines = [
    { id: newId(), ledger_entry_id: entry.id, wallet_id: source.id, account_type: "Transfer", amount: -amount },
    { id: newId(), ledger_entry_id: entry.id, wallet_id: destination.id, account_type: "Transfer", amount }
  ];
  state.ledger_entries.push(entry);
  state.ledger_lines.push(...lines);
  audit(state, userId, "ledger_entry", entry.id, "transfer_create", null, { entry, lines }, "Wallet transfer recorded");
  return { entry, lines };
}

export function recordOwnerHarvest(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const amount = Number(fields.amount);
  const wallet = state.wallets.find((item) => item.id === fields.source_wallet_id && item.is_active);
  if (!wallet) throw new Error("Active source wallet is required.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Harvest amount must be positive.");
  if (!fields.reason_notes?.trim()) throw new Error("Reason is required.");
  if (amount > walletBalance(state, wallet.id)) throw new Error("Cannot harvest more than current wallet balance.");
  const entry = {
    id: newId(),
    booking_id: null,
    entry_date: fields.harvest_date || new Date().toISOString().slice(0, 10),
    description: `Owner Harvest - ${fields.harvest_type}`,
    status: "posted",
    created_at: new Date().toISOString(),
    created_by: userId
  };
  const line = {
    id: newId(),
    ledger_entry_id: entry.id,
    wallet_id: wallet.id,
    account_type: "Owner Harvest",
    amount: -amount
  };
  const harvest = {
    id: newId(),
    harvest_date: entry.entry_date,
    source_wallet_id: wallet.id,
    amount,
    harvest_type: fields.harvest_type,
    reason_notes: fields.reason_notes.trim(),
    destination: fields.destination || "",
    ledger_entry_id: entry.id,
    created_at: new Date().toISOString()
  };
  state.ledger_entries.push(entry);
  state.ledger_lines.push(line);
  state.owner_harvests.push(harvest);
  audit(state, userId, "owner_harvest", harvest.id, "create", null, { harvest, entry, line }, "Owner harvest recorded");
  return { harvest, entry, line };
}

export function reverseLedgerEntry(state, entryId, reason, userId) {
  requirePermission(state, userId, "manage_ledger");
  const entry = state.ledger_entries.find((item) => item.id === entryId);
  if (!entry) throw new Error("Transaction not found.");
  if (entry.status !== "posted" || entry.reversed_at) throw new Error("Transaction is already voided or reversed.");
  const originalLines = state.ledger_lines.filter((line) => line.ledger_entry_id === entryId);
  if (!originalLines.length) throw new Error("Transaction has no ledger lines to reverse.");
  const reversalEntry = {
    id: newId(),
    booking_id: entry.booking_id,
    entry_date: new Date().toISOString().slice(0, 10),
    description: `Reversal: ${entry.description}`,
    status: "posted",
    reversed_entry_id: entry.id,
    reversal_reason: reason,
    created_at: new Date().toISOString(),
    created_by: userId
  };
  const reversalLines = originalLines.map((line) => ({
    id: newId(),
    ledger_entry_id: reversalEntry.id,
    wallet_id: line.wallet_id,
    account_type: line.account_type,
    amount: -Number(line.amount)
  }));
  entry.reversed_at = new Date().toISOString();
  entry.reversal_reason = reason;
  state.ledger_entries.push(reversalEntry);
  state.ledger_lines.push(...reversalLines);
  if (entry.booking_id) recomputeBookingFinancials(state, entry.booking_id);
  audit(state, userId, "ledger_entry", entry.id, "reverse", entry, { reversalEntry, reversalLines }, reason);
  return { reversalEntry, reversalLines };
}

export function recordDailyClosing(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const expected = walletBalance(state, fields.wallet_id);
  const actual = Number(fields.actual_counted_amount);
  const closing = {
    id: newId(),
    closing_date: fields.closing_date || new Date().toISOString().slice(0, 10),
    wallet_id: fields.wallet_id,
    expected_balance: expected,
    actual_counted_amount: actual,
    difference: actual - expected,
    notes: fields.notes || "",
    closed_by: "Manager",
    created_at: new Date().toISOString()
  };
  state.daily_closings.push(closing);
  audit(state, userId, "daily_closing", closing.id, "create", null, closing, "Daily closing recorded");
  return closing;
}

export function drinkCurrentStock(state, productId) {
  return state.drink_inventory_movements
    .filter((movement) => movement.product_id === productId)
    .reduce((total, movement) => total + drinkMovementSignedQuantity(movement), 0);
}

export function drinkProductMetrics(state, productId, now = new Date()) {
  const product = state.drink_products.find((item) => item.id === productId);
  if (!product) return null;
  const today = dateKey(now);
  const month = today.slice(0, 7);
  const sales = state.drink_sales.filter((sale) => sale.product_id === productId);
  const todaySales = sales.filter((sale) => sale.sale_date === today);
  const monthSales = sales.filter((sale) => String(sale.sale_date || "").startsWith(month));
  const totalProfit = monthSales.reduce((total, sale) => total + Number(sale.net_profit || 0), 0);
  const currentStock = drinkCurrentStock(state, productId);

  return {
    current_stock_cases: currentStock,
    inventory_value: currentStock * Number(product.cost_per_case || 0),
    sales_today_cases: sum(todaySales.map((sale) => sale.quantity_cases)),
    sales_month_cases: sum(monthSales.map((sale) => sale.quantity_cases)),
    profit_estimate: totalProfit
  };
}

export function recordDrinkInventoryMovement(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const product = state.drink_products.find((item) => item.id === fields.product_id);
  if (!product) throw new Error("Drink product is required.");
  if (!DRINK_MOVEMENT_TYPES.includes(fields.movement_type)) throw new Error("Invalid drink movement type.");
  if (fields.movement_type === "sale") throw new Error("Use Record Drink Sale for sales.");
  const quantity = Number(fields.quantity_cases);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Quantity must not be zero.");
  if (fields.movement_type !== "adjustment" && quantity <= 0) throw new Error("Quantity must be positive.");
  const movement = {
    id: newId(),
    movement_date: fields.movement_date || new Date().toISOString().slice(0, 10),
    product_id: product.id,
    movement_type: fields.movement_type,
    quantity_cases: quantity,
    wallet_id: fields.wallet_id || null,
    booking_id: fields.booking_id || null,
    notes: fields.notes || "",
    ledger_entry_id: null,
    created_at: new Date().toISOString()
  };
  state.drink_inventory_movements.push(movement);
  audit(state, userId, "drink_inventory_movement", movement.id, "create", null, movement, "Drink inventory movement recorded");
  return movement;
}

export function recordDrinkSale(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const product = state.drink_products.find((item) => item.id === fields.product_id && item.is_active);
  const wallet = state.wallets.find((item) => item.id === fields.wallet_id && item.is_active);
  if (!product) throw new Error("Active drink product is required.");
  if (!wallet) throw new Error("Active wallet is required.");
  const quantity = Number(fields.quantity_cases);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be positive.");
  if (drinkCurrentStock(state, product.id) < quantity) throw new Error("Not enough drink stock.");

  const salesAmount = quantity * Number(product.selling_price_per_case || 0);
  const costAmount = quantity * Number(product.cost_per_case || 0);
  const commissionAmount = quantity * Number(product.commission_per_case || 0);
  const netProfit = salesAmount - costAmount - commissionAmount;
  const saleDate = fields.sale_date || new Date().toISOString().slice(0, 10);
  const entry = {
    id: newId(),
    booking_id: null,
    entry_date: saleDate,
    description: `Drink sale - ${product.name}`,
    status: "posted",
    reference_number: fields.reference_number || null,
    proof_note: fields.proof_note || null,
    created_at: new Date().toISOString(),
    created_by: userId
  };
  const line = {
    id: newId(),
    ledger_entry_id: entry.id,
    wallet_id: wallet.id,
    account_type: "Revenue",
    amount: salesAmount
  };
  const sale = {
    id: newId(),
    sale_date: saleDate,
    product_id: product.id,
    booking_id: fields.booking_id || null,
    quantity_cases: quantity,
    wallet_id: wallet.id,
    sales_amount: salesAmount,
    cost_amount: costAmount,
    commission_amount: commissionAmount,
    net_profit: netProfit,
    notes: fields.notes || "",
    ledger_entry_id: entry.id,
    created_at: new Date().toISOString()
  };
  const movement = {
    id: newId(),
    movement_date: saleDate,
    product_id: product.id,
    movement_type: "sale",
    quantity_cases: quantity,
    wallet_id: wallet.id,
    booking_id: fields.booking_id || null,
    notes: fields.notes || "",
    ledger_entry_id: entry.id,
    created_at: new Date().toISOString()
  };

  state.ledger_entries.push(entry);
  state.ledger_lines.push(line);
  state.drink_sales.push(sale);
  state.drink_inventory_movements.push(movement);
  audit(state, userId, "drink_sale", sale.id, "create", null, { sale, movement, entry, line }, "Drink sale recorded");
  return { sale, movement, entry, line };
}

export function bookingProfitability(state, bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("Booking not found.");
  const packageRevenue = Number(booking.total_revenue || 0);
  const drinkProfit = state.drink_sales
    .filter((sale) => sale.booking_id === bookingId)
    .reduce((total, sale) => total + Number(sale.net_profit || 0), 0);
  const electricityCost = 0;
  const linkedExpenses = state.expenses
    .filter((expense) => {
      if (expense.booking_id !== bookingId) return false;
      const entry = state.ledger_entries.find((item) => item.id === expense.ledger_entry_id);
      return !entry || (entry.status === "posted" && !entry.reversed_at);
    })
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);
  return {
    package_revenue: packageRevenue,
    drink_profit: drinkProfit,
    electricity_cost: electricityCost,
    booking_linked_expenses: linkedExpenses,
    booking_profit: packageRevenue + drinkProfit - electricityCost - linkedExpenses
  };
}

export function recordElectricityBaseline(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const startMeter = Number(fields.start_meter);
  const rate = Number(fields.rate_per_kwh);
  if (!Number.isFinite(startMeter) || startMeter <= 0) throw new Error("Starting reading must be positive.");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Rate per kWh must be positive.");
  const baseline = {
    id: newId(),
    billing_period_month: fields.billing_period_month,
    start_meter: startMeter,
    rate_per_kwh: rate,
    notes: fields.notes || "",
    created_at: new Date().toISOString()
  };
  state.electricity_monthly_baselines.push(baseline);
  audit(state, userId, "electricity_baseline", baseline.id, "create", null, baseline, "Monthly electricity baseline recorded");
  return baseline;
}

export function recordElectricityReading(state, fields, userId) {
  requirePermission(state, userId, "manage_ledger");
  const baseline = state.electricity_monthly_baselines.find((item) => item.id === fields.baseline_id);
  if (!baseline) throw new Error("Monthly starting reading is required first.");
  const currentMeter = Number(fields.current_meter);
  if (!Number.isFinite(currentMeter) || currentMeter <= 0) throw new Error("Current reading must be positive.");
  if (currentMeter < Number(baseline.start_meter)) throw new Error("Current reading cannot be lower than starting reading.");
  const reading = {
    id: newId(),
    baseline_id: baseline.id,
    reading_date: fields.reading_date || new Date().toISOString().slice(0, 10),
    current_meter: currentMeter,
    notes: fields.notes || "",
    created_at: new Date().toISOString()
  };
  state.electricity_readings.push(reading);
  audit(state, userId, "electricity_reading", reading.id, "create", null, reading, "Electricity current reading recorded");
  return reading;
}

export function electricityTrackerSummary(baseline, reading) {
  if (!baseline || !reading) return { kwh_used: 0, estimated_amount: 0 };
  const kwhUsed = Number(reading.current_meter || 0) - Number(baseline.start_meter || 0);
  if (kwhUsed < 0) throw new Error("Current reading cannot be lower than starting reading.");
  return {
    kwh_used: kwhUsed,
    estimated_amount: kwhUsed * Number(baseline.rate_per_kwh || 0)
  };
}

export function walletBalance(state, walletId) {
  return state.ledger_lines.reduce((total, line) => {
    const entry = state.ledger_entries.find((item) => item.id === line.ledger_entry_id);
    if (entry?.status === "posted" && line.wallet_id === walletId) return total + Number(line.amount);
    return total;
  }, 0);
}

export function financeSummary(state, now = new Date()) {
  const today = dateKey(now);
  const month = today.slice(0, 7);
  const posted = postedLedgerLines(state);
  const todayRevenue = sumByType(posted, "Revenue", (entry) => entry.entry_date === today);
  const todayExpenses = expenseTotal(sumByType(posted, "Expense", (entry) => entry.entry_date === today));
  const monthRevenue = sumByType(posted, "Revenue", (entry) => String(entry.entry_date || "").startsWith(month));
  const monthExpenses = expenseTotal(sumByType(posted, "Expense", (entry) => String(entry.entry_date || "").startsWith(month)));
  const securityDepositLiability = sumByType(posted, "Security Deposit Liability", () => true);

  return {
    today_revenue: todayRevenue,
    today_expenses: todayExpenses,
    today_net: todayRevenue - todayExpenses,
    month_revenue: monthRevenue,
    month_expenses: monthExpenses,
    month_net: monthRevenue - monthExpenses,
    security_deposit_liability: securityDepositLiability
  };
}

export function filterLedgerLines(state, filters = {}) {
  const query = String(filters.search || "").trim().toLowerCase();
  return postedLedgerLines(state)
    .filter(({ line, entry }) => {
      if (filters.start_date && entry.entry_date < filters.start_date) return false;
      if (filters.end_date && entry.entry_date > filters.end_date) return false;
      if (filters.wallet_id && line.wallet_id !== filters.wallet_id) return false;
      if (filters.account_type && line.account_type !== filters.account_type) return false;
      if (!query) return true;

      const linkedBookingId = entry.booking_id || state.drink_sales?.find((sale) => sale.ledger_entry_id === entry.id)?.booking_id;
      const booking = state.bookings.find((item) => item.id === linkedBookingId);
      const guest = state.guests.find((item) => item.id === booking?.guest_id);
      return [
        booking?.booking_code,
        guest?.full_name,
        guest?.phone,
        guest?.alternate_contact_number,
        entry.description,
        entry.reference_number
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const dateCompare = String(b.entry.entry_date || "").localeCompare(String(a.entry.entry_date || ""));
      if (dateCompare) return dateCompare;
      return String(b.entry.created_at || "").localeCompare(String(a.entry.created_at || ""));
    });
}

export function expenseSummaryByCategory(state, filters = {}) {
  const rows = state.expenses
    .map((expense) => {
      const entry = state.ledger_entries.find((item) => item.id === expense.ledger_entry_id && item.status === "posted");
      if (!entry || entry.reversed_at) return null;
      if (filters.start_date && entry.entry_date < filters.start_date) return null;
      if (filters.end_date && entry.entry_date > filters.end_date) return null;
      const amount = state.ledger_lines
        .filter((line) => line.ledger_entry_id === entry.id && line.account_type === "Expense")
        .reduce((total, line) => total + Math.abs(Number(line.amount || 0)), 0);
      return {
        category: expense.category || "Uncategorized",
        amount
      };
    })
    .filter(Boolean);

  const totals = new Map();
  rows.forEach((row) => totals.set(row.category, Number(totals.get(row.category) || 0) + row.amount));
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export function recomputeBookingFinancials(state, bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const lines = state.ledger_lines.filter((line) => {
    const entry = state.ledger_entries.find((item) => item.id === line.ledger_entry_id);
    return entry?.booking_id === bookingId && entry.status === "posted";
  });
  booking.total_revenue = sum(lines.filter((line) => line.account_type === "Revenue").map((line) => line.amount));
  booking.total_deposit_received = sum(
    lines
      .filter((line) => line.account_type === "Security Deposit Liability" && Number(line.amount) > 0)
      .map((line) => line.amount)
  );
  booking.total_deposit_refunded = Math.abs(
    sum(
      lines
        .filter((line) => line.account_type === "Security Deposit Liability" && Number(line.amount) < 0)
        .map((line) => line.amount)
    )
  );

  const helper = state.security_deposits.find((item) => item.booking_id === bookingId);
  if (helper) {
    helper.required_amount = booking.security_deposit_amount;
    helper.received_amount = booking.total_deposit_received;
    helper.refunded_amount = booking.total_deposit_refunded;
    helper.status = depositStatus(helper);
  }
}

export function findBookingConflict(state, booking) {
  if (!BLOCKING_STATUSES.has(booking.status)) return null;
  return state.bookings.find((existing) => {
    if (existing.id === booking.id || !BLOCKING_STATUSES.has(existing.status)) return false;
    return rangesOverlap(booking.start_at, booking.end_at, existing.start_at, existing.end_at);
  });
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

function nextBookingCode(state, startAt) {
  const year = new Date(startAt).getFullYear();
  state.booking_counters[year] = Number(state.booking_counters[year] || 0) + 1;
  return `TRZ-${year}-${String(state.booking_counters[year]).padStart(4, "0")}`;
}

function depositStatus(helper) {
  if (helper.refunded_amount >= helper.received_amount && helper.received_amount > 0) return "Refunded";
  if (helper.refunded_amount > 0) return "Partially Refunded";
  if (helper.received_amount >= helper.required_amount) return "Received";
  if (helper.received_amount > 0) return "Partially Received";
  return "Not Requested";
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function postedLedgerLines(state) {
  return state.ledger_lines
    .map((line) => ({
      line,
      entry: state.ledger_entries.find((item) => item.id === line.ledger_entry_id)
    }))
    .filter(({ entry }) => entry?.status === "posted");
}

function sumByType(rows, accountType, includeEntry) {
  return rows.reduce((total, { line, entry }) => {
    if (line.account_type !== accountType || !includeEntry(entry)) return total;
    return total + Number(line.amount || 0);
  }, 0);
}

function expenseTotal(amount) {
  return Math.max(-Number(amount || 0), 0);
}

function drinkMovementSignedQuantity(movement) {
  const quantity = Number(movement.quantity_cases || 0);
  if (movement.movement_type === "sale" || movement.movement_type === "damage_spoilage") return -Math.abs(quantity);
  if (movement.movement_type === "adjustment") return quantity;
  return Math.abs(quantity);
}

function dateKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}

function requirePermission(state, userId, permission) {
  if (!hasPermission(state, userId, permission)) throw new Error(`Missing permission: ${permission}`);
}
