import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetBase = path.join(__dirname, "assets");

const sample = {
  guest:          { full_name: "Maria Santos" },
  booking:        {
    booking_code:               "TRZ-2026-0042",
    start_at:                   "2026-06-20T14:00:00+08:00",
    end_at:                     "2026-06-22T12:00:00+08:00",
    pax_count:                  8,
    base_price:                 14000,
    security_deposit_amount:    3000,
    total_deposit_received:     3000,
    total_deposit_refunded:     0,
    total_revenue:              7000
  },
  bookingPackage: { name: "Standard Overnight" },
  packageVersion: {
    included_rooms:  2,
    included_pax:    8,
    is_overnight:    true,
    has_breakfast:   false
  }
};

const resendSrc = await readFile(new URL("./resend.mjs", import.meta.url), "utf8");

const helperPattern = /^function (escapeHtml|money|formatDateOnly|formatTimeOnly|miniDetail|paymentCell|quickInfo|inclusionGrid|stayGuideGrid|stayGuideCard|darkGuideGrid|darkCard|sectionDivider|galleryCard)\b/m;
const lines = resendSrc.split("\n");
const helpers = [];
let depth = 0;
let capturing = false;
for (const line of lines) {
  if (!capturing && helperPattern.test(line)) capturing = true;
  if (capturing) {
    helpers.push(line);
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    if (capturing && depth === 0 && helpers.length > 1) {
      capturing = false;
      depth = 0;
    }
  }
}

const helperCode = helpers.join("\n");

const { guest, booking, bookingPackage, packageVersion } = sample;
const checkInDate  = fmt(booking.start_at, { month: "short", day: "numeric", year: "numeric" });
const checkOutDate = fmt(booking.end_at,   { month: "short", day: "numeric", year: "numeric" });
const checkInTime  = fmtTime(booking.start_at);
const checkOutTime = fmtTime(booking.end_at);
const packageName  = bookingPackage.name;
const pax          = booking.pax_count;
const packagePrice    = php(booking.base_price);
const depositRequired = php(booking.security_deposit_amount);
const depositReceived = php(booking.total_deposit_received);
const depositRefunded = php(booking.total_deposit_refunded);
const packageBalance  = php(Math.max(booking.base_price - booking.total_revenue, 0));

function fmt(v, opts) {
  return v ? new Date(v).toLocaleDateString("en-PH", opts) : "Not set";
}
function fmtTime(v) {
  if (!v) return "Not set";
  const d = new Date(v);
  if (d.getHours() === 12 && d.getMinutes() === 0) return "12:00 NN";
  return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}
function php(v) {
  return `PHP ${Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function assetUrl(filename) {
  return new URL(`file:///${assetBase.replace(/\\/g, "/")}/${filename}`).href;
}

const mapLink = "https://maps.google.com/?q=The+Resthouse+Zamboanga";
const contactPhone = "0954 195 4478";
const resortLocation = "Tala Road, Brgy. Lumbangan, Zamboanga City";
const replyTo = "theresthousezamboanga@gmail.com";

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

const inclusions = ["Overnight stay", "8 pax", "2 rooms", "Pool access", "KTV room", "Game room", "Fast WiFi", "24/7 security"];

const buildHtml = new Function(
  "guest", "booking", "packageName", "pax",
  "checkInDate", "checkOutDate", "checkInTime", "checkOutTime",
  "packagePrice", "depositRequired", "depositReceived", "depositRefunded", "packageBalance",
  "inclusions", "reminders", "careItems",
  "contactPhone", "resortLocation", "mapLink", "replyTo", "assetUrl",
  helperCode + `
  return \`<!doctype html>
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
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">\${escapeHtml(booking.booking_code)} confirmed &mdash; Check-in \${escapeHtml(checkInDate)} at \${escapeHtml(checkInTime)}.</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece7de;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 0 44px;">
          <table role="presentation" class="trz-container" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:680px;border-collapse:collapse;background:#fffaf3;">

            <tr>
              <td style="line-height:0;font-size:0;padding:0;background:#041109;border-radius:14px 14px 0 0;">
                <img src="\${assetUrl('hero.jpg')}" width="680" alt="The Resthouse Zamboanga" style="display:block;width:100%;max-width:680px;height:360px;object-fit:cover;object-position:28% 30%;border:0;border-radius:14px 14px 0 0;">
              </td>
            </tr>

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

            <tr>
              <td class="trz-pad" style="padding:24px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border:1px solid rgba(215,177,84,.55);border-radius:14px;">
                  <tr>
                    <td colspan="2" style="padding:24px 28px 18px;border-bottom:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="vertical-align:top;">
                            <p style="margin:0 0 2px;font-style:italic;color:#c8dfc8;font-family:Arial,sans-serif;font-size:13px;">Welcome,</p>
                            <h2 style="margin:0;font-size:28px;line-height:1.1;color:#ffffff;">\${escapeHtml(guest.full_name)}</h2>
                          </td>
                          <td style="vertical-align:top;text-align:right;">
                            <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c8dfc8;">Booking Code</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-left:auto;">
                              <tr><td style="background:rgba(215,177,84,.18);border:1px solid #d7b154;border-radius:999px;padding:7px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;white-space:nowrap;">\${escapeHtml(booking.booking_code)}</td></tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;border-right:1px solid rgba(255,255,255,.1);vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Check-in</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">\${escapeHtml(checkInDate)}</p>
                      <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#c8dfc8;">\${escapeHtml(checkInTime)}</p>
                    </td>
                    <td class="trz-stack" width="50%" style="padding:20px 28px;vertical-align:top;">
                      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Check-out</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">\${escapeHtml(checkOutDate)}</p>
                      <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#c8dfc8;">\${escapeHtml(checkOutTime)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding:0 28px 22px;border-top:1px solid rgba(255,255,255,.1);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          \${miniDetail("Package", packageName)}
                          \${miniDetail("Guests", pax + " pax")}
                          \${miniDetail("Resort Line", contactPhone)}
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="trz-pad" style="padding:16px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:14px;">
                  <tr><td style="padding:20px 26px 18px;">
                    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aaa9e;">Payment Summary</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        \${paymentCell("Package Price", packagePrice, false)}
                        \${paymentCell("Deposit Required", depositRequired, false)}
                        \${paymentCell("Deposit Paid", depositReceived, false)}
                        \${paymentCell("Balance Due", packageBalance, true)}
                      </tr>
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="trz-pad" style="padding:14px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f0e8;border-radius:12px;">
                  <tr>
                    \${quickInfo("Check-in Time", checkInTime, "Let us know if you are arriving early.")}
                    \${quickInfo("Check-out Time", checkOutTime, "Late check-out subject to availability.")}
                    \${quickInfo("Resort Line", contactPhone, "We are here throughout your stay.")}
                    \${quickInfo("Address", "Lumbangan, ZC", "Tala Road, Brgy. Lumbangan")}
                  </tr>
                </table>
              </td>
            </tr>

            \${sectionDivider("Explore The Resthouse")}

            <tr>
              <td class="trz-pad" style="padding:0 28px 6px;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    \${galleryCard(assetUrl('pool.jpg'), "Pool Area")}
                    \${galleryCard(assetUrl('ktv.jpg'), "KTV Room")}
                  </tr>
                  <tr>
                    \${galleryCard(assetUrl('game.jpg'), "Game Room")}
                    \${galleryCard(assetUrl('bedroom.jpg'), "Bedroom")}
                  </tr>
                </table>
              </td>
            </tr>

            \${sectionDivider("Your Package")}

            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td class="trz-stack" width="36%" style="background:#06331e;border-radius:12px;padding:28px 24px;vertical-align:top;">
                      <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7b154;">Your Package</p>
                      <h2 style="margin:0 0 14px;font-size:24px;line-height:1.15;color:#ffffff;">\${escapeHtml(packageName)}</h2>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.65;color:#c8dfc8;">Everything curated for a comfortable, memorable stay at The Resthouse.</p>
                    </td>
                    <td class="trz-stack trz-stack-r" width="64%" style="padding:0 0 0 14px;vertical-align:top;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4ded3;border-radius:12px;">
                        <tr><td style="padding:22px 24px;">\${inclusionGrid(inclusions)}</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            \${sectionDivider("Your Stay Guide")}

            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                \${stayGuideGrid(reminders)}
              </td>
            </tr>

            \${sectionDivider("Caring for Your Home Away")}

            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#06331e;border-radius:14px;">
                  <tr><td style="padding:6px 12px 20px;">\${darkGuideGrid(careItems)}</td></tr>
                </table>
              </td>
            </tr>

            \${sectionDivider("Getting Here & Contact")}

            <tr>
              <td class="trz-pad" style="padding:4px 28px 0;background:#fffaf3;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td class="trz-stack" width="54%" style="padding:22px;background:#ffffff;border:1px solid #e4ded3;border-radius:12px;vertical-align:top;">
                      <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9aaa9e;">Our Location</p>
                      <p style="margin:0 0 3px;font-size:17px;font-weight:700;color:#17251c;">The Resthouse Zamboanga</p>
                      <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#4e5b53;">\${escapeHtml(resortLocation)}</p>
                      <img src="\${assetUrl('location-map.jpg')}" width="300" alt="The Resthouse Zamboanga location map" style="display:block;width:100%;max-width:300px;height:auto;border:0;border-radius:8px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:14px;">
                        <tr><td style="background:#06331e;border-radius:8px;padding:10px 20px;">
                          <a href="\${mapLink}" style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#f4d375;text-decoration:none;">View on Google Maps &rarr;</a>
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
                              <a href="tel:09541954478" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f4d375;text-decoration:none;">\${escapeHtml(contactPhone)}</a>
                            </td></tr>
                          </table>
                          <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px;">
                            <tr><td style="background:#f4f0e8;border:1px solid #e4ded3;border-radius:8px;padding:10px 20px;">
                              <a href="mailto:\${replyTo}" style="font-family:Arial,sans-serif;font-size:13px;color:#17251c;text-decoration:none;">\${escapeHtml(replyTo)}</a>
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

            <tr>
              <td class="trz-pad" style="padding:32px 40px 30px;background:#041109;border-radius:0 0 14px 14px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><td style="padding-bottom:18px;border-bottom:1px solid rgba(215,177,84,.35);text-align:center;">
                    <img src="\${assetUrl('logo.png')}" width="220" alt="The Resthouse Zamboanga" style="display:block;margin:0 auto;width:220px;max-width:220px;height:auto;border:0;">
                  </td></tr>
                  <tr><td style="padding-top:18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#c8dfc8;">
                    Thank you for choosing <strong style="color:#f4d375;">The Resthouse Zamboanga.</strong><br>
                    We look forward to welcoming you.<br>
                    <span style="color:#7a8a7e;font-size:12px;">\${escapeHtml(contactPhone)} &nbsp;&middot;&nbsp; \${escapeHtml(replyTo)}</span>
                  </td></tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>\`;`
);

const html = buildHtml(
  guest, booking, packageName, pax,
  checkInDate, checkOutDate, checkInTime, checkOutTime,
  packagePrice, depositRequired, depositReceived, depositRefunded, packageBalance,
  inclusions, reminders, careItems,
  contactPhone, resortLocation, mapLink, replyTo, assetUrl
);

const outPath = path.join(__dirname, "preview.html");
await writeFile(outPath, html, "utf8");
console.log("Preview written to:", outPath);
