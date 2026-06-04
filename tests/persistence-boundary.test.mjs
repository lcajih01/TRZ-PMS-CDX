import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const supabase = await readFile(new URL("../src/supabase.js", import.meta.url), "utf8");
const foundationMigration = await readFile(new URL("../supabase/migrations/001_phase1_foundation.sql", import.meta.url), "utf8");
const accessMigration = await readFile(new URL("../supabase/migrations/002_access_code_rls.sql", import.meta.url), "utf8");
const financialWorkflowMigration = await readFile(new URL("../supabase/migrations/004_phase1_financial_workflow.sql", import.meta.url), "utf8");
const checkinWorkflowMigration = await readFile(new URL("../supabase/migrations/005_phase1_checkin_workflow.sql", import.meta.url), "utf8");
const deleteMigration = await readFile(new URL("../supabase/migrations/006_calendar_history_pricing_delete.sql", import.meta.url), "utf8");
const checkoutCompletesMigration = await readFile(new URL("../supabase/migrations/007_checkout_settlement_completes_booking.sql", import.meta.url), "utf8");
const hardeningMigration = await readFile(new URL("../supabase/migrations/008_phase1_hardening.sql", import.meta.url), "utf8");
const bookingManagementMigration = await readFile(new URL("../supabase/migrations/009_phase2b_booking_management.sql", import.meta.url), "utf8");
const financeControlsMigration = await readFile(new URL("../supabase/migrations/010_phase2c_finance_controls.sql", import.meta.url), "utf8");
const drinksMigration = await readFile(new URL("../supabase/migrations/011_phase3a_drinks_inventory.sql", import.meta.url), "utf8");
const electricityMigration = await readFile(new URL("../supabase/migrations/012_phase3b_electricity_tracking.sql", import.meta.url), "utf8");
const simplifiedElectricityMigration = await readFile(new URL("../supabase/migrations/013_phase3b_simplify_electricity_tracker.sql", import.meta.url), "utf8");
const ownerHarvestMigration = await readFile(new URL("../supabase/migrations/014_phase3c_owner_harvest.sql", import.meta.url), "utf8");
const automationMigration = await readFile(new URL("../supabase/migrations/015_phase4a_automation_foundation.sql", import.meta.url), "utf8");
const automationTimingMigration = await readFile(new URL("../supabase/migrations/016_phase4a_automation_timing_rules.sql", import.meta.url), "utf8");
const checkinRpcFixMigration = await readFile(new URL("../supabase/migrations/017_fix_checkin_rpc_overload.sql", import.meta.url), "utf8");
const checkoutRpcFixMigration = await readFile(new URL("../supabase/migrations/018_fix_checkout_rpc_overload.sql", import.meta.url), "utf8");
const migrationDir = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
const allMigrations = (await Promise.all(migrationFiles.map(async (name) => [
  name,
  await readFile(new URL(name, migrationDir), "utf8")
]))).map(([name, sql]) => `-- ${name}\n${sql}`).join("\n\n");

assert.ok(app.includes('from "./supabase.js"'), "app must use the Supabase client");
assert.ok(!app.includes("trz-pms-phase1-state"), "business records must not be stored in localStorage");
assert.ok(!app.includes("createInitialState"), "browser app must not seed local business records");
assert.ok(app.includes("verify_pms_access_code"), "app must unlock through the PMS access code RPC");
assert.ok(app.includes("change_manager_security_code"), "app must change manager code through RPC");
assert.ok(app.includes("trz-manager-view-unlocked"), "Manager View must use browser session-only visibility state");
assert.ok(app.includes("unlock-manager-view"), "Manager View must have a discreet unlock control");
assert.ok(app.includes("Normal View is active"), "Normal View must be the default finance visibility mode");
assert.ok(app.includes("Manager View is active"), "Manager View must reveal sensitive finance visibility");
assert.ok(app.includes("Operational Cash on Hand"), "Normal View must show operational cash on hand");
assert.ok(app.includes("Cash available for approved operating expenses."), "operational cash card must explain allowed use");
assert.ok(app.includes('wallet.name.toLowerCase() === "cash"'), "operational cash card must use only the Cash wallet");
assert.ok(app.includes("Low cash available"), "operational cash card should support a low-cash warning");
assert.ok(supabase.includes("VITE_SUPABASE_URL"), "Supabase URL must come from VITE_SUPABASE_URL");
assert.ok(supabase.includes("VITE_SUPABASE_ANON_KEY"), "Supabase anon key must come from VITE_SUPABASE_ANON_KEY");
assert.ok(!supabase.includes("/auth/v1/token"), "Supabase Auth login must not be used in the access-code phase");
assert.ok(foundationMigration.includes("bookings_no_active_overlap"), "migration must enforce calendar conflict prevention");
assert.ok(foundationMigration.includes("recompute_booking_financials"), "migration must keep booking snapshots ledger-derived");
assert.ok(foundationMigration.includes("'Security Deposit Liability'"), "migration must separate deposit liability from revenue");
assert.ok(accessMigration.includes("create table if not exists settings"), "access migration must create protected settings table");
assert.ok(accessMigration.includes("revoke all on table settings from anon"), "settings must not be directly readable by anon");
assert.ok(accessMigration.includes("security definer"), "code verification must happen through security-definer RPCs");
assert.ok(accessMigration.includes("to anon"), "Phase 1 anon RLS policies must be explicit");
assert.ok(app.includes("Security deposit received?"), "booking creation must include optional deposit shortcut");
assert.ok(app.includes("Checkout Settlement"), "checkout status must trigger settlement UI");
assert.ok(app.includes("Check-In Payment"), "check-in status must trigger payment UI");
assert.ok(app.includes("perform_checkin_payment"), "check-in payment must use RPC");
assert.ok(app.includes("start_meter_reading"), "check-in RPC payload must include canonical optional start meter parameter");
assert.ok(app.includes('form.dataset.submitting === "true"'), "forms must guard against quick duplicate submits");
assert.ok(app.includes("perform_checkout_settlement"), "checkout settlement must use RPC");
assert.ok(app.includes("end_meter_reading"), "checkout RPC payload must include canonical optional end meter parameter");
assert.ok(app.includes("electricity_rate_per_kwh"), "checkout RPC payload must include canonical optional electricity rate parameter");
assert.ok(app.includes("Monthly Starting Reading"), "Operations must support monthly electricity baseline");
assert.ok(app.includes("Current Reading"), "Operations must support current electricity readings");
assert.ok(app.includes("Usage / Estimate"), "Operations must show electricity usage estimate");
assert.ok(app.includes("Reading Log"), "Operations must show electricity reading log");
assert.ok(!app.includes("correct_booking_electricity"), "simplified electricity UI must not use booking correction RPC");
assert.ok(!app.includes("function statusForm"), "old status-change form must stay removed");
assert.ok(!app.includes("updateBookingStatus"), "old status-change workflow must stay removed");
assert.ok(!app.includes('action === "complete"'), "old Complete Booking handler must stay removed");
assert.ok(!app.includes("Manager Record Transaction"), "manual transaction UI must stay hidden from Finance");
assert.ok(app.includes('verify_manager_security_code", { input_code: fields.manager_code }'), "manual transaction writes must verify manager code first");
assert.ok(app.includes('verify_manager_security_code", { input_code: managerCode }'), "Manager View unlock must verify manager code first");
assert.ok(app.includes("Manager View is required for transaction reversals"), "transaction reversals must require Manager View");
assert.ok(app.includes("Owner Harvest"), "Manager View Finance must include Owner Harvest");
assert.ok(app.includes('data-action="owner-harvest"'), "Owner Harvest form must exist");
assert.ok(app.includes('verify_manager_security_code", { input_code: fields.manager_code }'), "Owner Harvest must require Manager Security Code");
assert.ok(app.includes("Automation Queue"), "Settings must show Automation Queue");
assert.ok(app.includes("Email provider not configured"), "Automation must show provider missing state");
assert.ok(app.includes("set_automation_queue_status"), "Automation status changes must use RPC");
assert.ok(app.includes("Email / Automation"), "Booking modal must show email automation controls");
assert.ok(app.includes("Create/Queue Confirmation Email"), "Booking modal must queue confirmation email");
assert.ok(app.includes("Mark Confirmation as Sent"), "Booking modal must mark confirmation sent");
assert.ok(app.includes("Skip Confirmation"), "Booking modal must skip confirmation");
assert.ok(app.includes("Retry Failed Email"), "Booking modal must retry failed email");
assert.ok(app.includes("Confirmation email queued"), "Booking creation must show queued confirmation notice");
assert.ok(app.includes("No guest email; confirmation skipped"), "Booking creation must show missing email skip notice");
assert.ok(app.includes("queue_booking_automation"), "Booking modal must use queue automation RPC");
assert.ok(app.includes("Ready to send"), "Due pending automation items must show ready to send");
assert.ok(app.includes("Mark as Sent"), "Automation queue must support manual sent status");
assert.ok(app.includes("Mark as Failed"), "Automation queue must support manual failed status");
assert.ok(app.includes("Skip"), "Automation queue must support skip action");
assert.ok(app.includes("Retry"), "Automation queue must support retry action");
assert.ok(app.includes("guestProfileModal"), "guest profile/history modal must exist");
assert.ok(app.includes("Booking Timeline"), "booking action modal must show timeline");
assert.ok(app.includes("data-booking-search-form"), "booking search must exist");
assert.ok(app.includes("booking-notes"), "booking notes update form must exist");
assert.ok(app.includes("timelineEventsForBooking"), "booking timeline must be derived from existing records");
assert.ok(app.includes("Edit Booking"), "booking action modal must support edit/reschedule");
assert.ok(app.includes("Cancel Booking"), "booking action modal must support cancellation with reason");
assert.ok(app.includes("Archive Booking"), "completed/cancelled/refunded bookings must support archive");
assert.ok(app.includes("data-calendar-nav=\"prev\""), "calendar must support previous month navigation");
assert.ok(app.includes("data-calendar-nav=\"next\""), "calendar must support next month navigation");
assert.ok(app.includes("data-calendar-nav=\"today\""), "calendar must support today navigation");
assert.ok(app.includes("Record Expense"), "finance must support expense entry");
assert.ok(app.includes("data-action=\"transfer\""), "finance must support wallet transfers");
assert.ok(app.includes("Void/Reversal"), "transactions must support reversal action");
assert.ok(app.includes("reference_number"), "transactions must support reference numbers");
assert.ok(!app.includes("Wallet Movement"), "Finance must not show duplicate Wallet Movement section");
assert.ok(!app.includes("Today Revenue"), "Finance summary must not show Today Revenue");
assert.ok(!app.includes("Today Expenses"), "Finance summary must not show Today Expenses");
assert.ok(!app.includes("Today Net"), "Finance summary must not show Today Net");
assert.ok(app.includes("This Month Revenue"), "Finance summary must keep monthly revenue");
assert.ok(app.includes("Current Security Deposit Liability"), "Finance summary must keep deposit liability");
assert.ok(app.includes("slice(0, 10)"), "Transactions must show latest 10 rows only");
assert.ok(app.includes("type-badge"), "Transactions must show simple account type badges");
assert.ok(app.includes("Operations"), "Operations tab must exist for Phase 3A");
assert.ok(app.includes("Record Drink Sale"), "Operations must support drink sales");
assert.ok(app.includes("Stock Movement"), "Operations must support drink inventory movements");
assert.ok(app.includes("drinkCurrentStock"), "drink sales must use stock calculations");
assert.ok(financialWorkflowMigration.includes("perform_checkout_settlement"), "checkout settlement RPC must exist");
assert.ok(financialWorkflowMigration.includes("Checkout settlement is required"), "direct Checked Out status update must be guarded");
assert.ok(checkinWorkflowMigration.includes("perform_checkin_payment"), "check-in payment RPC must exist");
assert.ok(checkinWorkflowMigration.includes("Check-in payment confirmation is required"), "direct Checked In status update must be guarded");
assert.ok(deleteMigration.includes("delete_test_booking"), "testing delete RPC must exist");
assert.ok(deleteMigration.includes("financial records"), "testing delete must protect financial bookings");
assert.ok(checkoutCompletesMigration.includes("set status = 'Completed'"), "checkout settlement must complete bookings");
assert.ok(hardeningMigration.includes("'checkin_payment'"), "check-in audit must be written by RPC");
assert.ok(hardeningMigration.includes("'checkout_settlement'"), "checkout settlement audit must be written by RPC");
assert.ok(hardeningMigration.includes("'delete_blocked'"), "blocked delete attempts must be audited");
assert.ok(hardeningMigration.includes("Check-in payment confirmation is required"), "hardening migration must keep check-in status guard");
assert.ok(bookingManagementMigration.includes("Only Completed, Cancelled, or Refunded bookings can be archived"), "archive status guard must be enforced in SQL");
assert.ok(financeControlsMigration.includes("add value if not exists 'Expense'"), "Expense account type must be added");
assert.ok(financeControlsMigration.includes("create table if not exists public.expenses"), "expenses table must exist");
assert.ok(financeControlsMigration.includes("create table if not exists public.daily_closings"), "daily closings table must exist");
assert.ok(financeControlsMigration.includes("alter column booking_id drop not null"), "ledger entries must allow unlinked finance records");
assert.ok(drinksMigration.includes("create table if not exists public.drink_products"), "drink products table must exist");
assert.ok(drinksMigration.includes("create table if not exists public.drink_inventory_movements"), "drink movements table must exist");
assert.ok(drinksMigration.includes("create table if not exists public.drink_sales"), "drink sales table must exist");
assert.ok(drinksMigration.includes("Red Horse 500ml"), "default drink products must be seeded");
assert.ok(electricityMigration.includes("add column if not exists start_meter"), "bookings must store start meter");
assert.ok(electricityMigration.includes("generated always as"), "electricity usage/cost must be generated from readings");
assert.ok(electricityMigration.includes("correct_booking_electricity"), "manager correction RPC must exist");
assert.ok(simplifiedElectricityMigration.includes("create table if not exists public.electricity_monthly_baselines"), "electricity baseline table must exist");
assert.ok(simplifiedElectricityMigration.includes("create table if not exists public.electricity_readings"), "electricity readings table must exist");
assert.ok(simplifiedElectricityMigration.includes("rate_per_kwh > 0"), "electricity rate must be positive");
assert.ok(ownerHarvestMigration.includes("add value if not exists 'Owner Harvest'"), "Owner Harvest account type must be added");
assert.ok(ownerHarvestMigration.includes("create table if not exists public.owner_harvests"), "owner harvest table must exist");
assert.ok(ownerHarvestMigration.includes("amount > 0"), "owner harvest amount must be positive");
assert.ok(automationMigration.includes("create table if not exists public.automation_queue"), "automation queue table must exist");
assert.ok(automationMigration.includes("unique (booking_id, automation_type)"), "automation queue must prevent duplicate booking/type records");
assert.ok(automationMigration.includes("booking_confirmation"), "booking confirmation automation type must exist");
assert.ok(automationMigration.includes("checkin_reminder"), "check-in reminder automation type must exist");
assert.ok(automationMigration.includes("thank_you"), "thank-you automation type must exist");
assert.ok(automationMigration.includes("Guest email missing."), "missing email must be handled clearly");
assert.ok(automationMigration.includes("new.status = 'Completed'"), "thank-you automation must queue after completion");
assert.ok(automationMigration.includes("target_booking.status in ('Cancelled', 'Refunded', 'Archived')"), "cancelled/refunded/archived reminders must be skipped");
assert.ok(automationMigration.includes("set_automation_queue_status"), "automation queue status RPC must exist");
assert.ok(automationMigration.includes("grant execute on function public.set_automation_queue_status"), "automation queue status RPC must be callable");
assert.ok(automationTimingMigration.includes("queue_scheduled_for := now();"), "booking confirmation must queue immediately");
assert.ok(automationTimingMigration.includes("queue_scheduled_for := target_booking.start_at - interval '3 days'"), "check-in reminder must queue 3 days before check-in");
assert.ok(automationTimingMigration.includes("queue_scheduled_for := now() + interval '3 hours'"), "thank-you must queue 3 hours after completion");
assert.ok(automationTimingMigration.includes("target_booking.status <> 'Completed'"), "thank-you must only queue after completed status");
assert.ok(automationTimingMigration.includes("Guest email missing."), "missing email must remain skipped with reason");
assert.ok(checkinRpcFixMigration.includes("drop function if exists public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text);"), "old 6-argument check-in RPC overload must be dropped");
assert.ok(checkinRpcFixMigration.includes("drop function if exists public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text, numeric);"), "old 7-argument check-in RPC overload must be dropped before recreation");
assert.equal((checkinRpcFixMigration.match(/create or replace function public\.perform_checkin_payment/g) || []).length, 1, "check-in RPC fix migration must recreate exactly one canonical function");
assert.ok(checkinRpcFixMigration.includes("start_meter_reading numeric default null"), "canonical check-in RPC must keep optional start meter parameter");
assert.ok(checkinRpcFixMigration.includes("if target_booking.status = 'Checked In'"), "canonical check-in RPC must block duplicate check-in submissions");
assert.ok(checkoutRpcFixMigration.includes("p.proname = 'perform_checkout_settlement'"), "checkout RPC fix migration must drop all checkout overloads dynamically");
assert.equal((checkoutRpcFixMigration.match(/create or replace function public\.perform_checkout_settlement/g) || []).length, 1, "checkout RPC fix migration must recreate exactly one canonical function");
assert.ok(checkoutRpcFixMigration.includes("end_meter_reading numeric default null"), "canonical checkout RPC must keep optional end meter parameter");
assert.ok(checkoutRpcFixMigration.includes("electricity_rate_per_kwh numeric default null"), "canonical checkout RPC must keep optional electricity rate parameter");
assert.ok(checkoutRpcFixMigration.includes("if target_booking.status = 'Completed'"), "canonical checkout RPC must block duplicate checkout submissions");
assert.ok(!checkoutRpcFixMigration.includes("create or replace function public.record_owner_harvest"), "owner harvest RPC overload must not be introduced");
assert.ok(!checkoutRpcFixMigration.includes("create or replace function public.record_expense"), "expense RPC overload must not be introduced");
assert.ok(!checkoutRpcFixMigration.includes("create or replace function public.record_transfer"), "transfer RPC overload must not be introduced");
assertNoUnsafeRpcOverloads(allMigrations, {
  perform_checkin_payment: ["uuid", "numeric", "uuid", "numeric", "uuid", "text", "numeric"],
  perform_checkout_settlement: ["uuid", "numeric", "text", "numeric", "uuid", "numeric", "numeric"],
  verify_pms_access_code: ["text"],
  verify_manager_security_code: ["text"],
  change_pms_access_code: ["text", "text"],
  change_manager_security_code: ["text", "text"],
  set_automation_queue_status: ["uuid", "text", "text"],
  delete_test_booking: ["uuid", "text"]
});

console.log("Persistence boundary tests passed.");

function assertNoUnsafeRpcOverloads(sql, expectedSignatures) {
  for (const [name, expected] of Object.entries(expectedSignatures)) {
    const signatures = rpcSignatures(sql, name);
    assert.ok(signatures.length > 0, `${name} RPC must be defined in migrations`);
    const unique = new Set(signatures.map((signature) => signature.join(",")));
    const expectedKey = expected.join(",");
    if (unique.size > 1) {
      assert.ok(
        sql.includes(`p.proname = '${name}'`) || sql.includes(`drop function if exists public.${name}`),
        `${name} overloads must have an explicit cleanup migration`
      );
    }
    assert.equal(signatures.at(-1).join(","), expectedKey, `${name} latest signature must be canonical`);
  }
}

function rpcSignatures(sql, name) {
  const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\(([^)]*)\\)`, "gi");
  const signatures = [];
  for (const match of sql.matchAll(pattern)) {
    signatures.push(match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/\s+default\s+.+$/i, "").trim().split(/\s+/).at(-1).toLowerCase()));
  }
  return signatures;
}
