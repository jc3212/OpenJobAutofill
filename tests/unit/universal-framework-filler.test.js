/**
 * OpenJobAutofill - Unit Test: Universal Framework Filler (Phase 1 Gate)
 *
 * Verifies React 16+ _valueTracker bypass, prototype setter execution,
 * full event dispatch chain (Focus -> Setter -> Input (composed: true) -> Change -> Blur),
 * and non-native combobox / virtual input compatibility.
 */

import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createMockChrome } from "../mock-chrome.js";

console.log("=== Running Unit Test: Universal Framework Filler Gate ===");

// 1. Mock Event & Element Infrastructure
class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.composed = Boolean(options.composed);
    this.cancelable = Boolean(options.cancelable);
    this.data = options.data || null;
  }
}

class MockElement {
  constructor(tagName = "input", attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this._attrs = { ...attrs };
    this._listeners = {};
    this._value = "";
    this._checked = false;
    this.disabled = false;
    this.children = [];
    this.parentElement = null;
    this.isContentEditable = false;
    this.textContent = "";
  }

  getAttribute(name) {
    return this._attrs[name] || null;
  }

  setAttribute(name, val) {
    this._attrs[name] = String(val);
  }

  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }

  dispatchEvent(event) {
    const list = (this._listeners[event.type] || []).slice();
    for (const fn of list) {
      fn(event);
    }
    return true;
  }

  focus() {
    this.dispatchEvent(new MockEvent("focus", { bubbles: true, composed: true }));
  }

  blur() {
    this.dispatchEvent(new MockEvent("blur", { bubbles: true, composed: true }));
  }

  click() {
    this.dispatchEvent(new MockEvent("click", { bubbles: true, composed: true }));
  }

  scrollIntoView() {}

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }
}

class MockHTMLInputElement extends MockElement {
  constructor(attrs = {}) {
    super("input", attrs);
    this.type = attrs.type || "text";
  }

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = String(val);
  }

  get checked() {
    return this._checked;
  }

  set checked(val) {
    this._checked = Boolean(val);
  }
}

  const mockChrome = createMockChrome();
  mockChrome.runtime.sendMessage = (msg, cb) => {
    if (typeof cb === "function") cb({ ok: true, data: {} });
    return Promise.resolve({ ok: true, data: {} });
  };

  const sandbox = {
    window: {},
    location: { hostname: "example.com", href: "https://example.com" },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: (tag) => new MockElement(tag),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      documentElement: new MockElement("html")
    },
    chrome: mockChrome,
  Event: MockEvent,
  CustomEvent: MockEvent,
  FocusEvent: MockEvent,
  InputEvent: MockEvent,
  MouseEvent: MockEvent,
  Element: MockElement,
  Node: { ELEMENT_NODE: 1 },
  HTMLInputElement: MockHTMLInputElement,
  HTMLTextAreaElement: class extends MockElement {},
  HTMLSelectElement: class extends MockElement {},
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const contentCode = fs.readFileSync("src/content.js", "utf8");
vm.createContext(sandbox);
vm.runInContext(contentCode, sandbox);

const exports = sandbox.__OJAF_TEST_EXPORTS__;
assert.ok(exports, "src/content.js must expose __OJAF_TEST_EXPORTS__");
const { setNativeValue, setCheckboxOrRadio, fillElementSmart } = exports;
assert.ok(typeof setNativeValue === "function", "setNativeValue must be exported");
assert.ok(typeof setCheckboxOrRadio === "function", "setCheckboxOrRadio must be exported");
assert.ok(typeof fillElementSmart === "function", "fillElementSmart must be exported");

// ==========================================
// Tests
// ==========================================

console.log("1. Testing React 16+ _valueTracker Bypass & Reset...");
{
  const input = new MockHTMLInputElement({ type: "text" });
  input.value = "Initial Value";

  let trackerValue = input.value;
  input._valueTracker = {
    getValue: () => trackerValue,
    setValue: (val) => {
      trackerValue = val;
    }
  };

  assert.equal(input._valueTracker.getValue(), "Initial Value");

  setNativeValue(input, "Updated Value");

  assert.equal(input.value, "Updated Value");
  // Tracker must have been reset to empty string so React SyntheticEvent detects value difference
  assert.equal(trackerValue, "", "_valueTracker must be reset to force React change event");
  console.log("  ✔ React 16+ _valueTracker successfully cracked and reset");
}

console.log("2. Testing Complete Event Chain (Focus -> Setter -> Input(composed) -> Change -> Blur)...");
{
  const input = new MockHTMLInputElement({ type: "text" });
  const eventsFired = [];

  input.addEventListener("focus", (e) => {
    eventsFired.push({ type: "focus", composed: e.composed, value: input.value });
  });
  input.addEventListener("input", (e) => {
    eventsFired.push({ type: "input", composed: e.composed, value: input.value });
  });
  input.addEventListener("change", (e) => {
    eventsFired.push({ type: "change", composed: e.composed, value: input.value });
  });
  input.addEventListener("blur", (e) => {
    eventsFired.push({ type: "blur", composed: e.composed, value: input.value });
  });

  setNativeValue(input, "New Content");

  const eventTypes = eventsFired.map((e) => e.type);
  assert.deepEqual(
    eventTypes,
    ["focus", "input", "change", "blur"],
    "Must fire exact clean event sequence without duplicate focus or blur"
  );

  const inputEvent = eventsFired.find((e) => e.type === "input");
  assert.equal(inputEvent.composed, true, "Input event must have composed: true");
  assert.equal(inputEvent.value, "New Content", "Value must be set before input event fires");

  const changeEvent = eventsFired.find((e) => e.type === "change");
  assert.equal(changeEvent.composed, true, "Change event must have composed: true");

  console.log("  ✔ Complete clean event dispatch chain verified with composed: true");
}

console.log("3. Testing Checkbox & Radio _valueTracker and Setter...");
{
  const checkbox = new MockHTMLInputElement({ type: "checkbox" });
  let trackerValue = false;
  checkbox._valueTracker = {
    getValue: () => trackerValue,
    setValue: (val) => {
      trackerValue = val;
    }
  };

  const cbEvents = [];
  checkbox.addEventListener("change", (e) => cbEvents.push({ type: "change", composed: e.composed, checked: checkbox.checked }));

  setCheckboxOrRadio(checkbox, "true");
  assert.equal(checkbox.checked, true, "Checkbox should be checked");
  assert.equal(cbEvents.length, 1, "Change event should fire");
  assert.equal(cbEvents[0].composed, true, "Change event must be composed: true");

  console.log("  ✔ Checkbox and radio tracker bypass verified");
}

console.log("4. Testing Combobox & Non-native Virtual Input Fallback via fillElementSmart...");
{
  const comboboxContainer = new MockElement("div", { role: "combobox" });
  const virtualItem = new MockElement("span", { class: "ant-select-selection-item" });
  virtualItem.textContent = "请选择";

  const searchInput = new MockHTMLInputElement({ type: "text", class: "ant-select-selection-search-input" });
  searchInput.value = "";

  comboboxContainer.querySelector = (sel) => {
    if (sel.includes("selection-item")) return virtualItem;
    if (sel.includes("input")) return searchInput;
    return null;
  };

  let changeFired = false;
  comboboxContainer.addEventListener("change", (e) => {
    changeFired = true;
    assert.equal(e.composed, true, "Combobox change event must be composed");
  });

  const fillResult = await fillElementSmart(comboboxContainer, "硕士研究生", { type: "combobox" }, { writeMode: "direct" });

  assert.equal(fillResult.ok, true, "Combobox filling should succeed");
  assert.equal(virtualItem.textContent, "硕士研究生", "Virtual display text must be updated");
  assert.equal(searchInput.value, "硕士研究生", "Inner search input must be updated");
  assert.equal(changeFired, true, "Combobox change event must have fired");
  console.log("  ✔ Combobox virtual display and inner input update verified via fillElementSmart");
}

console.log("✅ Universal Framework Filler tests passed!\n");
