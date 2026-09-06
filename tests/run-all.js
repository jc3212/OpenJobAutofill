/**
 * OpenJobAutofill - Master 4-Phase Verification Runner
 */

console.log("==================================================================");
console.log("  OpenJobAutofill: 4-Phase Convergence Verification Test Suite   ");
console.log("==================================================================\n");

async function runAll() {
  const startTime = Date.now();

  try {
    await import("./unit/contracts.test.js");
    await import("./integration/resume-import-service.test.js");
    await import("./test-phase0-security.js");
    await import("./test-phase1-invariants-concurrency.js");
    await import("./test-phase2-parsers-pii-ssrf.js");
    await import("./test-phase3-e2e-workflows.js");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("==================================================================");
    console.log(`🎉 ALL 4 GATES PASSED SUCCESSFULLY in ${elapsed}s!`);
    console.log("   - Phase 0: Security, CSP & Deprecation Gate        [PASS]");
    console.log("   - Phase 1: Invariants, Concurrency & Idempotency   [PASS]");
    console.log("   - Phase 2: Parsers, PII Extraction & SSRF Filter   [PASS]");
    console.log("   - Phase 3: UI Workflow, Snapshot & Round-Trip      [PASS]");
    console.log("==================================================================");
  } catch (err) {
    console.error("\n❌ VERIFICATION SUITE FAILED:");
    console.error(err);
    process.exit(1);
  }
}

runAll();
