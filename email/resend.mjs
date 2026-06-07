import { readFile } from "node:fs/promises";

const sender = "The Resthouse Zamboanga <bookings@theresthousezamboanga.com>";
const replyTo = "theresthousezamboanga@gmail.com";
const contactPhone = "0954 195 4478";
const resortLocation = "Tala Road, Brgy. Lumbangan, Zamboanga City";
const mapLink = "https://maps.google.com/?q=The+Resthouse+Zamboanga+Tala+Road+Lumbangan+Zamboanga+City";
const inlineImageFiles = [
  ["trz-hero", "hero.jpg"],
  ["trz-pool", "pool.jpg"],
  ["trz-ktv", "ktv.jpg"],
  ["trz-game", "game.jpg"],
  ["trz-bedroom", "bedroom.jpg"],
  ["trz-location", "location-map.jpg"],
  ["trz-logo", "logo.png"]
];

export async function sendAutomationEmail({ queueId, env }) {
  if (!queueId) throw new Error("Automation queue id is required.");

  let config;
  let queue;

  try {
    config = supabaseConfig(env);
    queue = await fetchSingle(config, "automation_queue", queueId);
    if (queue.status === "sent") return { ok: true, message: "Email already marked as sent." };
    if (queue.status === "skipped") throw new Error("Skipped email cannot be sent.");

    if (queue.automation_type === "thank_you") {
      if (!queue.guest_email) throw new Error("Guest email missing.");
      if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");
      const booking = await fetchSingle(config, "bookings", queue.booking_id);
      const guest = await fetchSingle(config, "guests", booking.guest_id);
      const message = await buildStayFarewellEmail({ booking, guest });
      const farePayload = {
        from: sender,
        to: [queue.guest_email],
        reply_to: replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          "X-Entity-Ref-ID": `${queue.booking_id}-${queue.id}`,
          "X-Transaction-Type": "thank_you"
        }
      };
      if (message.attachments?.length) farePayload.attachments = message.attachments;
      const fareRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(farePayload)
      });
      if (!fareRes.ok) {
        const errorText = await fareRes.text();
        throw new Error(errorText || fareRes.statusText);
      }
      await setQueueStatus(config, queue.id, "sent", null);
      return { ok: true, message: "Email sent." };
    }

    if (queue.automation_type !== "booking_confirmation") throw new Error("Only booking confirmation email sending is enabled.");
    if (!queue.guest_email) throw new Error("Guest email missing.");
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const booking = await fetchSingle(config, "bookings", queue.booking_id);
    const guest = await fetchSingle(config, "guests", booking.guest_id);
    const packageVersion = await fetchSingle(config, "package_versions", booking.package_version_id);
    const bookingPackage = await fetchSingle(config, "packages", packageVersion.package_id);
    const message = await buildBookingConfirmationEmail({ queue, booking, guest, packageVersion, bookingPackage });
    const emailPayload = {
      from: sender,
      to: [queue.guest_email],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: {
        "X-Entity-Ref-ID": `${queue.booking_id}-${queue.id}`,
        "X-Transaction-Type": "booking_confirmation"
      }
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
    const reason = readableError(error);
    if (config && queue?.id) {
      try {
        await setQueueStatus(config, queue.id, "failed", reason);
      } catch (statusError) {
        throw new Error(`${reason} Also failed to update automation status: ${readableError(statusError)}`);
      }
    }
    throw new Error(reason);
  }
}

async function buildBookingConfirmationEmail({ queue, booking, guest, packageVersion, bookingPackage }) {
  const subject = queue.subject || `Your Booking is Confirmed · ${booking.booking_code}`;
  const checkInDate = formatDateOnly(booking.start_at);
  const checkOutDate = formatDateOnly(booking.end_at);
  const checkInTime = formatTimeOnly(booking.start_at);
  const checkOutTime = formatTimeOnly(booking.end_at);
  const packageName = bookingPackage?.name || "Selected package";
  const pax = booking.pax_count || "Not set";
  const packagePrice = money(booking.base_price);
  const depositRequired = money(booking.security_deposit_amount);
  const depositReceived = money(booking.total_deposit_received);
  const depositRefunded = money(booking.total_deposit_refunded);
  const packageBalance = money(Math.max(Number(booking.base_price || 0) - Number(booking.total_revenue || 0), 0));
  const inclusions = packageInclusions(bookingPackage, packageVersion);
  const careItems = [
    ["Bedroom & Furniture", "Keep beds, linens, towels, curtains, and furniture clean and undamaged. Charges apply for damage or stains."],
    ["Electronics & Appliances", "Handle TVs, remotes, and appliances with care. Damage beyond normal use may require repair or replacement fees."],
    ["KTV Equipment", "Treat microphones, speakers, and karaoke units gently so every group can enjoy them."],
    ["Game Room", "Use billiard tables, darts, and game items responsibly. Damaged or missing items may be charged."],
    ["Pool Area", "Keep the pool area clean and safe. Contamination, damage, or misuse may require cleaning or repair fees."],
    ["Your Belongings", "Please look after your personal items. The resort is not liable for lost or misplaced belongings."],
    ["Special Requests", "For special requests, please message us before 7:00 PM during your stay so we can assist properly."]
  ];
  const reminders = [
    ["Registered Guests Only", "Only guests listed in your booking are permitted inside the resort premises."],
    ["No Pets Allowed", "For everyone's comfort, a PHP 5,000 violation fee applies for pets brought inside the resort."],
    ["No Smoking in Rooms", "Smoking is strictly prohibited inside rooms. Designated outdoor areas are available."],
    ["Overnight Visitors", "Visitors staying beyond 12 midnight are considered overnight guests and may be charged per person."],
    ["Sleep in Bedrooms Only", "Please do not sleep overnight in the KTV room, billiard room, VIP room, or common area sofas."],
    ["Leave It Clean (CLAYGO)", "Help us keep the resort beautiful and enjoyable for every guest."],
    ["Security & CCTV", "Security cameras monitor common areas for the safety and comfort of all guests."],
    ["Drinks & Corkage", "Please coordinate with us for drink corkage matters before or during your stay."]
  ];
  const text = [
    `Booking Confirmed — ${booking.booking_code}`,
    `Check-in:  ${checkInDate} at ${checkInTime}`,
    `Check-out: ${checkOutDate} at ${checkOutTime}`,
    "",
    "The Resthouse Zamboanga",
    "Your Private Paradise. Your Home Away From Home.",
    "",
    `Guest: ${guest.full_name}`,
    `Package: ${packageName}`,
    `Guests: ${pax} pax`,
    "",
    "Payment Summary",
    `Package Price: ${packagePrice}`,
    `Security Deposit Required: ${depositRequired}`,
    `Security Deposit Paid: ${depositReceived}`,
    `Security Deposit Refunded: ${depositRefunded}`,
    `Balance Due: ${packageBalance}`,
    "",
    "Package Inclusions",
    ...inclusions.map((item) => `✓ ${item}`),
    "",
    "Your Stay Guide",
    ...reminders.map(([title, body], i) => `${i + 1}. ${title} — ${body}`),
    "",
    "Caring for Your Home Away",
    ...careItems.map(([title, body]) => `• ${title}: ${body}`),
    "",
    "Getting Here",
    "The Resthouse Zamboanga",
    resortLocation,
    `Map: ${mapLink}`,
    "",
    "Contact Us",
    `Call: ${contactPhone}`,
    `Email: ${replyTo}`
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media only screen and (max-width: 640px) {
        .trz-container { width: 100% !important; }
        .trz-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .trz-stack { display: block !important; width: 100% !important; }
        .trz-stack-r { padding-left: 0 !important; padding-top: 10px !important; }
        .trz-photo { height: auto !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#ece7de;font-family:Georgia,'Times New Roman',serif;color:#17251c;">
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">${escapeHtml(booking.booking_code)} confirmed &mdash; Check-in ${escapeHtml(checkInDate)} at ${escapeHtml(checkInTime)}.</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece7de;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 0 44px;">
          <table role="presentation" class="trz-container" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:680px;border-collapse:collapse;background:#fffaf3;">

            <!-- HERO: exterior shot, cropped to tighten on the resort rather than open sky / edges -->
            <tr>
              <td style="line-height:0;font-size:0;padding:0;background:#041109;border-radius:14px 14px 0 0;">
                <img src="cid:trz-hero" width="680" alt="The Resthouse Zamboanga" style="display:block;width:100%;max-width:680px;height:360px;object-fit:cover;object-position:28% 30%;border:0;border-radius:14px 14px 0 0;">
              </td>
            </tr>

            <!-- BRAND HEADER -->
            <tr>
              <td class="trz-pad" style="background:#041109;padding:30px 40px 36px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="border-bottom:1px solid rgba(215,177,84,.4);padding-bottom:14px;">
                    <span style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#d7b154;">The Resthouse Zamboanga &nbsp;&middot;&nbsp; Zamboanga City, Philippines</span>
                  </td></tr>
                  <tr><td style="padding-top:20px;">
                    <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#d7b154;">Booking Confirmed</p>
                    <h1 style="margin:0 0 8px;font-size:44px;line-height:1.05;color:#ffffff;font-weight:700;">Your Stay Awaits.</h1>
                    <p style="margin:0;font-size:17px;font-style:italic;color:#d7b154;line-height:1.4;">Your Private Paradise. Your Home Away From Home.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- BOOKING SUMMARY CARD -->
            <tr>
              <td class="trz-pad" style="padding:24px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border:1px solid rgba(215,177,84,.55);border-radius:14px;">
                  <tr>
                    <td colspan="2" style="padding:24px 28px 18px;border-bottom:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="vertical-align:top;">
                            <p style="margin:0 0 2px;font-style:italic;color:#c8dfc8;font-family:Arial,sans-serif;font-size:13px;">Welcome,</p>
                            <h2 style="margin:0;font-size:28px;line-height:1.1;color:#ffffff;">${escapeHtml(guest.full_name)}</h2>
                          </td>
                          <td style="vertical-align:top;text-align:right;">
                            <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c8dfc8;">Booking Code</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-left:auto;">
                              <tr><td style="background:rgba(215,177,84,.18);border:1px solid #d7b154;border-radius:999px;padding:7px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;white-space:nowrap;">${escapeHtml(booking.booking_code)}</td></tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;border-right:1px solid rgba(255,255,255,.1);vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Check-in</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkInDate)}</p>
                      <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#c8dfc8;">${escapeHtml(checkInTime)}</p>
                    </td>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Check-out</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkOutDate)}</p>
                      <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#c8dfc8;">${escapeHtml(checkOutTime)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding:0 28px 22px;border-top:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          ${miniDetail("Package", packageName)}
                          ${miniDetail("Guests", `${pax} pax`)}
                          ${miniDetail("Resort Line", contactPhone)}
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- PAYMENT SUMMARY -->
            <tr>
              <td class="trz-pad" style="padding:16px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:14px;">
                  <tr><td style="padding:20px 26px 18px;">
                    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aaa9e;">Payment Summary</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        ${paymentCell("Package Price", packagePrice, false)}
                        ${paymentCell("Deposit Required", depositRequired, false)}
                        ${paymentCell("Deposit Paid", depositReceived, false)}
                        ${paymentCell("Balance Due", packageBalance, true)}
                      </tr>
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- QUICK INFO ROW -->
            <tr>
              <td class="trz-pad" style="padding:14px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f0e8;border-radius:12px;">
                  <tr>
                    ${quickInfo("Check-in Time", checkInTime, "Let us know if you are arriving early.")}
                    ${quickInfo("Check-out Time", checkOutTime, "Late check-out subject to availability.")}
                    ${quickInfo("Resort Line", contactPhone, "We are here throughout your stay.")}
                    ${quickInfo("Address", "Lumbangan, ZC", "Tala Road, Brgy. Lumbangan")}
                  </tr>
                </table>
              </td>
            </tr>

            ${sectionDivider("Explore The Resthouse")}

            <!-- 2×2 GALLERY WITH CAPTIONS -->
            <tr>
              <td class="trz-pad" style="padding:0 28px 6px;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    ${galleryCard("cid:trz-pool", "Pool Area")}
                    ${galleryCard("cid:trz-ktv", "KTV Room")}
                  </tr>
                  <tr>
                    ${galleryCard("cid:trz-game", "Game Room")}
                    ${galleryCard("cid:trz-bedroom", "Bedroom")}
                  </tr>
                </table>
              </td>
            </tr>

            ${sectionDivider("Your Package")}

            <!-- PACKAGE INCLUSIONS -->
            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td class="trz-stack" width="36%" style="background:#06331e;border-radius:12px;padding:28px 24px;vertical-align:top;">
                      <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Your Package</p>
                      <h2 style="margin:0 0 14px;font-size:24px;line-height:1.15;color:#ffffff;">${escapeHtml(packageName)}</h2>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.65;color:#c8dfc8;">Everything curated for a comfortable, memorable stay at The Resthouse.</p>
                    </td>
                    <td class="trz-stack trz-stack-r" width="64%" style="padding:0 0 0 14px;vertical-align:top;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:12px;">
                        <tr><td style="padding:22px 24px;">${inclusionGrid(inclusions)}</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${sectionDivider("Your Stay Guide")}

            <!-- STAY GUIDE: numbered cards -->
            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                ${stayGuideGrid(reminders)}
              </td>
            </tr>

            ${sectionDivider("Caring for Your Home Away")}

            <!-- CARE GUIDELINES: dark card grid -->
            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border-radius:14px;">
                  <tr><td style="padding:6px 12px 20px;">${darkGuideGrid(careItems)}</td></tr>
                </table>
              </td>
            </tr>

            ${sectionDivider("Getting Here & Contact")}

            <!-- LOCATION + CONTACT -->
            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td class="trz-stack" width="54%" style="padding:22px;background:#ffffff;border:1px solid #e4ded3;border-radius:12px;vertical-align:top;">
                      <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9aaa9e;">Our Location</p>
                      <p style="margin:0 0 3px;font-size:17px;font-weight:700;color:#17251c;">The Resthouse Zamboanga</p>
                      <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#4e5b53;">${escapeHtml(resortLocation)}</p>
                      <img src="cid:trz-location" width="300" alt="The Resthouse Zamboanga location map" style="display:block;width:100%;max-width:300px;height:auto;border:0;border-radius:8px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:14px;">
                        <tr><td style="background:#06331e;border-radius:8px;padding:10px 20px;">
                          <a href="${mapLink}" style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#f4d375;text-decoration:none;">View on Google Maps &rarr;</a>
                        </td></tr>
                      </table>
                    </td>
                    <td class="trz-stack trz-stack-r" width="46%" style="padding:0 0 0 14px;vertical-align:top;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:12px;">
                        <tr><td style="padding:22px;">
                          <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9aaa9e;">Need Assistance?</p>
                          <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:13px;line-height:1.65;color:#4e5b53;">We are here to make your stay as comfortable and memorable as possible.</p>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:10px;">
                            <tr><td style="background:#06331e;border-radius:8px;padding:10px 20px;">
                              <a href="tel:${contactPhone.replace(/\s/g, "")}" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;text-decoration:none;">${escapeHtml(contactPhone)}</a>
                            </td></tr>
                          </table>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px;">
                            <tr><td style="background:#f4f0e8;border:1px solid #e4ded3;border-radius:8px;padding:10px 20px;">
                              <a href="mailto:${replyTo}" style="font-family:Arial,sans-serif;font-size:13px;color:#17251c;text-decoration:none;">${escapeHtml(replyTo)}</a>
                            </td></tr>
                          </table>
                          <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.55;color:#7a8a7e;font-style:italic;">For special requests, please message us before 7:00 PM during your stay so we can assist properly.</p>
                        </td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td class="trz-pad" style="padding:32px 40px 30px;background:#041109;border-radius:0 0 14px 14px;margin-top:28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="padding-bottom:18px;border-bottom:1px solid rgba(215,177,84,.35);text-align:center;">
                    <img src="cid:trz-logo" width="220" alt="The Resthouse Zamboanga" style="display:block;margin:0 auto;width:220px;max-width:220px;height:auto;border:0;">
                  </td></tr>
                  <tr><td style="padding-top:18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#c8dfc8;">
                    Thank you for choosing <strong style="color:#f4d375;">The Resthouse Zamboanga.</strong><br>
                    We look forward to welcoming you.<br>
                    <span style="color:#7a8a7e;font-size:12px;">${escapeHtml(contactPhone)} &nbsp;&middot;&nbsp; ${escapeHtml(replyTo)}</span>
                  </td></tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    html,
    text,
    attachments: await confirmationAttachments()
  };
}

async function confirmationAttachments() {
  return Promise.all(inlineImageFiles.map(async ([contentId, filename]) => {
    const bytes = await readFile(new URL(`./assets/${filename}`, import.meta.url));
    return {
      filename,
      content: bytes.toString("base64"),
      content_id: contentId
    };
  }));
}

async function farewellAttachments() {
  const files = [["trz-hero", "hero.jpg"], ["trz-logo", "logo.png"]];
  return Promise.all(files.map(async ([contentId, filename]) => {
    const bytes = await readFile(new URL(`./assets/${filename}`, import.meta.url));
    return { filename, content: bytes.toString("base64"), content_id: contentId };
  }));
}

function sectionDivider(title) {
  return `
    <tr>
      <td class="trz-pad" style="padding:28px 28px 16px;background:#fffaf3;text-align:center;">
        <p style="margin:0 0 12px;font-size:20px;letter-spacing:.04em;color:#17251c;">${escapeHtml(title)}</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr>
          <td style="border-top:1px solid #e4ded3;"></td>
          <td width="48" style="border-top:2px solid #d7b154;"></td>
          <td style="border-top:1px solid #e4ded3;"></td>
        </tr></table>
      </td>
    </tr>`;
}

function miniDetail(label, value) {
  return `
    <td class="trz-stack" width="33%" style="padding:12px 0 0;vertical-align:top;font-family:Arial,sans-serif;">
      <span style="display:block;color:#d8c58d;font-size:10px;text-transform:uppercase;letter-spacing:.1em;">${escapeHtml(label)}</span>
      <strong style="display:block;margin-top:4px;color:#ffffff;font-size:13px;line-height:1.35;">${escapeHtml(value)}</strong>
    </td>`;
}

function paymentCell(label, value, highlight) {
  return `
    <td class="trz-stack" width="25%" style="padding:0 16px 0 0;border-right:${highlight ? "none" : "1px solid #eae3d8"};vertical-align:top;">
      <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9aaa9e;">${escapeHtml(label)}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:${highlight ? "#7a3800" : "#17251c"};">${escapeHtml(value)}</p>
    </td>`;
}

function quickInfo(label, value, note) {
  return `
    <td class="trz-stack" width="25%" style="padding:14px 16px;vertical-align:top;border-right:1px solid #e6ded0;">
      <p style="margin:0 0 6px;color:#7a8a7e;font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.1em;">${escapeHtml(label)}</p>
      <p style="margin:0 0 6px;color:#17251c;font-family:Arial,sans-serif;font-size:15px;line-height:1.3;font-weight:700;">${escapeHtml(value)}</p>
      <p style="margin:0;color:#4e5b53;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;">${escapeHtml(note)}</p>
    </td>`;
}

function galleryCard(src, label) {
  return `
    <td class="trz-stack" width="50%" style="padding:4px;vertical-align:top;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        <tr><td style="padding:0;line-height:0;font-size:0;background:#041109;">
          <img class="trz-photo" src="${src}" width="330" alt="${escapeHtml(label)}" style="display:block;width:100%;max-width:330px;height:auto;border:0;">
        </td></tr>
        <tr><td style="background:#041109;padding:11px 16px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#d7b154;">
          ${escapeHtml(label)}
        </td></tr>
      </table>
    </td>`;
}

function inclusionGrid(inclusions) {
  const cells = inclusions.map((item, index) => {
    const open = index % 2 === 0 ? "<tr>" : "";
    const close = index % 2 === 1 ? "</tr>" : "";
    return `${open}<td width="50%" style="padding:7px 8px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#17251c;"><span style="color:#06331e;font-weight:700;">✓</span>&nbsp; ${escapeHtml(item)}</td>${close}`;
  });
  if (inclusions.length % 2) cells.push("<td></td></tr>");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${cells.join("")}</table>`;
}

function stayGuideGrid(items) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    rows.push(`
      <tr>
        <td class="trz-stack" width="50%" style="padding:5px;vertical-align:top;">${stayGuideCard(left, i + 1)}</td>
        ${right
          ? `<td class="trz-stack" width="50%" style="padding:5px;vertical-align:top;">${stayGuideCard(right, i + 2)}</td>`
          : `<td width="50%"></td>`}
      </tr>`);
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows.join("")}</table>`;
}

function stayGuideCard(item, num) {
  const [title, body] = item;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="height:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2dacf;border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td width="34" style="vertical-align:top;padding-top:1px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr><td style="width:28px;background:#06331e;border-radius:14px;text-align:center;padding:6px 8px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:#f4d375;">${num}</td></tr>
              </table>
            </td>
            <td style="vertical-align:top;padding-left:10px;">
              <h3 style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#17251c;">${escapeHtml(title)}</h3>
              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#39483f;">${escapeHtml(body)}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>`;
}

function darkGuideGrid(items) {
  const cells = items.map(([title, body], index) => {
    const open = index % 2 === 0 ? "<tr>" : "";
    const close = index % 2 === 1 ? "</tr>" : "";
    return `${open}<td class="trz-stack" width="50%" style="padding:7px;vertical-align:top;">${darkCard(title, body)}</td>${close}`;
  });
  if (items.length % 2) cells.push("<td></td></tr>");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${cells.join("")}</table>`;
}

function darkCard(title, body) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="height:100%;border-collapse:collapse;border:1px solid rgba(215,177,84,.3);border-radius:8px;">
      <tr><td style="padding:15px;text-align:center;">
        <h3 style="margin:0 0 7px;font-family:Arial,sans-serif;font-size:13px;color:#f4d375;">${escapeHtml(title)}</h3>
        <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#e8f4e8;">${escapeHtml(body)}</p>
      </td></tr>
    </table>`;
}

function packageInclusions(bookingPackage, packageVersion) {
  const packageName = String(bookingPackage?.name || "").toLowerCase();
  const rooms = Number(packageVersion?.included_rooms || 0);
  const pax = Number(packageVersion?.included_pax || 0);
  const base = [
    `${pax || "Included"} pax`,
    rooms ? `${rooms} rooms` : "Private resort use",
    "Pool access",
    "KTV room",
    "Game room",
    "Fast WiFi",
    "24/7 security"
  ];
  if (packageVersion?.has_breakfast) base.splice(2, 0, "Breakfast included");
  if (packageName.includes("day")) return ["Day Use stay", ...base];
  if (packageName.includes("lite")) return ["Overnight stay", ...base];
  if (packageName.includes("standard")) return ["Overnight stay", ...base];
  return [packageVersion?.is_overnight ? "Overnight stay" : "Private stay", ...base];
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || response.statusText);
  }
  if (!response.ok) throw new Error(data?.message || data?.error || text || response.statusText);
  return data;
}

function readableError(error) {
  return String(error?.message || error || "Email sending failed.").slice(0, 500);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Not set";
}

function formatDateOnly(value) {
  return value ? new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "Not set";
}

function formatTimeOnly(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (date.getHours() === 12 && date.getMinutes() === 0) return "12:00 NN";
  return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
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

async function buildStayFarewellEmail({ booking, guest }) {
  const subject = `Thank you for staying with us · ${booking.booking_code}`;
  const checkInDate = formatDateOnly(booking.start_at);
  const checkOutDate = formatDateOnly(booking.end_at);
  const guestName = guest.full_name;

  const text = [
    `Thank you for staying with us — ${booking.booking_code}`,
    "",
    `Dear ${guestName},`,
    "",
    "It was our absolute pleasure hosting you at The Resthouse Zamboanga.",
    "We hope your stay was exactly what you needed — a true home away from home.",
    "",
    `Booking: ${booking.booking_code}`,
    `Arrived:  ${checkInDate}`,
    `Departed: ${checkOutDate}`,
    "",
    "We're grateful you chose The Resthouse Zamboanga.",
    "",
    "If you enjoyed your stay, we'd be grateful if you could share your experience with others.",
    `Reach us at: ${contactPhone} / ${replyTo}`,
    "",
    "The Resthouse Zamboanga",
    resortLocation,
    `Call: ${contactPhone}`,
    `Email: ${replyTo}`
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media only screen and (max-width: 640px) {
        .trz-container { width: 100% !important; }
        .trz-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .trz-stack { display: block !important; width: 100% !important; }
        .trz-stack-r { padding-left: 0 !important; padding-top: 10px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#ece7de;font-family:Georgia,'Times New Roman',serif;color:#17251c;">
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">A note for ${escapeHtml(guestName)} from The Resthouse Zamboanga &mdash; it was a pleasure hosting you.</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece7de;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 0 44px;">
          <table role="presentation" class="trz-container" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:680px;border-collapse:collapse;background:#fffaf3;">

            <!-- HERO -->
            <tr>
              <td style="line-height:0;font-size:0;padding:0;background:#041109;border-radius:14px 14px 0 0;">
                <img src="cid:trz-hero" width="680" alt="The Resthouse Zamboanga" style="display:block;width:100%;max-width:680px;height:360px;object-fit:cover;object-position:28% 30%;border:0;border-radius:14px 14px 0 0;">
              </td>
            </tr>

            <!-- BRAND HEADER -->
            <tr>
              <td class="trz-pad" style="background:#041109;padding:36px 40px 40px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="border-bottom:1px solid rgba(215,177,84,.4);padding-bottom:14px;">
                    <span style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#d7b154;">The Resthouse Zamboanga &nbsp;&middot;&nbsp; Zamboanga City, Philippines</span>
                  </td></tr>
                  <tr><td style="padding-top:24px;">
                    <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#d7b154;">A Note from The Resthouse</p>
                    <h1 style="margin:0 0 10px;font-size:40px;line-height:1.1;color:#ffffff;font-weight:700;">It was wonderful<br>having you.</h1>
                    <p style="margin:0;font-size:17px;font-style:italic;color:#d7b154;line-height:1.4;">We're grateful you chose The Resthouse Zamboanga.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- STAY SUMMARY CARD -->
            <tr>
              <td class="trz-pad" style="padding:24px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border:1px solid rgba(215,177,84,.55);border-radius:14px;">
                  <tr>
                    <td colspan="2" style="padding:24px 28px 18px;border-bottom:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="vertical-align:top;">
                            <p style="margin:0 0 2px;font-style:italic;color:#c8dfc8;font-family:Arial,sans-serif;font-size:13px;">Thank you for staying with us,</p>
                            <h2 style="margin:0;font-size:28px;line-height:1.1;color:#ffffff;">${escapeHtml(guestName)}</h2>
                          </td>
                          <td style="vertical-align:top;text-align:right;">
                            <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c8dfc8;">Booking Code</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-left:auto;">
                              <tr><td style="background:rgba(215,177,84,.18);border:1px solid #d7b154;border-radius:999px;padding:7px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;white-space:nowrap;">${escapeHtml(booking.booking_code)}</td></tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;border-right:1px solid rgba(255,255,255,.1);vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Arrived</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkInDate)}</p>
                    </td>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Departed</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkOutDate)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- PERSONAL MESSAGE -->
            <tr>
              <td class="trz-pad" style="padding:20px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:14px;">
                  <tr><td style="padding:30px 32px;">
                    <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aaa9e;">A Personal Note</p>
                    <p style="margin:0 0 16px;font-size:19px;line-height:1.55;color:#17251c;">It was our absolute pleasure hosting you at The Resthouse Zamboanga.</p>
                    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#4e5b53;">We hope your stay gave you exactly what you came for &mdash; rest, warmth, and a space that felt like home. Every detail of your visit matters to us, and we are grateful you chose to spend your time with us.</p>
                    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#4e5b53;">If there is anything we could do better, or if there is something that made your stay especially memorable, we would love to hear from you.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- SECTION DIVIDER -->
            <tr>
              <td class="trz-pad" style="padding:28px 28px 16px;background:#fffaf3;text-align:center;">
                <p style="margin:0 0 12px;font-size:20px;letter-spacing:.04em;color:#17251c;">Share Your Experience</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr>
                  <td style="border-top:1px solid #e4ded3;"></td>
                  <td width="48" style="border-top:2px solid #d7b154;"></td>
                  <td style="border-top:1px solid #e4ded3;"></td>
                </tr></table>
              </td>
            </tr>

            <!-- EXPERIENCE SHARING -->
            <tr>
              <td class="trz-pad" style="padding:0 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:14px;">
                  <tr><td style="padding:28px 32px;">
                    <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aaa9e;">Your Feedback</p>
                    <p style="margin:0 0 16px;font-size:18px;line-height:1.5;color:#17251c;">If you enjoyed your stay, we'd be grateful if you could share your experience with others.</p>
                    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#4e5b53;">Word of mouth from guests like you means everything to us. It helps other families discover a place to call home away from home.</p>
                    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#4e5b53;">Simply reply to this email, or reach us at <strong style="color:#17251c;">${escapeHtml(contactPhone)}</strong> or <strong style="color:#17251c;">${escapeHtml(replyTo)}</strong>.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- CONTACT STRIP -->
            <tr>
              <td class="trz-pad" style="padding:16px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f0e8;border-radius:12px;">
                  <tr>
                    <td class="trz-stack" width="33%" style="padding:16px 18px;border-right:1px solid #e6ded0;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Phone</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#17251c;">${escapeHtml(contactPhone)}</p>
                    </td>
                    <td class="trz-stack" width="33%" style="padding:16px 18px;border-right:1px solid #e6ded0;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Email</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#17251c;">${escapeHtml(replyTo)}</p>
                    </td>
                    <td class="trz-stack" width="33%" style="padding:16px 18px;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Address</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#4e5b53;">${escapeHtml(resortLocation)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td class="trz-pad" style="padding:32px 40px 30px;background:#041109;border-radius:0 0 14px 14px;margin-top:28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="padding-bottom:18px;border-bottom:1px solid rgba(215,177,84,.35);text-align:center;">
                    <img src="cid:trz-logo" width="220" alt="The Resthouse Zamboanga" style="display:block;margin:0 auto;width:220px;max-width:220px;height:auto;border:0;">
                  </td></tr>
                  <tr><td style="padding-top:18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#c8dfc8;">
                    It was a pleasure having you.<br>
                    We look forward to welcoming you back.<br>
                    <span style="color:#7a8a7e;font-size:12px;">${escapeHtml(contactPhone)} &nbsp;&middot;&nbsp; ${escapeHtml(replyTo)}</span>
                  </td></tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text, attachments: await farewellAttachments() };
}

export async function sendGuestMemoryEmail({ memoryId, env }) {
  if (!memoryId) throw new Error("Memory id is required.");

  const config = supabaseConfig(env);
  const memory = await fetchSingle(config, "guest_memories", memoryId);

  if (memory.status === "sent") return { ok: true, message: "Memory email already sent." };
  if (!memory.card_url) throw new Error("Memory card has not been uploaded yet.");

  const booking = await fetchSingle(config, "bookings", memory.booking_id);
  const guest = await fetchSingle(config, "guests", booking.guest_id);

  const guestEmail = (guest.email || "").trim();
  if (!guestEmail) throw new Error("This guest has no email address on file.");
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

  const message = await buildGuestMemoryEmail({ booking, guest, memory });

  const payload = {
    from: sender,
    to: [guestEmail],
    reply_to: replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: {
      "X-Entity-Ref-ID": `${memory.booking_id}-${memory.id}`,
      "X-Transaction-Type": "guest_memory"
    }
  };
  if (message.attachments?.length) payload.attachments = message.attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || res.statusText);
  }

  await supabaseFetch(config, `/rest/v1/guest_memories?id=eq.${encodeURIComponent(memoryId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "sent", updated_at: new Date().toISOString() })
  });

  return { ok: true, message: "Memory email sent." };
}

async function buildGuestMemoryEmail({ booking, guest, memory }) {
  const subject = `A Memory from Your Stay · ${booking.booking_code}`;
  const guestName = guest.full_name;
  const checkInDate = formatDateOnly(booking.start_at);
  const checkOutDate = formatDateOnly(booking.end_at);
  const personalMessage = (memory.memory_message || "").trim();

  const cardRes = await fetch(memory.card_url);
  if (!cardRes.ok) throw new Error("Could not load memory card image for email.");
  const cardBase64 = Buffer.from(await cardRes.arrayBuffer()).toString("base64");

  const text = [
    `A Memory from Your Stay · ${booking.booking_code}`,
    "",
    `Dear ${guestName},`,
    "",
    "It was a privilege hosting you at The Resthouse Zamboanga.",
    personalMessage || "We hope your time with us was everything you needed.",
    "",
    `Booking: ${booking.booking_code}`,
    `Arrived:  ${checkInDate}`,
    `Departed: ${checkOutDate}`,
    "",
    "With warmth,",
    "The Resthouse Zamboanga",
    `${contactPhone}  ·  ${replyTo}`,
    resortLocation
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media only screen and (max-width: 640px) {
        .trz-container { width: 100% !important; }
        .trz-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .trz-stack { display: block !important; width: 100% !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#ece7de;font-family:Georgia,'Times New Roman',serif;color:#17251c;">
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">A memory from your stay at The Resthouse Zamboanga &mdash; ${escapeHtml(booking.booking_code)}.</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece7de;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 0 44px;">
          <table role="presentation" class="trz-container" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:680px;border-collapse:collapse;background:#fffaf3;">

            <!-- BRAND HEADER -->
            <tr>
              <td class="trz-pad" style="background:#041109;padding:40px 40px 44px;border-radius:14px 14px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="border-bottom:1px solid rgba(215,177,84,.4);padding-bottom:14px;">
                    <span style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#d7b154;">The Resthouse Zamboanga &nbsp;&middot;&nbsp; Zamboanga City, Philippines</span>
                  </td></tr>
                  <tr><td style="padding-top:24px;">
                    <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#d7b154;">A Memory from Your Stay</p>
                    <h1 style="margin:0 0 10px;font-size:36px;line-height:1.2;color:#ffffff;font-weight:700;">Thank you for creating beautiful memories with us.</h1>
                    <p style="margin:0;font-size:17px;font-style:italic;color:#d7b154;line-height:1.4;">Thank you for choosing The Resthouse Zamboanga.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- HERO MEMORY CARD IMAGE -->
            <tr>
              <td style="padding:0;line-height:0;font-size:0;">
                <img src="cid:trz-memory-card" width="680" alt="Your Memory Card" style="display:block;width:100%;max-width:680px;height:auto;border:0;">
              </td>
            </tr>

            <!-- STAY SUMMARY -->
            <tr>
              <td class="trz-pad" style="padding:24px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border:1px solid rgba(215,177,84,.55);border-radius:14px;">
                  <tr>
                    <td colspan="2" style="padding:22px 28px 16px;border-bottom:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="vertical-align:top;">
                            <p style="margin:0 0 2px;font-style:italic;color:#c8dfc8;font-family:Arial,sans-serif;font-size:13px;">With warm regards,</p>
                            <h2 style="margin:0;font-size:26px;line-height:1.1;color:#ffffff;">${escapeHtml(guestName)}</h2>
                          </td>
                          <td style="vertical-align:top;text-align:right;">
                            <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c8dfc8;">Booking</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-left:auto;">
                              <tr><td style="background:rgba(215,177,84,.18);border:1px solid #d7b154;border-radius:999px;padding:7px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;white-space:nowrap;">${escapeHtml(booking.booking_code)}</td></tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="trz-stack" width="50%" style="padding:18px 28px;border-right:1px solid rgba(255,255,255,.1);vertical-align:top;">
                      <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Arrived</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkInDate)}</p>
                    </td>
                    <td class="trz-stack" width="50%" style="padding:18px 28px;vertical-align:top;">
                      <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Departed</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(checkOutDate)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>


            <!-- WARM MESSAGE -->
            <tr>
              <td class="trz-pad" style="padding:16px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:14px;">
                  <tr><td style="padding:26px 30px;">
                    <p style="margin:0 0 14px;font-size:19px;line-height:1.55;color:#17251c;">It was a privilege hosting you.</p>
                    <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#4e5b53;">We hope your time at The Resthouse Zamboanga gave you the rest and joy you deserved. Every stay matters deeply to us, and yours was no different.</p>
                    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#4e5b53;">This card is a small keepsake from your visit. We hope it brings back a smile whenever you see it.</p>
                  </td></tr>
                </table>
              </td>
            </tr>

            <!-- CONTACT STRIP -->
            <tr>
              <td class="trz-pad" style="padding:14px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f0e8;border-radius:12px;">
                  <tr>
                    <td class="trz-stack" width="33%" style="padding:15px 18px;border-right:1px solid #e6ded0;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Phone</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#17251c;">${escapeHtml(contactPhone)}</p>
                    </td>
                    <td class="trz-stack" width="33%" style="padding:15px 18px;border-right:1px solid #e6ded0;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Email</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#17251c;">${escapeHtml(replyTo)}</p>
                    </td>
                    <td class="trz-stack" width="33%" style="padding:15px 18px;vertical-align:top;">
                      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aaa9e;">Address</p>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#4e5b53;">${escapeHtml(resortLocation)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td class="trz-pad" style="padding:32px 40px 30px;background:#041109;border-radius:0 0 14px 14px;margin-top:28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="padding-bottom:18px;border-bottom:1px solid rgba(215,177,84,.35);text-align:center;">
                    <img src="cid:trz-logo" width="220" alt="The Resthouse Zamboanga" style="display:block;margin:0 auto;width:220px;max-width:220px;height:auto;border:0;">
                  </td></tr>
                  <tr><td style="padding-top:18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#c8dfc8;">
                    We hope to welcome you back soon.<br>
                    <span style="color:#7a8a7e;font-size:12px;">${escapeHtml(contactPhone)} &nbsp;&middot;&nbsp; ${escapeHtml(replyTo)}</span>
                  </td></tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text, attachments: await memoryCardAttachments(cardBase64) };
}

async function memoryCardAttachments(cardBase64) {
  const logoBytes = await readFile(new URL("./assets/logo.png", import.meta.url));
  return [
    { filename: "memory-card.jpg", content: cardBase64, content_id: "trz-memory-card" },
    { filename: "logo.png", content: logoBytes.toString("base64"), content_id: "trz-logo" }
  ];
}
