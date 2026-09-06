/**
 * OpenJobAutofill - Unit Test: Profile Store Reliability, Tri-state Corruption & Idempotency
 */

import assert from "node:assert/strict";
import { createMockChrome } from "../mock-chrome.js";
globalThis.chrome = createMockChrome();
import { ProfileStore, unwrapStoreResult } from "../../src/lib/profile-store.js";
import {
  STORAGE_ENVELOPE_KEY,
  STORAGE_META_KEY,
  PROTOCOL_ERRORS,
  createDefaultResumeEnvelope
} from "../../src/lib/protocol.js";

console.log("=== Running Unit Test: Profile Store Reliability Gate ===");

const dummyNormalize = (p) => p || { schemaVersion: 2, sections: {} };

// 1. Testing Self-Heal Persistence (Soft Defect)
console.log("1. Testing Self-Heal Persistence...");
{
  await chrome.storage.local.clear();

  // Create an envelope with soft defect: missing profileOrder and orphaned activeProfileId
  const env = createDefaultResumeEnvelope();
  const validId = env.activeProfileId;
  delete env.profileOrder;
  env.activeProfileId = "non_existent_id";

  await chrome.storage.local.set({ [STORAGE_ENVELOPE_KEY]: env });

  // Initialize
  const healed = await ProfileStore.ensureInitialized(dummyNormalize);
  assert.equal(ProfileStore.isReadOnly(), false);
  assert.equal(healed.activeProfileId, validId);
  assert.deepEqual(healed.profileOrder, [validId]);

  // Read directly from storage to assert self-heal was PERSISTED to disk!
  const rawDisk = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY, STORAGE_META_KEY]);
  const diskEnv = rawDisk[STORAGE_ENVELOPE_KEY];
  assert.equal(diskEnv.activeProfileId, validId, "Self-healed activeProfileId MUST be persisted to storage");
  assert.deepEqual(diskEnv.profileOrder, [validId], "Self-healed profileOrder MUST be persisted to storage");
  assert.ok(rawDisk[STORAGE_META_KEY]?.lastRepairedAt, "storageMeta must record lastRepairedAt");
  console.log("  ✔ Soft defect self-healing successfully persisted to chrome.storage.local");
}

// 2. Testing Tri-State Corruption: Recoverable from Legacy Mirror
console.log("2. Testing Tri-State Corruption: Recoverable from Legacy Mirror...");
{
  await chrome.storage.local.clear();

  // Corrupted envelope (empty profiles), BUT valid legacy profileV2 exists
  const corruptEnv = {
    schemaVersion: 1,
    profiles: {}, // Invariant violation!
    profileOrder: [],
    activeProfileId: ""
  };
  const legacyProfile = {
    schemaVersion: 2,
    sections: {
      basic: { kind: "simple", values: { "姓名": "王五", "简历名称": "王五的遗留简历" } }
    }
  };

  await chrome.storage.local.set({
    [STORAGE_ENVELOPE_KEY]: corruptEnv,
    profileV2: legacyProfile
  });

  const recovered = await ProfileStore.ensureInitialized(dummyNormalize);
  assert.equal(ProfileStore.isReadOnly(), false, "Must recover and not stay in read-only mode");
  const activeProf = recovered.profiles[recovered.activeProfileId];
  assert.equal(activeProf.name, "王五的遗留简历");
  assert.equal(activeProf.profileV2.sections.basic.values["姓名"], "王五");

  const rawDisk = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY, STORAGE_META_KEY]);
  assert.equal(rawDisk[STORAGE_META_KEY]?.recoveredFromLegacy, true);
  console.log("  ✔ Recoverable corruption successfully restored from legacy profileV2 mirror and persisted");
}

// 3. Testing Tri-State Corruption: Hard Corruption & Read-Only Safety Mode
console.log("3. Testing Tri-State Corruption: Hard Corruption Safety Mode...");
{
  await chrome.storage.local.clear();

  // Corrupted envelope (empty profiles) and NO legacy profileV2 mirror exists
  const hardCorrupted = {
    schemaVersion: 1,
    profiles: {},
    profileOrder: [],
    activeProfileId: ""
  };

  await chrome.storage.local.set({
    [STORAGE_ENVELOPE_KEY]: hardCorrupted
  });

  await ProfileStore.ensureInitialized(dummyNormalize);

  // Invariant: MUST enter read-only safety mode and MUST NOT invent fake blank profile
  assert.equal(ProfileStore.isReadOnly(), true, "Must enter read-only safety mode on hard corruption");
  assert.match(ProfileStore.getReadOnlyReason(), /profiles must contain at least 1 profile/);

  const rawDisk = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY, STORAGE_META_KEY]);
  assert.ok(rawDisk[STORAGE_META_KEY]?.lastCorruptedBackup, "Corrupted snapshot must be backed up");
  assert.deepEqual(rawDisk[STORAGE_ENVELOPE_KEY].profiles, {}, "Must NOT invent fake profile on hard corruption");

  // All mutations must be blocked while in read-only mode
  const writeRes = await ProfileStore.saveProfile({
    operationId: "op_fail_readonly",
    profileId: "dummy",
    baseProfileRevision: 1,
    baseStateRevision: 1,
    profileV2: {}
  }, dummyNormalize);

  assert.equal(writeRes.ok, false);
  assert.equal(writeRes.error, PROTOCOL_ERRORS.READ_ONLY_MODE);
  console.log("  ✔ Hard corruption safely backed up to storageMeta, entered read-only mode, and blocked mutations");
}

// 4. Testing Idempotency: Full Response Caching & Collision Guard
console.log("4. Testing Idempotency: Full Response Caching & Collision Protection...");
{
  await chrome.storage.local.clear();
  await ProfileStore.ensureInitialized(dummyNormalize);

  const opId = "op_idempotency_test_1";
  const createPayload = {
    operationId: opId,
    name: "新测试档案",
    profileV2: { schemaVersion: 2, sections: {} },
    setActive: true,
    baseStateRevision: 1
  };

  // First call
  const firstRes = await ProfileStore.createProfile(createPayload, dummyNormalize);
  assert.equal(firstRes.ok, true);
  assert.ok(firstRes.profileId, "First call must return profileId");

  // Replay identical call
  const replayRes = await ProfileStore.createProfile(createPayload, dummyNormalize);
  assert.equal(replayRes.ok, true);
  assert.equal(replayRes.deduplicated, true);
  assert.equal(replayRes.profileId, firstRes.profileId, "Replay MUST return cached profileId, not undefined!");

  // Tampered payload reuse same operationId -> must reject with INVALID_OPERATION_ID_REUSE
  const tamperedPayload = {
    operationId: opId,
    name: "篡改名称",
    profileV2: { schemaVersion: 2, sections: {} },
    setActive: false,
    baseStateRevision: 1
  };
  const tamperedRes = await ProfileStore.createProfile(tamperedPayload, dummyNormalize);
  assert.equal(tamperedRes.ok, false);
  assert.equal(tamperedRes.error, PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE);
  console.log("  ✔ Idempotent replay returns cached full response and strictly rejects operationId collision");
}

// 5. Testing unwrapStoreResult Error Path
console.log("5. Testing unwrapStoreResult Error Path...");
{
  const successRes = { ok: true, stateRevision: 5, profileId: "prof_123" };
  const unwrapped = unwrapStoreResult(successRes);
  assert.equal(unwrapped.profileId, "prof_123");

  const conflictRes = { ok: false, error: PROTOCOL_ERRORS.CONFLICT, currentStateRevision: 3 };
  assert.throws(
    () => unwrapStoreResult(conflictRes),
    (err) => {
      assert.equal(err.code, PROTOCOL_ERRORS.CONFLICT);
      assert.equal(err.message, PROTOCOL_ERRORS.CONFLICT);
      return true;
    }
  );

  assert.throws(() => unwrapStoreResult(null), /Empty or invalid response/);
  console.log("  ✔ unwrapStoreResult unmasks errors and prevents false transport success");
}

console.log("✅ All Profile Store Reliability tests passed!\n");
