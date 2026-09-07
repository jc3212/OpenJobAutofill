/**
 * OpenJobAutofill - Standard Resume Schema & Passthrough Protocol
 * 
 * Defines the 19 standard first-level sections, enforces schema assertion,
 * canonical normalization, and unknown field passthrough preservation.
 */

export const PROFILE_SCHEMA_VERSION = 2;

/**
 * The 19 standard first-level section definitions.
 * Sourced directly from options.js and frozen to prevent accidental mutation.
 */
export const STANDARD_SECTION_DEFINITIONS = Object.freeze({
  basic: Object.freeze({ key: "basic", title: "基本信息", kind: "simple" }),
  intention: Object.freeze({ key: "intention", title: "求职意向", kind: "repeat" }),
  education: Object.freeze({ key: "education", title: "教育经历", kind: "repeat" }),
  internship: Object.freeze({ key: "internship", title: "实习经历", kind: "repeat" }),
  work: Object.freeze({ key: "work", title: "工作经历", kind: "repeat" }),
  performance: Object.freeze({ key: "performance", title: "绩效考核", kind: "repeat" }),
  project: Object.freeze({ key: "project", title: "项目经历/实践活动", kind: "repeat" }),
  student: Object.freeze({ key: "student", title: "干部任职经历（在校职务）", kind: "repeat" }),
  awards: Object.freeze({ key: "awards", title: "奖惩情况", kind: "repeat" }),
  language: Object.freeze({ key: "language", title: "外语能力", kind: "repeat" }),
  computer: Object.freeze({ key: "computer", title: "计算机技能（IT技能）", kind: "repeat" }),
  certificates: Object.freeze({ key: "certificates", title: "证书", kind: "repeat" }),
  family: Object.freeze({ key: "family", title: "家庭情况", kind: "repeat" }),
  training: Object.freeze({ key: "training", title: "培训经历", kind: "repeat" }),
  papers: Object.freeze({ key: "papers", title: "论文和著作", kind: "repeat" }),
  patent: Object.freeze({ key: "patent", title: "专利", kind: "repeat" }),
  self: Object.freeze({ key: "self", title: "自我描述", kind: "simple" }),
  declarations: Object.freeze({ key: "declarations", title: "有关声明", kind: "simple" }),
  other: Object.freeze({ key: "other", title: "其他信息", kind: "simple" })
});

export const STANDARD_SECTION_KEYS = Object.freeze(Object.keys(STANDARD_SECTION_DEFINITIONS));

const STANDARD_SECTION_SET = new Set(STANDARD_SECTION_KEYS);
const KNOWN_TOP_LEVEL_KEYS = new Set(["schemaVersion", "updatedAt", "sections", "customSections", "__passthrough"]);

function isPlainObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function sanitizeText(str, maxLength = 120) {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, maxLength);
}

/**
 * Creates an empty canonical ProfileV2 with all 19 standard sections initialized.
 * @returns {object}
 */
export function createEmptyProfileV2() {
  const sections = {};
  for (const key of STANDARD_SECTION_KEYS) {
    const def = STANDARD_SECTION_DEFINITIONS[key];
    sections[key] = def.kind === "repeat"
      ? { key: def.key, title: def.title, kind: "repeat", items: [] }
      : { key: def.key, title: def.title, kind: "simple", values: {}, custom: [] };
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: "",
    sections,
    customSections: []
  };
}

/**
 * Asserts that a given profileV2 strictly satisfies schema constraints.
 * Throws an Error with a descriptive message if invalid.
 * 
 * @param {any} profileV2 
 */
export function assertProfileV2Schema(profileV2) {
  if (!isPlainObject(profileV2)) {
    throw new Error("Invalid ProfileV2: profile must be a non-null object");
  }
  if (profileV2.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new Error(`Invalid ProfileV2: schemaVersion must be ${PROFILE_SCHEMA_VERSION}, received ${profileV2.schemaVersion}`);
  }
  if (!isPlainObject(profileV2.sections)) {
    throw new Error("Invalid ProfileV2: sections must be a plain object");
  }

  for (const [key, section] of Object.entries(profileV2.sections)) {
    if (!isPlainObject(section)) {
      throw new Error(`Invalid ProfileV2: section '${key}' must be a plain object`);
    }
    const standardDef = STANDARD_SECTION_DEFINITIONS[key];
    if (standardDef && section.kind && section.kind !== standardDef.kind) {
      throw new Error(`Invalid ProfileV2: section '${key}' kind mismatch (expected '${standardDef.kind}', got '${section.kind}')`);
    }
    if (section.kind === "repeat") {
      if (section.items != null && !Array.isArray(section.items)) {
        throw new Error(`Invalid ProfileV2: repeat section '${key}' items must be an array`);
      }
    } else if (section.kind === "simple") {
      if (section.values != null && !isPlainObject(section.values)) {
        throw new Error(`Invalid ProfileV2: simple section '${key}' values must be an object`);
      }
      if (section.custom != null && !Array.isArray(section.custom)) {
        throw new Error(`Invalid ProfileV2: simple section '${key}' custom rows must be an array`);
      }
    }
  }

  if (profileV2.customSections != null && !Array.isArray(profileV2.customSections)) {
    throw new Error("Invalid ProfileV2: customSections must be an array");
  }
}

/**
 * Normalizes an arbitrary ProfileV2 into the canonical schema while preserving
 * unknown sections and top-level properties inside __passthrough.
 * 
 * @param {any} profileV2 
 * @returns {object} Canonical ProfileV2 with passthrough preservation
 */
export function normalizeProfileV2(profileV2) {
  if (!isPlainObject(profileV2)) {
    return createEmptyProfileV2();
  }

  const sourceSections = isPlainObject(profileV2.sections) ? profileV2.sections : {};
  const normalizedSections = {};
  const passthroughSections = {};
  const passthroughProps = {};

  // 1. Process standard 19 sections
  for (const key of STANDARD_SECTION_KEYS) {
    const def = STANDARD_SECTION_DEFINITIONS[key];
    const rawSec = sourceSections[key];

    if (!isPlainObject(rawSec)) {
      normalizedSections[key] = def.kind === "repeat"
        ? { key: def.key, title: def.title, kind: "repeat", items: [] }
        : { key: def.key, title: def.title, kind: "simple", values: {}, custom: [] };
      continue;
    }

    if (def.kind === "repeat") {
      const items = Array.isArray(rawSec.items)
        ? rawSec.items.map(normalizeRepeatItem).filter((item) => Object.keys(item.values).length > 0 || item.custom.length > 0)
        : [];
      normalizedSections[key] = {
        key: def.key,
        title: sanitizeText(rawSec.title || def.title, 120),
        kind: "repeat",
        items
      };
    } else {
      normalizedSections[key] = {
        key: def.key,
        title: sanitizeText(rawSec.title || def.title, 120),
        kind: "simple",
        values: normalizeValues(rawSec.values),
        custom: normalizeCustomRows(rawSec.custom)
      };
    }
  }

  // 2. Identify unknown/non-standard sections for passthrough
  for (const [key, rawSec] of Object.entries(sourceSections)) {
    if (!STANDARD_SECTION_SET.has(key)) {
      passthroughSections[key] = (typeof structuredClone === "function")
        ? structuredClone(rawSec)
        : JSON.parse(JSON.stringify(rawSec));
    }
  }

  // 3. Identify unknown top-level properties for passthrough
  for (const [propKey, propVal] of Object.entries(profileV2)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(propKey)) {
      passthroughProps[propKey] = (typeof structuredClone === "function")
        ? structuredClone(propVal)
        : JSON.parse(JSON.stringify(propVal));
    }
  }

  // 4. Merge existing __passthrough if present
  if (isPlainObject(profileV2.__passthrough)) {
    if (isPlainObject(profileV2.__passthrough.sections)) {
      Object.assign(passthroughSections, (typeof structuredClone === "function")
        ? structuredClone(profileV2.__passthrough.sections)
        : JSON.parse(JSON.stringify(profileV2.__passthrough.sections)));
    }
    if (isPlainObject(profileV2.__passthrough.properties)) {
      Object.assign(passthroughProps, (typeof structuredClone === "function")
        ? structuredClone(profileV2.__passthrough.properties)
        : JSON.parse(JSON.stringify(profileV2.__passthrough.properties)));
    }
  }

  // 5. Build canonical output
  const normalized = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: sanitizeText(profileV2.updatedAt || "", 80),
    sections: normalizedSections,
    customSections: Array.isArray(profileV2.customSections)
      ? profileV2.customSections.map(normalizeCustomSection).filter((s) => s.kind === "repeat" ? s.items.length > 0 : (Object.keys(s.values).length > 0 || s.custom.length > 0))
      : []
  };

  const hasPassthroughSections = Object.keys(passthroughSections).length > 0;
  const hasPassthroughProps = Object.keys(passthroughProps).length > 0;
  if (hasPassthroughSections || hasPassthroughProps) {
    normalized.__passthrough = {
      sections: passthroughSections,
      properties: passthroughProps
    };
  }

  return normalized;
}

/**
 * Restores passthrough sections and properties back onto a profileV2 object.
 * Essential before saving or exporting to guarantee zero data loss.
 * 
 * @param {object} profileV2 
 * @returns {object} ProfileV2 with passthrough restored
 */
export function restorePassthrough(profileV2) {
  if (!isPlainObject(profileV2)) return profileV2;
  const output = (typeof structuredClone === "function")
    ? structuredClone(profileV2)
    : JSON.parse(JSON.stringify(profileV2));

  const passthrough = output.__passthrough;
  if (!isPlainObject(passthrough)) {
    return output;
  }

  // Restore unknown sections
  if (isPlainObject(passthrough.sections)) {
    if (!isPlainObject(output.sections)) {
      output.sections = {};
    }
    for (const [k, v] of Object.entries(passthrough.sections)) {
      if (!output.sections[k]) {
        output.sections[k] = v;
      }
    }
  }

  // Restore unknown top-level properties
  if (isPlainObject(passthrough.properties)) {
    for (const [k, v] of Object.entries(passthrough.properties)) {
      if (!(k in output)) {
        output[k] = v;
      }
    }
  }

  return output;
}

function normalizeRepeatItem(item = {}) {
  return {
    title: sanitizeText(item.title || "", 120),
    values: normalizeValues(item.values),
    custom: normalizeCustomRows(item.custom)
  };
}

function normalizeCustomSection(section = {}, index = 0) {
  const isRepeat = section.kind === "repeat";
  if (isRepeat) {
    const items = Array.isArray(section.items)
      ? section.items.map(normalizeRepeatItem).filter((item) => Object.keys(item.values).length > 0 || item.custom.length > 0)
      : [];
    return {
      key: sanitizeText(section.key || `custom-${index}`, 80),
      title: sanitizeText(section.title || "自定义资料", 120),
      kind: "repeat",
      items
    };
  }
  return {
    key: sanitizeText(section.key || `custom-${index}`, 80),
    title: sanitizeText(section.title || "自定义资料", 120),
    kind: "simple",
    values: normalizeValues(section.values),
    custom: normalizeCustomRows(section.custom)
  };
}

function normalizeValues(values) {
  const result = {};
  if (!isPlainObject(values)) return result;

  for (const [k, v] of Object.entries(values)) {
    const cleanKey = sanitizeText(k, 120);
    const cleanVal = String(v == null ? "" : v).trim();
    if (cleanKey && cleanVal) {
      result[cleanKey] = cleanVal;
    }
  }
  return result;
}

function normalizeCustomRows(rows) {
  if (!Array.isArray(rows)) return [];
  const result = [];

  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const cleanLabel = sanitizeText(row.label || "", 120);
    const cleanValue = String(row.value == null ? "" : row.value).trim();
    if (cleanLabel && cleanValue) {
      result.push({ label: cleanLabel, value: cleanValue });
    }
  }
  return result;
}
