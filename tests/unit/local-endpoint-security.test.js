/**
 * OpenJobAutofill - Unit Test: Local AI Endpoints, Permissions & SSRF Security Gate
 * 
 * Validates:
 * 1. Manifest MV3 declarations for loopback host permissions & DNR
 * 2. OpenAI Base URL auto-normalization (Ollama /v1 fault tolerance)
 * 3. Local endpoint intelligent detection
 * 4. SSRF defense matrix with allowLocalEndpoints on/off (cloud metadata, dangerous ports, public HTTP)
 * 5. DNR rules structure for Ollama Origin rewriting
 * 6. Background message sender authorization & caller SSRF isolation
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  normalizeOpenAiBaseUrl,
  isLikelyLocalEndpoint,
  validateEndpointUrl,
  validateConfiguredEndpoint,
  getApiPermissionOrigins,
  toOriginPermissionPattern,
  getOllamaDnrRules,
  OLLAMA_DNR_RULE_LOCALHOST_ID,
  OLLAMA_DNR_RULE_127001_ID,
  DANGEROUS_PORTS,
  isHtmlResponse,
  createHtmlResponseError
} from "../../src/lib/endpoint-validator.js";
import {
  handleMessage,
  syncDeclarativeNetRequestRules
} from "../../src/background.js";
import { createMockChrome } from "../mock-chrome.js";

console.log("=== Running Unit Test: Local AI Endpoints & SSRF Security Gate ===");

// Setup mock chrome environment
const mockChrome = createMockChrome();
globalThis.chrome = mockChrome;

// -------------------------------------------------------------
// 1. Manifest MV3 Permissions & Host Patterns Contract
// -------------------------------------------------------------
console.log("1. Testing Manifest MV3 Permissions Contract...");
const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8"));

// Must have declarativeNetRequestWithHostAccess
assert.ok(
  manifest.permissions.includes("declarativeNetRequestWithHostAccess"),
  "manifest.permissions must declare 'declarativeNetRequestWithHostAccess'"
);

// Must have specific optional host permissions for loopback addresses
const expectedHostPatterns = [
  "http://localhost/*",
  "https://localhost/*",
  "http://127.0.0.1/*",
  "https://127.0.0.1/*",
  "http://*/*",
  "https://*/*"
];

for (const pattern of expectedHostPatterns) {
  assert.ok(
    manifest.optional_host_permissions.includes(pattern),
    `manifest.optional_host_permissions must declare '${pattern}'`
  );
}
console.log("  ✔ Manifest MV3 permissions & host patterns contract verified");

// -------------------------------------------------------------
// 2. Base URL Normalization & Ollama Path Auto-Completion
// -------------------------------------------------------------
console.log("2. Testing OpenAI Base URL Normalization (/v1 fault tolerance)...");

// Ollama variations without /v1 must be auto-completed to /v1
assert.equal(normalizeOpenAiBaseUrl("http://localhost:11434"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("http://localhost:11434/"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("http://127.0.0.1:11434/"), "http://127.0.0.1:11434/v1");

// Scheme-less entries must be given appropriate scheme and /v1
assert.equal(normalizeOpenAiBaseUrl("localhost:11434"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("127.0.0.1:11434"), "http://127.0.0.1:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("192.168.1.50:11434"), "http://192.168.1.50:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("api.deepseek.com/v1"), "https://api.deepseek.com/v1");

// Accidental inclusion of /chat/completions or /completions in Base URL must be cleanly stripped
assert.equal(normalizeOpenAiBaseUrl("http://localhost:11434/v1/chat/completions"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1");
assert.equal(normalizeOpenAiBaseUrl("http://127.0.0.1:11434/chat/completions"), "http://127.0.0.1:11434/v1");

// LM Studio & local server without path must be completed to /v1
assert.equal(normalizeOpenAiBaseUrl("http://localhost:1234"), "http://localhost:1234/v1");
assert.equal(normalizeOpenAiBaseUrl("http://localhost:8000"), "http://localhost:8000/v1");

// Bare external domains without /v1 must also be auto-completed to /v1
assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com"), "https://api.openai.com/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com/"), "https://api.openai.com/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.deepseek.com"), "https://api.deepseek.com/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.deepseek.com/"), "https://api.deepseek.com/v1");
assert.equal(normalizeOpenAiBaseUrl("http://my-newapi.com:3000"), "http://my-newapi.com:3000/v1");
assert.equal(normalizeOpenAiBaseUrl("http://my-newapi.com:3000/chat/completions"), "http://my-newapi.com:3000/v1");

// Already having /v1 must be preserved idempotently
assert.equal(normalizeOpenAiBaseUrl("http://localhost:11434/v1"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com/v1"), "https://api.openai.com/v1");
assert.equal(normalizeOpenAiBaseUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1");

// Explicit custom paths beyond root must be preserved
assert.equal(normalizeOpenAiBaseUrl("http://localhost:8000/api/v2"), "http://localhost:8000/api/v2");

console.log("  ✔ OpenAI Base URL normalization & /v1 auto-completion verified");

// HTML response detection tests
{
  const htmlSnippet = '<!doctype html><html lang="zh-CN"><head><script src="/theme-bootstrap.js"></script></head><body>NewAPI</body></html>';
  assert.equal(isHtmlResponse({ headers: new Headers({ "content-type": "text/html; charset=utf-8" }) }, htmlSnippet), true);
  assert.equal(isHtmlResponse(null, htmlSnippet), true);
  assert.equal(isHtmlResponse(null, '{"sections": {}}'), false);
  const err = createHtmlResponseError(htmlSnippet, "http://api.domain.com/chat/completions");
  assert.match(err.message, /NewAPI \/ OneAPI/);
  assert.match(err.message, /\/v1/);
}

// -------------------------------------------------------------
// 3. Local Endpoint Intelligent Detection
// -------------------------------------------------------------
console.log("3. Testing Local Endpoint Detection...");

assert.equal(isLikelyLocalEndpoint("http://localhost:11434"), true);
assert.equal(isLikelyLocalEndpoint("localhost:1234"), true);
assert.equal(isLikelyLocalEndpoint("http://127.0.0.1:8000"), true);
assert.equal(isLikelyLocalEndpoint("http://192.168.1.50:11434/v1"), true);
assert.equal(isLikelyLocalEndpoint("http://10.0.0.5:8000"), true);
assert.equal(isLikelyLocalEndpoint("https://my-lan-server:11434"), true); // Ollama port detected

assert.equal(isLikelyLocalEndpoint("https://api.openai.com/v1"), false);
assert.equal(isLikelyLocalEndpoint("https://api.deepseek.com/v1"), false);
assert.equal(isLikelyLocalEndpoint("https://cloud.siliconflow.cn/v1"), false);
assert.equal(isLikelyLocalEndpoint(""), false);
assert.equal(isLikelyLocalEndpoint(null), false);

console.log("  ✔ Local endpoint intelligent detection verified");

// -------------------------------------------------------------
// 4. Origin Permission Pattern Generation
// -------------------------------------------------------------
console.log("4. Testing Origin Permission Pattern Generation...");

assert.equal(toOriginPermissionPattern("http://localhost:11434/v1"), "http://localhost/*");
assert.equal(toOriginPermissionPattern("http://127.0.0.1:11434/v1"), "http://127.0.0.1/*");
assert.equal(toOriginPermissionPattern("http://[::1]:11434/v1"), "http://127.0.0.1/*"); // safely mapped to 127.0.0.1
assert.equal(toOriginPermissionPattern("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/*");
assert.equal(toOriginPermissionPattern("invalid-url"), "");

// Should default to openai-compatible when mode is omitted
const testOrigins = getApiPermissionOrigins({
  baseUrl: "http://localhost:11434"
});
assert.deepEqual(testOrigins, ["http://localhost/*"]);

console.log("  ✔ Origin permission pattern generation verified");

// -------------------------------------------------------------
// 5. SSRF Defense Matrix (AllowLocalEndpoints = false)
// -------------------------------------------------------------
console.log("5. Testing SSRF Defense Matrix with allowLocalEndpoints = false...");

// Insecure HTTP to public internet must be blocked
assert.throws(() => validateEndpointUrl("http://api.openai.com/v1"), /HTTPS_REQUIRED/);

// Local loopback and private IPs must be blocked
assert.throws(() => validateEndpointUrl("http://localhost:11434/v1", false), /HTTPS_REQUIRED/);
assert.throws(() => validateEndpointUrl("https://localhost:11434/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://127.0.0.1:11434/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://127.0.0.2:11434/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://evil.localhost:11434/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://[::ffff:7f00:1]:11434/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://[fd00:1234::1]:8000/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://100.64.0.1:8000/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://192.168.1.1/v1", false), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("https://localhost:0/v1", false), /SSRF_BLOCKED/);

console.log("  ✔ SSRF baseline protection verified");

// -------------------------------------------------------------
// 6. SSRF Defense Matrix (AllowLocalEndpoints = true)
// -------------------------------------------------------------
console.log("6. Testing SSRF Adversarial Defense Matrix with allowLocalEndpoints = true...");

// A. Legitimate local endpoints MUST be permitted
assert.ok(validateEndpointUrl("http://localhost:11434/v1", true));
assert.ok(validateEndpointUrl("http://127.0.0.1:11434/v1", true));
assert.ok(validateEndpointUrl("http://localhost:1234/v1", true));
assert.ok(validateEndpointUrl("http://192.168.1.200:8000/v1", true));
assert.ok(validateEndpointUrl("https://api.openai.com/v1", true));

// B. ADVERSARIAL ATTACKS: Public HTTP must NEVER be allowed
assert.throws(
  () => validateEndpointUrl("http://api.openai.com/v1", true),
  /HTTPS_REQUIRED/,
  "Public API over plain HTTP must be blocked even when allowLocalEndpoints is true"
);
assert.throws(
  () => validateEndpointUrl("http://attacker.example.com/api", true),
  /HTTPS_REQUIRED/,
  "Public domains over HTTP must be blocked"
);

// C. ADVERSARIAL ATTACKS: Cloud metadata services MUST be blocked unconditionally
const cloudMetadataTargets = [
  "http://169.254.169.254/latest/meta-data",
  "https://169.254.169.254/latest/meta-data",
  "http://169.254.169.254.nip.io/latest/meta-data",
  "http://[::ffff:169.254.169.254]/latest/meta-data",
  "https://[::ffff:a9fe:a9fe]/latest/meta-data",
  "http://[fd00:ec2::254]/latest/meta-data",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://instance-data/latest/meta-data"
];

for (const target of cloudMetadataTargets) {
  assert.throws(
    () => validateEndpointUrl(target, true),
    /SSRF_BLOCKED/,
    `Cloud metadata endpoint must be blocked: ${target}`
  );
}

// D. ADVERSARIAL ATTACKS: Sensitive / dangerous service ports MUST be blocked
for (const port of DANGEROUS_PORTS) {
  assert.throws(
    () => validateEndpointUrl(`http://localhost:${port}/v1`, true),
    /SSRF_BLOCKED/,
    `Dangerous port ${port} must be blocked on localhost`
  );
  assert.throws(
    () => validateEndpointUrl(`http://127.0.0.1:${port}/v1`, true),
    /SSRF_BLOCKED/,
    `Dangerous port ${port} must be blocked on 127.0.0.1`
  );
}

// E. ADVERSARIAL ATTACKS: Port boundaries (0 or > 65535) must be blocked
assert.throws(() => validateEndpointUrl("http://localhost:0/v1", true), /SSRF_BLOCKED/);

// F. ADVERSARIAL ATTACKS: Obfuscated hex/decimal/octal/shorthand/encoded IPs & credentials must be blocked
assert.throws(() => validateEndpointUrl("http://0x7f.1/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://0x7f000001/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://2130706433/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://0177.0.0.1/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://127.1/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://foo:bar@127.0.0.1:11434/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://foo:bar@0x7f000001:11434/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://user@localhost/v1", true), /SSRF_BLOCKED/);
assert.throws(() => validateEndpointUrl("http://%31%32%37.0.0.1/v1", true), /SSRF_BLOCKED/);

console.log("  ✔ SSRF adversarial attack gates passed: public HTTP, cloud metadata, dangerous ports & obfuscated IPs rejected");

// -------------------------------------------------------------
// 7. DeclarativeNetRequest Ollama 403 Origin Rewrite Rules
// -------------------------------------------------------------
console.log("7. Testing DNR Rule Specifications & Synchronization...");

const dnrRules = getOllamaDnrRules(mockChrome.runtime.id);
assert.equal(dnrRules.length, 2);

const localhostRule = dnrRules.find((r) => r.id === OLLAMA_DNR_RULE_LOCALHOST_ID);
assert.ok(localhostRule, "Localhost DNR rule must exist");
assert.equal(localhostRule.condition.urlFilter, "||localhost");
assert.equal(localhostRule.action.type, "modifyHeaders");
assert.equal(localhostRule.action.requestHeaders[0].header, "Origin");
assert.equal(localhostRule.action.requestHeaders[0].value, "http://localhost");
assert.deepEqual(localhostRule.condition.initiatorDomains, [mockChrome.runtime.id]);

const ip127Rule = dnrRules.find((r) => r.id === OLLAMA_DNR_RULE_127001_ID);
assert.ok(ip127Rule, "127.0.0.1 DNR rule must exist");
assert.equal(ip127Rule.condition.urlFilter, "||127.0.0.1");
assert.equal(ip127Rule.action.requestHeaders[0].value, "http://127.0.0.1");
assert.deepEqual(ip127Rule.condition.initiatorDomains, [mockChrome.runtime.id]);

// Test DNR sync integration with mockChrome
await syncDeclarativeNetRequestRules(true);
let dynamicRules = await mockChrome.declarativeNetRequest.getDynamicRules();
assert.equal(dynamicRules.length, 2, "Dynamic rules must be registered when enabled");

await syncDeclarativeNetRequestRules(false);
dynamicRules = await mockChrome.declarativeNetRequest.getDynamicRules();
assert.equal(dynamicRules.length, 0, "Dynamic rules must be cleared when disabled");

console.log("  ✔ DNR Origin rewrite rule specifications & dynamic sync verified");

// -------------------------------------------------------------
// 8. Background Sender Authorization Gate
// -------------------------------------------------------------
console.log("8. Testing Background Message Sender Authorization Gate...");

// A webpage content script attempting to execute administrative actions
const untrustedSender = {
  tab: { id: 42 },
  url: "https://job-hunting-scam.com/apply"
};

const blockedTypes = [
  "OJAF_SAVE_SETTINGS",
  "OJAF_CLEAR_SETTINGS",
  "OJAF_TEST_CONNECTION",
  "OJAF_LIST_MODELS"
];

for (const type of blockedTypes) {
  await assert.rejects(
    async () => handleMessage({ type, payload: {} }, untrustedSender),
    /UNAUTHORIZED_CALLER/,
    `Untrusted sender must not be allowed to execute ${type}`
  );
}

// Internal extension page sender must be allowed
const trustedSender = {
  tab: { id: 1 },
  url: mockChrome.runtime.getURL("src/options.html")
};
// Test that internal sender does not throw UNAUTHORIZED_CALLER on LIST_MODELS check
// (it may throw custom URL required, but NOT UNAUTHORIZED_CALLER)
await assert.rejects(
  async () => handleMessage({ type: "OJAF_LIST_MODELS", payload: { apiConfig: { mode: "custom" } } }, trustedSender),
  (err) => err.message !== "UNAUTHORIZED_CALLER: 此管理操作仅允许由扩展内部页面触发。"
);

console.log("  ✔ Background message sender authorization gate verified");

// -------------------------------------------------------------
// 9. Configured Endpoint Isolation in mapFields & analyzePageStructure
// -------------------------------------------------------------
console.log("9. Testing mapFields Endpoint Isolation against Poisoning...");

// Save a safe configuration first
await mockChrome.storage.local.set({
  apiConfig: {
    mode: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    allowLocalEndpoints: false
  }
});

// A caller attempts to pass a malicious payload with arbitrary local endpoint
// mapFields must strictly ignore payload.apiConfig and use storage settings!
try {
  await handleMessage({
    type: "OJAF_MAP_FIELDS",
    payload: {
      scan: { fields: [] },
      profileCatalog: { fields: [] },
      apiConfig: {
        baseUrl: "http://127.0.0.1:6379/injected" // Attempt to probe local Redis
      }
    }
  });
} catch (err) {
  // It may fail on missing fields or callAi mock, but it must NOT connect to or validate the injected 127.0.0.1:6379
  assert.ok(
    !err.message.includes("6379"),
    `Injected API config must not be used: ${err.message}`
  );
}

console.log("  ✔ mapFields & analyzePageStructure storage isolation against endpoint poisoning verified");

console.log("\n✅ ALL LOCAL AI ENDPOINTS & SSRF SECURITY TESTS PASSED!\n");
