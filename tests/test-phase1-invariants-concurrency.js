import assert from "node:assert/strict";
import {
  PROTOCOL_ERRORS,
  assertInvariants,
  createDefaultResumeEnvelope
} from "../src/lib/protocol.js";
import { ProfileStore } from "../src/lib/profile-store.js";
import { createMockChrome } from "./mock-chrome.js";

console.log("=== Running Phase 1: Invariants, Concurrency & Idempotency Gate ===");

const dummyNormalize = (p) => p || { schemaVersion: 2, sections: {}, customSections: [] };

// 1. Invariants Tests
console.log("1. Testing Protocol Invariants...");
assert.throws(() => assertInvariants(null), /Invariant Violation/);
assert.throws(() => assertInvariants({}), /Invariant Violation/);
assert.throws(() => assertInvariants({ profiles: {} }), /Invariant Violation/);

const defaultEnv = createDefaultResumeEnvelope();
assert.doesNotThrow(() => assertInvariants(defaultEnv));

// Missing active profile
const brokenEnv1 = JSON.parse(JSON.stringify(defaultEnv));
brokenEnv1.activeProfileId = "non_existent";
assert.throws(() => assertInvariants(brokenEnv1), /Invariant Violation: activeProfileId/);

// Mismatched profileOrder
const brokenEnv2 = JSON.parse(JSON.stringify(defaultEnv));
brokenEnv2.profileOrder = [];
assert.throws(() => assertInvariants(brokenEnv2), /Invariant Violation: profileOrder length/);

// Invalid revision
const brokenEnv3 = JSON.parse(JSON.stringify(defaultEnv));
brokenEnv3.stateRevision = 0;
assert.throws(() => assertInvariants(brokenEnv3), /Invariant Violation: stateRevision/);
console.log("  ✔ All invariant failure modes asserted correctly");

// 2. ProfileStore Initialization & Soft Self-Healing
console.log("2. Testing ProfileStore Initialization & Migration...");
globalThis.chrome = createMockChrome();

// A. Fresh initialization
let env = await ProfileStore.ensureInitialized(dummyNormalize);
assert.equal(env.stateRevision, 1);
assert.equal(env.profileOrder.length, 1);
assert.equal(ProfileStore.isReadOnly(), false);
console.log("  ✔ Fresh envelope initialized successfully");

// B. Soft-defect self healing (e.g. missing profileOrder)
globalThis.chrome = createMockChrome();
const rawProfileId = "p_legacy";
await chrome.storage.local.set({
  resumeEnvelope: {
    schemaVersion: 1,
    envelopeRevision: 1,
    stateRevision: 1,
    lastCommittedOperationId: "",
    activeProfileId: rawProfileId,
    // intentionally omit profileOrder
    profiles: {
      [rawProfileId]: {
        id: rawProfileId,
        name: "测试简历",
        revision: 1,
        updatedAt: new Date().toISOString(),
        profileV2: { schemaVersion: 2, sections: {} }
      }
    },
    recentOperations: {}
  }
});
env = await ProfileStore.ensureInitialized(dummyNormalize);
assert.ok(Array.isArray(env.profileOrder), "Soft-healing should reconstruct profileOrder");
assert.equal(env.profileOrder[0], rawProfileId);
assert.equal(ProfileStore.isReadOnly(), false);
console.log("  ✔ Soft defect self-healing verified");

// 3. Concurrency & Optimistic Locking
console.log("3. Testing Optimistic Locking & Conservative Concurrency...");
globalThis.chrome = createMockChrome();
await ProfileStore.ensureInitialized(dummyNormalize);
const initialSnap = await ProfileStore.getActiveSnapshot();
const targetId = initialSnap.profileId;
const baseProfRev = initialSnap.revision;
const baseStateRev = initialSnap.stateRevision;

// Successful save
const saveRes1 = await ProfileStore.saveProfile({
  operationId: "op_save_1",
  profileId: targetId,
  baseProfileRevision: baseProfRev,
  baseStateRevision: baseStateRev,
  profileV2: { schemaVersion: 2, sections: { basic: { values: { "姓名": "李四" } } } }
}, dummyNormalize);

assert.equal(saveRes1.ok, true);
assert.equal(saveRes1.stateRevision, 2);
assert.equal(saveRes1.profileRevision, 2);
console.log("  ✔ Successful save increments revisions");

// Stale stateRevision conflict
const conflictRes1 = await ProfileStore.saveProfile({
  operationId: "op_conflict_state",
  profileId: targetId,
  baseProfileRevision: 2,
  baseStateRevision: 1, // outdated state revision
  profileV2: { schemaVersion: 2, sections: {} }
}, dummyNormalize);

assert.equal(conflictRes1.ok, false);
assert.equal(conflictRes1.error, PROTOCOL_ERRORS.CONFLICT);
console.log("  ✔ Stale stateRevision safely detected as CONFLICT");

// Stale profileRevision conflict
const conflictRes2 = await ProfileStore.saveProfile({
  operationId: "op_conflict_prof",
  profileId: targetId,
  baseProfileRevision: 1, // outdated profile revision
  baseStateRevision: 2,
  profileV2: { schemaVersion: 2, sections: {} }
}, dummyNormalize);

assert.equal(conflictRes2.ok, false);
assert.equal(conflictRes2.error, PROTOCOL_ERRORS.CONFLICT);
console.log("  ✔ Stale profileRevision safely detected as CONFLICT");

// 4. Concurrency & Active Deletion
console.log("4. Testing Profile Creation & Active Deletion...");
// Create second profile
const createRes = await ProfileStore.createProfile({
  operationId: "op_create_2",
  name: "第二份简历",
  profileV2: { schemaVersion: 2, sections: {} },
  setActive: true,
  baseStateRevision: 2
}, dummyNormalize);

assert.equal(createRes.ok, true);
const secondId = createRes.profileId;
assert.equal(createRes.stateRevision, 3);

let activeSnap = await ProfileStore.getActiveSnapshot();
assert.equal(activeSnap.profileId, secondId, "Active profile should now be secondId");

// Delete the currently active profile (secondId)
const delRes = await ProfileStore.deleteProfile({
  operationId: "op_delete_active",
  profileId: secondId,
  baseStateRevision: 3
});

assert.equal(delRes.ok, true);
assert.equal(delRes.activeProfileId, targetId, "Active profile should auto-failover to remaining profile");
activeSnap = await ProfileStore.getActiveSnapshot();
assert.equal(activeSnap.profileId, targetId);
console.log("  ✔ Active profile deletion auto-reassigns activeProfileId correctly");

// Attempt to delete last remaining profile
const delLastRes = await ProfileStore.deleteProfile({
  operationId: "op_delete_last",
  profileId: targetId,
  baseStateRevision: delRes.stateRevision
});
assert.equal(delLastRes.ok, false);
assert.equal(delLastRes.error, "CANNOT_DELETE_LAST_PROFILE");
console.log("  ✔ Deleting last profile blocked as expected");

// 5. Idempotency & Operation Deduplication
console.log("5. Testing Idempotency & Replay Protection...");
const currentSnap = await ProfileStore.getActiveSnapshot();
const opPayload = {
  operationId: "idempotent_test_op",
  profileId: targetId,
  baseProfileRevision: currentSnap.revision,
  baseStateRevision: currentSnap.stateRevision,
  profileV2: { schemaVersion: 2, sections: { basic: { values: { "姓名": "王五" } } } }
};

// First execution
const resExec1 = await ProfileStore.saveProfile(opPayload, dummyNormalize);
assert.equal(resExec1.ok, true);
const committedStateRev = resExec1.stateRevision;

// Replay with identical payload
const resExec2 = await ProfileStore.saveProfile(opPayload, dummyNormalize);
assert.equal(resExec2.ok, true);
assert.equal(resExec2.deduplicated, true);
assert.equal(resExec2.stateRevision, committedStateRev, "Replay must return cached revision without incrementing");
console.log("  ✔ Identical payload replay returns deduplicated: true");

// Replay with different payload under same operationId -> INVALID_OPERATION_ID_REUSE
const tamperedPayload = {
  ...opPayload,
  profileV2: { schemaVersion: 2, sections: { basic: { values: { "姓名": "被篡改" } } } }
};
const resTampered = await ProfileStore.saveProfile(tamperedPayload, dummyNormalize);
assert.equal(resTampered.ok, false);
assert.equal(resTampered.error, PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE);
console.log("  ✔ Tampered payload replay rejected with INVALID_OPERATION_ID_REUSE");

// 6. Read-Only Mode on Heavy Corruption
console.log("6. Testing Read-Only Mode on Heavy Corruption...");
globalThis.chrome = createMockChrome();
// Write heavily corrupted envelope (e.g., profiles is a string instead of object)
await chrome.storage.local.set({
  resumeEnvelope: {
    schemaVersion: 1,
    profiles: "corrupted_non_object"
  }
});

const corruptEnv = await ProfileStore.ensureInitialized(dummyNormalize);
assert.equal(ProfileStore.isReadOnly(), true);
console.log(`  ✔ Severe corruption triggered read-only mode: ${ProfileStore.getReadOnlyReason()}`);

// Check metadata backup was saved
const meta = (await chrome.storage.local.get(["storageMeta"])).storageMeta;
assert.ok(meta?.lastCorruptedBackup, "Must preserve corrupted backup in storageMeta");
console.log("  ✔ Corrupted state safely preserved in storageMeta");

// Attempt mutation while in read-only mode
const writeAttempt = await ProfileStore.saveProfile({
  operationId: "write_when_readonly",
  profileId: "any",
  baseProfileRevision: 1,
  baseStateRevision: 1,
  profileV2: {}
}, dummyNormalize);

assert.equal(writeAttempt.ok, false);
assert.equal(writeAttempt.error, PROTOCOL_ERRORS.READ_ONLY_MODE);
console.log("  ✔ Mutation blocked when in read-only mode");

console.log("✅ Phase 1 Gate Passed!\n");
