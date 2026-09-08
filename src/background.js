import { ProfileStore } from "./lib/profile-store.js";
import { PROTOCOL_ERRORS, MESSAGE_TYPES } from "./lib/protocol.js";
import { normalizeProfileV2, assertProfileV2Schema } from "./lib/resume-schema.js";
import {
  UPSTREAM_REPOSITORY,
  getUpdateApiUrl,
  getReleasesUrl
} from "./lib/config.js";
import {
  validateEndpointUrl,
  validateConfiguredEndpoint,
  normalizeOpenAiBaseUrl,
  getOllamaDnrRules,
  OLLAMA_DNR_RULE_LOCALHOST_ID,
  OLLAMA_DNR_RULE_127001_ID
} from "./lib/endpoint-validator.js";

const DEFAULT_API_CONFIG = {
  mode: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  endpointPath: "/chat/completions",
  apiKey: "",
  model: "your-model-name",
  useJsonResponseFormat: false,
  extraHeadersJson: "{}",
  customUrl: "",
  customMethod: "POST",
  customHeadersJson: "{}",
  customBodyTemplate:
    '{\n  "model": {{modelJson}},\n  "messages": {{messagesJson}},\n  "temperature": 0\n}',
  customResponsePath: "choices.0.message.content",
  allowLocalEndpoints: false
};

const PROFILE_SCHEMA_VERSION = 2;
const DEFAULT_PROFILE_V2 = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  updatedAt: "",
  sections: {},
  customSections: []
};

const STORAGE_KEYS = {
  profileV2: "profileV2",
  apiConfig: "apiConfig",
  updateState: "updateState"
};

const PROFILE_PANEL_STATE_KEY = "OJAF_PROFILE_PANEL_STATE";
const MAX_PROFILE_PANEL_STATE_ITEMS = 20;
const UPDATE_ALARM_NAME = "OJAF_CHECK_RELEASE_UPDATE";
const UPDATE_CHECK_INTERVAL_MINUTES = 12 * 60;
const UPDATE_REPOSITORY = UPSTREAM_REPOSITORY;
const UPDATE_LATEST_RELEASE_API = getUpdateApiUrl(UPDATE_REPOSITORY);
const UPDATE_RELEASES_URL = getReleasesUrl(UPDATE_REPOSITORY);

async function syncDeclarativeNetRequestRules(enable = true) {
  if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.updateDynamicRules) {
    return false;
  }
  try {
    const removeRuleIds = [OLLAMA_DNR_RULE_LOCALHOST_ID, OLLAMA_DNR_RULE_127001_ID];
    const extId = chrome.runtime?.id || "";
    const addRules = enable ? getOllamaDnrRules(extId) : [];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
    return true;
  } catch (err) {
    console.warn("OJAF: failed to sync declarativeNetRequest rules:", err);
    return false;
  }
}
if (typeof chrome !== "undefined") {
  chrome.runtime?.onInstalled?.addListener(async () => {
    await ProfileStore.ensureInitialized(normalizeProfileV2).catch(() => undefined);
    const existing = await chrome.storage.local.get([
      STORAGE_KEYS.apiConfig,
      STORAGE_KEYS.updateState
    ]);
    const next = {};

    if (!existing[STORAGE_KEYS.apiConfig]) {
      next[STORAGE_KEYS.apiConfig] = DEFAULT_API_CONFIG;
    }

    if (!existing[STORAGE_KEYS.updateState]) {
      next[STORAGE_KEYS.updateState] = createDefaultUpdateState();
    }

    if (Object.keys(next).length > 0) {
      await chrome.storage.local.set(next);
    }

    const effectiveConfig = next[STORAGE_KEYS.apiConfig] || existing[STORAGE_KEYS.apiConfig] || DEFAULT_API_CONFIG;
    await syncDeclarativeNetRequestRules(Boolean(effectiveConfig.allowLocalEndpoints)).catch(() => undefined);

    await setupUpdateAlarm().catch(() => undefined);
    void checkForUpdate({ reason: "installed" }).catch(() => undefined);
  });

  chrome.runtime?.onStartup?.addListener(async () => {
    void ProfileStore.ensureInitialized(normalizeProfileV2).catch(() => undefined);
    const existing = await chrome.storage.local.get([STORAGE_KEYS.apiConfig]).catch(() => ({}));
    const effectiveConfig = existing?.[STORAGE_KEYS.apiConfig] || DEFAULT_API_CONFIG;
    await syncDeclarativeNetRequestRules(Boolean(effectiveConfig.allowLocalEndpoints)).catch(() => undefined);
    void setupUpdateAlarm().catch(() => undefined);
    void refreshUpdateBadge().catch(() => undefined);
  });

  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM_NAME) {
      void checkForUpdate({ reason: "alarm" }).catch(() => undefined);
    }
  });

  void setupUpdateAlarm().catch(() => undefined);
  void refreshUpdateBadge().catch(() => undefined);

  // Auto-sync DNR rules on background worker spin-up
  void (async () => {
    try {
      const existing = await chrome.storage.local.get([STORAGE_KEYS.apiConfig]);
      const cfg = existing?.[STORAGE_KEYS.apiConfig];
      await syncDeclarativeNetRequestRules(Boolean(cfg?.allowLocalEndpoints));
    } catch {}
  })();

  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("OJAF_")) {
      return undefined;
    }

    handleMessage(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });
}

async function handleMessage(message, sender) {
  // Security Boundary: Administrative actions (saving/clearing settings, testing arbitrary connection)
  // must NEVER be callable from arbitrary webpage content scripts.
  const SENSITIVE_INTERNAL_ACTIONS = new Set([
    MESSAGE_TYPES.SAVE_SETTINGS,
    MESSAGE_TYPES.CLEAR_SETTINGS,
    MESSAGE_TYPES.TEST_CONNECTION,
    MESSAGE_TYPES.LIST_MODELS
  ]);

  if (sender?.tab && SENSITIVE_INTERNAL_ACTIONS.has(message.type)) {
    const extBaseUrl = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
      ? chrome.runtime.getURL("")
      : "chrome-extension://";
    const isExtensionPage = Boolean(sender.url && sender.url.startsWith(extBaseUrl));
    if (!isExtensionPage) {
      throw new Error("UNAUTHORIZED_CALLER: 此管理操作仅允许由扩展内部页面触发。");
    }
  }
  switch (message.type) {
    case MESSAGE_TYPES.GET_SETTINGS:
      return getSettings();
    case MESSAGE_TYPES.GET_ENVELOPE:
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      return ProfileStore.getEnvelope();
    case MESSAGE_TYPES.GET_ACTIVE_PROFILE_SNAPSHOT:
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      return ProfileStore.getActiveSnapshot();
    case MESSAGE_TYPES.SAVE_PROFILE: {
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      const saveRes = await ProfileStore.saveProfile(message.payload || {}, normalizeProfileV2);
      if (!saveRes.ok) throw new Error(saveRes.error || "SAVE_FAILED");
      return saveRes;
    }
    case MESSAGE_TYPES.SET_ACTIVE_PROFILE: {
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      const setRes = await ProfileStore.setActiveProfile(message.payload || {});
      if (!setRes.ok) throw new Error(setRes.error || "SET_ACTIVE_FAILED");
      return setRes;
    }
    case MESSAGE_TYPES.CREATE_PROFILE: {
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      const createRes = await ProfileStore.createProfile(message.payload || {}, normalizeProfileV2);
      if (!createRes.ok) throw new Error(createRes.error || "CREATE_FAILED");
      return createRes;
    }
    case MESSAGE_TYPES.DELETE_PROFILE: {
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      const delRes = await ProfileStore.deleteProfile(message.payload || {});
      if (!delRes.ok) throw new Error(delRes.error || "DELETE_FAILED");
      return delRes;
    }
    case MESSAGE_TYPES.RENAME_PROFILE: {
      await ProfileStore.ensureInitialized(normalizeProfileV2);
      const renRes = await ProfileStore.renameProfile(message.payload || {});
      if (!renRes.ok) throw new Error(renRes.error || "RENAME_FAILED");
      return renRes;
    }
    case MESSAGE_TYPES.PARSE_RESUME_WITH_AI:
      return parseResumeWithAi(message.payload || {});
    case MESSAGE_TYPES.OPEN_OPTIONS:
      await chrome.runtime.openOptionsPage();
      return {};
    case MESSAGE_TYPES.SAVE_SETTINGS:
      return saveSettings(message.payload || {});
    case MESSAGE_TYPES.CLEAR_SETTINGS:
      return clearSettings();
    case MESSAGE_TYPES.MAP_FIELDS:
      return mapFields(message.payload || {});
    case MESSAGE_TYPES.ANALYZE_PAGE_STRUCTURE:
      return analyzePageStructure(message.payload || {});
    case MESSAGE_TYPES.SAVE_PROFILE_PANEL_STATE:
      return saveProfilePanelState(message.payload || {});
    case MESSAGE_TYPES.GET_PROFILE_PANEL_STATE:
      return getProfilePanelState(message.payload || {});
    case MESSAGE_TYPES.LIST_MODELS:
      return listModels(message.payload || {});
    case MESSAGE_TYPES.TEST_CONNECTION:
      return testApi(message.payload || {});
    case MESSAGE_TYPES.GET_UPDATE_STATUS:
      return getUpdateState();
    case MESSAGE_TYPES.CHECK_FOR_UPDATE:
      return checkForUpdate({ reason: message.payload?.reason || "manual" });
    case MESSAGE_TYPES.OPEN_UPDATE_PAGE:
      return openUpdatePage(message.payload || {});
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getSettings() {
  await ProfileStore.ensureInitialized(normalizeProfileV2);
  const snapshot = await ProfileStore.getActiveSnapshot();
  const values = await chrome.storage.local.get([STORAGE_KEYS.apiConfig]);
  return {
    profileV2: snapshot?.profileV2 || DEFAULT_PROFILE_V2,
    apiConfig: { ...DEFAULT_API_CONFIG, ...(values[STORAGE_KEYS.apiConfig] || {}) }
  };
}

async function saveSettings(payload) {
  if (payload.profileV2) {
    throw new Error(PROTOCOL_ERRORS.DEPRECATED_WRITE_PROTOCOL);
  }

  const next = {};
  if (payload.apiConfig) {
    const apiConfig = { ...DEFAULT_API_CONFIG, ...payload.apiConfig };
    if (apiConfig.mode === "openai-compatible" && apiConfig.baseUrl) {
      apiConfig.baseUrl = normalizeOpenAiBaseUrl(apiConfig.baseUrl);
    }
    validateConfiguredEndpoint(apiConfig);
    next[STORAGE_KEYS.apiConfig] = apiConfig;
    await syncDeclarativeNetRequestRules(Boolean(apiConfig.allowLocalEndpoints)).catch(() => undefined);
  }

  await chrome.storage.local.set(next);
  return { saved: Object.keys(next) };
}

async function clearSettings() {
  await chrome.storage.local.clear();
  await ProfileStore.ensureInitialized(normalizeProfileV2);
  return { cleared: true };
}

async function setupUpdateAlarm() {
  if (!chrome.alarms?.create) {
    return;
  }

  const existing = chrome.alarms.get
    ? await chrome.alarms.get(UPDATE_ALARM_NAME)
    : null;
  if (existing) {
    return;
  }

  await chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 5,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES
  });
}

function createDefaultUpdateState(patch = {}) {
  return {
    status: "unknown",
    currentVersion: getCurrentVersion(),
    latestVersion: "",
    latestTag: "",
    releaseName: "",
    releaseUrl: UPDATE_RELEASES_URL,
    publishedAt: "",
    checkedAt: 0,
    error: "",
    reason: "",
    ...patch
  };
}

async function getUpdateState() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.updateState]);
  const state = reconcileUpdateState({
    ...createDefaultUpdateState(),
    ...(values[STORAGE_KEYS.updateState] || {}),
    currentVersion: getCurrentVersion()
  });
  await applyUpdateBadge(state);
  return state;
}

async function checkForUpdate(options = {}) {
  const reason = options.reason || "manual";
  const currentVersion = getCurrentVersion();

  try {
    const response = await fetch(UPDATE_LATEST_RELEASE_API, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json"
      },
      cache: "no-store"
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub Release 暂时不可用（HTTP ${response.status}）`);
    }

    const release = safeJsonParse(text);
    const latestTag = String(release?.tag_name || "").trim();
    const latestVersion = normalizeVersion(latestTag || release?.name || "");
    if (!latestVersion) {
      throw new Error("GitHub Release 没有返回有效版本号。");
    }

    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const state = createDefaultUpdateState({
      status: updateAvailable ? "available" : "current",
      currentVersion,
      latestVersion,
      latestTag,
      releaseName: String(release?.name || latestTag || latestVersion),
      releaseUrl: String(release?.html_url || UPDATE_RELEASES_URL),
      publishedAt: String(release?.published_at || ""),
      checkedAt: Date.now(),
      error: "",
      reason
    });
    await saveUpdateState(state);
    return state;
  } catch (error) {
    const previous = await getUpdateState();
    const errorMessage = formatUpdateCheckError(error);
    const state = createDefaultUpdateState({
      ...previous,
      status: previous.status === "available" ? "available" : "error",
      currentVersion,
      checkedAt: Date.now(),
      error: errorMessage,
      reason
    });
    await saveUpdateState(state);
    return state;
  }
}

async function saveUpdateState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.updateState]: state });
  await applyUpdateBadge(state);
}

async function refreshUpdateBadge() {
  const state = await getUpdateState();
  await applyUpdateBadge(state);
}

async function applyUpdateBadge(state) {
  if (!chrome.action) {
    return;
  }

  if (state?.status === "available") {
    await chrome.action.setBadgeText({ text: "NEW" });
    await chrome.action.setBadgeBackgroundColor({ color: "#c37a18" });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

async function openUpdatePage(payload = {}) {
  const state = await getUpdateState();
  const url = String(payload.url || state.releaseUrl || UPDATE_RELEASES_URL);
  await chrome.tabs.create({ url });
  return { opened: true, url };
}

function getCurrentVersion() {
  return chrome.runtime.getManifest().version || "0.0.0";
}

function normalizeVersion(value) {
  const match = String(value || "").trim().match(/v?(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : "";
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

function reconcileUpdateState(state) {
  if (!state.latestVersion) {
    return state;
  }

  const comparison = compareVersions(state.latestVersion, state.currentVersion);
  if (comparison > 0) {
    return { ...state, status: "available" };
  }
  if (state.status === "available") {
    return { ...state, status: "current", error: "" };
  }
  return state;
}

function formatUpdateCheckError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "暂时无法连接 GitHub Release，请稍后重试。";
  }
  return message || "检查更新失败，请稍后重试。";
}

async function saveProfilePanelState(payload) {
  const pageKey = normalizeProfilePanelStateKey(payload.pageKey || "");
  if (!pageKey || !chrome.storage.session) {
    return { saved: false };
  }

  const patch = isPlainObject(payload.patch) ? payload.patch : {};
  const result = await chrome.storage.session.get(PROFILE_PANEL_STATE_KEY);
  const allStates = result[PROFILE_PANEL_STATE_KEY] || {};
  allStates[pageKey] = {
    ...(allStates[pageKey] || {}),
    pageKey,
    ...patch,
    updatedAt: Date.now()
  };

  const entries = Object.entries(allStates)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, MAX_PROFILE_PANEL_STATE_ITEMS);
  await chrome.storage.session.set({ [PROFILE_PANEL_STATE_KEY]: Object.fromEntries(entries) });
  return { saved: true };
}

async function getProfilePanelState(payload) {
  const pageKey = normalizeProfilePanelStateKey(payload.pageKey || "");
  if (!pageKey || !chrome.storage.session) {
    return null;
  }

  const result = await chrome.storage.session.get(PROFILE_PANEL_STATE_KEY);
  return result[PROFILE_PANEL_STATE_KEY]?.[pageKey] || null;
}

function normalizeProfilePanelStateKey(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

async function mapFields(payload) {
  const { scan } = payload;
  if (!scan || !Array.isArray(scan.fields)) {
    throw new Error("Missing scan result. Scan the current form first.");
  }

  const settings = await getSettings();
  // SECURITY SSRF BOUNDARY: Always use user's saved apiConfig from storage.
  // Callers (webpage content scripts) MUST NOT override the configured endpoint!
  const apiConfig = settings.apiConfig;
  validateConfiguredEndpoint(apiConfig);
  const profileCatalog = normalizeProvidedProfileCatalog(payload.profileCatalog);
  if (!profileCatalog) {
    throw new Error("Missing profile field catalog.");
  }

  const taskDeadline = Number(payload.taskDeadline || 0) || (Date.now() + 25000);
  const { outboundScan, opaqueToRealId } = createOutboundAiDto(scan);

  const messages = buildMessages(profileCatalog, outboundScan);
  const rawContent = await callAi(apiConfig, messages, {
    profile: profileCatalog,
    profileCatalog,
    scan: outboundScan,
    taskDeadline
  });
  const parsed = parseJsonFromText(rawContent);

  if (parsed && Array.isArray(parsed.mappings)) {
    for (const m of parsed.mappings) {
      if (m && m.fieldId) {
        m.fieldId = opaqueToRealId.get(m.fieldId) || m.fieldId;
      }
    }
  }

  const mappings = annotateMappingsWithCatalog(normalizeAiMappings(parsed, scan.fields), profileCatalog);
  return {
    mappings,
    notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    raw: parsed
  };
}

async function analyzePageStructure(payload) {
  const { scan } = payload;
  if (!scan || !Array.isArray(scan.fields)) {
    throw new Error("Missing scan result. Scan the current form first.");
  }

  const settings = await getSettings();
  // SECURITY SSRF BOUNDARY: Always use user's saved apiConfig from storage.
  const apiConfig = settings.apiConfig;
  validateConfiguredEndpoint(apiConfig);
  const taskDeadline = Number(payload.taskDeadline || 0) || (Date.now() + 25000);
  const { outboundScan, opaqueToRealId } = createOutboundAiDto(scan);

  const messages = buildPageStructureMessages(outboundScan);
  const rawContent = await callAi(apiConfig, messages, {
    profile: { fields: [] },
    profileCatalog: { fields: [] },
    scan: outboundScan,
    taskDeadline
  });
  const parsed = parseJsonFromText(rawContent);

  if (parsed && Array.isArray(parsed.fieldHints)) {
    for (const h of parsed.fieldHints) {
      if (h && h.fieldId) {
        h.fieldId = opaqueToRealId.get(h.fieldId) || h.fieldId;
      }
    }
  }

  return normalizePageStructureAnalysis(parsed, scan.fields);
}

async function testApi(payload) {
  const settings = await getSettings();
  const apiConfig = { ...settings.apiConfig, ...(payload.apiConfig || {}) };
  if (apiConfig.mode === "openai-compatible" && apiConfig.baseUrl) {
    apiConfig.baseUrl = normalizeOpenAiBaseUrl(apiConfig.baseUrl);
  }
  validateConfiguredEndpoint(apiConfig);
  if (apiConfig.allowLocalEndpoints) {
    await syncDeclarativeNetRequestRules(true).catch(() => undefined);
  }
  const fakeProfile = {
    sections: [
      {
        key: "basic",
        title: "基本信息",
        fields: [
          {
            path: "profileV2.sections.basic.values[0]",
            label: "基本信息 / 姓名",
            aliases: ["姓名", "真实姓名", "基本信息"]
          }
        ]
      }
    ],
    fields: [
      {
        path: "profileV2.sections.basic.values[0]",
        label: "基本信息 / 姓名",
        aliases: ["姓名", "真实姓名", "基本信息"]
      }
    ]
  };
  const fakeScan = {
    hostname: "example.test",
    fields: [
      {
        fieldId: "test_name",
        type: "text",
        label: "姓名",
        placeholder: "",
        required: true,
        section: "基本信息",
        options: []
      }
    ]
  };
  const { outboundScan } = createOutboundAiDto(fakeScan);
  const messages = buildMessages(fakeProfile, outboundScan);
  const rawContent = await callAi(apiConfig, messages, {
    profile: fakeProfile,
    profileCatalog: fakeProfile,
    scan: outboundScan
  });
  const parsed = parseJsonFromText(rawContent);
  return {
    parsed,
    contentPreview: typeof rawContent === "string" ? rawContent.slice(0, 800) : String(rawContent).slice(0, 800)
  };
}

async function listModels(payload) {
  const settings = await getSettings();
  const apiConfig = { ...settings.apiConfig, ...(payload.apiConfig || {}) };
  if (apiConfig.mode === "openai-compatible" && apiConfig.baseUrl) {
    apiConfig.baseUrl = normalizeOpenAiBaseUrl(apiConfig.baseUrl);
  }
  validateConfiguredEndpoint(apiConfig);
  if (apiConfig.allowLocalEndpoints) {
    await syncDeclarativeNetRequestRules(true).catch(() => undefined);
  }
  const url = resolveModelListUrl(apiConfig);
  if (!url) {
    throw new Error(apiConfig.mode === "custom" ? "Custom API URL is required." : "API base URL is required.");
  }

  const headers = buildRequestHeaders({
    apiConfig,
    headerJson: apiConfig.mode === "custom" ? apiConfig.customHeadersJson : apiConfig.extraHeadersJson,
    includeContentType: false
  });

  const response = await fetch(url, {
    method: "GET",
    headers
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Model list request failed ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = safeJsonParse(text);
  const source = extractModelListSource(data);
  const models = normalizeModelList(source);

  return {
    url,
    models
  };
}

export function createOutboundAiDto(scan) {
  const opaqueToRealId = new Map();
  const realToOpaqueId = new Map();
  let counter = 1;

  let hostname = scan.hostname || "";
  if (!hostname && scan.url) {
    try {
      hostname = new URL(scan.url).hostname;
    } catch {
      hostname = "";
    }
  }

  const outboundFields = (scan.fields || []).map((field) => {
    const opaqueId = `fld_${counter++}`;
    opaqueToRealId.set(opaqueId, field.fieldId);
    realToOpaqueId.set(field.fieldId, opaqueId);

    const cleanOptions = Array.isArray(field.options)
      ? field.options
          .map((opt) => {
            const lbl = String(opt?.label || opt?.text || opt?.value || "").trim();
            return lbl ? { label: sanitizePromptText(lbl, 30) } : null;
          })
          .filter(Boolean)
          .slice(0, 20)
      : [];

    return {
      fieldId: opaqueId,
      type: String(field.type || "text").slice(0, 20),
      label: sanitizePromptText(field.label || field.placeholder || "", 60),
      section: sanitizePromptText(field.section || "", 40),
      required: Boolean(field.required),
      options: cleanOptions
    };
  });

  const outboundScan = {
    hostname,
    fields: outboundFields
  };

  return { outboundScan, opaqueToRealId, realToOpaqueId };
}

function normalizeProvidedProfileCatalog(profileCatalog) {
  if (!isPlainObject(profileCatalog) || !Array.isArray(profileCatalog.fields)) {
    return null;
  }

  const fields = profileCatalog.fields
    .map((field) => ({
      path: sanitizeAttributeText(field?.path || ""),
      label: sanitizePromptText(field?.label || "", 180),
      aliases: Array.isArray(field?.aliases)
        ? field.aliases.map((alias) => sanitizePromptText(alias, 120)).filter(Boolean).slice(0, 12)
        : []
    }))
    .filter((field) => field.path && field.label)
    .slice(0, 300);

  const sections = Array.isArray(profileCatalog.sections)
    ? profileCatalog.sections
        .map((section) => {
          const sectionFields = Array.isArray(section?.fields)
            ? section.fields
                .map((field) => fields.find((item) => item.path === sanitizeAttributeText(field?.path || "")))
                .filter(Boolean)
            : [];

          return {
            key: sanitizeAttributeText(section?.key || ""),
            title: sanitizePromptText(section?.title || "", 120),
            fields: sectionFields
          };
        })
        .filter((section) => section.title && section.fields.length > 0)
    : [];

  return {
    sections,
    fields
  };
}

function sanitizeAttributeText(value) {
  return sanitizePromptText(value, 120);
}

function sanitizePromptText(value, maxLength = 220) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  return redactPersonalValues(text, maxLength);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}


function redactPersonalValues(text, maxLength = 220) {
  if (!text) {
    return "";
  }

  const labelPatterns = [
    /((?:姓名|手机号码|手机号|联系电话|电话|电子邮箱|邮箱|邮件|证件号码|身份证号|出生日期|出生时间|毕业院校|专业|学历|学位|工作单位|实习\/实践单位|组织名称|职务|岗位|学校|籍贯|户口|居住地|地址|联系人|证书号|学历证书号|奖惩名称|奖惩单位|奖惩原因|自我评价|招聘信息来源|备注|高考所在地|高考分数|身高|体重|期望年收入|分数)(?:[^:：]{0,8})[：:]\s*)([^|；;，,\n]+)/g,
    /((?:是否[^:：\n]{0,40}[：:]\s*))([^\n]+)/g
  ];

  let redacted = text;
  for (const pattern of labelPatterns) {
    redacted = redacted.replace(pattern, (match, prefix) => {
      return `${prefix}【已隐藏】`;
    });
  }

  redacted = redacted.replace(/\b(?:\d{11}|\d{15,18}[Xx]?)\b/g, "【已隐藏】");
  redacted = redacted.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "【已隐藏】");
  redacted = redacted.replace(/\b\d{4,}\b/g, (match) => (match.length >= 6 ? "【已隐藏】" : match));

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

function buildMessages(profileCatalog, scan) {
  const systemPrompt = [
    "You are a form-field mapping engine for job application forms.",
    "Your task is to produce the primary field mappings for the current page.",
    "Local fallback rules will handle any remaining unmatched fields.",
    "Return strict JSON only. Do not include prose or explanations outside JSON.",
    "Privacy rule: you are not given the user's actual resume values, and you must not ask for, infer, copy, or output personal values.",
    "The profile field catalog contains sourcePath names and field labels only. All real values are withheld and will be resolved locally in the browser.",
    "Do not map file upload fields. Do not decide to submit the form.",
    "Prefer sourcePath. Use value only for non-personal constants when no sourcePath applies.",
    "If options are provided for a select/combobox, map to the relevant sourcePath; local code will match the user's value to the page option."
  ].join("\n");

  const userPrompt = [
    "Map fields from the current job application page to the local resume profile field catalog.",
    "",
    "Return JSON with this schema:",
    JSON.stringify(
      {
        mappings: [
          {
            fieldId: "field id from fields list",
            sourcePath: "exact path from local profile field catalog",
            value: "optional non-personal literal only when sourcePath is not enough",
            confidence: 0.95,
            reason: "short reason"
          }
        ],
        notes: ["optional warnings"]
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Use only fieldId values that exist in fields.",
    "- Set confidence from 0 to 1.",
    "- Precision is more important than coverage. If context is ambiguous, omit the mapping instead of guessing.",
    "- Required fields deserve careful mapping, but uncertainty must lower confidence.",
    "- For repeated sections like family father/mother, performance review rows, or education entries, use section, nearbyText, and groupText to select the right profile path.",
    "- In Chinese job application forms, generic labels such as 姓名、电话、工作单位、职务、地址 must follow their context: family member, emergency contact, reference/prover, performance review, current residence, hukou, native place, source place, or mailing address.",
    "- Do not map family/emergency/reference generic fields to the applicant's own basic information unless the page context is clearly the applicant profile.",
    "- For Chinese recruitment forms, common mappings include 姓名 -> 姓名, 手机号码 -> 手机号码/电话, 电子邮箱 -> 邮箱/电子邮箱, 毕业院校 -> 学校/毕业院校, 证书名称 -> 证书名称（技能名称）.",
    "- For user-defined fields, inspect customFields.* items by label and key. If a custom field matches, use sourcePath like customFields.basic[0].value.",
    "- For declarations asking yes/no questions, use declarations.* only if the question meaning clearly matches.",
    "- Do not output copied page values, existing field values, names, phone numbers, email addresses, ID numbers, schools, employers, addresses, or experience descriptions.",
    "",
    "Local profile field catalog. Values are intentionally omitted:",
    JSON.stringify(profileCatalog, null, 2),
    "",
    "Detected page fields JSON. Existing field values are intentionally omitted/redacted:",
    JSON.stringify(scan, null, 2)
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}

function buildPageStructureMessages(scan) {
  const systemPrompt = [
    "You are a page-structure analyzer for job application forms.",
    "Your task is to normalize noisy detected web form metadata into readable form-field hints.",
    "Return strict JSON only. Do not include prose or explanations outside JSON.",
    "Privacy rule: the page may already contain user-entered values in nearby text, so never copy, infer, or output personal values.",
    "Only output structural labels, section names, control kind hints, and short non-sensitive notes.",
    "Do not decide to submit the form and do not map to a resume profile."
  ].join("\n");

  const userPrompt = [
    "Analyze the current job application page fields.",
    "",
    "Return JSON with this schema:",
    JSON.stringify(
      {
        siteType: "generic | zhiye | hotjob | ats | ant-design | element-ui | custom",
        confidence: 0.8,
        fieldHints: [
          {
            fieldId: "field id from fields list",
            label: "normalized visible label, no personal value",
            section: "normalized section name",
            controlKind: "text | textarea | select | search-select | radio | checkbox | date | file | unknown",
            confidence: 0.9,
            note: "short structural note"
          }
        ],
        notes: ["optional warnings"]
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Use only fieldId values that exist in fields.",
    "- If nearbyText contains a label and value, output only the label.",
    "- Prefer Chinese field labels when the page is Chinese.",
    "- For repeated sections, keep section names such as 基本信息、教育经历、实习经历、工作经历、绩效考核、专业资格、项目经历、家庭信息、附加问题.",
    "- If a field is a custom select/search input, set controlKind to search-select or select.",
    "- Do not output names, phone numbers, email addresses, ID numbers, schools, employers, addresses, dates of birth, or experience descriptions.",
    "",
    "Detected page fields JSON. Existing field values are omitted/redacted:",
    JSON.stringify(scan, null, 2)
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}

async function callAi(apiConfig, messages, context) {
  if (apiConfig.mode === "custom") {
    return callCustomApi(apiConfig, messages, context);
  }
  return callOpenAiCompatible(apiConfig, messages, context);
}

async function callOpenAiCompatible(apiConfig, messages, context) {
  if (!apiConfig.baseUrl) {
    throw new Error("API base URL is required.");
  }
  if (!apiConfig.model) {
    throw new Error("Model name is required.");
  }

  const baseUrl = normalizeOpenAiBaseUrl(apiConfig.baseUrl);
  const url = joinUrl(baseUrl, apiConfig.endpointPath || "/chat/completions");
  validateEndpointUrl(url, Boolean(apiConfig.allowLocalEndpoints));
  const headers = buildRequestHeaders({ apiConfig, headerJson: apiConfig.extraHeadersJson });

  const body = {
    model: apiConfig.model,
    messages,
    temperature: 0
  };

  if (apiConfig.useJsonResponseFormat) {
    body.response_format = { type: "json_object" };
  }

  const taskDeadline = Number(context?.taskDeadline || 0) || (Date.now() + 25000);
  const remainingBudget = Math.max(0, taskDeadline - Date.now());
  if (remainingBudget <= 0) {
    throw new Error("AI_REQUEST_TIMEOUT: 任务 AI 总预算（25秒）已耗尽，已自动降级使用本地规则。");
  }

  const timeoutMs = Math.min(15000, remainingBudget);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("AI_REQUEST_TIMEOUT"));
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError" || err?.message?.includes("AI_REQUEST_TIMEOUT")) {
      const isTotalExceeded = Date.now() >= taskDeadline;
      throw new Error(isTotalExceeded
        ? "AI_REQUEST_TIMEOUT: 任务 AI 总预算（25秒）已耗尽，已自动降级使用本地规则。"
        : "AI_REQUEST_TIMEOUT: AI 请求超时（15秒内无响应），已自动降级使用本地规则。");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = safeJsonParse(text);
  if (!data) {
    return text;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item.text || item.content || "").join("");
  }
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(data);
}

async function callCustomApi(apiConfig, messages, context) {
  if (!apiConfig.customUrl) {
    throw new Error("Custom API URL is required.");
  }

  validateEndpointUrl(apiConfig.customUrl, Boolean(apiConfig.allowLocalEndpoints));
  const headers = buildRequestHeaders({ apiConfig, headerJson: apiConfig.customHeadersJson });

  const body = renderTemplate(apiConfig.customBodyTemplate || DEFAULT_API_CONFIG.customBodyTemplate, {
    model: apiConfig.model || "",
    messages,
    systemPrompt: messages.find((message) => message.role === "system")?.content || "",
    userPrompt: messages.find((message) => message.role === "user")?.content || "",
    profile: context.profile,
    scan: context.scan
  });

  const taskDeadline = Number(context?.taskDeadline || 0) || (Date.now() + 25000);
  const remainingBudget = Math.max(0, taskDeadline - Date.now());
  if (remainingBudget <= 0) {
    throw new Error("AI_REQUEST_TIMEOUT: 任务 AI 总预算（25秒）已耗尽，已自动降级使用本地规则。");
  }

  const timeoutMs = Math.min(15000, remainingBudget);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("AI_REQUEST_TIMEOUT"));
  }, timeoutMs);

  let response;
  try {
    response = await fetch(apiConfig.customUrl, {
      method: apiConfig.customMethod || "POST",
      headers,
      body,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError" || err?.message?.includes("AI_REQUEST_TIMEOUT")) {
      const isTotalExceeded = Date.now() >= taskDeadline;
      throw new Error(isTotalExceeded
        ? "AI_REQUEST_TIMEOUT: 任务 AI 总预算（25秒）已耗尽，已自动降级使用本地规则。"
        : "AI_REQUEST_TIMEOUT: AI 自定义接口请求超时（15秒内无响应），已自动降级使用本地规则。");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Custom API request failed ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = safeJsonParse(text);
  if (!data) {
    return text;
  }

  const content = apiConfig.customResponsePath ? getByPath(data, apiConfig.customResponsePath) : data;
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

function buildRequestHeaders({ apiConfig, headerJson, includeContentType = true }) {
  const headers = parseJsonObject(headerJson, "request headers");
  if (includeContentType && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  if (apiConfig.apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
    headers.authorization = `Bearer ${apiConfig.apiKey}`;
  }
  return headers;
}

function resolveModelListUrl(apiConfig) {
  if (apiConfig.mode === "openai-compatible") {
    if (!apiConfig.baseUrl) return "";
    const baseUrl = normalizeOpenAiBaseUrl(apiConfig.baseUrl);
    return joinUrl(baseUrl, "/models");
  }

  const derived = deriveModelListUrl(apiConfig.customUrl || "");
  return derived;
}

function deriveModelListUrl(sourceUrl) {
  if (!sourceUrl) {
    return "";
  }

  try {
    const url = new URL(sourceUrl);
    if (url.pathname.endsWith("/chat/completions")) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
      return url.toString();
    }
    if (url.pathname.endsWith("/completions")) {
      url.pathname = url.pathname.replace(/\/completions$/, "/models");
      return url.toString();
    }
    if (url.pathname.endsWith("/responses")) {
      url.pathname = url.pathname.replace(/\/responses$/, "/models");
      return url.toString();
    }
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/models";
      return url.toString();
    }
    url.pathname = "/models";
    return url.toString();
  } catch {
    return "";
  }
}

function extractModelListSource(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.data)) {
    return data.data;
  }
  if (Array.isArray(data?.models)) {
    return data.models;
  }
  if (Array.isArray(data?.items)) {
    return data.items;
  }
  if (Array.isArray(data?.result)) {
    return data.result;
  }
  if (Array.isArray(data?.choices)) {
    return data.choices;
  }
  if (data && typeof data === "object") {
    for (const key of ["data", "models", "items", "result", "list"]) {
      if (Array.isArray(data[key])) {
        return data[key];
      }
    }
  }

  throw new Error("Could not find a model array in the response.");
}

function normalizeModelList(source) {
  const items = Array.isArray(source) ? source : [];
  return items
    .map((item) => normalizeModelItem(item))
    .filter(Boolean);
}

function normalizeModelItem(item) {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? { id, name: id } : null;
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const id = String(item.id || item.model || item.name || item.slug || item.value || "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    name: String(item.display_name || item.name || item.id || id).trim() || id
  };
}

function joinUrl(baseUrl, path) {
  const normalizedBase = String(baseUrl).replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/?/, "/");
  return `${normalizedBase}${normalizedPath}`;
}

function parseJsonObject(value, label) {
  if (!value || !String(value).trim()) {
    return {};
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function renderTemplate(template, values) {
  const replacements = {
    model: values.model,
    modelJson: JSON.stringify(values.model),
    messagesJson: JSON.stringify(values.messages),
    systemPrompt: values.systemPrompt,
    systemPromptJson: JSON.stringify(values.systemPrompt),
    userPrompt: values.userPrompt,
    userPromptJson: JSON.stringify(values.userPrompt),
    prompt: values.userPrompt,
    promptJson: JSON.stringify(values.userPrompt),
    profileJson: JSON.stringify(values.profile),
    profileCatalogJson: JSON.stringify(values.profileCatalog || values.profile),
    fieldsJson: JSON.stringify(values.scan.fields),
    scanJson: JSON.stringify(values.scan)
  };

  return String(template).replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) {
      throw new Error(`Unknown custom API template variable: ${key}`);
    }
    return replacements[key];
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonFromText(text) {
  if (typeof text !== "string") {
    return text;
  }

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const direct = safeJsonParse(cleaned);
  if (direct) {
    return direct;
  }

  const jsonCandidate = extractFirstJson(cleaned);
  const parsed = jsonCandidate ? safeJsonParse(jsonCandidate) : null;
  if (!parsed) {
    throw new Error(`AI response is not valid JSON: ${cleaned.slice(0, 500)}`);
  }

  return parsed;
}

function normalizePageStructureAnalysis(parsed, fields) {
  const validFieldIds = new Set(fields.map((field) => field.fieldId));
  const fieldHintsSource = Array.isArray(parsed?.fieldHints)
    ? parsed.fieldHints
    : Array.isArray(parsed?.fields)
      ? parsed.fields
      : [];

  const fieldHints = fieldHintsSource
    .filter((hint) => hint && validFieldIds.has(String(hint.fieldId || "")))
    .map((hint) => ({
      fieldId: String(hint.fieldId),
      label: sanitizePromptText(hint.label || hint.normalizedLabel || "", 120),
      section: sanitizePromptText(hint.section || hint.group || "", 120),
      controlKind: sanitizeAttributeText(hint.controlKind || hint.type || "unknown"),
      confidence: clampConfidence(hint.confidence),
      note: sanitizePromptText(hint.note || hint.reason || "", 160)
    }))
    .filter((hint) => hint.label || hint.section || hint.controlKind !== "unknown");

  return {
    siteType: sanitizeAttributeText(parsed?.siteType || parsed?.type || "generic"),
    confidence: clampConfidence(parsed?.confidence),
    fieldHints,
    notes: Array.isArray(parsed?.notes)
      ? parsed.notes.map((note) => sanitizePromptText(note, 160)).filter(Boolean).slice(0, 8)
      : [],
    raw: parsed
  };
}

function extractFirstJson(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) {
    return "";
  }

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

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
        return text.slice(start, i + 1);
      }
    }
  }

  return "";
}

function normalizeAiMappings(parsed, fields) {
  let mappings = [];

  if (Array.isArray(parsed)) {
    mappings = parsed;
  } else if (Array.isArray(parsed?.mappings)) {
    mappings = parsed.mappings;
  } else if (parsed && typeof parsed === "object") {
    mappings = Object.entries(parsed).map(([fieldId, value]) => ({
      fieldId,
      ...(value && typeof value === "object" ? value : { value })
    }));
  }

  const validFieldIds = new Set(fields.map((field) => field.fieldId));
  return mappings
    .filter((mapping) => mapping && validFieldIds.has(mapping.fieldId))
    .map((mapping) => {
      const normalized = {
        fieldId: String(mapping.fieldId),
        sourcePath: mapping.sourcePath || mapping.source || mapping.path || "",
        confidence: clampConfidence(mapping.confidence),
        reason: String(mapping.reason || "")
      };

      if (
        !normalized.sourcePath &&
        Object.prototype.hasOwnProperty.call(mapping, "value") &&
        mapping.value !== undefined
      ) {
        normalized.value = mapping.value;
      }

      return normalized;
    });
}

function annotateMappingsWithCatalog(mappings, profileCatalog) {
  const catalogFields = Array.isArray(profileCatalog?.fields) ? profileCatalog.fields : [];
  const sections = Array.isArray(profileCatalog?.sections) ? profileCatalog.sections : [];
  const fieldByPath = new Map(catalogFields.map((field) => [field.path, field]));
  const sectionByPath = new Map();

  for (const section of sections) {
    const fields = Array.isArray(section.fields) ? section.fields : [];
    for (const field of fields) {
      sectionByPath.set(field.path, section.title || "");
    }
  }

  return mappings.map((mapping) => {
    const catalogField = fieldByPath.get(mapping.sourcePath);
    if (!catalogField) {
      return mapping;
    }

    return {
      ...mapping,
      sourceLabel: catalogField.label || "",
      sourceSection: sectionByPath.get(mapping.sourcePath) || ""
    };
  });
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, number));
}

function getByPath(source, path) {
  const parts = String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let current = source;
  for (const part of parts) {
    if (current == null) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function cleanPrototypePollution(obj, depth = 0) {
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

async function parseResumeWithAi(payload) {
  const previewText = String(payload?.previewText || payload?.rawText || "").trim();
  if (!previewText) {
    throw new Error("外发给 AI 的经历文本内容为空。");
  }
  if (previewText.length > 100000) {
    throw new Error("经历文本长度超过 100,000 字符限制。");
  }

  const settings = await chrome.storage.local.get([STORAGE_KEYS.apiConfig]);
  const apiConfig = { ...DEFAULT_API_CONFIG, ...(settings[STORAGE_KEYS.apiConfig] || {}) };
  validateConfiguredEndpoint(apiConfig);

  const systemPrompt = [
    "You are a professional resume structure analyzer.",
    "Your job is to extract structured educational background, work experience, project experience, skills, certificates, and awards from the given text.",
    "Return strict JSON only. Do not wrap with markdown blocks. Do not invent any personal identification values.",
    "The returned JSON must have this schema:",
    JSON.stringify({
      sections: {
        education: {
          key: "education",
          title: "教育经历",
          kind: "repeat",
          items: [{
            values: { "学校": "", "专业": "", "学历": "", "学位": "", "开始时间": "", "结束时间": "", "专业描述": "" },
            custom: []
          }]
        },
        work: {
          key: "work",
          title: "工作经历",
          kind: "repeat",
          items: [{
            values: { "公司": "", "职位": "", "所属部门": "", "开始时间": "", "结束时间": "", "工作内容": "", "工作成果": "" },
            custom: []
          }]
        },
        project: {
          key: "project",
          title: "项目经历/实践活动",
          kind: "repeat",
          items: [{
            values: { "项目名称": "", "职位": "", "本人职责": "", "开始时间": "", "结束时间": "", "项目内容": "", "项目成果": "" },
            custom: []
          }]
        },
        computer: {
          key: "computer",
          title: "计算机技能（IT技能）",
          kind: "repeat",
          items: [{
            values: { "证书名称（技能名称）": "", "掌握程度": "熟练" },
            custom: []
          }]
        },
        language: {
          key: "language",
          title: "外语能力",
          kind: "repeat",
          items: [{
            values: { "外语种类": "英语", "证书名称（技能名称）": "", "成绩": "" },
            custom: []
          }]
        },
        awards: {
          key: "awards",
          title: "奖惩情况",
          kind: "repeat",
          items: [{
            values: { "奖惩名称": "", "奖惩时间": "", "奖惩描述": "" },
            custom: []
          }]
        },
        self: {
          key: "self",
          title: "自我描述",
          kind: "simple",
          values: { "自我评价": "" }
        }
      }
    }, null, 2)
  ].join("\n");

  const userPrompt = [
    "Please extract the structured experience sections from this text:",
    "---",
    previewText,
    "---",
    "Return JSON only."
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const rawAiResult = await callAi(apiConfig, messages, { profile: {}, scan: {} });
  if (typeof rawAiResult !== "string" || rawAiResult.length > 100000) {
    throw new Error("AI 响应过大或格式不正确。");
  }

  const cleanedText = rawAiResult.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleanedText);
  } catch (err) {
    const candidate = extractFirstJson(cleanedText);
    parsed = candidate ? safeJsonParse(candidate) : null;
    if (!parsed) {
      throw new Error(`AI 返回的内容不是有效的 JSON 结构: ${cleanedText.slice(0, 300)}`);
    }
  }

  const safeObj = cleanPrototypePollution(parsed);

  if (!safeObj || typeof safeObj !== "object" || !safeObj.sections || typeof safeObj.sections !== "object") {
    throw new Error("AI 返回的结果缺少有效 sections 结构。");
  }

  let hasExperience = false;
  for (const sec of Object.values(safeObj.sections)) {
    if (sec?.kind === "repeat" && Array.isArray(sec.items) && sec.items.length > 0) {
      hasExperience = true;
      break;
    }
    if (sec?.kind === "simple" && sec.values && Object.keys(sec.values).length > 0) {
      hasExperience = true;
      break;
    }
  }
  if (!hasExperience) {
    throw new Error("AI 未能从文本中提取出有效经历内容。");
  }

  return {
    sections: safeObj.sections,
    diagnostics: {
      provider: apiConfig.mode || "openai-compatible",
      model: apiConfig.model || "default"
    }
  };
}

export {
  mapFields,
  analyzePageStructure,
  callAi,
  callOpenAiCompatible,
  callCustomApi,
  handleMessage,
  validateEndpointUrl,
  validateConfiguredEndpoint,
  normalizeOpenAiBaseUrl,
  syncDeclarativeNetRequestRules
};

