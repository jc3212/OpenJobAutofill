/**
 * OpenJobAutofill - Core Protocol & Invariant Helpers
 */

export const PROTOCOL_ERRORS = {
  DEPRECATED_WRITE_PROTOCOL: "DEPRECATED_WRITE_PROTOCOL",
  CONFLICT: "CONFLICT",
  INVALID_OPERATION_ID_REUSE: "INVALID_OPERATION_ID_REUSE",
  OPERATION_UNKNOWN: "OPERATION_UNKNOWN",
  NOT_FOUND: "NOT_FOUND",
  READ_ONLY_MODE: "READ_ONLY_MODE"
};

export const STORAGE_ENVELOPE_KEY = "resumeEnvelope";
export const STORAGE_META_KEY = "storageMeta";

export const MESSAGE_TYPES = Object.freeze({
  GET_SETTINGS: "OJAF_GET_SETTINGS",
  SAVE_SETTINGS: "OJAF_SAVE_SETTINGS",
  CLEAR_SETTINGS: "OJAF_CLEAR_SETTINGS",
  GET_ENVELOPE: "OJAF_GET_ENVELOPE",
  GET_ACTIVE_PROFILE_SNAPSHOT: "OJAF_GET_ACTIVE_PROFILE_SNAPSHOT",
  SAVE_PROFILE: "OJAF_SAVE_PROFILE",
  SET_ACTIVE_PROFILE: "OJAF_SET_ACTIVE_PROFILE",
  CREATE_PROFILE: "OJAF_CREATE_PROFILE",
  DELETE_PROFILE: "OJAF_DELETE_PROFILE",
  RENAME_PROFILE: "OJAF_RENAME_PROFILE",
  PARSE_RESUME_WITH_AI: "OJAF_PARSE_RESUME_WITH_AI",
  OPEN_OPTIONS: "OJAF_OPEN_OPTIONS",
  MAP_FIELDS: "OJAF_MAP_FIELDS",
  ANALYZE_PAGE_STRUCTURE: "OJAF_ANALYZE_PAGE_STRUCTURE",
  SAVE_PROFILE_PANEL_STATE: "OJAF_SAVE_PROFILE_PANEL_STATE",
  GET_PROFILE_PANEL_STATE: "OJAF_GET_PROFILE_PANEL_STATE",
  LIST_MODELS: "OJAF_LIST_MODELS",
  TEST_CONNECTION: "OJAF_TEST_CONNECTION",
  GET_UPDATE_STATUS: "OJAF_GET_UPDATE_STATUS",
  CHECK_FOR_UPDATE: "OJAF_CHECK_FOR_UPDATE",
  OPEN_UPDATE_PAGE: "OJAF_OPEN_UPDATE_PAGE"
});

export function createDefaultResumeEnvelope(initialProfile = null) {
  const defaultId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "profile_default";
  const now = new Date().toISOString();
  
  const baseProfile = initialProfile || {
    schemaVersion: 2,
    updatedAt: now,
    sections: {},
    customSections: []
  };

  return {
    schemaVersion: 1,
    envelopeRevision: 1,
    stateRevision: 1,
    lastCommittedOperationId: "",
    activeProfileId: defaultId,
    profileOrder: [defaultId],
    profiles: {
      [defaultId]: {
        id: defaultId,
        name: "默认简历",
        revision: 1,
        updatedAt: now,
        profileV2: baseProfile
      }
    },
    recentOperations: {}
  };
}

/**
 * Validates the 5 mandatory state invariants.
 * Throws error if any invariant is violated.
 */
export function assertInvariants(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Invariant Violation: resumeEnvelope is not a valid object");
  }

  // Invariant 1: profiles must be non-empty object and have at least 1 profile
  if (!envelope.profiles || typeof envelope.profiles !== "object" || Object.keys(envelope.profiles).length === 0) {
    throw new Error("Invariant Violation: profiles must contain at least 1 profile");
  }

  // Invariant 2: activeProfileId must exist in profiles
  if (!envelope.activeProfileId || !envelope.profiles[envelope.activeProfileId]) {
    throw new Error(`Invariant Violation: activeProfileId (${envelope.activeProfileId}) not found in profiles`);
  }

  // Invariant 3: profileOrder must be 1:1 bijective match with profiles keys
  const profileKeys = Object.keys(envelope.profiles);
  const orderList = Array.isArray(envelope.profileOrder) ? envelope.profileOrder : [];
  if (orderList.length !== profileKeys.length) {
    throw new Error(`Invariant Violation: profileOrder length (${orderList.length}) !== profiles count (${profileKeys.length})`);
  }
  const orderSet = new Set(orderList);
  for (const key of profileKeys) {
    if (!orderSet.has(key)) {
      throw new Error(`Invariant Violation: profile key (${key}) missing from profileOrder`);
    }
  }

  // Invariant 4: stateRevision and each profile.revision must be positive integers
  if (!Number.isInteger(envelope.stateRevision) || envelope.stateRevision < 1) {
    throw new Error(`Invariant Violation: stateRevision (${envelope.stateRevision}) must be a positive integer`);
  }
  for (const [id, prof] of Object.entries(envelope.profiles)) {
    if (!Number.isInteger(prof.revision) || prof.revision < 1) {
      throw new Error(`Invariant Violation: profile [${id}].revision (${prof.revision}) must be a positive integer`);
    }
  }

  return true;
}

/**
 * Computes a SHA-256 hash string for an operation payload to detect tampering on duplicate operationId.
 */
export async function computeRequestHash(payload) {
  try {
    const raw = JSON.stringify(payload || {});
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    let hash = 0;
    const str = JSON.stringify(payload || "");
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }
}
