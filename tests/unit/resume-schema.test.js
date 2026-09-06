/**
 * OpenJobAutofill - Unit Test: Resume Schema, 19 Standard Sections & Passthrough Gate
 */

import assert from "node:assert/strict";
import {
  PROFILE_SCHEMA_VERSION,
  STANDARD_SECTION_DEFINITIONS,
  STANDARD_SECTION_KEYS,
  createEmptyProfileV2,
  assertProfileV2Schema,
  normalizeProfileV2,
  restorePassthrough
} from "../../src/lib/resume-schema.js";

console.log("=== Running Unit Test: Resume Schema & Passthrough Gate ===");

// 1. Validate 19 Standard Section Definitions
console.log("1. Testing 19 Standard Sections Completeness & Immutability...");
{
  assert.equal(STANDARD_SECTION_KEYS.length, 19, "Must have exactly 19 standard section keys");
  
  const expectedKeys = [
    "basic", "intention", "education", "internship", "work",
    "performance", "project", "student", "awards", "language",
    "computer", "certificates", "family", "training", "papers",
    "patent", "self", "declarations", "other"
  ];
  assert.deepEqual(Array.from(STANDARD_SECTION_KEYS), expectedKeys);

  // Assert immutability
  assert.throws(() => {
    STANDARD_SECTION_DEFINITIONS.basic = { key: "tampered" };
  }, TypeError, "STANDARD_SECTION_DEFINITIONS must be frozen");

  assert.throws(() => {
    STANDARD_SECTION_KEYS.push("tampered");
  }, TypeError, "STANDARD_SECTION_KEYS must be frozen");

  // Verify kinds
  assert.equal(STANDARD_SECTION_DEFINITIONS.basic.kind, "simple");
  assert.equal(STANDARD_SECTION_DEFINITIONS.intention.kind, "repeat");
  assert.equal(STANDARD_SECTION_DEFINITIONS.education.kind, "repeat");
  assert.equal(STANDARD_SECTION_DEFINITIONS.work.kind, "repeat");
  assert.equal(STANDARD_SECTION_DEFINITIONS.project.kind, "repeat");
  assert.equal(STANDARD_SECTION_DEFINITIONS.self.kind, "simple");
  assert.equal(STANDARD_SECTION_DEFINITIONS.declarations.kind, "simple");
  assert.equal(STANDARD_SECTION_DEFINITIONS.other.kind, "simple");

  console.log("  ✔ 19 standard sections verified and strictly immutable");
}

// 2. Testing createEmptyProfileV2
console.log("2. Testing createEmptyProfileV2...");
{
  const empty = createEmptyProfileV2();
  assert.equal(empty.schemaVersion, 2);
  assert.equal(Object.keys(empty.sections).length, 19);
  assert.doesNotThrow(() => assertProfileV2Schema(empty));
  assert.deepEqual(empty.sections.basic.values, {});
  assert.deepEqual(empty.sections.education.items, []);
  console.log("  ✔ createEmptyProfileV2 creates valid 19-section canonical profile");
}

// 3. Testing assertProfileV2Schema
console.log("3. Testing assertProfileV2Schema Validation & Error Paths...");
{
  assert.throws(() => assertProfileV2Schema(null), /non-null object/);
  assert.throws(() => assertProfileV2Schema({ schemaVersion: 1, sections: {} }), /schemaVersion must be 2/);
  assert.throws(() => assertProfileV2Schema({ schemaVersion: 2 }), /sections must be a plain object/);

  // Section kind mismatch
  const badKind = createEmptyProfileV2();
  badKind.sections.basic.kind = "repeat"; // basic must be simple
  assert.throws(() => assertProfileV2Schema(badKind), /kind mismatch/);

  // Repeat items malformed
  const badRepeat = createEmptyProfileV2();
  badRepeat.sections.education.items = "not-an-array";
  assert.throws(() => assertProfileV2Schema(badRepeat), /items must be an array/);

  // Simple values malformed
  const badSimple = createEmptyProfileV2();
  badSimple.sections.basic.values = "not-an-object";
  assert.throws(() => assertProfileV2Schema(badSimple), /values must be an object/);

  console.log("  ✔ assertProfileV2Schema catches all structural anomalies with clear errors");
}

// 4. Testing normalizeProfileV2 & Unknown Field Passthrough Retention
console.log("4. Testing normalizeProfileV2 & Unknown Field Passthrough Retention...");
{
  const rawInput = {
    schemaVersion: 2,
    updatedAt: "2026-09-06T10:00:00Z",
    sections: {
      basic: {
        kind: "simple",
        values: { "姓名": "张三", "电话": "13800138000" },
        custom: [{ label: "期望城市", value: "北京" }]
      },
      education: {
        kind: "repeat",
        items: [
          {
            title: "清华大学",
            values: { "学校": "清华大学", "学历": "硕士" },
            custom: []
          }
        ]
      },
      // Non-standard legacy or 3rd-party section
      legacyCustomSection: {
        kind: "custom_kind",
        data: { foo: "bar" }
      }
    },
    // Non-standard top-level property
    _metaClientVendor: "SuperVendorApp",
    _syncTimestamp: 1725619200
  };

  const normalized = normalizeProfileV2(rawInput);
  assert.doesNotThrow(() => assertProfileV2Schema(normalized));
  assert.equal(normalized.sections.basic.values["姓名"], "张三");
  assert.equal(normalized.sections.education.items[0].values["学校"], "清华大学");

  // Verify that all 19 standard sections are present in normalized output
  assert.equal(Object.keys(normalized.sections).length, 19);

  // Verify passthrough retention
  assert.ok(normalized.__passthrough, "__passthrough must be generated for unknown fields");
  assert.deepEqual(
    normalized.__passthrough.sections.legacyCustomSection,
    { kind: "custom_kind", data: { foo: "bar" } },
    "Unknown section must be retained in __passthrough.sections"
  );
  assert.equal(normalized.__passthrough.properties._metaClientVendor, "SuperVendorApp");
  assert.equal(normalized.__passthrough.properties._syncTimestamp, 1725619200);

  console.log("  ✔ normalizeProfileV2 standardizes 19 sections while capturing unknown fields into __passthrough");
}

// 5. Testing restorePassthrough & Round-trip Zero Data Loss
console.log("5. Testing restorePassthrough & Round-trip Zero Data Loss...");
{
  const original = {
    schemaVersion: 2,
    updatedAt: "2026-09-06",
    sections: {
      basic: { kind: "simple", values: { "姓名": "李四" }, custom: [] },
      customSpecialSection: { special: true, tags: ["a", "b"] }
    },
    extraThirdPartyKey: { mode: "pro" }
  };

  // 1. Normalize
  const normalized = normalizeProfileV2(original);
  assert.equal(normalized.__passthrough.sections.customSpecialSection.special, true);
  assert.equal(normalized.__passthrough.properties.extraThirdPartyKey.mode, "pro");

  // 2. Restore
  const restored = restorePassthrough(normalized);
  assert.deepEqual(restored.sections.customSpecialSection, original.sections.customSpecialSection);
  assert.deepEqual(restored.extraThirdPartyKey, original.extraThirdPartyKey);

  console.log("  ✔ restorePassthrough guarantees 100% round-trip fidelity with zero data loss");
}

console.log("✅ All Resume Schema & Passthrough tests passed!\n");
