import assert from "node:assert/strict";
import {
  archiveBooking,
  changeBookingStatus,
  completeCheckoutSettlement,
  createBooking,
  createGuest,
  createInitialState,
  calculateBasePrice,
  deleteTestBooking,
  bookingProfitability,
  drinkCurrentStock,
  drinkProductMetrics,
  electricityTrackerSummary,
  editBooking,
  expenseSummaryByCategory,
  filterLedgerLines,
  financeSummary,
  latestPackageVersion,
  overnightOccupiedDateKeys,
  recordDailyClosing,
  recordDrinkInventoryMovement,
  recordDrinkSale,
  recordElectricityBaseline,
  recordElectricityReading,
  recordExpense,
  recordLedgerLine,
  recordOwnerHarvest,
  recordTransfer,
  reverseLedgerEntry,
  updatePackageVersion,
  walletBalance
} from "../src/core.js";

const state = createInitialState();
const manager = state.user_profiles.find((user) => user.full_name === "TRZ Manager").id;
const accounting = state.user_profiles.find((user) => user.full_name === "Accounting").id;

const guest = createGuest(
  state,
  {
    full_name: "Maria Santos",
    phone: "09170000000",
    alternate_contact_number: "09180000000",
    email: "maria@example.test",
    notes: "Organizer is alternate contact."
  },
  manager
);

assert.equal(guest.alternate_contact_number, "09180000000");

const dayUse = state.packages.find((pkg) => pkg.name === "Day Use");
const originalDayUseVersion = latestPackageVersion(state, dayUse.id);

const booking = createBooking(
  state,
  {
    guest_id: guest.id,
    package_version_id: originalDayUseVersion.id,
    status: "Tentative",
    start_at: "2026-06-20T15:00:00.000Z",
    end_at: "2026-06-20T23:00:00.000Z",
    pax_count: 15,
    security_deposit_amount: 5000,
    notes: ""
  },
  manager
);

assert.equal(booking.booking_code, "TRZ-2026-0001");
assert.equal(booking.base_price, 10000);

assert.throws(
  () =>
    createBooking(
      state,
      {
        guest_id: guest.id,
        package_version_id: originalDayUseVersion.id,
        status: "Confirmed",
        start_at: "2026-06-20T16:00:00.000Z",
        end_at: "2026-06-20T20:00:00.000Z",
        pax_count: 10,
        security_deposit_amount: 5000
      },
      manager
    ),
  /conflict/
);

const cancelled = createBooking(
  state,
  {
    guest_id: guest.id,
    package_version_id: originalDayUseVersion.id,
    status: "Cancelled",
    start_at: "2026-06-20T16:00:00.000Z",
    end_at: "2026-06-20T20:00:00.000Z",
    pax_count: 10,
    security_deposit_amount: 5000
  },
  manager
);

assert.equal(cancelled.booking_code, "TRZ-2026-0002");

const standard = state.packages.find((pkg) => pkg.name === "Standard Package");
const standardVersion = latestPackageVersion(state, standard.id);
const multiNightBooking = createBooking(
  state,
  {
    guest_id: guest.id,
    package_version_id: standardVersion.id,
    status: "Tentative",
    start_at: "2026-06-22T15:00:00.000Z",
    end_at: "2026-06-25T12:00:00.000Z",
    pax_count: 25,
    security_deposit_amount: 5000
  },
  manager
);

assert.equal(calculateBasePrice(standardVersion, multiNightBooking.start_at, multiNightBooking.end_at), 60000);
assert.equal(multiNightBooking.base_price, 60000);
assert.deepEqual(
  overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-18T12:00:00.000Z"),
  ["2026-06-17"]
);
assert.ok(!overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-18T12:00:00.000Z").includes("2026-06-18"));
assert.deepEqual(
  overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-19T12:00:00.000Z"),
  ["2026-06-17", "2026-06-18"]
);
assert.ok(!overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-19T12:00:00.000Z").includes("2026-06-19"));
assert.deepEqual(
  overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-20T12:00:00.000Z"),
  ["2026-06-17", "2026-06-18", "2026-06-19"]
);
assert.ok(!overnightOccupiedDateKeys("2026-06-17T15:00:00.000Z", "2026-06-20T12:00:00.000Z").includes("2026-06-20"));

const completedMultiNight = completeCheckoutSettlement(state, multiNightBooking.id, manager);
assert.equal(completedMultiNight.status, "Completed");

const futureBookingAfterCompleted = createBooking(
  state,
  {
    guest_id: guest.id,
    package_version_id: standardVersion.id,
    status: "Confirmed",
    start_at: "2026-06-22T15:00:00.000Z",
    end_at: "2026-06-25T12:00:00.000Z",
    pax_count: 25,
    security_deposit_amount: 5000
  },
  manager
);

assert.equal(futureBookingAfterCompleted.booking_code, "TRZ-2026-0004");

const rescheduled = editBooking(
  state,
  futureBookingAfterCompleted.id,
  {
    guest_id: guest.id,
    package_version_id: standardVersion.id,
    start_at: "2026-06-26T15:00:00.000Z",
    end_at: "2026-06-28T12:00:00.000Z",
    pax_count: 22,
    security_deposit_amount: 7000,
    notes: "Moved by guest request."
  },
  manager
);

assert.equal(rescheduled.base_price, 40000);
assert.equal(rescheduled.security_deposit_amount, 7000);
assert.ok(state.audit_logs.some((log) => log.action === "booking_reschedule"));

assert.throws(
  () =>
    editBooking(
      state,
      futureBookingAfterCompleted.id,
      {
        guest_id: guest.id,
        package_version_id: standardVersion.id,
        start_at: "2026-06-20T15:00:00.000Z",
        end_at: "2026-06-21T12:00:00.000Z",
        pax_count: 22,
        security_deposit_amount: 7000,
        notes: ""
      },
      manager
    ),
  /conflict/
);

changeBookingStatus(state, rescheduled.id, "Cancelled", manager, "Guest cancelled");
assert.equal(state.bookings.find((item) => item.id === rescheduled.id).status, "Cancelled");
archiveBooking(state, rescheduled.id, manager);
assert.equal(state.bookings.find((item) => item.id === rescheduled.id).status, "Archived");

const nextVersion = updatePackageVersion(
  state,
  dayUse.id,
  {
    price: 12000,
    included_pax: 15,
    included_rooms: 3,
    has_breakfast: false,
    start_time: "15:00",
    end_time: "23:00",
    is_overnight: false
  },
  manager
);

assert.equal(nextVersion.version_number, 2);
assert.equal(state.bookings.find((item) => item.id === booking.id).package_version_id, originalDayUseVersion.id);
assert.equal(state.bookings.find((item) => item.id === booking.id).base_price, 10000);

const cash = state.wallets.find((wallet) => wallet.name === "Cash");
const gcash = state.wallets.find((wallet) => wallet.name === "GCash");

recordLedgerLine(
  state,
  {
    booking_id: booking.id,
    wallet_id: cash.id,
    account_type: "Revenue",
    amount: 10000,
    entry_date: "2026-06-21",
    description: "Day Use payment"
  },
  accounting
);

recordLedgerLine(
  state,
  {
    booking_id: booking.id,
    wallet_id: gcash.id,
    account_type: "Security Deposit Liability",
    amount: 5000,
    entry_date: "2026-06-21",
    description: "Security deposit received"
  },
  accounting
);

recordLedgerLine(
  state,
  {
    booking_id: booking.id,
    wallet_id: gcash.id,
    account_type: "Security Deposit Liability",
    amount: -5000,
    entry_date: "2026-06-21",
    description: "Security deposit refunded"
  },
  accounting
);

const refreshedBooking = state.bookings.find((item) => item.id === booking.id);
const deposit = state.security_deposits.find((item) => item.booking_id === booking.id);

assert.equal(refreshedBooking.total_revenue, 10000);
assert.equal(refreshedBooking.total_deposit_received, 5000);
assert.equal(refreshedBooking.total_deposit_refunded, 5000);
assert.equal(deposit.status, "Refunded");
assert.equal(walletBalance(state, cash.id), 10000);
assert.equal(walletBalance(state, gcash.id), 0);
assert.equal(refreshedBooking.total_revenue, 10000, "deposit liability must not be counted as revenue");

const deleteGuest = createGuest(
  state,
  {
    full_name: "Training Delete Guest",
    phone: "09990000000",
    email: "delete@example.test"
  },
  manager
);
const deleteBooking = createBooking(
  state,
  {
    guest_id: deleteGuest.id,
    package_version_id: originalDayUseVersion.id,
    status: "Tentative",
    start_at: "2026-06-29T15:00:00.000Z",
    end_at: "2026-06-29T23:00:00.000Z",
    pax_count: 12,
    security_deposit_amount: 5000
  },
  manager
);
recordLedgerLine(
  state,
  {
    booking_id: deleteBooking.id,
    wallet_id: cash.id,
    account_type: "Revenue",
    amount: 3000,
    entry_date: "2026-06-29",
    description: "Training payment"
  },
  accounting
);
recordLedgerLine(
  state,
  {
    booking_id: deleteBooking.id,
    wallet_id: cash.id,
    account_type: "Security Deposit Liability",
    amount: 5000,
    entry_date: "2026-06-29",
    description: "Training deposit"
  },
  accounting
);
recordExpense(
  state,
  {
    expense_date: "2026-06-29",
    category: "Miscellaneous",
    description: "Training linked expense",
    vendor_payee: "Training",
    amount: 500,
    wallet_id: cash.id,
    booking_id: deleteBooking.id,
    notes: ""
  },
  accounting
);
assert.equal(walletBalance(state, cash.id), 17500);
assert.equal(financeSummary(state, new Date("2026-06-29T08:00:00")).today_revenue, 3000);
assert.equal(financeSummary(state, new Date("2026-06-29T08:00:00")).security_deposit_liability, 5000);
deleteTestBooking(state, deleteBooking.id, manager);
assert.equal(state.bookings.some((item) => item.id === deleteBooking.id), false);
assert.equal(state.guests.some((item) => item.id === deleteGuest.id), false);
assert.equal(state.ledger_entries.some((entry) => entry.booking_id === deleteBooking.id), false);
assert.equal(state.expenses.some((expense) => expense.booking_id === deleteBooking.id), false);
assert.equal(filterLedgerLines(state, { search: deleteBooking.booking_code }).length, 0);
assert.equal(walletBalance(state, cash.id), 10000);
assert.equal(financeSummary(state, new Date("2026-06-29T08:00:00")).today_revenue, 0);
assert.equal(financeSummary(state, new Date("2026-06-29T08:00:00")).security_deposit_liability, 0);

const expenseResult = recordExpense(
  state,
  {
    expense_date: "2026-06-21",
    category: "Cleaning Supplies",
    description: "Mop and detergent",
    vendor_payee: "Local store",
    amount: 1500,
    wallet_id: cash.id,
    notes: ""
  },
  accounting
);

assert.equal(walletBalance(state, cash.id), 8500);
assert.equal(expenseResult.line.account_type, "Expense");
assert.equal(expenseResult.line.amount, -1500);

const bank = state.wallets.find((wallet) => wallet.name === "Bank");
recordTransfer(
  state,
  {
    source_wallet_id: cash.id,
    destination_wallet_id: bank.id,
    amount: 2000,
    transfer_date: "2026-06-21",
    description: "Cash deposit to bank"
  },
  accounting
);

assert.equal(walletBalance(state, cash.id), 6500);
assert.equal(walletBalance(state, bank.id), 2000);
assert.equal(refreshedBooking.total_revenue, 10000, "transfer must not change booking revenue");

const financeBeforeReversal = financeSummary(state, new Date("2026-06-21T08:00:00"));
assert.equal(financeBeforeReversal.today_revenue, 10000);
assert.equal(financeBeforeReversal.today_expenses, 1500);
assert.equal(financeBeforeReversal.today_net, 8500);
assert.equal(financeBeforeReversal.month_revenue, 10000);
assert.equal(financeBeforeReversal.month_expenses, 1500);
assert.equal(financeBeforeReversal.month_net, 8500);
assert.equal(financeBeforeReversal.security_deposit_liability, 0);

const filteredExpenses = filterLedgerLines(state, {
  start_date: "2026-06-21",
  end_date: "2026-06-21",
  account_type: "Expense"
});
assert.equal(filteredExpenses.length, 1);
assert.equal(filteredExpenses[0].line.amount, -1500);

const guestMatches = filterLedgerLines(state, { search: "Maria" });
assert.ok(guestMatches.some(({ entry }) => entry.booking_id === booking.id));

const categorySummary = expenseSummaryByCategory(state, {
  start_date: "2026-06-21",
  end_date: "2026-06-21"
});
assert.deepEqual(categorySummary, [{ category: "Cleaning Supplies", amount: 1500 }]);

reverseLedgerEntry(state, expenseResult.entry.id, "Wrong receipt amount", accounting);
assert.equal(walletBalance(state, cash.id), 8000);
assert.equal(financeSummary(state, new Date("2026-06-21T08:00:00")).month_expenses, 0);
assert.deepEqual(expenseSummaryByCategory(state, {
  start_date: "2026-06-21",
  end_date: "2026-06-21"
}), []);

const closing = recordDailyClosing(
  state,
  {
    wallet_id: cash.id,
    actual_counted_amount: 7900,
    closing_date: "2026-06-21",
    notes: "Short by 100"
  },
  accounting
);

assert.equal(closing.expected_balance, 8000);
assert.equal(closing.difference, -100);
assert.equal(walletBalance(state, cash.id), 8000, "daily closing must not change wallet balance");

const redHorse = state.drink_products.find((product) => product.name === "Red Horse 500ml");
assert.equal(redHorse.cost_per_case, 620);
assert.equal(redHorse.selling_price_per_case, 1600);
assert.equal(redHorse.commission_per_case, 100);

recordDrinkInventoryMovement(
  state,
  {
    movement_date: "2026-06-21",
    product_id: redHorse.id,
    movement_type: "purchase_add_stock",
    quantity_cases: 5,
    wallet_id: cash.id,
    notes: "Opening stock"
  },
  accounting
);

assert.equal(drinkCurrentStock(state, redHorse.id), 5);

const drinkSale = recordDrinkSale(
  state,
  {
    sale_date: "2026-06-21",
    product_id: redHorse.id,
    booking_id: booking.id,
    quantity_cases: 2,
    wallet_id: cash.id,
    notes: "Guest bought two cases"
  },
  accounting
);

assert.equal(drinkCurrentStock(state, redHorse.id), 3);
assert.equal(drinkSale.sale.sales_amount, 3200);
assert.equal(drinkSale.sale.cost_amount, 1240);
assert.equal(drinkSale.sale.commission_amount, 200);
assert.equal(drinkSale.sale.net_profit, 1760);
assert.equal(drinkSale.line.account_type, "Revenue");
assert.equal(drinkSale.line.amount, 3200);
assert.equal(drinkSale.entry.booking_id, null, "drink ledger revenue must not change package balance calculations");
assert.equal(walletBalance(state, cash.id), 11200);
assert.equal(refreshedBooking.total_revenue, 10000, "drink sale must not reduce package balance due");

const drinkMetrics = drinkProductMetrics(state, redHorse.id, new Date("2026-06-21T08:00:00"));
assert.equal(drinkMetrics.current_stock_cases, 3);
assert.equal(drinkMetrics.inventory_value, 1860);
assert.equal(drinkMetrics.sales_today_cases, 2);
assert.equal(drinkMetrics.sales_month_cases, 2);
assert.equal(drinkMetrics.profit_estimate, 1760);

const beforeHarvestSummary = financeSummary(state, new Date("2026-06-21T08:00:00"));
const harvest = recordOwnerHarvest(
  state,
  {
    harvest_date: "2026-06-21",
    source_wallet_id: cash.id,
    amount: 1000,
    harvest_type: "Owner Draw",
    reason_notes: "Owner withdrawal",
    destination: "Owner"
  },
  accounting
);
assert.equal(harvest.line.account_type, "Owner Harvest");
assert.equal(harvest.line.amount, -1000);
assert.equal(walletBalance(state, cash.id), 10200);
const afterHarvestSummary = financeSummary(state, new Date("2026-06-21T08:00:00"));
assert.equal(afterHarvestSummary.today_revenue, beforeHarvestSummary.today_revenue);
assert.equal(afterHarvestSummary.today_expenses, beforeHarvestSummary.today_expenses);
assert.throws(
  () =>
    recordOwnerHarvest(
      state,
      {
        harvest_date: "2026-06-21",
        source_wallet_id: cash.id,
        amount: 999999,
        harvest_type: "Owner Draw",
        reason_notes: "Too much"
      },
      accounting
    ),
  /Cannot harvest more/
);

const electricityBaseline = recordElectricityBaseline(
  state,
  {
    billing_period_month: "2026-06-01",
    start_meter: 100,
    rate_per_kwh: 12.5,
    notes: "Bill paid"
  },
  accounting
);
const electricityReading = recordElectricityReading(
  state,
  {
    baseline_id: electricityBaseline.id,
    reading_date: "2026-06-21",
    current_meter: 145,
    notes: "Mid-month reading"
  },
  accounting
);
const electricitySummary = electricityTrackerSummary(electricityBaseline, electricityReading);
assert.equal(electricitySummary.kwh_used, 45);
assert.equal(electricitySummary.estimated_amount, 562.5);

assert.throws(
  () =>
    recordElectricityReading(
      state,
      {
        baseline_id: electricityBaseline.id,
        reading_date: "2026-06-21",
        current_meter: 99
      },
      accounting
    ),
  /Current reading cannot be lower/
);

recordExpense(
  state,
  {
    expense_date: "2026-06-21",
    category: "Staff Meal",
    description: "Booking staff meal",
    vendor_payee: "Local store",
    amount: 500,
    wallet_id: cash.id,
    booking_id: booking.id,
    notes: ""
  },
  accounting
);

const profitability = bookingProfitability(state, booking.id);
assert.equal(profitability.package_revenue, 10000);
assert.equal(profitability.drink_profit, 1760);
assert.equal(profitability.electricity_cost, 0);
assert.equal(profitability.booking_linked_expenses, 500);
assert.equal(profitability.booking_profit, 11260);

assert.throws(
  () =>
    recordDrinkSale(
      state,
      {
        sale_date: "2026-06-21",
        product_id: redHorse.id,
        quantity_cases: 10,
        wallet_id: cash.id
      },
      accounting
    ),
  /Not enough drink stock/
);

changeBookingStatus(state, booking.id, "Confirmed", manager, "Deposit received");
assert.ok(state.audit_logs.some((log) => log.entity_type === "booking" && log.action === "status_change"));
assert.ok(state.audit_logs.some((log) => log.entity_type === "ledger_entry" && log.action === "create"));
assert.ok(state.audit_logs.some((log) => log.entity_type === "package" && log.action === "create_version"));
assert.ok(state.audit_logs.some((log) => log.entity_type === "drink_sale" && log.action === "create"));

assert.throws(
  () =>
    recordLedgerLine(
      state,
      {
        booking_id: booking.id,
        wallet_id: cash.id,
        account_type: "Transfer",
        amount: 1000,
        description: "Reserved only"
      },
      accounting
    ),
  /reserved/
);

console.log("Phase 1 foundation tests passed.");
