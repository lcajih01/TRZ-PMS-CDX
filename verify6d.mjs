import { readFileSync } from "fs";
const app = readFileSync("src/app.js", "utf8");
const core = readFileSync("src/core.js", "utf8");
const css = readFileSync("styles.css", "utf8");

// Extract from first occurrence of a function marker until the next top-level function
function fnBlock(src, fnMarker, maxLen = 2000) {
  const idx = src.indexOf(fnMarker);
  return idx === -1 ? "" : src.slice(idx, idx + maxLen);
}

// Extract the bookingActionsForStatus block
function actionsBlock() {
  const start = app.indexOf("function bookingActionsForStatus(");
  const end = app.indexOf("\nfunction ", start + 10);
  return app.slice(start, end);
}
const actBlock = actionsBlock();

const checks = [
  // ── Issue 1: Guest email editing ──────────────────────────────────────────
  ["CREATION_STATUSES exported from core.js", core.includes("export const CREATION_STATUSES")],
  ["REVERT_TARGETS exported from core.js", core.includes("export const REVERT_TARGETS")],
  ["CREATION_STATUSES imported in app.js", app.includes("CREATION_STATUSES,")],
  ["REVERT_TARGETS imported in app.js", app.includes("REVERT_TARGETS,")],
  ["guest_email field in editBookingModal", fnBlock(app, "function editBookingModal(", 3000).includes('name="guest_email"')],
  ["guest email pre-filled from guest record", fnBlock(app, "function editBookingModal(", 3000).includes("guest?.email")],
  ["updateBookingDetails updates guest email", fnBlock(app, "async function updateBookingDetails(", 2500).includes('update("guests"')],
  ["guest email audit log in updateBookingDetails", fnBlock(app, "async function updateBookingDetails(", 2500).includes("Email updated from")],
  ["updateGuestEmail function exists", app.includes("async function updateGuestEmail(")],
  ["editGuestEmailModal function exists", app.includes("function editGuestEmailModal(")],
  ["editGuestEmailContext wired in render()", app.includes("if (editGuestEmailContext)")],
  ["update-guest-email form action wired in bindForms", app.includes('"update-guest-email"')],
  ["edit-email action handler in bindBookingActionButtons", app.includes('action === "edit-email"')],
  // Use actionsBlock() to target bookingActionsForStatus specifically
  ["edit-email shown in Checked In actions", (() => {
    const idx = actBlock.indexOf('"Checked In"');
    return idx !== -1 && actBlock.slice(idx, idx + 400).includes("edit-email");
  })()],
  ["edit-email shown in Completed actions", (() => {
    const idx = actBlock.indexOf('"Completed"');
    return idx !== -1 && actBlock.slice(idx, idx + 400).includes("edit-email");
  })()],
  ["edit-email shown in Cancelled actions", (() => {
    const idx = actBlock.indexOf('"Cancelled"');
    return idx !== -1 && actBlock.slice(idx, idx + 400).includes("edit-email");
  })()],

  // ── Issue 2: Manager-protected cancel ────────────────────────────────────
  ["cancelBookingModal has manager_code field", fnBlock(app, "function cancelBookingModal(", 2000).includes('name="manager_code"')],
  ["cancelBooking verifies manager code", fnBlock(app, "async function cancelBooking(", 800).includes("verify_manager_security_code")],
  ["cancelBooking sets status Cancelled only (no deletes)", (() => {
    const block = fnBlock(app, "async function cancelBooking(", 800);
    return block.includes('status: "Cancelled"') && !block.includes("delete") && !block.includes("remove");
  })()],
  ["cancelBooking audit log recorded", fnBlock(app, "async function cancelBooking(", 800).includes("createAudit")],

  // ── Issue 3: Revert status ────────────────────────────────────────────────
  ["revertStatusModal function exists", app.includes("function revertStatusModal(")],
  ["revertBookingStatus function exists", app.includes("async function revertBookingStatus(")],
  ["revertBookingStatus verifies manager code", fnBlock(app, "async function revertBookingStatus(", 1200).includes("verify_manager_security_code")],
  ["revertBookingStatus creates audit log", fnBlock(app, "async function revertBookingStatus(", 1200).includes("createAudit")],
  ["revertBookingStatus validates against REVERT_TARGETS", fnBlock(app, "async function revertBookingStatus(", 1200).includes("targets.includes(fields.target_status)")],
  ["revert action handler wired in bindBookingActionButtons", app.includes('action === "revert"')],
  ["booking-revert-status form action wired in bindForms", app.includes('"booking-revert-status"')],

  // ── Issue 3b: Restore cancelled ───────────────────────────────────────────
  ["restoreCancelledModal function exists", app.includes("function restoreCancelledModal(")],
  ["restoreCancelledBooking function exists", app.includes("async function restoreCancelledBooking(")],
  ["restoreCancelledBooking checks status===Cancelled", fnBlock(app, "async function restoreCancelledBooking(", 1200).includes('status !== "Cancelled"')],
  ["restoreCancelledBooking allows Inquiry and Tentative only", (() => {
    const block = fnBlock(app, "async function restoreCancelledBooking(", 1200);
    return block.includes('"Inquiry"') && block.includes('"Tentative"');
  })()],
  ["restoreCancelledBooking verifies manager code", fnBlock(app, "async function restoreCancelledBooking(", 1200).includes("verify_manager_security_code")],
  ["restoreCancelledBooking creates audit log", fnBlock(app, "async function restoreCancelledBooking(", 1200).includes("createAudit")],
  ["restoreCancelledBooking does NOT touch ledger/deposits", (() => {
    const block = fnBlock(app, "async function restoreCancelledBooking(", 1200);
    return !block.includes("ledger") && !block.includes("deposit");
  })()],
  ["restore-cancelled action handler wired", app.includes('action === "restore-cancelled"')],
  ["booking-restore-cancelled form action wired in bindForms", app.includes('"booking-restore-cancelled"')],
  ["Cancelled status uses restore-cancelled not revert", (() => {
    const idx = actBlock.indexOf('"Cancelled"');
    const chunk = actBlock.slice(idx, idx + 500);
    return chunk.includes("restore-cancelled") && !chunk.includes('"revert"');
  })()],

  // ── Archive manager protection ─────────────────────────────────────────────
  ["archiveBooking requires manager code", fnBlock(app, "async function archiveBooking(", 800).includes("verify_manager_security_code")],

  // ── Issue 4: Status dropdown safety ───────────────────────────────────────
  ["bookingForm uses CREATION_STATUSES for status dropdown", (() => {
    const block = fnBlock(app, "function bookingForm(", 4000);
    return block.includes("CREATION_STATUSES") && !block.includes("BOOKING_STATUSES");
  })()],
  ["CREATION_STATUSES has exactly 5 entries in core.js", (() => {
    const m = core.match(/export const CREATION_STATUSES = \[([\s\S]*?)\]/);
    if (!m) return false;
    return (m[1].match(/"[^"]+"/g) || []).length === 5;
  })()],
  ["REVERT_TARGETS excludes Cancelled", !core.includes('"Cancelled":')],
  ["REVERT_TARGETS excludes Archived", !core.includes('"Archived":')],
  ["REVERT_TARGETS excludes Inquiry (no rollback from Inquiry)", !core.includes('"Inquiry":')],

  // ── Issue 5: UI readability ─────────────────────────────────────────────────
  ["form-section-title CSS defined", css.includes(".form-section-title")],
  ["field-required::after CSS defined", css.includes(".field-required::after")],
  ["form-required-hint CSS defined", css.includes(".form-required-hint")],
  ["form-field-hint CSS defined", css.includes(".form-field-hint")],
  ["btn-warning CSS defined", css.includes("button.btn-warning")],
  ["form-section-title used in editBookingModal", fnBlock(app, "function editBookingModal(", 3000).includes("form-section-title")],
  ["form-section-title used in bookingForm", fnBlock(app, "function bookingForm(", 4000).includes("form-section-title")],
  ["field-required used in editBookingModal", fnBlock(app, "function editBookingModal(", 3000).includes("field-required")],
  ["form-required-hint used in bookingForm", fnBlock(app, "function bookingForm(", 4000).includes("form-required-hint")],
  ["field-required used in cancelBookingModal", fnBlock(app, "function cancelBookingModal(", 2000).includes("field-required")],
  ["field-required used in revertStatusModal", fnBlock(app, "function revertStatusModal(", 2000).includes("field-required")],
  ["field-required used in restoreCancelledModal", fnBlock(app, "function restoreCancelledModal(", 2000).includes("field-required")],

  // ── Context wiring ─────────────────────────────────────────────────────────
  ["revertStatusContext declared", app.includes("let revertStatusContext = null")],
  ["restoreCancelledContext declared", app.includes("let restoreCancelledContext = null")],
  ["editGuestEmailContext declared", app.includes("let editGuestEmailContext = null")],
  ["revertStatusContext cleared in closeAllModals", fnBlock(app, "function closeAllModals(", 600).includes("revertStatusContext = null")],
  ["restoreCancelledContext cleared in closeAllModals", fnBlock(app, "function closeAllModals(", 600).includes("restoreCancelledContext = null")],
  ["editGuestEmailContext cleared in closeAllModals", fnBlock(app, "function closeAllModals(", 600).includes("editGuestEmailContext = null")],
];

let pass = 0, fail = 0;
checks.forEach(([label, ok]) => {
  console.log((ok ? "PASS" : "FAIL") + " " + label);
  ok ? pass++ : fail++;
});
console.log("");
console.log(pass + "/" + checks.length + " checks passed" + (fail ? " — " + fail + " FAILED" : ""));
process.exit(fail > 0 ? 1 : 0);
