import { readFile } from "node:fs/promises";

const sender = "The Resthouse Zamboanga <bookings@theresthousezamboanga.com>";
const replyTo = "theresthousezamboanga@gmail.com";
const contactPhone = "0954 195 4478";
const confirmationAttachmentFiles = [
  "TRZ HOUSE RULES.pdf",
  "Penalties and Damages.pdf",
  "TRZ LOCATION.pdf"
];

export async function sendAutomationEmail({ queueId, env }) {
  if (!queueId) throw new Error("Automation queue id is required.");

  const config = supabaseConfig(env);
  const queue = await fetchSingle(config, "automation_queue", queueId);

  try {
    if (queue.status === "sent") return { ok: true, message: "Email already marked as sent." };
    if (queue.status === "skipped") throw new Error("Skipped email cannot be sent.");
    if (queue.automation_type !== "booking_confirmation") throw new Error("Only booking confirmation email sending is enabled.");
    if (!queue.guest_email) throw new Error("Guest email missing.");
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const booking = await fetchSingle(config, "bookings", queue.booking_id);
    const guest = await fetchSingle(config, "guests", booking.guest_id);
    const packageVersion = await fetchSingle(config, "package_versions", booking.package_version_id);
    const bookingPackage = await fetchSingle(config, "packages", packageVersion.package_id);
    const message = await buildBookingConfirmationEmail({ queue, booking, guest, bookingPackage });
    const emailPayload = {
      from: sender,
      to: [queue.guest_email],
      reply_to: replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text
    };
    if (message.attachments?.length) emailPayload.attachments = message.attachments;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      throw new Error(errorText || resendResponse.statusText);
    }

    await setQueueStatus(config, queue.id, "sent", null);
    return { ok: true, message: "Email sent." };
  } catch (error) {
    await setQueueStatus(config, queue.id, "failed", error.message);
    throw error;
  }
}

async function buildBookingConfirmationEmail({ queue, booking, guest, bookingPackage }) {
  const subject = queue.subject || `Booking Confirmation - ${booking.booking_code}`;
  const checkIn = formatDate(booking.start_at);
  const checkOut = formatDate(booking.end_at);
  const packageName = bookingPackage?.name || "Selected package";
  const pax = booking.pax_count || "Not set";
  const packagePrice = money(booking.base_price);
  const depositRequired = money(booking.security_deposit_amount);
  const depositReceived = money(booking.total_deposit_received);
  const depositRefunded = money(booking.total_deposit_refunded);
  const packageBalance = money(Math.max(Number(booking.base_price || 0) - Number(booking.total_revenue || 0), 0));
  const text = [
    "The Resthouse Zamboanga",
    "Booking Confirmed",
    "",
    `Guest Name: ${guest.full_name}`,
    `Booking Code: ${booking.booking_code}`,
    `Check-in: ${checkIn}`,
    `Check-out: ${checkOut}`,
    `Package: ${packageName}`,
    `Pax: ${pax}`,
    `Package Price: ${packagePrice}`,
    "",
    "Payment Summary",
    `Security Deposit Required: ${depositRequired}`,
    `Security Deposit Paid: ${depositReceived}`,
    `Security Deposit Refunded: ${depositRefunded}`,
    `Package Balance Due: ${packageBalance}`,
    "",
    "Arrival Reminders",
    "Please review the attached house rules, penalties and damages guide, and location guide before arrival.",
    "Message us if your arrival time changes.",
    "",
    "Attached Documents",
    "House Rules",
    "Penalties & Damages",
    "Location Map",
    "",
    "Contact Details",
    `Email: ${replyTo}`,
    `Contact: ${contactPhone}`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;background:#00140b;color:#f2f7f0;padding:28px">
      <div style="max-width:680px;margin:0 auto">
        <div style="text-align:center;padding:18px 0 28px">
          <div style="display:inline-block;border:1px solid #b08a2e;color:#ffd966;border-radius:4px;padding:6px 14px;font-size:11px;font-weight:700;letter-spacing:.12em">TRZ</div>
          <h1 style="margin:16px 0 4px;font-size:24px;line-height:1.2;color:#ffffff">The Resthouse Zamboanga</h1>
          <div style="font-size:11px;letter-spacing:.16em;color:#caa640;text-transform:uppercase">Zamboanga City, Philippines</div>
        </div>
        <div style="background:#082313;border:1px solid #15592d;border-radius:12px;overflow:hidden">
          <div style="background:#0d3b1c;padding:28px 28px 24px;border-bottom:1px solid #1c6b37">
            <div style="display:inline-block;background:#0d5c2d;color:#9cffc0;border:1px solid #20a34f;border-radius:999px;padding:7px 14px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Booking Confirmed</div>
            <h2 style="margin:18px 0 6px;font-size:27px;line-height:1.15;color:#ffffff">${escapeHtml(guest.full_name)}</h2>
            <div style="font-size:13px;color:#b8c8bb">${escapeHtml(guest.phone || "")}</div>
          </div>
          <div style="padding:28px">
            <p style="margin:0 0 22px;color:#f4f7f2;line-height:1.7">We're delighted to confirm your reservation at <strong>The Resthouse Zamboanga</strong>. We look forward to welcoming you and your group for an unforgettable stay.</p>
            <div style="background:#071b10;border:1px solid #12351f;border-radius:9px;padding:22px;margin-bottom:18px">
              <h3 style="margin:0 0 14px;color:#8f9b91;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Reservation Details</h3>
              <table style="width:100%;border-collapse:collapse">
                ${detailRow("Guest Name", guest.full_name)}
                ${detailRow("Booking Code", booking.booking_code)}
                ${detailRow("Check-in", checkIn)}
                ${detailRow("Check-out", checkOut)}
                ${detailRow("Package", packageName)}
                ${detailRow("Guests", `${pax} pax`)}
              </table>
            </div>
            <div style="background:#101f11;border:1px solid #637a25;border-radius:9px;padding:22px;margin-bottom:18px">
              <h3 style="margin:0 0 14px;color:#d4b34d;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Payment Summary</h3>
              <table style="width:100%;border-collapse:collapse">
                ${detailRow("Package Price", packagePrice)}
                ${detailRow("Security Deposit Required", depositRequired)}
                ${detailRow("Security Deposit Paid", depositReceived)}
                ${detailRow("Security Deposit Refunded", depositRefunded)}
                ${detailRow("Package Balance Due", packageBalance)}
              </table>
            </div>
            <div style="background:#062715;border:1px solid #19733b;border-radius:9px;padding:22px;margin-bottom:18px">
              <h3 style="margin:0 0 14px;color:#22b765;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Arrival Reminders</h3>
              <p style="margin:0 0 8px;color:#eef5ef">- <strong>Check-in:</strong> 3:00 PM onwards</p>
              <p style="margin:0 0 8px;color:#eef5ef">- <strong>Check-out:</strong> 12:00 PM (Noon)</p>
              <p style="margin:0 0 8px;color:#eef5ef">- Bring a valid government-issued ID</p>
              <p style="margin:0;color:#eef5ef">- Review the house rules and attached documents</p>
            </div>
            <div style="margin:20px 0 22px">
              <h3 style="margin:0 0 12px;color:#6f7d71;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Attached Documents</h3>
              <span style="display:inline-block;margin:0 8px 8px 0;border:1px solid #ba9b3d;color:#f1d36b;border-radius:5px;padding:9px 13px;font-weight:700;font-size:12px">House Rules -></span>
              <span style="display:inline-block;margin:0 8px 8px 0;border:1px solid #ba9b3d;color:#f1d36b;border-radius:5px;padding:9px 13px;font-weight:700;font-size:12px">Penalties &amp; Damages -></span>
              <span style="display:inline-block;margin:0 8px 8px 0;border:1px solid #ba9b3d;color:#f1d36b;border-radius:5px;padding:9px 13px;font-weight:700;font-size:12px">Location Map -></span>
            </div>
            <p style="margin:0;color:#e7eee7;line-height:1.7">Questions or changes? Call us at <strong style="color:#f1d36b">${escapeHtml(contactPhone)}</strong> or email <a style="color:#f1d36b" href="mailto:${escapeHtml(replyTo)}">${escapeHtml(replyTo)}</a>. We're happy to help.</p>
          </div>
        </div>
        <div style="text-align:center;color:#687b6c;font-size:12px;padding:24px 12px">
          <div>${escapeHtml(contactPhone)} - ${escapeHtml(replyTo)}</div>
          <div style="margin-top:10px">You received this because of a reservation at The Resthouse Zamboanga.</div>
        </div>
      </div>
    </div>`;
  return {
    subject,
    html,
    text,
    attachments: await confirmationAttachments()
  };
}

async function confirmationAttachments() {
  return Promise.all(confirmationAttachmentFiles.map(async (filename) => {
    const bytes = await readFile(new URL(`../documents/${filename}`, import.meta.url));
    return {
      filename,
      content: bytes.toString("base64")
    };
  }));
}

function detailRow(label, value) {
  return `
    <tr>
      <td style="border-bottom:1px solid #e2eadf;padding:9px 8px;color:#58705f;width:38%">${escapeHtml(label)}</td>
      <td style="border-bottom:1px solid #e2eadf;padding:9px 8px;font-weight:700">${escapeHtml(value)}</td>
    </tr>`;
}

function supabaseConfig(env) {
  const url = (env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) throw new Error("Supabase environment variables are missing.");
  return { url, anonKey };
}

async function fetchSingle(config, table, id) {
  const rows = await supabaseFetch(config, `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows?.[0];
  if (!row) throw new Error(`${table} record not found.`);
  return row;
}

async function setQueueStatus(config, queueId, status, errorMessage) {
  return supabaseFetch(config, "/rest/v1/rpc/set_automation_queue_status", {
    method: "POST",
    body: JSON.stringify({
      input_queue_id: queueId,
      input_status: status,
      input_error_message: errorMessage
    })
  });
}

async function supabaseFetch(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json"
    },
    body: options.body
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Not set";
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
