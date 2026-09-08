/**
 * OpenJobAutofill - AI Section Normalizer & Resilience Engine
 * 
 * Provides robust extraction, polymorphism unwrapping, alias resolution,
 * and canonical structure normalization for AI resume parse outputs.
 */

import {
  STANDARD_SECTION_DEFINITIONS,
  STANDARD_SECTION_KEYS
} from "./resume-schema.js";
import { normalizeAiFieldAliases } from "./profile-reconciler.js";
import {
  isHtmlResponse,
  createHtmlResponseError
} from "./endpoint-validator.js";

/**
 * Clean prototype pollution recursively up to depth 6.
 * Strips __proto__, constructor, and prototype.
 * 
 * @param {any} obj 
 * @param {number} depth 
 * @returns {any}
 */
export function cleanPrototypePollution(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanPrototypePollution(item, depth + 1));
  }
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    clean[key] = cleanPrototypePollution(value, depth + 1);
  }
  return clean;
}

/**
 * Comprehensive mapping from common AI aliases (Chinese and English variants)
 * to canonical ProfileV2 section keys.
 */
export const SECTION_ALIAS_MAP = Object.freeze({
  // education
  "教育经历": "education",
  "教育背景": "education",
  "教育信息": "education",
  "教育": "education",
  "学历信息": "education",
  "学历经历": "education",
  "最高学历": "education",
  "education_experience": "education",
  "education_background": "education",
  "education_history": "education",
  "educations": "education",
  "edu": "education",

  // work
  "工作经历": "work",
  "工作经验": "work",
  "职业经历": "work",
  "工作历史": "work",
  "工作": "work",
  "work_experience": "work",
  "work_history": "work",
  "jobs": "work",
  "employment": "work",
  "career": "work",
  "works": "work",

  // internship
  "实习经历": "internship",
  "实习经验": "internship",
  "实习": "internship",
  "internship_experience": "internship",
  "internships": "internship",
  "intern": "internship",

  // project
  "项目经历": "project",
  "项目经验": "project",
  "项目经历/实践活动": "project",
  "实践活动": "project",
  "项目": "project",
  "project_experience": "project",
  "projects": "project",

  // computer / skills
  "计算机技能": "computer",
  "计算机技能（it技能）": "computer",
  "计算机能力": "computer",
  "it技能": "computer",
  "专业技能": "computer",
  "技能特长": "computer",
  "专业技能/it技能": "computer",
  "技能": "computer",
  "技术栈": "computer",
  "skills": "computer",
  "skill": "computer",
  "it_skills": "computer",
  "computer_skills": "computer",
  "tech_skills": "computer",

  // language
  "外语能力": "language",
  "语言能力": "language",
  "外语水平": "language",
  "语言水平": "language",
  "英语能力": "language",
  "外语": "language",
  "language_ability": "language",
  "languages": "language",
  "language_skills": "language",

  // awards
  "奖惩情况": "awards",
  "奖励荣誉": "awards",
  "荣誉奖励": "awards",
  "获奖经历": "awards",
  "所获荣誉": "awards",
  "荣誉": "awards",
  "奖项": "awards",
  "awards_and_punishments": "awards",
  "awards_and_honors": "awards",
  "honors": "awards",
  "awards": "awards",
  "prizes": "awards",

  // certificates
  "证书": "certificates",
  "资格证书": "certificates",
  "职业资格": "certificates",
  "certification": "certificates",
  "certifications": "certificates",
  "certs": "certificates",

  // self
  "自我描述": "self",
  "自我评价": "self",
  "个人评价": "self",
  "个人总结": "self",
  "自我总结": "self",
  "self_evaluation": "self",
  "self_assessment": "self",
  "summary": "self",
  "self_description": "self",

  // intention
  "求职意向": "intention",
  "求职期望": "intention",
  "期望职位": "intention",
  "意向": "intention",
  "job_intention": "intention",
  "career_objective": "intention",
  "objective": "intention",

  // student
  "干部任职经历（在校职务）": "student",
  "干部任职经历": "student",
  "学生干部经历": "student",
  "在校职务": "student",
  "校园经历": "student",
  "校内职务": "student",
  "student_cadre": "student",

  // training
  "培训经历": "training",
  "培训": "training",
  "training_experience": "training",
  "trainings": "training",

  // papers
  "论文和著作": "papers",
  "论文著作": "papers",
  "学术论文": "papers",
  "论文": "papers",
  "出版物": "papers",
  "papers": "papers",
  "publications": "papers",

  // patent
  "专利": "patent",
  "发明专利": "patent",
  "patents": "patent",

  // family
  "家庭情况": "family",
  "家庭成员": "family",
  "家庭背景": "family",
  "family": "family",

  // performance
  "绩效考核": "performance",
  "绩效": "performance",
  "performance": "performance"
});

/**
 * Resilient JSON repair engine:
 * 1. Strips JS single-line (//) and multi-line (/* *\/) comments outside strings
 * 2. Normalizes single-quoted strings and keys
 * 3. Eliminates trailing commas before } and ]
 * 4. Escapes literal unescaped control characters (\n, \r, \t) inside string literals
 * 5. Closes truncated strings and missing closing braces/brackets
 * 
 * @param {string} text 
 * @returns {any}
 */
export function repairJson(text) {
  if (typeof text !== "string") return null;
  const str = text.trim();
  if (!str) return null;

  try {
    return JSON.parse(str);
  } catch {}

  let result = "";
  let inString = false;
  let quoteChar = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  const bracketStack = [];

  const len = str.length;
  for (let i = 0; i < len; i++) {
    const char = str[i];
    const nextChar = i + 1 < len ? str[i + 1] : "";

    // Handle comments
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inString) {
      // Start of comments
      if (char === "/" && nextChar === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
        i++;
        continue;
      }

      // Check strings (double or single quotes)
      if (char === '"' || char === "'") {
        inString = true;
        quoteChar = char;
        result += '"';
        continue;
      }

      // Track brackets
      if (char === "{") {
        bracketStack.push("}");
        result += char;
        continue;
      }
      if (char === "[") {
        bracketStack.push("]");
        result += char;
        continue;
      }
      if (char === "}" || char === "]") {
        if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1] === char) {
          bracketStack.pop();
        }
        result += char;
        continue;
      }

      // Trailing comma check
      if (char === ",") {
        let peek = i + 1;
        while (peek < len && /\s/.test(str[peek])) {
          peek++;
        }
        if (peek < len && (str[peek] === "}" || str[peek] === "]")) {
          continue;
        }
        result += char;
        continue;
      }

      result += char;
    } else {
      // Inside string
      if (escaped) {
        escaped = false;
        result += char;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        result += char;
        continue;
      }

      if (char === quoteChar) {
        inString = false;
        quoteChar = null;
        result += '"';
        continue;
      }

      if (quoteChar === "'" && char === '"') {
        result += '\\"';
        continue;
      }

      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }

      result += char;
    }
  }

  if (inString) {
    result += '"';
  }

  while (bracketStack.length > 0) {
    result += bracketStack.pop();
  }

  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function safeJsonParse(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  try {
    return repairJson(trimmed);
  } catch {
    return null;
  }
}

/**
 * Evaluates candidate likelihood of representing resume sections.
 * Used to prioritize the best JSON candidate from noisy outputs.
 */
function scoreJsonCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return -1;
  let score = 1;

  if (candidate.sections && typeof candidate.sections === "object") {
    score += 15;
  }
  if (candidate.data?.sections || candidate.result?.sections || candidate.response?.sections || candidate.resume?.sections) {
    score += 12;
  }
  if (candidate.data || candidate.result || candidate.response || candidate.resume || candidate.output || candidate.profile) {
    score += 3;
  }

  const keys = Array.isArray(candidate)
    ? candidate.flatMap((el) => {
        if (!el || typeof el !== "object") return [];
        return [el.key, el.title, el.sectionKey, el.name, el.section, ...Object.keys(el)].filter(Boolean);
      })
    : Object.keys(candidate);

  for (const k of keys) {
    const resolved = resolveSectionKey(k);
    if (resolved && resolved !== "other" && STANDARD_SECTION_DEFINITIONS[resolved]) {
      score += 5;
    }
  }

  return score;
}

/**
 * Searches for all balanced JSON candidate objects ({...}) or arrays ([...]) in text.
 * Returns the best candidate that parses to an object/array containing resume sections.
 */
function extractBalancedJson(text) {
  if (typeof text !== "string") return null;

  const candidates = [];
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const startChar = text[i];
    if (startChar !== "{" && startChar !== "[") {
      continue;
    }

    const opener = startChar;
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = -1;

    for (let j = i; j < len; j++) {
      const char = text[j];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === opener) {
        depth += 1;
      } else if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          endIndex = j;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      const slice = text.slice(i, endIndex + 1);
      const parsed = safeJsonParse(slice);
      if (parsed && typeof parsed === "object") {
        const score = scoreJsonCandidate(parsed);
        candidates.push({ parsed, score });
        if (score >= 10) {
          return parsed;
        }
      }
    } else if (depth > 0) {
      // Handles truncated JSON reaching EOF: attempt resilient repair parse
      const slice = text.slice(i);
      const parsed = safeJsonParse(slice);
      if (parsed && typeof parsed === "object") {
        const score = scoreJsonCandidate(parsed);
        candidates.push({ parsed, score });
        if (score >= 10) {
          return parsed;
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].parsed;
  }

  return null;
}

/**
 * Cleans thinking tags, code blocks, and extracts a parsed JSON structure.
 * 
 * @param {string|object} rawAiResult 
 * @returns {any}
 */
/**
 * Cleans thinking tags, code blocks, and extracts a parsed JSON structure.
 * 
 * @param {string|object} rawAiResult 
 * @returns {any}
 */
export function cleanAndExtractJson(rawAiResult) {
  if (rawAiResult && typeof rawAiResult === "object") {
    return cleanPrototypePollution(rawAiResult);
  }

  const rawStr = String(rawAiResult || "").trim();
  const snippet = rawStr.slice(0, 150);

  if (!rawStr) {
    throw new Error(`AI 返回的内容为空，缺少有效 sections 结构。响应摘要: ${snippet}`);
  }

  if (isHtmlResponse(null, rawStr)) {
    throw createHtmlResponseError(rawStr);
  }

  // 1. Remove closed <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning> tags
  let cleaned = rawStr
    .replace(/<(?:think|thought|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|thought|reasoning)>/gi, "")
    .trim();

  // 2. Remove orphan leading reasoning ending in </think>, </thought>, </reasoning>
  cleaned = cleaned.replace(/^[\s\S]*?<\/(?:think|thought|reasoning)>/i, "").trim();

  // 3. Remove unclosed <think>... residues if present
  if (/<(?:think|thought|reasoning)\b[^>]*>/i.test(cleaned)) {
    // If followed by a markdown code block, remove think prefix up to ```
    if (/```/i.test(cleaned)) {
      cleaned = cleaned.replace(/<(?:think|thought|reasoning)\b[^>]*>[\s\S]*?(?=```)/i, "").trim();
    }
    // If followed by { or [, remove the think prefix up to the opener
    cleaned = cleaned.replace(/<(?:think|thought|reasoning)\b[^>]*>[\s\S]*?(?=[{\[])/i, "").trim();
    // If still present without { or [ after it, strip to end
    cleaned = cleaned.replace(/<(?:think|thought|reasoning)\b[^>]*>[\s\S]*$/i, "").trim();
  }

  // 4. Try direct JSON parse on cleaned text
  const directParsed = safeJsonParse(cleaned);
  if (directParsed && typeof directParsed === "object") {
    return cleanPrototypePollution(directParsed);
  }

  // 5. Try extracting from markdown code block (support any language identifier: json, js, javascript, json5, etc.)
  const codeBlockMatches = [...cleaned.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)(?:```|$)/gi)];
  let bestCodeBlockParsed = null;
  let bestCodeBlockScore = -1;

  for (const match of codeBlockMatches) {
    const blockContent = match[1].trim();
    if (!blockContent) continue;
    const parsed = safeJsonParse(blockContent);
    if (parsed && typeof parsed === "object") {
      const score = scoreJsonCandidate(parsed);
      if (score > bestCodeBlockScore) {
        bestCodeBlockScore = score;
        bestCodeBlockParsed = parsed;
      }
    }
  }

  if (bestCodeBlockParsed) {
    return cleanPrototypePollution(bestCodeBlockParsed);
  }

  // 6. Balanced brackets JSON extraction
  const balancedParsed = extractBalancedJson(cleaned);
  if (balancedParsed && typeof balancedParsed === "object") {
    return cleanPrototypePollution(balancedParsed);
  }

  throw new Error(`AI 返回的内容不是有效的 JSON 结构: ${snippet}`);
}

/**
 * Checks if an object directly contains any known resume section keys or aliases.
 */
function hasAnyExperienceKey(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  for (const k of Object.keys(obj)) {
    const resolved = resolveSectionKey(k);
    if (resolved && resolved !== "other" && STANDARD_SECTION_DEFINITIONS[resolved]) {
      return true;
    }
  }
  return false;
}

/**
 * Infers a section key from field names when an item has no explicit section key or title.
 */
function inferSectionKeyFromItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const keys = Object.keys(item);
  for (const k of keys) {
    const lk = k.toLowerCase().replace(/[-_\s]+/g, "");
    if (/学校|毕业|学历|专业|school|university|college|degree|major|gpa/i.test(lk)) return "education";
    if (/公司|企业|单位|职位|岗位|company|employer|position|jobtitle/i.test(lk)) return "work";
    if (/项目|实践|project|projectname/i.test(lk)) return "project";
    if (/技能|skill|technology|tech/i.test(lk)) return "computer";
    if (/外语|语种|语言|language|toefl|ielts|cet/i.test(lk)) return "language";
    if (/奖惩|奖励|荣誉|奖项|award|honor|prize/i.test(lk)) return "awards";
    if (/证书|资质|执照|certificate|certification/i.test(lk)) return "certificates";
    if (/自我评价|自我描述|个人评价|个人总结|summary|bio/i.test(lk)) return "self";
    if (/求职意向|期望职位|期望城市|intention|objective/i.test(lk)) return "intention";
  }
  return null;
}

/**
 * Merges a newly encountered section item or array into an existing section dictionary entry.
 */
function mergeSectionItem(existing, newVal) {
  if (Array.isArray(existing)) {
    if (Array.isArray(newVal)) {
      existing.push(...newVal);
    } else if (newVal?.items && Array.isArray(newVal.items)) {
      existing.push(...newVal.items);
    } else {
      existing.push(newVal);
    }
    return existing;
  }

  if (existing && typeof existing === "object") {
    if (Array.isArray(existing.items)) {
      if (Array.isArray(newVal)) {
        existing.items.push(...newVal);
      } else if (newVal?.items && Array.isArray(newVal.items)) {
        existing.items.push(...newVal.items);
      } else if (newVal && typeof newVal === "object") {
        existing.items.push(newVal);
      }
      return existing;
    }

    if (existing.values && typeof existing.values === "object") {
      const newVals = newVal?.values && typeof newVal.values === "object" ? newVal.values : (typeof newVal === "object" ? newVal : {});
      existing.values = { ...existing.values, ...newVals };
      return existing;
    }
  }

  return newVal;
}

/**
 * Maps an array of section items to a dictionary keyed by element key or title.
 * Resiliently handles:
 * - Items with explicit key/title/name properties
 * - Items that are single-section dictionaries: { "education": [...] }
 * - Items with experience fields directly: { "学校": "北大" }
 * - Merges multiple items with the same section key
 */
function arrayToSectionsDict(arr) {
  const dict = {};

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;

    // 1. Explicit section key/title property
    const explicitKey = item.key || item.sectionKey || item.title || item.name || item.section || item.section_name || item.sectionTitle || item.sectionName;
    if (explicitKey && typeof explicitKey === "string") {
      const resolved = resolveSectionKey(explicitKey) || explicitKey.trim();
      if (dict[resolved]) {
        dict[resolved] = mergeSectionItem(dict[resolved], item);
      } else {
        dict[resolved] = item;
      }
      continue;
    }

    // 2. Dictionary where keys are section names: { "education": [...] } or { "工作经历": [...] }
    let hasSectionKey = false;
    for (const [k, v] of Object.entries(item)) {
      const resolved = resolveSectionKey(k);
      if (resolved && resolved !== "other" && STANDARD_SECTION_DEFINITIONS[resolved]) {
        hasSectionKey = true;
        if (dict[resolved]) {
          dict[resolved] = mergeSectionItem(dict[resolved], v);
        } else {
          dict[resolved] = v;
        }
      }
    }
    if (hasSectionKey) {
      continue;
    }

    // 3. Item itself contains experience fields directly: e.g. { "学校": "北大" }
    const inferredKey = inferSectionKeyFromItem(item);
    if (inferredKey) {
      if (dict[inferredKey]) {
        dict[inferredKey] = mergeSectionItem(dict[inferredKey], item);
      } else {
        dict[inferredKey] = [item];
      }
    }
  }

  return dict;
}

/**
 * Unwraps nested wrapper layers (data, result, response, resume, sections).
 * 
 * @param {any} safeObj 
 * @param {number} depth 
 * @returns {object}
 */
export function unwrapSections(safeObj, depth = 0) {
  if (depth > 6 || !safeObj || typeof safeObj !== "object") {
    return safeObj;
  }

  // Array of sections -> dict
  if (Array.isArray(safeObj)) {
    return arrayToSectionsDict(safeObj);
  }

  // safeObj.sections exists
  if (safeObj.sections && typeof safeObj.sections === "object") {
    return unwrapSections(safeObj.sections, depth + 1);
  }

  // Recursive wrapper check
  const wrapperKeys = ["data", "result", "response", "resume", "output", "payload", "profile"];
  for (const wKey of wrapperKeys) {
    if (safeObj[wKey] && typeof safeObj[wKey] === "object") {
      const inner = safeObj[wKey];
      if (inner.sections && typeof inner.sections === "object") {
        return unwrapSections(inner.sections, depth + 1);
      }
      if (Array.isArray(inner) || hasAnyExperienceKey(inner)) {
        return unwrapSections(inner, depth + 1);
      }
      if (wrapperKeys.some((k) => inner[k] && typeof inner[k] === "object")) {
        return unwrapSections(inner, depth + 1);
      }
    }
  }

  return safeObj;
}

/**
 * Resolves a raw section key/title to a canonical standard section key.
 * 
 * @param {string} rawKey 
 * @returns {string}
 */
export function resolveSectionKey(rawKey) {
  if (typeof rawKey !== "string") return "";
  const trimmed = rawKey.trim();
  if (STANDARD_SECTION_DEFINITIONS[trimmed]) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (STANDARD_SECTION_DEFINITIONS[lower]) {
    return lower;
  }
  if (SECTION_ALIAS_MAP[trimmed]) {
    return SECTION_ALIAS_MAP[trimmed];
  }
  if (SECTION_ALIAS_MAP[lower]) {
    return SECTION_ALIAS_MAP[lower];
  }
  const clean = lower.replace(/[-_\s]+/g, "");
  if (SECTION_ALIAS_MAP[clean]) {
    return SECTION_ALIAS_MAP[clean];
  }
  return null;
}

/**
 * Normalizes section keys and canonical ProfileV2 structures.
 * 
 * @param {object} unwrapped 
 * @returns {object}
 */
export function normalizeSections(unwrapped) {
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return {};
  }

  const normalizedSections = {};

  for (const [rawKey, rawVal] of Object.entries(unwrapped)) {
    if (rawVal == null) continue;
    let normKey = resolveSectionKey(rawKey);
    if (!normKey) {
      if (rawVal && typeof rawVal === "object" && (rawVal.kind === "repeat" || rawVal.kind === "simple")) {
        normKey = rawKey.trim();
      } else {
        continue;
      }
    }

    const standardDef = STANDARD_SECTION_DEFINITIONS[normKey];
    const isRepeat = standardDef
      ? standardDef.kind === "repeat"
      : (Array.isArray(rawVal) || Array.isArray(rawVal?.items) || rawVal?.kind === "repeat");
    const title = standardDef?.title || rawVal?.title || rawKey;

    if (isRepeat) {
      let rawItems = [];
      if (Array.isArray(rawVal)) {
        rawItems = rawVal;
      } else if (Array.isArray(rawVal?.items)) {
        rawItems = rawVal.items;
      } else if (rawVal?.items && typeof rawVal.items === "object") {
        rawItems = [rawVal.items];
      } else if (rawVal && typeof rawVal === "object") {
        rawItems = [rawVal];
      }

      const normalizedItems = [];
      for (const item of rawItems) {
        if (!item) continue;

        let valuesObj = {};
        let customArr = [];
        let itemTitle = "";

        if (typeof item === "string") {
          itemTitle = item;
          valuesObj = { [standardDef?.title || "内容"]: item };
        } else if (typeof item === "object") {
          itemTitle = item.title || "";
          if (item.values && typeof item.values === "object" && !Array.isArray(item.values)) {
            valuesObj = { ...item.values };
            customArr = Array.isArray(item.custom) ? [...item.custom] : [];
          } else {
            // Flat item where item itself contains the fields
            valuesObj = { ...item };
            delete valuesObj.key;
            delete valuesObj.title;
            delete valuesObj.kind;
            delete valuesObj.items;
            delete valuesObj.custom;
            customArr = Array.isArray(item.custom) ? [...item.custom] : [];
          }
        }

        // Ensure string values for scalar fields
        for (const [k, v] of Object.entries(valuesObj)) {
          if (v != null && typeof v !== "object") {
            valuesObj[k] = String(v).trim();
          }
        }

        // Section-specific field normalization
        if (normKey === "computer") {
          const skillName = valuesObj["技能名称"] || valuesObj["技能"] || valuesObj["name"] || valuesObj["IT技能"] || valuesObj["证书名称"];
          if (skillName && !valuesObj["证书名称（技能名称）"]) {
            valuesObj["证书名称（技能名称）"] = skillName;
          }
          const level = valuesObj["熟练程度"] || valuesObj["掌握程度"] || valuesObj["level"];
          if (level && !valuesObj["掌握程度"]) {
            valuesObj["掌握程度"] = level;
          }
        }

        // General AI field aliases (bilingual)
        valuesObj = normalizeAiFieldAliases(normKey, valuesObj);

        normalizedItems.push({
          title: itemTitle,
          values: valuesObj,
          custom: customArr
        });
      }

      if (normalizedSections[normKey]) {
        normalizedSections[normKey].items.push(...normalizedItems);
      } else {
        normalizedSections[normKey] = {
          key: normKey,
          title,
          kind: "repeat",
          items: normalizedItems
        };
      }
    } else {
      // Simple section (self, basic, declarations, other)
      let valuesObj = {};
      let customArr = Array.isArray(rawVal?.custom) ? [...rawVal.custom] : [];

      if (typeof rawVal === "string") {
        valuesObj = {
          [normKey === "self" ? "自我评价" : (standardDef?.title || "内容")]: rawVal.trim()
        };
      } else if (Array.isArray(rawVal)) {
        const strings = [];
        for (const el of rawVal) {
          if (typeof el === "string") {
            strings.push(el.trim());
          } else if (el && typeof el === "object") {
            const innerVal = el.values && typeof el.values === "object" ? el.values : el;
            for (const [k, v] of Object.entries(innerVal)) {
              if (k === "key" || k === "title" || k === "kind" || k === "custom" || k === "items") continue;
              if (v != null) {
                const strV = typeof v === "object" ? JSON.stringify(v) : String(v).trim();
                if (strV) {
                  valuesObj[k] = valuesObj[k] ? `${valuesObj[k]}\n${strV}` : strV;
                }
              }
            }
          }
        }
        if (strings.length > 0) {
          const joined = strings.join("\n");
          valuesObj[normKey === "self" ? "自我评价" : (standardDef?.title || "内容")] = joined;
        }
      } else if (rawVal && typeof rawVal === "object") {
        let sourceValues = null;
        if (Array.isArray(rawVal.items) && rawVal.items.length > 0) {
          const first = rawVal.items[0];
          sourceValues = first?.values && typeof first.values === "object" ? first.values : first;
        } else if (rawVal.values && typeof rawVal.values === "object" && !Array.isArray(rawVal.values)) {
          sourceValues = rawVal.values;
        } else {
          sourceValues = rawVal;
        }

        if (sourceValues && typeof sourceValues === "object") {
          for (const [k, v] of Object.entries(sourceValues)) {
            if (k === "key" || k === "title" || k === "kind" || k === "custom" || k === "items") continue;
            if (v != null) {
              valuesObj[k] = typeof v === "object" ? JSON.stringify(v) : String(v).trim();
            }
          }
        }
      }

      if (normKey === "self") {
        const selfVal = valuesObj["自我评价"] || valuesObj["自我描述"] || valuesObj["个人评价"] || valuesObj["个人总结"] || valuesObj["自我总结"] || valuesObj["summary"] || valuesObj["evaluation"] || valuesObj["content"] || valuesObj["intro"];
        if (selfVal) {
          valuesObj["自我评价"] = selfVal;
        }
      }

      if (normalizedSections[normKey]) {
        normalizedSections[normKey].values = { ...normalizedSections[normKey].values, ...valuesObj };
      } else {
        normalizedSections[normKey] = {
          key: normKey,
          title,
          kind: "simple",
          values: valuesObj,
          custom: customArr
        };
      }
    }
  }

  return normalizedSections;
}

/**
 * End-to-end resilient AI resume section extractor and normalizer.
 * 
 * Steps:
 * 1. Deep text cleaning: strips thinking chains (<think>), code blocks, parses balanced JSON.
 * 2. Structure polymorphic unwrap: unwraps data/result/response/sections wrappers and arrays.
 * 3. Canonical normalization: maps aliases, wraps flat items into standard repeat/simple sections.
 * 4. Experience validation: ensures non-empty structured experience exists.
 * 5. Diagnostic feedback: provides responsive snippet upon failure.
 * 
 * @param {string|object} rawAiResult 
 * @returns {object} Normalized sections object
 */
export function extractAndNormalizeAiSections(rawAiResult) {
  const snippet = typeof rawAiResult === "string"
    ? rawAiResult.trim().slice(0, 150)
    : JSON.stringify(rawAiResult || {}).slice(0, 150);

  // 1. Clean & Extract JSON
  const parsed = cleanAndExtractJson(rawAiResult);
  const safeObj = cleanPrototypePollution(parsed);

  if (!safeObj || typeof safeObj !== "object") {
    throw new Error(`AI 返回的结果缺少有效 sections 结构。响应摘要: ${snippet}`);
  }

  // 2. Polymorphic Unwrap
  const unwrapped = unwrapSections(safeObj);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    throw new Error(`AI 返回的结果缺少有效 sections 结构。响应摘要: ${snippet}`);
  }

  // 3. Section Key & Structure Normalization
  const sections = normalizeSections(unwrapped);

  if (!sections || typeof sections !== "object" || Object.keys(sections).length === 0) {
    throw new Error(`AI 返回的结果缺少有效 sections 结构。响应摘要: ${snippet}`);
  }

  // 4. Validate experience content
  const EXPERIENCE_SECTION_KEYS = new Set([
    "education", "work", "project", "internship", "computer", "language",
    "awards", "certificates", "self", "student", "training", "papers",
    "patent", "performance", "intention"
  ]);

  let hasExperience = false;
  for (const [key, sec] of Object.entries(sections)) {
    if (!EXPERIENCE_SECTION_KEYS.has(key)) continue; // ignore non-experience sections (e.g. basic, declarations, other)
    if (sec.kind === "repeat" && Array.isArray(sec.items) && sec.items.length > 0) {
      const hasNonEmptyValue = sec.items.some((item) => {
        const vals = item.values || {};
        return Object.values(vals).some((v) => String(v == null ? "" : v).trim().length > 0);
      });
      if (hasNonEmptyValue) {
        hasExperience = true;
        break;
      }
    }
    if (sec.kind === "simple" && sec.values && typeof sec.values === "object") {
      const hasNonEmptyValue = Object.values(sec.values).some((v) => String(v == null ? "" : v).trim().length > 0);
      if (hasNonEmptyValue) {
        hasExperience = true;
        break;
      }
    }
  }

  if (!hasExperience) {
    throw new Error(`AI 未能从文本中提取出有效经历内容。响应摘要: ${snippet}`);
  }

  return sections;
}
