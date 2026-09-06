import {
  PROTOCOL_ERRORS,
  STORAGE_ENVELOPE_KEY,
  STORAGE_META_KEY,
  createDefaultResumeEnvelope,
  assertInvariants,
  computeRequestHash
} from "./protocol.js";

let operationQueue = Promise.resolve();
let isReadOnlyMode = false;
let readOnlyReason = "";

function enqueueOperation(fn) {
  const next = operationQueue.then(fn, fn);
  operationQueue = next.catch(() => undefined);
  return next;
}

export const ProfileStore = {
  async ensureInitialized(normalizeProfileV2) {
    return enqueueOperation(async () => {
      const data = await chrome.storage.local.get([
        STORAGE_ENVELOPE_KEY,
        STORAGE_META_KEY,
        "profileV2"
      ]);

      let envelope = data[STORAGE_ENVELOPE_KEY];
      let meta = data[STORAGE_META_KEY] || { migrationVersion: 0 };

      if (envelope) {
        try {
          // Check for recoverable soft defects
          if (!Array.isArray(envelope.profileOrder) && envelope.profiles) {
            envelope.profileOrder = Object.keys(envelope.profiles);
          }
          if (!envelope.profiles[envelope.activeProfileId] && envelope.profileOrder?.length > 0) {
            envelope.activeProfileId = envelope.profileOrder[0];
          }

          assertInvariants(envelope);
          isReadOnlyMode = false;
          readOnlyReason = "";
          return envelope;
        } catch (err) {
          // Heavy corruption - enter read-only safety mode
          isReadOnlyMode = true;
          readOnlyReason = err.message;
          const snippet = JSON.stringify(envelope || "").slice(0, 65536);
          await chrome.storage.local.set({
            [STORAGE_META_KEY]: {
              ...meta,
              lastCorruptedBackup: {
                createdAt: new Date().toISOString(),
                sourceKey: STORAGE_ENVELOPE_KEY,
                error: err.message,
                dataSnippet: snippet
              }
            }
          });
          return envelope;
        }
      }

      // No envelope exists: migrate from legacy profileV2 or initialize default
      const legacyProfile = data.profileV2;
      const normalizedLegacy = legacyProfile && normalizeProfileV2 ? normalizeProfileV2(legacyProfile) : null;
      envelope = createDefaultResumeEnvelope(normalizedLegacy);

      // In legacy profile, check if there was a custom name
      const customName = legacyProfile?.sections?.basic?.values?.["简历名称"];
      if (customName && typeof customName === "string" && customName.trim()) {
        envelope.profiles[envelope.activeProfileId].name = customName.trim();
      }

      assertInvariants(envelope);
      meta.migrationVersion = 1;

      await chrome.storage.local.set({
        [STORAGE_ENVELOPE_KEY]: envelope,
        [STORAGE_META_KEY]: meta,
        profileV2: envelope.profiles[envelope.activeProfileId].profileV2
      });

      isReadOnlyMode = false;
      readOnlyReason = "";
      return envelope;
    });
  },

  isReadOnly() {
    return isReadOnlyMode;
  },

  getReadOnlyReason() {
    return readOnlyReason;
  },

  async getEnvelope() {
    return enqueueOperation(async () => {
      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY] || null;
      return {
        envelope,
        isReadOnly: isReadOnlyMode,
        readOnlyReason
      };
    });
  },

  async getActiveSnapshot() {
    return enqueueOperation(async () => {
      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope || !envelope.profiles || !envelope.profiles[envelope.activeProfileId]) {
        return null;
      }
      const active = envelope.profiles[envelope.activeProfileId];
      return {
        profileId: active.id,
        name: active.name,
        revision: active.revision,
        stateRevision: envelope.stateRevision,
        profileV2: JSON.parse(JSON.stringify(active.profileV2))
      };
    });
  },

  async saveProfile(payload, normalizeProfileV2) {
    return enqueueOperation(async () => {
      if (isReadOnlyMode) {
        return { ok: false, error: PROTOCOL_ERRORS.READ_ONLY_MODE, reason: readOnlyReason };
      }

      const { operationId, profileId, baseProfileRevision, baseStateRevision, profileV2 } = payload;
      const requestHash = await computeRequestHash({ profileId, baseProfileRevision, baseStateRevision, profileV2 });

      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope) {
        return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };
      }

      // Idempotency check
      if (operationId && envelope.recentOperations?.[operationId]) {
        const cached = envelope.recentOperations[operationId];
        if (cached.requestHash !== requestHash) {
          return { ok: false, error: PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE };
        }
        return { ok: true, stateRevision: cached.stateRevision, deduplicated: true };
      }

      const targetProfile = envelope.profiles[profileId];
      if (!targetProfile) {
        return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };
      }

      // Conservative concurrency check
      if (envelope.stateRevision !== baseStateRevision || targetProfile.revision !== baseProfileRevision) {
        return {
          ok: false,
          error: PROTOCOL_ERRORS.CONFLICT,
          currentStateRevision: envelope.stateRevision,
          currentProfileRevision: targetProfile.revision
        };
      }

      // Apply mutation
      targetProfile.profileV2 = normalizeProfileV2(profileV2);
      targetProfile.updatedAt = new Date().toISOString();
      targetProfile.revision += 1;
      envelope.stateRevision += 1;
      envelope.envelopeRevision += 1;
      envelope.lastCommittedOperationId = operationId || "";

      // Trim & record idempotency
      recordOperation(envelope, operationId, requestHash);
      assertInvariants(envelope);

      const toSet = {
        [STORAGE_ENVELOPE_KEY]: envelope
      };
      if (envelope.activeProfileId === profileId) {
        toSet.profileV2 = targetProfile.profileV2;
      }

      await chrome.storage.local.set(toSet);
      return {
        ok: true,
        stateRevision: envelope.stateRevision,
        profileRevision: targetProfile.revision
      };
    });
  },

  async setActiveProfile(payload) {
    return enqueueOperation(async () => {
      if (isReadOnlyMode) {
        return { ok: false, error: PROTOCOL_ERRORS.READ_ONLY_MODE, reason: readOnlyReason };
      }

      const { operationId, profileId, baseStateRevision } = payload;
      const requestHash = await computeRequestHash({ profileId, baseStateRevision });

      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope) return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };

      if (operationId && envelope.recentOperations?.[operationId]) {
        const cached = envelope.recentOperations[operationId];
        if (cached.requestHash !== requestHash) {
          return { ok: false, error: PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE };
        }
        return { ok: true, stateRevision: cached.stateRevision, deduplicated: true };
      }

      if (!envelope.profiles[profileId]) {
        return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };
      }

      if (envelope.stateRevision !== baseStateRevision) {
        return {
          ok: false,
          error: PROTOCOL_ERRORS.CONFLICT,
          currentStateRevision: envelope.stateRevision
        };
      }

      envelope.activeProfileId = profileId;
      envelope.stateRevision += 1;
      envelope.envelopeRevision += 1;
      envelope.lastCommittedOperationId = operationId || "";

      recordOperation(envelope, operationId, requestHash);
      assertInvariants(envelope);

      await chrome.storage.local.set({
        [STORAGE_ENVELOPE_KEY]: envelope,
        profileV2: envelope.profiles[profileId].profileV2
      });

      return {
        ok: true,
        stateRevision: envelope.stateRevision,
        activeProfileId: profileId
      };
    });
  },

  async createProfile(payload, normalizeProfileV2) {
    return enqueueOperation(async () => {
      if (isReadOnlyMode) {
        return { ok: false, error: PROTOCOL_ERRORS.READ_ONLY_MODE, reason: readOnlyReason };
      }

      const { operationId, name, profileV2, setActive, baseStateRevision } = payload;
      const requestHash = await computeRequestHash({ name, profileV2, setActive, baseStateRevision });

      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope) return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };

      if (operationId && envelope.recentOperations?.[operationId]) {
        const cached = envelope.recentOperations[operationId];
        if (cached.requestHash !== requestHash) {
          return { ok: false, error: PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE };
        }
        return { ok: true, stateRevision: cached.stateRevision, deduplicated: true };
      }

      if (envelope.stateRevision !== baseStateRevision) {
        return {
          ok: false,
          error: PROTOCOL_ERRORS.CONFLICT,
          currentStateRevision: envelope.stateRevision
        };
      }

      const newId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `prof_${Date.now()}`;
      const cleanProfile = normalizeProfileV2(profileV2);
      const cleanName = (name && String(name).trim()) || "新简历";

      envelope.profiles[newId] = {
        id: newId,
        name: cleanName,
        revision: 1,
        updatedAt: new Date().toISOString(),
        profileV2: cleanProfile
      };
      envelope.profileOrder.push(newId);

      if (setActive) {
        envelope.activeProfileId = newId;
      }

      envelope.stateRevision += 1;
      envelope.envelopeRevision += 1;
      envelope.lastCommittedOperationId = operationId || "";

      recordOperation(envelope, operationId, requestHash);
      assertInvariants(envelope);

      const toSet = { [STORAGE_ENVELOPE_KEY]: envelope };
      if (setActive) {
        toSet.profileV2 = cleanProfile;
      }

      await chrome.storage.local.set(toSet);
      return {
        ok: true,
        profileId: newId,
        stateRevision: envelope.stateRevision
      };
    });
  },

  async deleteProfile(payload) {
    return enqueueOperation(async () => {
      if (isReadOnlyMode) {
        return { ok: false, error: PROTOCOL_ERRORS.READ_ONLY_MODE, reason: readOnlyReason };
      }

      const { operationId, profileId, baseStateRevision } = payload;
      const requestHash = await computeRequestHash({ profileId, baseStateRevision });

      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope) return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };

      if (operationId && envelope.recentOperations?.[operationId]) {
        const cached = envelope.recentOperations[operationId];
        if (cached.requestHash !== requestHash) {
          return { ok: false, error: PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE };
        }
        return { ok: true, stateRevision: cached.stateRevision, deduplicated: true };
      }

      if (!envelope.profiles[profileId]) {
        return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };
      }

      if (envelope.profileOrder.length <= 1) {
        return { ok: false, error: "CANNOT_DELETE_LAST_PROFILE" };
      }

      if (envelope.stateRevision !== baseStateRevision) {
        return {
          ok: false,
          error: PROTOCOL_ERRORS.CONFLICT,
          currentStateRevision: envelope.stateRevision
        };
      }

      // If activeProfileId is being deleted, compute next active
      const currentIndex = envelope.profileOrder.indexOf(profileId);
      delete envelope.profiles[profileId];
      envelope.profileOrder = envelope.profileOrder.filter((id) => id !== profileId);

      if (envelope.activeProfileId === profileId) {
        const nextIndex = currentIndex < envelope.profileOrder.length ? currentIndex : envelope.profileOrder.length - 1;
        envelope.activeProfileId = envelope.profileOrder[nextIndex];
      }

      envelope.stateRevision += 1;
      envelope.envelopeRevision += 1;
      envelope.lastCommittedOperationId = operationId || "";

      recordOperation(envelope, operationId, requestHash);
      assertInvariants(envelope);

      await chrome.storage.local.set({
        [STORAGE_ENVELOPE_KEY]: envelope,
        profileV2: envelope.profiles[envelope.activeProfileId].profileV2
      });

      return {
        ok: true,
        stateRevision: envelope.stateRevision,
        activeProfileId: envelope.activeProfileId
      };
    });
  },

  async renameProfile(payload) {
    return enqueueOperation(async () => {
      if (isReadOnlyMode) {
        return { ok: false, error: PROTOCOL_ERRORS.READ_ONLY_MODE, reason: readOnlyReason };
      }

      const { operationId, profileId, newName, baseStateRevision } = payload;
      const requestHash = await computeRequestHash({ profileId, newName, baseStateRevision });

      const data = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY]);
      const envelope = data[STORAGE_ENVELOPE_KEY];
      if (!envelope) return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };

      if (operationId && envelope.recentOperations?.[operationId]) {
        const cached = envelope.recentOperations[operationId];
        if (cached.requestHash !== requestHash) {
          return { ok: false, error: PROTOCOL_ERRORS.INVALID_OPERATION_ID_REUSE };
        }
        return { ok: true, stateRevision: cached.stateRevision, deduplicated: true };
      }

      const profile = envelope.profiles[profileId];
      if (!profile) return { ok: false, error: PROTOCOL_ERRORS.NOT_FOUND };

      if (envelope.stateRevision !== baseStateRevision) {
        return {
          ok: false,
          error: PROTOCOL_ERRORS.CONFLICT,
          currentStateRevision: envelope.stateRevision
        };
      }

      profile.name = String(newName || "").trim() || "未命名简历";
      profile.updatedAt = new Date().toISOString();
      envelope.stateRevision += 1;
      envelope.envelopeRevision += 1;
      envelope.lastCommittedOperationId = operationId || "";

      recordOperation(envelope, operationId, requestHash);
      assertInvariants(envelope);

      await chrome.storage.local.set({
        [STORAGE_ENVELOPE_KEY]: envelope
      });

      return {
        ok: true,
        stateRevision: envelope.stateRevision,
        profileId,
        newName: profile.name
      };
    });
  }
};

function recordOperation(envelope, operationId, requestHash) {
  if (!operationId) return;
  if (!envelope.recentOperations) {
    envelope.recentOperations = {};
  }
  envelope.recentOperations[operationId] = {
    requestHash,
    result: "COMMITTED",
    stateRevision: envelope.stateRevision,
    timestamp: Date.now()
  };

  // Limit recentOperations to 50 items
  const entries = Object.entries(envelope.recentOperations);
  if (entries.length > 50) {
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - 50);
    for (const [key] of toDelete) {
      delete envelope.recentOperations[key];
    }
  }
}
