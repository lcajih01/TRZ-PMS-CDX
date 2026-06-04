# TRZ PMS Phase 1 Foundation

This is the Phase 1 foundation only:

- Access-code app unlock
- Package management with versioning
- Guests
- Bookings
- Calendar conflict prevention
- Audit logs
- Wallets
- Ledger
- Security deposits
- Finance controls
- Drinks inventory foundation
- Electricity tracking foundation
- Owner harvest tracking

Not included yet:

- Advanced user accounts
- Reports
- Email automation
- Catering
- Full inventory beyond drinks
- Staff tasks
- Advanced UI polish or animations

Business records are stored in Supabase tables. The app keeps only temporary access/session state and browser lockout counters locally.

## Important RLS Note

Because this phase does not use Supabase Auth, Supabase cannot truly know whether a browser has passed the PMS Access Code. For this internal temporary setup, the frontend unlocks the UI and Supabase RLS allows only the anon operations needed by the Phase 1 app. The `settings` table remains protected and code hashes are not directly readable.

The minimum safer future alternative is Supabase Auth or a server/Edge Function that issues scoped access after code verification.

## Setup

1. Create a Supabase project.

2. Run the migrations in Supabase SQL Editor, in order:

```text
supabase/migrations/001_phase1_foundation.sql
supabase/migrations/002_access_code_rls.sql
supabase/migrations/003_fix_booking_rpc_calendar.sql
supabase/migrations/004_phase1_financial_workflow.sql
supabase/migrations/005_phase1_checkin_workflow.sql
supabase/migrations/006_calendar_history_pricing_delete.sql
supabase/migrations/007_checkout_settlement_completes_booking.sql
supabase/migrations/008_phase1_hardening.sql
supabase/migrations/009_phase2b_booking_management.sql
supabase/migrations/010_phase2c_finance_controls.sql
supabase/migrations/011_phase3a_drinks_inventory.sql
supabase/migrations/012_phase3b_electricity_tracking.sql
supabase/migrations/013_phase3b_simplify_electricity_tracker.sql
supabase/migrations/014_phase3c_owner_harvest.sql
```

3. Copy `.env.example` to `.env` and add:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Use the Supabase Project URL and anon public key. Do not use the service role key in the browser app.

4. Run locally:

```powershell
cd C:\Users\luen0\Documents\Codex\2026-06-04\files-mentioned-by-the-user-pasted\outputs\trz-pms-phase1
node server.mjs
```

5. Open:

```text
http://localhost:5173
```

6. Enter the default PMS Access Code:

```text
202608
```

7. To open security settings or change codes, use the default Manager Security Code:

```text
329831
```

## Access Code Rules

- PMS Access Code unlocks the app UI.
- Manager Security Code is required before changing PMS Access Code.
- Manager Security Code is required before changing Manager Security Code.
- Codes are stored as hashes in the protected Supabase `settings` table.
- The frontend never reads the settings table or code hashes.
- Code verification and changes happen only through RPC functions.
- After 5 wrong PMS Access Code attempts, that browser locks login for 5 minutes.
- After 5 wrong Manager Security Code attempts, that browser locks security settings for 15 minutes.
- Lock / Logout clears the local access session.
- Normal View is the default after app unlock.
- Manager View is unlocked from the small gear beside Lock / Logout using the Manager Security Code.
- Manager View stays active until Lock / Logout.
- Wallet balances, finance summaries, transfers, reversals, deposit liability totals, and drink profit details are Manager View only.
- Normal View still shows Operational Cash on Hand from the Cash wallet for approved operating expenses.

## Tests

PowerShell may block `npm` directly on some Windows machines. Use:

```powershell
npm.cmd test
```

The tests verify the Phase 1 business rules, Supabase persistence boundary, access-code RPC boundary, and protected settings table assumptions.

## Manual Verification

After Supabase setup:

- Unlock with PMS Access Code `202608`.
- Open Dashboard and confirm the monthly calendar renders.
- Create a guest in the app, refresh, and confirm the guest remains.
- Confirm the guest appears in the Supabase `guests` table.
- Create a booking in the app, refresh, and confirm the booking remains.
- Click Lock / Logout, unlock again, and confirm the booking remains.
- Confirm the booking appears in the Supabase `bookings` table.
- Create a multi-night overnight booking and confirm `base_price` equals package price times nights.
- Try creating an overlapping active booking and confirm Supabase blocks it.
- Complete checkout settlement and confirm the booking becomes `Completed`.
- Confirm the completed booking stays visible on the calendar as gray history.
- Confirm the completed booking does not block a new future booking for the same range.
- Record normal payments from booking, check-in, or checkout workflows.
- Confirm manual Record Transaction is hidden from Finance.
- Record a Revenue ledger line and confirm it appears in `ledger_entries` and `ledger_lines`.
- Record a Security Deposit Liability line and confirm it appears in `ledger_lines`.
- Confirm wallet balances in the app are calculated from Supabase `ledger_lines`.
- Open Operations > Drinks.
- Confirm default drink products appear.
- Add drink stock, then record a drink sale.
- Confirm the drink sale appears in Transactions as Revenue.
- Confirm stock decreases and commission due appears in Drink Sales.
- Confirm `bookings.total_revenue` does not include the security deposit.
- Confirm `security_deposits` updates after deposit ledger lines.
- Confirm audit rows appear in `audit_logs`.
- Confirm failed/success delete attempts write audit rows.
- Confirm Delete Booking is blocked when the booking has financial records.
- Open Settings, enter Manager Security Code `329831`, and change the PMS Access Code.
- Lock / Logout, then confirm the new PMS Access Code works.
- Confirm the `settings` table cannot be selected directly through anon access.

## Security Warning

This Phase 1 access-code model is acceptable only for internal testing or a trusted private environment. The PMS Access Code unlocks the browser UI, but anon REST access to business tables remains broad enough for the current app to work without Supabase Auth.

Do not deploy this publicly as a production security model. Before public production use, upgrade to Supabase Auth with role-based RLS, or put business writes behind a server/Edge Function gate.

## Important Accounting Rule

The ledger is the source of truth.

`security_deposits` is only a workflow/helper table. It is synchronized from ledger lines and must not be treated as the accounting source of truth.

## Default Seed Values

Packages:

- Day Use: PHP 10,000, 15 pax, 3 rooms, 3:00 PM to 11:00 PM, no breakfast
- Lite Package: PHP 15,000, 15 pax, 6 rooms, overnight, with breakfast
- Standard Package: PHP 20,000, 25 pax, 9 rooms, overnight, with breakfast

Wallets:

- Cash
- GCash
- Maya
- Bank

Security deposit default:

- PHP 5,000

Drink products:

- Red Horse 500ml: cost PHP 620/case, selling PHP 1,600/case, commission PHP 100/case
- San Mig Pale Pilsen: cost PHP 880/case, selling PHP 1,600/case, commission PHP 100/case
- San Mig Light: cost PHP 1,050/case, selling PHP 1,650/case, commission PHP 100/case
