import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = "public";
const htmlPath = join(outputDir, "booking-request.html");
const cssPath = join(outputDir, "booking-request.css");

await assertExists(htmlPath, "final build output must contain booking-request.html");
await assertExists(cssPath, "final build output must contain booking-request.css");

const html = await readFile(htmlPath, "utf8");
assert.ok(html.includes("./booking-request.css"), "booking request page must reference booking-request.css");

const scriptMatch = html.match(/<script[^>]+src="\.\/([^"]+booking-request\.js)"/);
assert.ok(scriptMatch, "booking request page must reference booking-request.js");
await assertExists(join(outputDir, scriptMatch[1]), `final build output must contain ${scriptMatch[1]}`);

console.log("Build output verification passed.");

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    assert.fail(message);
  }
}
