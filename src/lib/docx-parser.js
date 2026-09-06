/**
 * OpenJobAutofill - Safe DOCX Parser with Allowlist Entry Reading and Table Structure Preservation
 */

export async function parseDocxFile(arrayBuffer) {
  if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("无效的文件数据。");
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error("文件体积超过 10 MiB 限制。");
  }

  // Ensure JSZip is loaded
  if (typeof JSZip === "undefined") {
    await import("./vendor/jszip.min.js");
  }

  const zip = new JSZip();
  let loadedZip;
  try {
    loadedZip = await zip.loadAsync(arrayBuffer);
  } catch (err) {
    throw new Error(`DOCX 文件解压失败，文件可能已损坏：${err.message}`);
  }

  // 1. Central directory safety check
  const files = Object.keys(loadedZip.files);
  if (files.length > 1000) {
    throw new Error("DOCX 内部条目数过多（超过 1000），拒绝解析。");
  }

  let totalUncompressedEstimate = 0;
  for (const filename of files) {
    if (filename.includes("..") || filename.startsWith("/") || filename.startsWith("\\")) {
      throw new Error(`检测到非法路径条目: ${filename}`);
    }
    const entry = loadedZip.files[filename];
    // Uncompressed size precheck if available
    const uncompressedSize = entry?._data?.uncompressedSize || 0;
    if (uncompressedSize > 10 * 1024 * 1024) {
      throw new Error(`DOCX 内部条目 [${filename}] 体积过大（超过 10 MiB），拒绝解析。`);
    }
    totalUncompressedEstimate += uncompressedSize;
    if (totalUncompressedEstimate > 50 * 1024 * 1024) {
      throw new Error("DOCX 总体积预估超过 50 MiB 上限，拒绝解析。");
    }
  }

  // Check essential entry
  if (!loadedZip.file("word/document.xml")) {
    throw new Error("不是合法的 Word (.docx) 文件（缺少 word/document.xml）。");
  }

  // 2. Load Mammoth browser converter
  if (typeof mammoth === "undefined") {
    await import("./vendor/mammoth.browser.min.js");
  }

  const warnings = [];
  const conversionResult = await mammoth.convertToHtml({ arrayBuffer });
  if (conversionResult.messages?.length) {
    for (const msg of conversionResult.messages) {
      if (msg.type === "warning") {
        warnings.push(`Word转换提示: ${msg.message}`);
      }
    }
  }

  // 3. Convert HTML to safe structured text preserving table rows and cells
  const rawHtml = conversionResult.value || "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, "text/html");

  const lines = [];
  extractNodeText(doc.body, lines);

  let rawText = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (rawText.length > 100000) {
    rawText = rawText.slice(0, 100000);
    warnings.push("提取文本超过 100,000 字符限制，已截断尾部。");
  }

  const cleanLines = lines.map((l) => l.trim()).filter(Boolean);

  return {
    rawText,
    lines: cleanLines,
    warnings,
    stats: {
      type: "docx",
      charCount: rawText.length,
      lineCount: cleanLines.length
    }
  };
}

function extractNodeText(node, lines) {
  if (!node) return;

  const tagName = node.nodeName?.toLowerCase();

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) lines.push(text);
    return;
  }

  // Disallowed tags: ignore script, style, iframe, form, etc.
  if (["script", "style", "iframe", "form", "svg", "button", "input"].includes(tagName)) {
    return;
  }

  // Handle table specially to preserve rows and cells
  if (tagName === "table") {
    const rows = node.querySelectorAll("tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("th, td");
      const cellTexts = [];
      for (const cell of cells) {
        const cellText = cell.textContent?.trim();
        if (cellText) cellTexts.push(cellText);
      }
      if (cellTexts.length > 0) {
        lines.push(cellTexts.join(" | "));
      }
    }
    return;
  }

  if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(tagName)) {
    const childTexts = [];
    for (const child of node.childNodes) {
      const t = child.textContent?.trim();
      if (t) childTexts.push(t);
    }
    const combined = childTexts.join(" ");
    if (combined) {
      lines.push(combined);
    }
    return;
  }

  // Recurse for general containers
  for (const child of node.childNodes) {
    extractNodeText(child, lines);
  }
}
