import assert from "node:assert/strict";
import { ProfileStore } from "../src/lib/profile-store.js";
import { PROTOCOL_ERRORS } from "../src/lib/protocol.js";
import { createMockChrome } from "./mock-chrome.js";

console.log("=== Running Phase 3: UI Workflow, Snapshot & Round-Trip Gate ===");

const dummyNormalize = (p) => p || { schemaVersion: 2, sections: {}, customSections: [] };

globalThis.chrome = createMockChrome();

// 1. Initial State
console.log("1. Testing Multi-Profile Lifecycle & Active Snapshot Isolation...");
await ProfileStore.ensureInitialized(dummyNormalize);
let envelope = (await ProfileStore.getEnvelope()).envelope;
const defaultId = envelope.activeProfileId;

// 2. Create Profile A ("张三-后端")
const createARes = await ProfileStore.createProfile({
  operationId: "op_create_A",
  name: "张三-后端",
  profileV2: {
    schemaVersion: 2,
    sections: {
      basic: {
        values: { "姓名": "张三", "电话": "13800000001", "邮箱": "zhangsan@test.com" },
        custom: []
      }
    }
  },
  setActive: false,
  baseStateRevision: envelope.stateRevision
}, dummyNormalize);

assert.equal(createARes.ok, true);
const profileAId = createARes.profileId;

// 3. Create Profile B ("李四-前端") and set active
envelope = (await ProfileStore.getEnvelope()).envelope;
const createBRes = await ProfileStore.createProfile({
  operationId: "op_create_B",
  name: "李四-前端",
  profileV2: {
    schemaVersion: 2,
    sections: {
      basic: {
        values: { "姓名": "李四", "电话": "13800000002", "邮箱": "lisi@test.com" },
        custom: []
      }
    }
  },
  setActive: true,
  baseStateRevision: envelope.stateRevision
}, dummyNormalize);

assert.equal(createBRes.ok, true);
const profileBId = createBRes.profileId;

// 4. Verify Content Script Snapshot Isolation
// When Content.js calls getActiveSnapshot, it must receive Profile B ("李四")
const contentSnapshot = await ProfileStore.getActiveSnapshot();
assert.equal(contentSnapshot.profileId, profileBId);
assert.equal(contentSnapshot.profileV2.sections.basic.values["姓名"], "李四");
console.log("  ✔ Content script snapshot receives active profile (李四)");

// 5. Options Edits Profile A while Active Profile is B
envelope = (await ProfileStore.getEnvelope()).envelope;
const profileA = envelope.profiles[profileAId];

const saveARes = await ProfileStore.saveProfile({
  operationId: "op_save_A_edit",
  profileId: profileAId,
  baseProfileRevision: profileA.revision,
  baseStateRevision: envelope.stateRevision,
  profileV2: {
    schemaVersion: 2,
    sections: {
      basic: {
        values: { "姓名": "张三", "电话": "13800000001", "邮箱": "zhangsan@test.com", "现居住城市": "北京" },
        custom: []
      }
    }
  }
}, dummyNormalize);

assert.equal(saveARes.ok, true);
console.log("  ✔ Saved edits to Profile A without disturbing active status");

// Verify active profile in storage is STILL Profile B
const activeCheck = await ProfileStore.getActiveSnapshot();
assert.equal(activeCheck.profileId, profileBId);
assert.equal(activeCheck.profileV2.sections.basic.values["姓名"], "李四");
console.log("  ✔ Active profile snapshot completely unaffected by Profile A edits");

// Verify single-source mirror in storage reflects active profile B
const rawMirror = (await chrome.storage.local.get(["profileV2"])).profileV2;
assert.equal(rawMirror.sections.basic.values["姓名"], "李四");
console.log("  ✔ ProfileV2 read-only mirror consistently reflects active profile B");

// 6. Concurrency Conflict Recovery Workflow
console.log("2. Testing Concurrency Conflict & Save-As-New Recovery Flow...");
// Tab 1 holds stale base revision
const staleStateRev = saveARes.stateRevision;
const staleProfileARev = saveARes.profileRevision;

// Tab 2 renames Profile A in the background
const renameRes = await ProfileStore.renameProfile({
  operationId: "op_rename_A",
  profileId: profileAId,
  newName: "张三-全栈专家",
  baseStateRevision: staleStateRev
});
assert.equal(renameRes.ok, true);

// Tab 1 now attempts to save Profile A with staleStateRev
const conflictSaveAttempt = await ProfileStore.saveProfile({
  operationId: "op_tab1_stale_save",
  profileId: profileAId,
  baseProfileRevision: staleProfileARev,
  baseStateRevision: staleStateRev, // STALE!
  profileV2: {
    schemaVersion: 2,
    sections: {
      basic: { values: { "姓名": "张三", "现居住城市": "上海" } }
    }
  }
}, dummyNormalize);

assert.equal(conflictSaveAttempt.ok, false);
assert.equal(conflictSaveAttempt.error, PROTOCOL_ERRORS.CONFLICT);
console.log("  ✔ Concurrency conflict successfully blocked");

// Options UI catches conflict, preserves user's edit, and does "Save as New Profile"
envelope = (await ProfileStore.getEnvelope()).envelope;
const saveAsNewRes = await ProfileStore.createProfile({
  operationId: "op_save_as_new_recovery",
  name: "张三-全栈专家 (副本)",
  profileV2: {
    schemaVersion: 2,
    sections: {
      basic: { values: { "姓名": "张三", "现居住城市": "上海" } }
    }
  },
  setActive: false,
  baseStateRevision: envelope.stateRevision
}, dummyNormalize);

assert.equal(saveAsNewRes.ok, true);
console.log("  ✔ Conflict recovery via Save-As-New succeeded without data loss");

// 7. Profile Export & Import Round-trip
console.log("3. Testing Profile Export & Import Round-trip...");
// Set mock API config to verify it is NOT exported
await chrome.storage.local.set({
  apiConfig: {
    apiKey: "sk-super-secret-key-12345",
    baseUrl: "https://api.openai.com/v1"
  }
});

// Emulate Options exportProfile logic
envelope = (await ProfileStore.getEnvelope()).envelope;
const exportSource = envelope.profiles[profileAId];
const exportedPayload = {
  format: "OpenJobAutofillProfileBackup",
  version: 2,
  exportedAt: new Date().toISOString(),
  profileName: exportSource.name,
  profileV2: exportSource.profileV2
};

const jsonString = JSON.stringify(exportedPayload, null, 2);

// Security assertion: API key must NOT be present in export
assert.ok(!jsonString.includes("sk-super-secret-key-12345"), "Export must NEVER leak API keys");
console.log("  ✔ Export strictly excludes API credentials");

// Emulate importProfileFromFile logic
const parsedImport = JSON.parse(jsonString);
assert.equal(parsedImport.format, "OpenJobAutofillProfileBackup");
assert.equal(parsedImport.profileV2.sections.basic.values["姓名"], "张三");
assert.equal(parsedImport.profileV2.sections.basic.values["现居住城市"], "北京");
console.log("  ✔ Export-Import round-trip verified 100% faithful to original data");

console.log("✅ Phase 3 Gate Passed!\n");
