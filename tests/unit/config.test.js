/**
 * OpenJobAutofill - Unit Test: Project Config & Identity Gate
 */

import assert from "node:assert/strict";
import {
  UPSTREAM_REPOSITORY,
  FORK_REPOSITORY,
  UPSTREAM_URL,
  FORK_URL,
  getAppVersion,
  getManifestMeta,
  getUpdateApiUrl,
  getReleasesUrl,
  PROJECT_CONFIG
} from "../../src/lib/config.js";

console.log("=== Running Unit Test: Project Config & Identity Gate ===");

// 1. Testing Repository Identifiers & URLs
console.log("1. Testing Repository Identifiers & URLs...");
{
  assert.equal(UPSTREAM_REPOSITORY, "Br1an67/OpenJobAutofill");
  assert.equal(FORK_REPOSITORY, "jc3212/OpenJobAutofill");
  assert.equal(UPSTREAM_URL, "https://github.com/Br1an67/OpenJobAutofill");
  assert.equal(FORK_URL, "https://github.com/jc3212/OpenJobAutofill");
  assert.equal(getUpdateApiUrl(), "https://api.github.com/repos/Br1an67/OpenJobAutofill/releases/latest");
  assert.equal(getUpdateApiUrl(FORK_REPOSITORY), "https://api.github.com/repos/jc3212/OpenJobAutofill/releases/latest");
  assert.equal(getReleasesUrl(), "https://github.com/Br1an67/OpenJobAutofill/releases");
  assert.equal(getReleasesUrl(FORK_REPOSITORY), "https://github.com/jc3212/OpenJobAutofill/releases");
  console.log("  ✔ Upstream and fork repo identity constants & URL generators verified");
}

// 2. Testing Dynamic Manifest Version
console.log("2. Testing Dynamic Manifest Version...");
{
  // Fallback when chrome.runtime is undefined
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  assert.equal(getAppVersion(), "1.0.2");
  
  // Dynamic version when chrome.runtime.getManifest() is available
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({
        name: "OpenJobAutofill",
        version: "3.2.1",
        description: "Test description",
        homepage_url: "https://github.com/jc3212/OpenJobAutofill"
      })
    }
  };

  assert.equal(getAppVersion(), "3.2.1");
  const meta = getManifestMeta();
  assert.equal(meta.version, "3.2.1");
  assert.equal(meta.homepageUrl, "https://github.com/jc3212/OpenJobAutofill");
  
  globalThis.chrome = originalChrome;
  console.log("  ✔ Dynamic manifest version and fallback behavior verified");
}

console.log("✅ All Project Config & Identity tests passed!");
