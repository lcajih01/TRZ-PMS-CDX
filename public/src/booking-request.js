import { money } from "./core.js";
import { hasSupabaseConfig, rpc, select } from "./supabase.js";

const form = document.getElementById("bookingRequestForm");
const packageSelect = document.getElementById("packageSelect");
const packageDetails = document.getElementById("packageDetails");
const statusMessage = document.getElementById("statusMessage");
const submitButton = document.getElementById("submitButton");
const formCard = document.getElementById("formCard");
const successTemplate = document.getElementById("successTemplate");

let packages = [];
let packageVersions = [];

init();

async function init() {
  setDateMinimums();
  bindForm();

  if (!hasSupabaseConfig()) {
    showMessage("Booking request form is not configured yet. Please contact The Resthouse Zamboanga.", true);
    packageSelect.innerHTML = `<option value="">Configuration needed</option>`;
    packageSelect.disabled = true;
    submitButton.disabled = true;
    return;
  }

  try {
    await loadPackages();
    renderPackageOptions();
    refreshPackageDetails();
  } catch (error) {
    showMessage(error.message, true);
    packageSelect.innerHTML = `<option value="">Packages unavailable</option>`;
    submitButton.disabled = true;
  }
}

function bindForm() {
  bindDatePickerOpeners();
  packageSelect.addEventListener("change", refreshPackageDetails);
  form.arrival_date.addEventListener("change", () => {
    form.departure_date.min = form.arrival_date.value || "";
    refreshPackageDetails();
  });
  form.departure_date.addEventListener("change", refreshPackageDetails);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage();

    const fields = Object.fromEntries(new FormData(form).entries());
    const selectedVersion = latestVersionForPackage(fields.package_id);

    try {
      validate(fields, selectedVersion);
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";

      const result = await rpc("submit_public_booking_request", {
        input_arrival_date: fields.arrival_date,
        input_departure_date: fields.departure_date,
        input_package_id: fields.package_id,
        input_pax: Number(fields.pax),
        input_full_name: fields.full_name,
        input_mobile_number: fields.mobile_number,
        input_email: fields.email,
        input_city_municipality: fields.city_municipality || null,
        input_occasion: fields.occasion || null,
        input_special_requests: fields.special_requests || null,
        input_agree_house_rules: fields.agree_house_rules === "on",
        input_agree_not_guaranteed: fields.agree_not_guaranteed === "on",
        input_agree_payment_verification: fields.agree_payment_verification === "on"
      });

      showSuccess(result?.booking_code || "Booking request received");
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit Booking Request";
    }
  });
}

function bindDatePickerOpeners() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.addEventListener("click", () => {
      input.showPicker?.();
    });
  });
}

async function loadPackages() {
  const [packageRows, versionRows] = await Promise.all([
    select("packages", { query: "is_active=eq.true", order: "order=name.asc" }),
    select("package_versions", { order: "order=version_number.asc" })
  ]);
  packages = packageRows || [];
  packageVersions = versionRows || [];
}

function renderPackageOptions() {
  const options = packages
    .map((pkg) => {
      const version = latestVersionForPackage(pkg.id);
      if (!version) return "";
      return `<option value="${escapeHtml(pkg.id)}">${escapeHtml(pkg.name)} - ${escapeHtml(money(version.price))}</option>`;
    })
    .join("");

  packageSelect.innerHTML = `<option value="">Select package</option>${options}`;
}

function refreshPackageDetails() {
  const pkg = packages.find((item) => item.id === packageSelect.value);
  const version = latestVersionForPackage(packageSelect.value);
  if (!pkg || !version) {
    packageDetails.hidden = true;
    packageDetails.innerHTML = "";
    return;
  }

  packageDetails.hidden = false;
  const stayType = version.is_overnight ? "Overnight package" : "Day Use package";
  const breakfast = version.has_breakfast ? "Breakfast included" : "No breakfast included";
  const roomText = Number(version.included_rooms || 0) > 0 ? `${version.included_rooms} room${Number(version.included_rooms) === 1 ? "" : "s"} included` : "No room allocation";
  const timeText = version.is_overnight
    ? "3:00 PM check-in to 12:00 PM check-out"
    : "3:00 PM to 11:00 PM on the selected date";

  packageDetails.innerHTML = `
    <h3><span>${escapeHtml(pkg.name)}</span><span>${escapeHtml(money(version.price))}</span></h3>
    <ul>
      <li>${stayType}</li>
      <li>Good for ${Number(version.included_pax)} pax</li>
      <li>${escapeHtml(roomText)}</li>
      <li>${breakfast}</li>
      <li>${timeText}</li>
    </ul>
    <p class="hint">Rates and final approval are confirmed by The Resthouse Zamboanga staff.</p>`;
}

function validate(fields, version) {
  if (!fields.arrival_date) throw new Error("Arrival date is required.");
  if (!fields.departure_date) throw new Error("Departure date is required.");
  if (!fields.package_id || !version) throw new Error("Please select a package.");
  if (!Number.isFinite(Number(fields.pax)) || Number(fields.pax) <= 0) throw new Error("Pax must be greater than zero.");
  if (!fields.full_name?.trim()) throw new Error("Full name is required.");
  if (!fields.mobile_number?.trim()) throw new Error("Mobile number is required.");
  if (!fields.email?.trim()) throw new Error("Email address is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email.trim())) throw new Error("Enter a valid email address.");
  if (version.is_overnight && fields.departure_date <= fields.arrival_date) {
    throw new Error("Departure date must be after arrival date for overnight packages.");
  }
  if (!version.is_overnight && fields.departure_date !== fields.arrival_date) {
    throw new Error("For Day Use, please use the same arrival and departure date.");
  }
  if (fields.special_requests && fields.special_requests.length > 500) throw new Error("Special requests must be 500 characters or less.");
  if (fields.agree_house_rules !== "on" || fields.agree_not_guaranteed !== "on" || fields.agree_payment_verification !== "on") {
    throw new Error("Please accept all required agreements before submitting.");
  }
}

function latestVersionForPackage(packageId) {
  return packageVersions
    .filter((version) => version.package_id === packageId)
    .sort((a, b) => Number(b.version_number) - Number(a.version_number))[0];
}

function setDateMinimums() {
  const today = new Date();
  const value = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  form.arrival_date.min = value;
  form.departure_date.min = value;
}

function showSuccess(bookingCode) {
  const node = successTemplate.content.cloneNode(true);
  node.querySelector("[data-success-code]").textContent = bookingCode;
  document.querySelector(".request-shell").remove();
  document.body.appendChild(node);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMessage(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
  statusMessage.hidden = false;
  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideMessage() {
  statusMessage.hidden = true;
  statusMessage.textContent = "";
  statusMessage.classList.remove("error");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
