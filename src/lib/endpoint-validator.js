/**
 * OpenJobAutofill - API Endpoint Security & Normalization
 * 
 * Handles URL normalization, SSRF protection boundaries,
 * local AI endpoint detection, and Chrome DNR rule definitions.
 */

export const DANGEROUS_PORTS = Object.freeze(new Set([
  21,    // FTP
  22,    // SSH
  23,    // Telnet
  25,    // SMTP
  53,    // DNS
  110,   // POP3
  135,   // RPC
  137,   // NetBIOS Name Service
  138,   // NetBIOS Datagram
  139,   // NetBIOS Session
  445,   // SMB
  6379,  // Redis
  11211, // Memcached
  2375,  // Docker daemon unauthenticated
  2376,  // Docker SSL
  10250, // Kubelet API
  10255  // Kubelet read-only
]));

export const OLLAMA_DNR_RULE_LOCALHOST_ID = 4001;
export const OLLAMA_DNR_RULE_127001_ID = 4002;

/**
 * Parses an IPv6-mapped or IPv4-translated IPv6 address (e.g. [::ffff:7f00:1] or [::ffff:127.0.0.1])
 * and converts it to its canonical IPv4 dotted-decimal string representation.
 * 
 * @param {string} rawHostname 
 * @returns {string|null} Dotted-decimal IPv4 string or null if not mapped IPv4
 */
export function parseIpv6MappedIpv4(rawHostname) {
  if (!rawHostname || typeof rawHostname !== "string") {
    return null;
  }
  const clean = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!clean.startsWith("::ffff:")) {
    return null;
  }
  const rest = clean.replace(/^::ffff:(?:0:)?/, "");
  if (rest.includes(".")) {
    return rest;
  }
  const parts = rest.split(":");
  if (parts.length === 2) {
    const high = parseInt(parts[0], 16);
    const low = parseInt(parts[1], 16);
    if (!isNaN(high) && !isNaN(low)) {
      return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
    }
  }
  return null;
}

/**
 * Inspects the raw endpoint URL before and after WHATWG URL parsing
 * to detect malicious evasions (hex IPs, pure integers, octal IPs, shorthand IPs, URL userinfo, percent encoding).
 * 
 * @param {string} rawUrl 
 * @param {URL} parsed 
 * @returns {string|null} Error reason string or null if clean
 */
export function detectObfuscatedHost(rawUrl, parsed) {
  // 1. Credentials in URL (RFC 3986 userinfo) are disallowed to prevent parser confusion & credential leak
  if (parsed.username || parsed.password) {
    return "禁止在 API 端点 URL 中嵌入用户名或密码等身份凭据。";
  }

  // Extract raw authority before WHATWG normalizes it
  const withoutProto = String(rawUrl).replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const authority = withoutProto.split("/")[0].split("?")[0].split("#")[0];
  if (authority.includes("@")) {
    return "禁止在 API 端点 URL 中嵌入身份凭据。";
  }

  // Strip port
  let hostPart = authority;
  if (hostPart.startsWith("[")) {
    const bracketEnd = hostPart.indexOf("]");
    if (bracketEnd > 0) {
      hostPart = hostPart.slice(0, bracketEnd + 1);
    }
  } else {
    hostPart = hostPart.split(":")[0];
  }

  // 2. URL-encoding in host
  if (/%[0-9a-fA-F]{2}/.test(hostPart)) {
    return "禁止使用 URL 编码混淆 API 端点主机名。";
  }

  // 3. Hexadecimal IP representation (e.g. 0x7f000001 or 0x7f.1)
  if (/0x[0-9a-f]/i.test(hostPart)) {
    return "禁止使用十六进制混淆 IP 作为 API 端点。";
  }

  // 4. Pure decimal integer representation (e.g. 2130706433)
  if (/^\d+$/.test(hostPart)) {
    return "禁止使用十进制整数混淆 IP 作为 API 端点。";
  }

  // 5. Dotted numeric IPv4 representation (check octal & shorthand notation)
  if (/^[\d.]+$/.test(hostPart)) {
    const octets = hostPart.split(".");
    if (octets.length !== 4) {
      return "禁止使用缩写/非标准 IPv4 地址格式作为 API 端点。";
    }
    for (const oct of octets) {
      // Octal check: starts with 0 and has length > 1
      if (oct.length > 1 && oct.startsWith("0")) {
        return "禁止使用八进制混淆 IP 作为 API 端点。";
      }
      const num = parseInt(oct, 10);
      if (isNaN(num) || num < 0 || num > 255) {
        return "无效的 IPv4 地址段。";
      }
    }
  }

  return null;
}

/**
 * Checks if a hostname or IP string corresponds to a private or local address.
 * 
 * @param {string} rawHostname 
 * @returns {boolean}
 */
export function isPrivateOrLocalHost(rawHostname) {
  if (!rawHostname || typeof rawHostname !== "string") {
    return false;
  }
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Check IPv6-mapped IPv4
  const mappedIpv4 = parseIpv6MappedIpv4(hostname);
  if (mappedIpv4 && isPrivateOrLocalHost(mappedIpv4)) {
    return true;
  }

  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    hostname === "::" ||
    hostname === "0.0.0.0" ||
    /^0\./.test(hostname) ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".home.arpa")
  );
}

/**
 * Checks if a hostname corresponds to cloud instance metadata services (AWS/GCP/Azure/OpenStack).
 * 
 * @param {string} rawHostname 
 * @returns {boolean}
 */
export function isCloudMetadataHost(rawHostname) {
  if (!rawHostname || typeof rawHostname !== "string") {
    return false;
  }
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");

  const mappedIpv4 = parseIpv6MappedIpv4(hostname);
  if (mappedIpv4 && isCloudMetadataHost(mappedIpv4)) {
    return true;
  }

  return (
    /^169\.254\./.test(hostname) ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata.internal" ||
    hostname === "instance-data" ||
    hostname.includes("169.254.169.254") ||
    hostname.includes("169.254.169.253") ||
    hostname.includes("169.254.170.2") ||
    hostname === "fd00:ec2::254" ||
    hostname.startsWith("fd00:ec2:")
  );
}

/**
 * Checks if input text is likely a local AI service endpoint
 * (e.g. Ollama, LM Studio, vLLM, LocalAI, text-generation-webui).
 * 
 * @param {string} input 
 * @returns {boolean}
 */
export function isLikelyLocalEndpoint(input) {
  if (!input || typeof input !== "string") {
    return false;
  }
  const str = input.trim().toLowerCase();
  if (
    str.includes("localhost") ||
    str.includes("127.0.0.1") ||
    str.includes("::1") ||
    str.includes("0.0.0.0")
  ) {
    return true;
  }
  // Common local AI model server ports
  if (
    str.includes(":11434") || // Ollama
    str.includes(":1234") ||  // LM Studio
    str.includes(":8000") ||  // vLLM / FastAPI
    str.includes(":8080") ||  // llama.cpp / LocalAI
    str.includes(":5000") ||  // LocalAI / Oobabooga
    str.includes(":7860")     // Gradio / WebUI
  ) {
    return true;
  }
  // Private LAN IP prefix
  if (/^(?:https?:\/\/)?(?:192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(str)) {
    return true;
  }
  return false;
}

/**
 * Normalizes OpenAI-compatible base URL.
 * Automatically prepends http:// or https:// if scheme is missing,
 * strips redundant endpoint suffixes (/chat/completions, /completions),
 * and appends /v1 for Ollama and local LLM servers when omitted.
 * 
 * @param {string} rawUrl 
 * @returns {string} Normalized URL
 */
export function normalizeOpenAiBaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }
  let trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  // Prepend scheme if user entered scheme-less URL
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    if (trimmed.startsWith("//")) {
      trimmed = `http:${trimmed}`;
    } else if (isLikelyLocalEndpoint(trimmed)) {
      trimmed = `http://${trimmed}`;
    } else {
      trimmed = `https://${trimmed}`;
    }
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const isLocal = isPrivateOrLocalHost(host);
    const isOllamaPort = url.port === "11434";

    // Strip redundant trailing completions path if mistakenly included in Base URL
    if (url.pathname.endsWith("/chat/completions")) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, "");
    } else if (url.pathname.endsWith("/completions")) {
      url.pathname = url.pathname.replace(/\/completions$/, "");
    }

    const cleanPath = url.pathname.replace(/\/+$/, "");

    // If it's Ollama or local LLM server and path is empty or "/", auto-append /v1
    if ((isOllamaPort || isLocal) && (cleanPath === "" || cleanPath === "/")) {
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }

    // Return trimmed URL without trailing slash if path is "/"
    if (url.pathname === "/") {
      return url.origin;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

/**
 * Validates endpoint URL against SSRF rules and protocol constraints.
 * 
 * @param {string} url 
 * @param {boolean} allowLocalEndpoints 
 * @returns {boolean} true if valid, throws descriptive Error otherwise.
 */
export function validateEndpointUrl(url, allowLocalEndpoints = false) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("API 地址格式不正确。");
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/g, "");
  const isPrivateOrLocal = isPrivateOrLocalHost(rawHostname);

  // 1. Obfuscated IPs & Userinfo are blocked as SSRF evasion attempts
  const obfuscationError = detectObfuscatedHost(url, parsed);
  if (obfuscationError) {
    throw new Error(`SSRF_BLOCKED: ${obfuscationError}`);
  }

  // 2. Cloud metadata endpoints are strictly forbidden regardless of flags
  if (isCloudMetadataHost(rawHostname)) {
    throw new Error("SSRF_BLOCKED: 为防范凭据泄露，严禁请求云服务器实例元数据服务（169.254.169.254）。");
  }

  // 3. Port validation & dangerous ports block
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "https:" ? 443 : 80);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error("SSRF_BLOCKED: API 端点端口号无效（必须在 1-65535 范围内）。");
  }
  if (DANGEROUS_PORTS.has(port)) {
    throw new Error(`SSRF_BLOCKED: 禁止访问高危系统或敏感服务端口（${port}）。`);
  }

  // 4. Protocol validation:
  if (parsed.protocol !== "https:") {
    if (parsed.protocol !== "http:") {
      throw new Error(`UNSUPPORTED_PROTOCOL: 不受支持的协议 ${parsed.protocol}，仅允许 HTTP 或 HTTPS。`);
    }
    // HTTP is only permitted when allowLocalEndpoints is true AND the target is private/local
    if (!allowLocalEndpoints) {
      throw new Error("HTTPS_REQUIRED: 为保障安全，API 请求仅允许使用 HTTPS 协议。如需使用本地/局域网接口，请在设置中开启对应选项。");
    }
    if (!isPrivateOrLocal) {
      throw new Error("HTTPS_REQUIRED: 公网 API 仅允许使用 HTTPS 协议，禁止明文 HTTP 传输数据。");
    }
  }

  // 5. Private / local network access requires explicit opt-in
  if (isPrivateOrLocal && !allowLocalEndpoints) {
    throw new Error("SSRF_BLOCKED: 为防止内网穿透与安全风险，默认禁止请求私网或本地回环地址。如需使用本地 Ollama 等服务，请在高级设置中开启“允许本地/局域网端点”。");
  }

  return true;
}

/**
 * Validates configured endpoint from an apiConfig object.
 * 
 * @param {object} apiConfig 
 */
export function validateConfiguredEndpoint(apiConfig) {
  const mode = apiConfig?.mode || "openai-compatible";
  let targetUrl = mode === "custom" ? apiConfig?.customUrl : apiConfig?.baseUrl;
  if (!targetUrl) {
    return true; // Empty URL will be caught by "baseUrl is required" check later
  }
  if (mode !== "custom") {
    targetUrl = normalizeOpenAiBaseUrl(targetUrl);
  }
  validateEndpointUrl(targetUrl, Boolean(apiConfig?.allowLocalEndpoints));
  return true;
}

/**
 * Extracts origin permission patterns required for chrome.permissions.
 * 
 * @param {object} apiConfig 
 * @returns {string[]}
 */
export function getApiPermissionOrigins(apiConfig) {
  const urls = [];
  const mode = apiConfig?.mode || "openai-compatible";
  if (mode === "openai-compatible" && apiConfig?.baseUrl) {
    urls.push(normalizeOpenAiBaseUrl(apiConfig.baseUrl));
  }
  if (mode === "custom" && apiConfig?.customUrl) {
    urls.push(apiConfig.customUrl);
  }

  return [...new Set(urls.map(toOriginPermissionPattern).filter(Boolean))];
}

/**
 * Converts a URL to origin permission pattern.
 * Safely maps IPv6 loopback to 127.0.0.1 since Chromium match patterns do not support bracketed IPv6.
 * 
 * @param {string} value 
 * @returns {string}
 */
export function toOriginPermissionPattern(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    const rawHostname = url.hostname.toLowerCase();
    const hostname = rawHostname.replace(/^\[|\]$/g, "");
    if (hostname.includes(":") || hostname === "::1") {
      return `${url.protocol}//127.0.0.1/*`;
    }
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

/**
 * DNR dynamic rules to rewrite Origin for Ollama cross-origin requests.
 * Restricts initiator to the extension ID when available to prevent third-party drive-by CSRF attacks.
 * 
 * @param {string} [extensionId]
 * @returns {object[]}
 */
export function getOllamaDnrRules(extensionId) {
  const extId = extensionId || (typeof chrome !== "undefined" && chrome?.runtime?.id) || "";
  const conditionProps = {};
  if (extId) {
    conditionProps.initiatorDomains = [extId];
  }

  return [
    {
      id: OLLAMA_DNR_RULE_LOCALHOST_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Origin",
            operation: "set",
            value: "http://localhost"
          }
        ]
      },
      condition: {
        ...conditionProps,
        urlFilter: "||localhost",
        resourceTypes: ["xmlhttprequest", "other"]
      }
    },
    {
      id: OLLAMA_DNR_RULE_127001_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Origin",
            operation: "set",
            value: "http://127.0.0.1"
          }
        ]
      },
      condition: {
        ...conditionProps,
        urlFilter: "||127.0.0.1",
        resourceTypes: ["xmlhttprequest", "other"]
      }
    }
  ];
}
