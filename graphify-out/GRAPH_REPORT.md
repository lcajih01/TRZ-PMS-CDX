# Graph Report - trz-pms-phase1  (2026-06-06)

## Corpus Check
- 31 files · ~1,246,804 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 355 nodes · 872 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `174a9bd2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]

## God Nodes (most connected - your core abstractions)
1. `money()` - 29 edges
2. `render()` - 25 edges
3. `createAudit()` - 23 edges
4. `insert()` - 22 edges
5. `requirePermission()` - 21 edges
6. `escapeHtml()` - 20 edges
7. `audit()` - 20 edges
8. `rpc()` - 20 edges
9. `isManagerViewUnlocked()` - 17 edges
10. `newId()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `dashboardView()` --calls--> `money()`  [EXTRACTED]
  src/app.js → src/core.js
- `bookingCard()` --calls--> `money()`  [EXTRACTED]
  src/app.js → src/core.js
- `walletsView()` --calls--> `walletBalance()`  [EXTRACTED]
  src/app.js → src/supabase.js
- `ledgerView()` --calls--> `filterLedgerLines()`  [EXTRACTED]
  src/app.js → src/core.js
- `depositsView()` --calls--> `financeSummary()`  [EXTRACTED]
  src/app.js → src/core.js

## Import Cycles
- None detected.

## Communities (22 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (38): archiveBooking(), cancelBooking(), createAudit(), createBooking(), createDrinkProduct(), createGuest(), createPackageVersion(), createWallet() (+30 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (36): afterHarvestSummary, bank, beforeHarvestSummary, booking, cancelled, cash, categorySummary, closing (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (25): addDaysToDateInput(), adminCleanupPreviewView(), adminToolsView(), bindAutomationActions(), bindBookingActionButtons(), bindBookingSearch(), bindCalendarActions(), bindCalendarNavigation() (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (36): activeDrinkProducts(), auditTimelineDetail(), automationView(), bookingForm(), currentMonthInput(), dailyClosingView(), depositsView(), drinkInventorySummaryView() (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (29): buildBookingConfirmationEmail(), cardGrid(), confirmationAttachmentFiles, confirmationAttachments(), darkCard(), darkGuideGrid(), darkGuideSection(), detailRow() (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (19): financeSummaryCards(), BLOCKING_STATUSES, bookingProfitability(), createInitialState(), dateKey(), deleteTestBooking(), DRINK_MOVEMENT_TYPES, drinkCurrentStock() (+11 more)

### Community 6 - "Community 6"
Cohesion: 0.26
Nodes (19): archiveBooking(), audit(), createGuest(), createWallet(), depositStatus(), newId(), recomputeBookingFinancials(), recordDailyClosing() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (17): automationGuestName(), bookingCode(), calendarDay(), calendarDayLabel(), calendarSegmentsForDay(), dateInputValue(), drinkProductName(), editBookingModal() (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (14): auditView(), bindAccessForms(), bookingsForGuest(), createBookingModal(), financeView(), guestProfileModal(), init(), isAccessUnlocked() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.19
Nodes (13): bookingActionModal(), bookingActionsForStatus(), bookingCard(), bookingRow(), bookingStatusClass(), bookingTimeline(), formatDate(), formatRange() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (11): accessCodeView(), changeManagerCode(), changePmsCode(), getAttemptLock(), readAttemptRecord(), registerFailedAttempt(), resetAttempts(), securitySettingsSection() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.20
Nodes (11): automationQueueStatus(), automationRecordsForBooking(), automationStatusRow(), bookingAutomationSection(), canQueueOrSendAutomation(), canSendAutomation(), markAutomationFailed(), queueBookingAutomation() (+3 more)

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (9): Access Code Rules, Default Seed Values, Important Accounting Rule, Important RLS Note, Manual Verification, Security Warning, Setup, Tests (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (10): cancelBookingModal(), checkinPaymentModal(), checkoutSettlementModal(), confirmCheckinPayment(), depositBalanceDue(), guestName(), guestNameText(), packageBalanceDue() (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (7): name, private, scripts, start, test, type, version

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (7): changeBookingStatus(), clone(), completeCheckoutSettlement(), editBooking(), findBookingConflict(), latestPackageVersion(), updatePackageVersion()

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (6): allMigrations, assertNoUnsafeRpcOverloads(), manifestData, migrationDir, migrationFiles, rpcSignatures()

### Community 17 - "Community 17"
Cohesion: 0.40
Nodes (6): bookingSearchControl(), bookingsView(), filteredBookings(), filteredGuests(), guestDirectorySection(), monthlyBookingList()

### Community 18 - "Community 18"
Cohesion: 0.50
Nodes (5): hydrateBookingDateForm(), bookingNightCount(), calculateBasePrice(), createBooking(), nextBookingCode()

### Community 19 - "Community 19"
Cohesion: 0.50
Nodes (4): calendarView(), dashboardRecentActivity(), dashboardUpcomingArrivals(), dashboardView()

## Knowledge Gaps
- **70 isolated node(s):** `version`, `configurations`, `inlineImageFiles`, `confirmationAttachmentFiles`, `name` (+65 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `financeSummary()` connect `Community 5` to `Community 1`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `calculateBasePrice()` connect `Community 18` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 15`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `drinkCurrentStock()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `inlineImageFiles` to the rest of the system?**
  _70 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10796221322537113 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08253968253968254 - nodes in this community are weakly interconnected._