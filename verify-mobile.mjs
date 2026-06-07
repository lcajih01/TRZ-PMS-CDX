import { readFileSync } from "fs";
const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("styles.css", "utf8");

function fnBlock(src, marker, maxLen = 3000) {
  const idx = src.indexOf(marker);
  return idx === -1 ? "" : src.slice(idx, idx + maxLen);
}

const checks = [
  // ── 1. Global overflow fix ────────────────────────────────────────
  ["html { overflow-x: hidden; } in global CSS", css.includes("html { overflow-x: hidden; }")],
  ["main { width: 100%; } in mobile block",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      return mobileIdx !== -1 && css.slice(mobileIdx).includes("main { margin-left: 0; width: 100%; }");
    })()],

  // ── 2. Mobile tap targets ─────────────────────────────────────────
  [".bm-nav-btn mobile min-height 44px",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      return mobileIdx !== -1 && css.slice(mobileIdx).includes(".bm-nav-btn { min-height: 44px; min-width: 44px; }");
    })()],
  [".calendar-nav button min-height 44px in mobile",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      return mobileIdx !== -1 && css.slice(mobileIdx).includes("min-height: 44px") &&
        css.slice(mobileIdx).includes(".calendar-nav button");
    })()],
  [".calendar-day min-height 44px in mobile",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      const block = css.slice(mobileIdx);
      const dayIdx = block.indexOf(".calendar-day {");
      return dayIdx !== -1 && block.slice(dayIdx, dayIdx + 80).includes("min-height: 44px");
    })()],

  // ── 3. FAB removed ───────────────────────────────────────────────
  ["FAB renderFloatingActions removed from app.js", !app.includes("function renderFloatingActions(")],
  ["#trz-fab-menu removed from CSS", !css.includes("#trz-fab-menu")],

  // ── 4. Electricity peso estimate ──────────────────────────────────
  ["elec-estimate-card class on Usage card", fnBlock(app, "function electricityView(").includes("elec-estimate-card")],
  ["elec-peso-estimate class on strong", fnBlock(app, "function electricityView(").includes("elec-peso-estimate")],
  ["peso amount is in <strong> (primary)", fnBlock(app, "function electricityView(").includes('class="elec-peso-estimate">${money(summary.estimated_amount)}</strong>')],
  ["kWh is in <em> (secondary)", fnBlock(app, "function electricityView(").includes('kWh used</em>')],
  ["Usage / Estimate label preserved (test compatibility)", fnBlock(app, "function electricityView(").includes("Usage / Estimate")],
  [".elec-estimate-card .elec-peso-estimate font-size in mobile CSS",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      return mobileIdx !== -1 && css.slice(mobileIdx).includes(".elec-estimate-card .elec-peso-estimate");
    })()],

  // ── 5. Mobile calendar detail panel ──────────────────────────────
  ["calendarSelectedDate module var declared", app.includes("let calendarSelectedDate = null")],
  ["#cal-detail-panel div in calendarView HTML", fnBlock(app, "function calendarView(").includes("cal-detail-panel")],
  ["data-cal-cell on available calendar day buttons", fnBlock(app, "function calendarDay(").includes("data-cal-cell data-open-date")],
  ["data-cal-cell on booked calendar day buttons", fnBlock(app, "function calendarDay(").includes("data-cal-cell data-open-booking")],
  ["mobile branch in bindCalendarActions for data-open-date", fnBlock(app, "function bindCalendarActions(").includes("window.innerWidth <= 760")],
  ["showCalendarDetail function exists", app.includes("function showCalendarDetail(")],
  ["showCalendarDetail handles empty date (no booking)", fnBlock(app, "function showCalendarDetail(").includes("cal-detail-date")],
  ["showCalendarDetail handles booked date", fnBlock(app, "function showCalendarDetail(").includes("cal-detail-view-btn")],
  ["showCalendarDetail sets calendarSelectedDate", fnBlock(app, "function showCalendarDetail(").includes("calendarSelectedDate =")],
  [".cal-detail-panel { display: none } in global CSS", css.includes(".cal-detail-panel  { display: none; }") || css.includes(".cal-detail-panel { display: none; }")],
  [".cal-detail-panel:not([hidden]) visible in mobile block",
    (() => {
      const mobileIdx = css.indexOf("@media (max-width: 760px)");
      return mobileIdx !== -1 && css.slice(mobileIdx).includes(".cal-detail-panel:not([hidden])");
    })()],

  // ── No-touch: booking/finance logic untouched ─────────────────────
  ["calendarSegmentsForDay not modified (no mobile branch inside it)", !fnBlock(app, "function calendarSegmentsForDay(", 2000).includes("innerWidth")],
];

let pass = 0, fail = 0;
checks.forEach(([label, ok]) => {
  console.log((ok ? "PASS" : "FAIL") + " " + label);
  ok ? pass++ : fail++;
});
console.log("");
console.log(pass + "/" + checks.length + " checks passed" + (fail ? " — " + fail + " FAILED" : ""));
process.exit(fail > 0 ? 1 : 0);
