/**
 * OpenJobAutofill - Safe PDF Text Extractor with Local Worker and No-Eval CSP Compliance
 */

export async function parsePdfFile(arrayBuffer) {
  if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("无效的文件数据。");
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error("PDF 文件体积超过 10 MiB 限制。");
  }

  // Load PDF.js bundle
  if (typeof pdfjsLib === "undefined") {
    await import("./vendor/pdf.min.js");
  }

  // Configure local worker and disable eval
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("src/lib/vendor/pdf.worker.min.js");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    isEvalSupported: false,
    useSystemFonts: true,
    stopAtErrors: false
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  if (numPages > 30) {
    throw new Error(`PDF 页数过多（共 ${numPages} 页，最多支持 30 页），请使用精简版简历。`);
  }

  const warnings = [];
  const allPageLines = [];
  let totalChars = 0;
  let emptyPageCount = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent?.items || [];

    if (items.length === 0) {
      emptyPageCount++;
      warnings.push(`第 ${pageNum} 页未检测到文本图层（疑似纯图片扫描页）。`);
      continue;
    }

    // Sort items by vertical position (top to bottom), then horizontal position (left to right)
    // In PDF coordinates: Y increases upwards, so higher transform[5] means higher on page
    const sorted = items.slice().sort((a, b) => {
      const yA = a.transform ? a.transform[5] : 0;
      const yB = b.transform ? b.transform[5] : 0;
      // If approximately same line (within 4 points threshold)
      if (Math.abs(yA - yB) > 4) {
        return yB - yA; // top to bottom
      }
      const xA = a.transform ? a.transform[4] : 0;
      const xB = b.transform ? b.transform[4] : 0;
      return xA - xB; // left to right
    });

    const pageLines = [];
    let currentLineY = null;
    let currentLineTexts = [];

    for (const item of sorted) {
      const text = String(item.str || "").trim();
      if (!text) continue;

      const y = item.transform ? item.transform[5] : 0;
      if (currentLineY === null || Math.abs(y - currentLineY) <= 4) {
        currentLineTexts.push(text);
        currentLineY = y;
      } else {
        if (currentLineTexts.length > 0) {
          pageLines.push(currentLineTexts.join(" "));
        }
        currentLineTexts = [text];
        currentLineY = y;
      }
    }

    if (currentLineTexts.length > 0) {
      pageLines.push(currentLineTexts.join(" "));
    }

    if (pageLines.length === 0) {
      emptyPageCount++;
      warnings.push(`第 ${pageNum} 页未提取到有效文本。`);
    } else {
      allPageLines.push(pageLines.join("\n"));
      totalChars += pageLines.reduce((acc, l) => acc + l.length, 0);
    }
  }

  if (emptyPageCount === numPages) {
    warnings.unshift("警告：该 PDF 所有页面均未检测到文本，极可能是图片扫描件。插件仅支持文本型 PDF，无法直接进行 OCR 文字识别。");
  }

  let rawText = allPageLines.join("\n\n").trim();
  if (rawText.length > 100000) {
    rawText = rawText.slice(0, 100000);
    warnings.push("提取文本超过 100,000 字符上限，已自动截断。");
  }

  return {
    rawText,
    warnings,
    stats: {
      type: "pdf",
      pageCount: numPages,
      emptyPageCount,
      charCount: rawText.length
    }
  };
}
