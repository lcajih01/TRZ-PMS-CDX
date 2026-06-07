import { sendGuestMemoryEmail } from "../../email/resend.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  let payload = {};
  try {
    payload = await readJson(req);
    const result = await sendGuestMemoryEmail({ memoryId: payload.memory_id, env: process.env });
    return sendJson(res, 200, result);
  } catch (error) {
    console.error("[memory/send]", {
      memory_id: payload.memory_id || null,
      error: error.message
    });
    return sendJson(res, 500, { ok: false, error: error.message || "Email sending failed." });
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};

  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
