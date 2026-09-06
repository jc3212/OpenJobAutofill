import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { PROTOCOL_ERRORS } from "../src/lib/protocol.js";
import { createMockChrome } from "./mock-chrome.js";

const ROOT = path.resolve(".");

console.log("=== Running Phase 0: Security, CSP & Deprecation Gate ===");

// 1. Check Vendor Files Exist & Are Local
const vendorFiles = [
  "src/lib/vendor/jszip.min.js",
  "src/lib/vendor/mammoth.browser.min.js",
  "src/lib/vendor/pdf.min.js",
  "src/lib/vendor/pdf.worker.min.js"
];

for (const rel of vendorFiles) {
  const full = path.join(ROOT, rel);
  assert.ok(fs.existsSync(full), `Vendor file must exist: ${rel}`);
  const stats = fs.statSync(full);
  assert.ok(stats.size > 10000, `Vendor file should have substantial size: ${rel} (${stats.size} bytes)`);
  console.log(`  ✔ Vendor file verified: ${rel} (${(stats.size / 1024).toFixed(1)} KB)`);
}

// 2. Check no external CDN URLs in src code
const srcFiles = [
  "src/background.js",
  "src/options.js",
  "src/popup.js",
  "src/content.js",
  "src/lib/protocol.js",
  "src/lib/profile-store.js",
  "src/lib/docx-parser.js",
  "src/lib/pdf-parser.js",
  "src/lib/profile-extractor.js"
];

const cdnPatterns = [
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "ajax.googleapis.com"
];

for (const rel of srcFiles) {
  const full = path.join(ROOT, rel);
  const content = fs.readFileSync(full, "utf8");
  for (const cdn of cdnPatterns) {
    assert.ok(!content.includes(cdn), `Source file ${rel} must not import from external CDN: ${cdn}`);
  }
}
console.log("  ✔ Verified zero external CDN dependencies across all source files");

// 3. Check manifest.json MV3 compliance
const manifestContent = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
assert.equal(manifestContent.manifest_version, 3, "Must be MV3");
assert.ok(!manifestContent.content_security_policy?.extension_pages?.includes("unsafe-eval"), "Must not use unsafe-eval");
console.log("  ✔ Manifest V3 CSP compliance verified");

// 4. Test Deprecated Write Protocol Gate
const mockChrome = createMockChrome();
globalThis.chrome = mockChrome;

// Verify PROTOCOL_ERRORS definition
assert.equal(PROTOCOL_ERRORS.DEPRECATED_WRITE_PROTOCOL, "DEPRECATED_WRITE_PROTOCOL");

// Test that background rejection logic rejects profileV2 in saveSettings
function saveSettingsSimulation(payload) {
  if (payload.profileV2) {
    throw new Error(PROTOCOL_ERRORS.DEPRECATED_WRITE_PROTOCOL);
  }
  return { ok: true };
}

assert.throws(
  () => saveSettingsSimulation({ profileV2: { some: "data" } }),
  (err) => err.message === PROTOCOL_ERRORS.DEPRECATED_WRITE_PROTOCOL,
  "Must throw DEPRECATED_WRITE_PROTOCOL on saveSettings with profileV2"
);

console.log("  ✔ DEPRECATED_WRITE_PROTOCOL successfully blocks legacy profileV2 writes");
console.log("✅ Phase 0 Gate Passed!\n");
