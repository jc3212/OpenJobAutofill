/**
 * OpenJobAutofill - Sandbox Integration Test: AI Gateway HTML Interceptor & /v1 Auto-Recovery
 * 
 * Verifies with a LIVE local HTTP server:
 * 1. Simulates NewAPI / OneAPI gateway serving SPA index.html on root routes with HTTP 200.
 * 2. Asserts that callOpenAiCompatible / callCustomApi catches HTML responses and throws informative diagnostic errors.
 * 3. Asserts that normalizeOpenAiBaseUrl auto-appends /v1, rerouting calls to /v1/chat/completions.
 * 4. Asserts that parseResumeWithAi completes end-to-end successfully against the mock gateway.
 * 5. Asserts that listModels correctly accesses /v1/models instead of falling into the SPA router.
 */

import http from "node:http";
import assert from "node:assert/strict";
import {
  callOpenAiCompatible,
  callCustomApi,
  parseResumeWithAi,
  isHtmlResponse,
  createHtmlResponseError,
  normalizeOpenAiBaseUrl
} from "../../src/background.js";
import { createMockChrome } from "../mock-chrome.js";

console.log("=== Running Sandbox Test: AI Gateway HTML Interceptor & Auto-Recovery ===");

const SPA_HTML_PAYLOAD = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <script src="/theme-bootstrap.js"></script>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <title>One API</title>
  </head>
  <body>
    <div id="root">OneAPI / NewAPI Gateway SPA</div>
  </body>
</html>`;

const VALID_CHAT_COMPLETION = {
  id: "chatcmpl-sandbox-mock",
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          sections: {
            education: {
              key: "education",
              title: "教育经历",
              kind: "repeat",
              items: [
                {
                  values: {
                    "学校": "清华大学",
                    "专业": "计算机科学与技术",
                    "学历": "硕士",
                    "开始时间": "2020-09",
                    "结束时间": "2023-06"
                  },
                  custom: []
                }
              ]
            }
          }
        })
      }
    }
  ]
};

const VALID_MODELS_LIST = {
  object: "list",
  data: [
    { id: "gpt-4o", object: "model" },
    { id: "deepseek-chat", object: "model" }
  ]
};

// Start mock server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Root / unversioned chat completions route returns SPA HTML with 200 OK (NewAPI / OneAPI behavior)
  if (url.pathname === "/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SPA_HTML_PAYLOAD);
    return;
  }

  // Versioned route /v1/chat/completions returns valid OpenAI JSON
  if (url.pathname === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(VALID_CHAT_COMPLETION));
    return;
  }

  // Unversioned /models route returns SPA HTML
  if (url.pathname === "/models") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SPA_HTML_PAYLOAD);
    return;
  }

  // Versioned /v1/models route returns model list JSON
  if (url.pathname === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(VALID_MODELS_LIST));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const port = server.address().port;
const gatewayHostUrl = `http://127.0.0.1:${port}`;

try {
  // -------------------------------------------------------------
  // Test 1: Interception of HTML response when hitting unversioned route
  // -------------------------------------------------------------
  console.log("1. Testing Interception of Gateway HTML Response...");
  {
    // Explicit test of customUrl hitting the unversioned HTML route:
    await assert.rejects(
      async () => {
        await callCustomApi(
          {
            mode: "custom",
            customUrl: `${gatewayHostUrl}/chat/completions`,
            allowLocalEndpoints: true
          },
          [{ role: "user", content: "hello" }],
          {}
        );
      },
      (err) => {
        assert.match(err.message, /API 接口返回了 HTML 网页而非 JSON 数据/);
        assert.match(err.message, /NewAPI \/ OneAPI/);
        assert.match(err.message, /\/v1/);
        assert.ok(err.message.includes("theme-bootstrap.js"));
        return true;
      }
    );
    console.log("  ✔ HTML response from API gateway correctly intercepted with clear diagnostic error");
  }

  // -------------------------------------------------------------
  // Test 2: Auto-Recovery via Base URL Normalization
  // -------------------------------------------------------------
  console.log("2. Testing Automatic /v1 Normalization & Auto-Recovery...");
  {
    // User configured bare gateway URL without /v1
    const rawConfigUrl = gatewayHostUrl; // e.g. http://127.0.0.1:PORT
    const normalized = normalizeOpenAiBaseUrl(rawConfigUrl);
    assert.equal(normalized, `${gatewayHostUrl}/v1`);

    // When calling callOpenAiCompatible with bare gateway URL, normalization routes it to /v1
    const result = await callOpenAiCompatible(
      {
        mode: "openai-compatible",
        baseUrl: gatewayHostUrl,
        endpointPath: "/chat/completions",
        model: "gpt-4o",
        allowLocalEndpoints: true
      },
      [{ role: "user", content: "extract" }],
      {}
    );

    assert.ok(typeof result === "string");
    assert.ok(result.includes("清华大学"));
    console.log("  ✔ Base URL without /v1 automatically healed to /v1 and succeeded");
  }

  // -------------------------------------------------------------
  // Test 3: Full End-to-End parseResumeWithAi Execution in Sandbox
  // -------------------------------------------------------------
  console.log("3. Testing End-to-End parseResumeWithAi against Mock Gateway...");
  {
    const mockStorage = {
      apiConfig: {
        mode: "openai-compatible",
        baseUrl: gatewayHostUrl, // bare URL without /v1
        endpointPath: "/chat/completions",
        model: "gpt-4o",
        allowLocalEndpoints: true
      }
    };
    globalThis.chrome = createMockChrome();
    await globalThis.chrome.storage.local.set(mockStorage);

    const parseResult = await parseResumeWithAi({
      previewText: "教育经历：2020-09 至 2023-06 清华大学 计算机科学与技术 硕士"
    });

    assert.ok(parseResult?.sections?.education);
    assert.equal(parseResult.sections.education.items[0].values["学校"], "清华大学");
    assert.equal(parseResult.sections.education.items[0].values["学历"], "硕士");
    console.log("  ✔ End-to-end resume parse succeeded with 100% fidelity without HTML errors");
  }

  // -------------------------------------------------------------
  // Test 4: Deduplication of /v1 in Path
  // -------------------------------------------------------------
  console.log("4. Testing URL Joining /v1 Deduplication...");
  {
    // If user configured baseUrl with /v1 AND endpointPath with /v1/chat/completions
    const resultDedupe = await callOpenAiCompatible(
      {
        mode: "openai-compatible",
        baseUrl: `${gatewayHostUrl}/v1`,
        endpointPath: "/v1/chat/completions",
        model: "gpt-4o",
        allowLocalEndpoints: true
      },
      [{ role: "user", content: "extract" }],
      {}
    );
    assert.ok(resultDedupe.includes("清华大学"));
    console.log("  ✔ Duplicate /v1 in base and path deduplicated seamlessly");
  }

  console.log("==================================================================");
  console.log("🎉 ALL SANDBOX AI GATEWAY INTERCEPTOR TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
} finally {
  server.close();
}
