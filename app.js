import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";

const { PDFDocument } = window.PDFLib;

const OUTPUT_FOLDER = "Strata_Output";
const REVIEW_FOLDER = "Review_Folder";
const SETTINGS_KEY = "strata-splitter-settings-v2";

const SEGMENT_TYPES = {
  text: "Fixed text",
  letters: "Letters (A–Z)",
  digits: "Digits (0–9)",
  alnum: "Letters or digits"
};

const PRESETS = {
  classic: {
    label: "Classic — H5-0G-01",
    segments: [
      { type: "text", value: "H5", name: "Project" },
      { type: "text", value: "-", name: "" },
      { type: "alnum", min: 2, max: 2, name: "Floor" },
      { type: "text", value: "-", name: "" },
      { type: "alnum", min: 2, max: 2, name: "Unit" }
    ]
  },
  tower: {
    label: "Tower block — R2A-201 / R2B-1307",
    segments: [
      { type: "text", value: "R2", name: "Project" },
      { type: "letters", min: 1, max: 1, name: "Block" },
      { type: "text", value: "-", name: "" },
      { type: "digits", min: 1, max: 2, name: "Floor" },
      { type: "digits", min: 2, max: 2, name: "Unit" }
    ]
  }
};

const state = {
  fileName: "",
  fileBuffer: null,
  rows: [],
  evaluatedRows: [],
  busy: false,
  segments: structuredClone(PRESETS.classic.segments)
};

const elements = {
  fileInput: document.getElementById("pdf-file"),
  fileName: document.getElementById("file-name"),
  preset: document.getElementById("preset"),
  segmentList: document.getElementById("segment-list"),
  addSegment: document.getElementById("add-segment"),
  sampleCode: document.getElementById("sample-code"),
  sampleResult: document.getElementById("sample-result"),
  marker: document.getElementById("marker"),
  customRegex: document.getElementById("custom-regex"),
  regexPreview: document.getElementById("regex-preview"),
  scanButton: document.getElementById("scan-button"),
  zipButton: document.getElementById("zip-button"),
  message: document.getElementById("message"),
  progressWrap: document.getElementById("progress-wrap"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  summaryTotal: document.getElementById("summary-total"),
  summarySuccess: document.getElementById("summary-success"),
  summaryReview: document.getElementById("summary-review"),
  summaryDuplicates: document.getElementById("summary-duplicates"),
  duplicateAlert: document.getElementById("duplicate-alert"),
  resultsBody: document.getElementById("results-body"),
  previewTitle: document.getElementById("preview-title"),
  previewCanvas: document.getElementById("preview-canvas")
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function padPage(pageNumber) {
  return String(pageNumber).padStart(3, "0");
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values) {
  return [...new Set(values.map(cleanCode).filter(Boolean))];
}

function clampLength(value, fallback = 1) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 1), 8);
}

function normalizeSegment(segment) {
  const type = SEGMENT_TYPES[segment?.type] ? segment.type : "text";
  const name = String(segment?.name || "").slice(0, 24);

  if (type === "text") {
    return { type, value: cleanCode(segment?.value || ""), name };
  }

  const min = clampLength(segment?.min);
  const max = Math.max(clampLength(segment?.max, min), min);
  return { type, min, max, name };
}

function segmentToRegex(segment) {
  if (segment.type === "text") {
    return escapeRegex(segment.value);
  }

  const characterClass =
    segment.type === "letters" ? "[A-Z]" : segment.type === "digits" ? "[0-9]" : "[A-Z0-9]";
  const quantifier =
    segment.min === segment.max ? `{${segment.min}}` : `{${segment.min},${segment.max}}`;
  return `${characterClass}${quantifier}`;
}

function getSettings() {
  return {
    segments: state.segments.map(normalizeSegment),
    customRegex: elements.customRegex.value.trim(),
    titleMarker: elements.marker.value.trim() || "STRATA UNIT DETAILS",
    contextWindow: 260
  };
}

function getRegexSource(settings = getSettings()) {
  if (settings.customRegex) {
    return settings.customRegex;
  }

  return settings.segments.map(segmentToRegex).join("");
}

function getCodeRegex(settings = getSettings()) {
  return new RegExp(`(?<![A-Z0-9])${getRegexSource(settings)}(?![A-Z0-9])`, "gi");
}

function getIssueFileName(row, effectiveCode) {
  const issue = String(row.issueType || "Review")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const page = `Page_${padPage(row.pageNumber)}`;

  if (effectiveCode) {
    return `${effectiveCode}_${issue}_${page}.pdf`;
  }

  return `${page}_REVIEW_${issue || "issue"}.pdf`;
}

function detectCodeFromText(rawText, settings) {
  const text = normalizeText(rawText);
  const markerIndex = text.toUpperCase().indexOf(settings.titleMarker.toUpperCase());
  const scopedText =
    markerIndex >= 0
      ? text.slice(markerIndex, markerIndex + settings.contextWindow)
      : text;

  const scopedMatches = uniqueValues(scopedText.match(getCodeRegex(settings)) || []);
  const allMatches = uniqueValues(text.match(getCodeRegex(settings)) || []);
  const matches = scopedMatches.length ? scopedMatches : allMatches;
  const snippetSource = scopedMatches.length ? scopedText : text;
  const firstMatch = matches[0] || "";
  const snippetIndex = firstMatch ? snippetSource.indexOf(firstMatch) : -1;
  const matchedSnippet =
    snippetIndex >= 0
      ? snippetSource.slice(Math.max(0, snippetIndex - 80), snippetIndex + 120)
      : scopedText.slice(0, 180);

  if (!matches.length) {
    return {
      detectedCode: "",
      candidateCodes: [],
      issueType: "Missing code",
      issueDetails: "No matching unit code was found on this page.",
      matchedSnippet
    };
  }

  if (matches.length > 1) {
    return {
      detectedCode: matches[0],
      candidateCodes: matches,
      issueType: "Multiple codes found",
      issueDetails: `Found multiple different codes: ${matches.join(", ")}.`,
      matchedSnippet
    };
  }

  return {
    detectedCode: matches[0],
    candidateCodes: matches,
    issueType: "",
    issueDetails: "",
    matchedSnippet
  };
}

function evaluateRows(rows, settings = getSettings()) {
  const codeMap = new Map();

  rows.forEach((row) => {
    const effectiveCode = cleanCode(row.manualCode || row.detectedCode || "");
    if (!effectiveCode) return;

    if (!codeMap.has(effectiveCode)) {
      codeMap.set(effectiveCode, []);
    }

    codeMap.get(effectiveCode).push(row.pageNumber);
  });

  return rows.map((row) => {
    const manualCode = cleanCode(row.manualCode || "");
    const effectiveCode = manualCode || cleanCode(row.detectedCode || "");
    const issues = [];

    if (!effectiveCode) {
      issues.push({
        type: "Missing code",
        details: "No unit code is available for this page."
      });
    } else if (!getCodeRegex(settings).test(effectiveCode)) {
      issues.push({
        type: "Pattern mismatch",
        details: `Code does not match ${getRegexSource(settings)}.`
      });
    }

    if (!manualCode && row.issueType === "Multiple codes found") {
      issues.push({
        type: "Multiple codes found",
        details: row.issueDetails
      });
    }

    if (effectiveCode && (codeMap.get(effectiveCode) || []).length > 1) {
      issues.push({
        type: "Duplicate code",
        details: `Same code appears on pages ${(codeMap.get(effectiveCode) || []).join(", ")}.`
      });
    }

    const primaryIssue = issues[0];
    const status = primaryIssue ? "Review" : "Success";

    return {
      ...row,
      manualCode,
      effectiveCode,
      status,
      issueType: primaryIssue?.type || "",
      issueDetails: primaryIssue?.details || "",
      outputFileName:
        status === "Success"
          ? `${effectiveCode}.pdf`
          : getIssueFileName({ ...row, issueType: primaryIssue?.type || "Review" }, effectiveCode)
    };
  });
}

function setBusy(label) {
  state.busy = Boolean(label);
  elements.scanButton.disabled = state.busy || !state.fileBuffer;
  elements.zipButton.disabled = state.busy || !state.evaluatedRows.length;
  elements.scanButton.textContent = label === "scan" ? "Scanning..." : "Scan PDF";
  elements.zipButton.textContent = label === "zip" ? "Generating..." : "Download ZIP";
}

function setMessage(value) {
  elements.message.textContent = value || "";
}

function updateSampleTester() {
  const sample = cleanCode(elements.sampleCode.value);
  if (!sample) {
    elements.sampleResult.textContent = "";
    elements.sampleResult.className = "sample-result";
    return;
  }

  try {
    const matches = new RegExp(`^(?:${getRegexSource()})$`, "i").test(sample);
    elements.sampleResult.textContent = matches ? "Match" : "No match";
    elements.sampleResult.className = `sample-result ${matches ? "pass" : "fail"}`;
  } catch (error) {
    elements.sampleResult.textContent = "Invalid pattern";
    elements.sampleResult.className = "sample-result fail";
  }
}

function updateRegexPreview() {
  try {
    elements.regexPreview.textContent = getRegexSource();
    getCodeRegex();
    setMessage("");
  } catch (error) {
    elements.regexPreview.textContent = "Invalid regex";
    setMessage(`Regex error: ${error.message}`);
  }
  updateSampleTester();
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        segments: state.segments,
        marker: elements.marker.value,
        customRegex: elements.customRegex.value,
        preset: elements.preset.value
      })
    );
  } catch (error) {
    // Storage may be unavailable (private mode); settings simply won't persist.
  }
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!stored) return;
    if (Array.isArray(stored.segments) && stored.segments.length) {
      state.segments = stored.segments.map(normalizeSegment);
    }
    if (typeof stored.marker === "string" && stored.marker.trim()) {
      elements.marker.value = stored.marker;
    }
    if (typeof stored.customRegex === "string") {
      elements.customRegex.value = stored.customRegex;
    }
    if (stored.preset && (PRESETS[stored.preset] || stored.preset === "custom")) {
      elements.preset.value = stored.preset;
    }
  } catch (error) {
    // Ignore corrupted stored settings and fall back to defaults.
  }
}

function matchingPresetKey() {
  const current = JSON.stringify(state.segments.map(normalizeSegment));
  return (
    Object.keys(PRESETS).find(
      (key) => JSON.stringify(PRESETS[key].segments.map(normalizeSegment)) === current
    ) || "custom"
  );
}

function onSettingsChanged() {
  elements.preset.value = matchingPresetKey();
  updateRegexPreview();
  saveSettings();
  if (state.rows.length) {
    refreshResults();
  }
}

function segmentFieldControls(segment, index) {
  if (segment.type === "text") {
    return `<input class="segment-value" data-index="${index}" data-field="value" value="${escapeXml(
      segment.value
    )}" placeholder="Text, e.g. R2 or -" />`;
  }

  return `
    <div class="segment-lengths">
      <input type="number" min="1" max="8" data-index="${index}" data-field="min" value="${segment.min}" aria-label="Minimum length" />
      <span>&ndash;</span>
      <input type="number" min="1" max="8" data-index="${index}" data-field="max" value="${segment.max}" aria-label="Maximum length" />
    </div>`;
}

function renderSegments() {
  state.segments = state.segments.map(normalizeSegment);

  elements.segmentList.innerHTML = state.segments
    .map((segment, index) => {
      const typeOptions = Object.entries(SEGMENT_TYPES)
        .map(
          ([key, label]) =>
            `<option value="${key}"${key === segment.type ? " selected" : ""}>${label}</option>`
        )
        .join("");

      return `
        <div class="segment-row">
          <select data-index="${index}" data-field="type">${typeOptions}</select>
          ${segmentFieldControls(segment, index)}
          <input class="segment-name" data-index="${index}" data-field="name" value="${escapeXml(
            segment.name || ""
          )}" placeholder="Label" />
          <div class="segment-actions">
            <button type="button" class="icon-button" data-move="-1" data-index="${index}" title="Move up" ${
              index === 0 ? "disabled" : ""
            }>&uarr;</button>
            <button type="button" class="icon-button" data-move="1" data-index="${index}" title="Move down" ${
              index === state.segments.length - 1 ? "disabled" : ""
            }>&darr;</button>
            <button type="button" class="icon-button danger" data-remove="${index}" title="Remove segment" ${
              state.segments.length === 1 ? "disabled" : ""
            }>&times;</button>
          </div>
        </div>`;
    })
    .join("");

  elements.segmentList.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const index = Number(event.target.dataset.index);
      const field = event.target.dataset.field;
      const segment = state.segments[index];
      if (!segment) return;

      if (field === "type") {
        const nextType = event.target.value;
        state.segments[index] = normalizeSegment({ ...segment, type: nextType });
        renderSegments();
      } else if (field === "value" || field === "name") {
        segment[field] = event.target.value;
      } else {
        segment[field] = event.target.value;
      }

      onSettingsChanged();
    });

    input.addEventListener("change", () => {
      state.segments = state.segments.map(normalizeSegment);
      renderSegments();
      onSettingsChanged();
    });
  });

  elements.segmentList.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const target = index + Number(button.dataset.move);
      if (target < 0 || target >= state.segments.length) return;
      [state.segments[index], state.segments[target]] = [
        state.segments[target],
        state.segments[index]
      ];
      renderSegments();
      onSettingsChanged();
    });
  });

  elements.segmentList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.segments.splice(Number(button.dataset.remove), 1);
      renderSegments();
      onSettingsChanged();
    });
  });
}

function renderPresetOptions() {
  elements.preset.innerHTML = [
    ...Object.entries(PRESETS).map(([key, preset]) => `<option value="${key}">${preset.label}</option>`),
    '<option value="custom">Custom</option>'
  ].join("");
}

function updateProgress(done, total) {
  if (!total) {
    elements.progressWrap.hidden = true;
    return;
  }

  elements.progressWrap.hidden = false;
  elements.progressBar.style.width = `${(done / total) * 100}%`;
  elements.progressText.textContent = `${done} / ${total}`;
}

function renderSummary() {
  const rows = state.evaluatedRows;
  const success = rows.filter((row) => row.status === "Success").length;
  const review = rows.length - success;
  const duplicates = [
    ...new Set(
      rows
        .filter((row) => row.issueType === "Duplicate code" && row.effectiveCode)
        .map((row) => row.effectiveCode)
    )
  ];

  elements.summaryTotal.textContent = rows.length;
  elements.summarySuccess.textContent = success;
  elements.summaryReview.textContent = review;
  elements.summaryDuplicates.textContent = duplicates.length;

  if (duplicates.length) {
    elements.duplicateAlert.hidden = false;
    elements.duplicateAlert.textContent = `Duplicate code(s): ${duplicates.join(
      ", "
    )}. Change one with a manual override or keep those pages in the review folder.`;
  } else {
    elements.duplicateAlert.hidden = true;
    elements.duplicateAlert.textContent = "";
  }

  return { success, review, duplicates };
}

function renderTable() {
  if (!state.evaluatedRows.length) {
    elements.resultsBody.innerHTML =
      '<tr><td colspan="7" class="empty-state">Select a PDF and scan it to see page-level results.</td></tr>';
    return;
  }

  elements.resultsBody.innerHTML = "";

  state.evaluatedRows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.status === "Review") {
      tr.classList.add("needs-review");
    }

    tr.innerHTML = `
      <td>${row.pageNumber}</td>
      <td>${escapeXml(row.detectedCode || "None")}</td>
      <td><input class="table-input" data-page="${row.pageNumber}" value="${escapeXml(
        row.manualCode || ""
      )}" placeholder="Optional" /></td>
      <td><span class="status ${row.status.toLowerCase()}">${row.status}</span></td>
      <td>${escapeXml(row.issueType || "None")}</td>
      <td>${escapeXml(row.outputFileName)}</td>
      <td><button type="button" class="text-button" data-preview="${row.pageNumber}">View</button></td>
    `;

    elements.resultsBody.appendChild(tr);
  });

  elements.resultsBody.querySelectorAll(".table-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const pageNumber = Number(event.target.dataset.page);
      const value = cleanCode(event.target.value);
      const row = state.rows.find((item) => item.pageNumber === pageNumber);
      if (row) {
        row.manualCode = value;
      }
      refreshResults();
    });
  });

  elements.resultsBody.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      renderPreview(Number(button.dataset.preview));
    });
  });
}

function refreshResults() {
  state.evaluatedRows = evaluateRows(state.rows);
  renderSummary();
  renderTable();
  elements.zipButton.disabled = state.busy || !state.evaluatedRows.length;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function uint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function dateToDos(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return textBytes(String(data));
}

class ZipBuilder {
  constructor() {
    this.files = [];
  }

  async file(path, data) {
    this.files.push({
      path: path.replace(/^\/+/, ""),
      bytes: await toBytes(data)
    });
  }

  async blob() {
    const parts = [];
    const centralParts = [];
    let offset = 0;
    const { dosTime, dosDate } = dateToDos();

    for (const file of this.files) {
      const nameBytes = textBytes(file.path);
      const size = file.bytes.length;
      const crc = crc32(file.bytes);
      const localHeader = [
        uint32(0x04034b50),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(crc),
        uint32(size),
        uint32(size),
        uint16(nameBytes.length),
        uint16(0),
        nameBytes
      ];

      parts.push(...localHeader, file.bytes);

      const centralHeader = [
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(crc),
        uint32(size),
        uint32(size),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes
      ];

      centralParts.push(...centralHeader);
      offset += localHeader.reduce((sum, item) => sum + item.length, 0) + size;
    }

    const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
    const end = [
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(this.files.length),
      uint16(this.files.length),
      uint32(centralSize),
      uint32(offset),
      uint16(0)
    ];

    return new Blob([...parts, ...centralParts, ...end], { type: "application/zip" });
  }
}

function columnLetter(index) {
  let letter = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    current = Math.floor((current - 1) / 26);
  }
  return letter;
}

async function buildXlsx(rows) {
  const headers = [
    "Source PDF name",
    "Page number",
    "Detected unit code",
    "Manual override",
    "Final unit code",
    "Output folder",
    "Output file name",
    "Status",
    "Issue type",
    "Issue details",
    "Matched text snippet",
    "Date processed"
  ];
  const processedAt = new Date().toLocaleString();
  const dataRows = rows.map((row) => [
    state.fileName,
    row.pageNumber,
    row.detectedCode,
    row.manualCode || "",
    row.effectiveCode,
    row.status === "Success" ? OUTPUT_FOLDER : REVIEW_FOLDER,
    row.outputFileName,
    row.status,
    row.issueType,
    row.issueDetails,
    row.matchedSnippet,
    processedAt
  ]);
  const allRows = [headers, ...dataRows];

  const sheetData = allRows
    .map((cells, rowIndex) => {
      const cellXml = cells
        .map((value, cellIndex) => {
          const ref = `${columnLetter(cellIndex + 1)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join("");

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="34" customWidth="1"/>
    <col min="2" max="2" width="12" customWidth="1"/>
    <col min="3" max="7" width="22" customWidth="1"/>
    <col min="8" max="10" width="24" customWidth="1"/>
    <col min="11" max="11" width="64" customWidth="1"/>
    <col min="12" max="12" width="22" customWidth="1"/>
  </cols>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;

  const zip = new ZipBuilder();
  await zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );
  await zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );
  await zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Processing Log" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  );
  await zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );
  await zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`
  );
  await zip.file("xl/worksheets/sheet1.xml", worksheet);
  await zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Strata PDF Splitter</dc:creator>
  <dc:title>Processing Log</dc:title>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`
  );
  await zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Strata PDF Splitter</Application>
</Properties>`
  );

  return zip.blob();
}

async function scanPdf() {
  if (!state.fileBuffer) {
    setMessage("Select a PDF first.");
    return;
  }

  let settings;
  try {
    settings = getSettings();
    getCodeRegex(settings);
  } catch (error) {
    setMessage(`Regex error: ${error.message}`);
    return;
  }

  setBusy("scan");
  setMessage("");
  state.rows = [];
  state.evaluatedRows = [];
  renderTable();
  renderSummary();

  try {
    const pdf = await pdfjsLib.getDocument({ data: state.fileBuffer.slice(0) }).promise;
    updateProgress(0, pdf.numPages);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      const detected = detectCodeFromText(text, settings);

      state.rows.push({
        pageNumber,
        detectedCode: detected.detectedCode,
        candidateCodes: detected.candidateCodes,
        manualCode: "",
        matchedSnippet: detected.matchedSnippet,
        issueType: detected.issueType,
        issueDetails: detected.issueDetails
      });

      if (pageNumber % 10 === 0 || pageNumber === pdf.numPages) {
        updateProgress(pageNumber, pdf.numPages);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    refreshResults();
    setMessage(`Scanned ${pdf.numPages} pages.`);
    await renderPreview(1);
  } catch (error) {
    setMessage(`Scan failed: ${error.message}`);
  } finally {
    setBusy("");
  }
}

async function renderPreview(pageNumber) {
  if (!state.fileBuffer) return;

  try {
    elements.previewTitle.textContent = `Page ${pageNumber}`;
    const pdf = await pdfjsLib.getDocument({ data: state.fileBuffer.slice(0) }).promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.75 });
    const canvas = elements.previewCanvas;
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport
    }).promise;
  } catch (error) {
    setMessage(`Preview failed: ${error.message}`);
  }
}

async function generateZip() {
  if (!state.fileBuffer || !state.evaluatedRows.length) {
    setMessage("Scan the PDF before generating output.");
    return;
  }

  setBusy("zip");
  setMessage("");

  try {
    const sourcePdf = await PDFDocument.load(state.fileBuffer.slice(0));
    const zip = new ZipBuilder();

    for (const row of state.evaluatedRows) {
      const newPdf = await PDFDocument.create();
      const [page] = await newPdf.copyPages(sourcePdf, [row.pageNumber - 1]);
      newPdf.addPage(page);
      const bytes = await newPdf.save({ useObjectStreams: true });
      const folder = row.status === "Success" ? OUTPUT_FOLDER : REVIEW_FOLDER;
      await zip.file(`${folder}/${row.outputFileName}`, bytes);
    }

    const logBlob = await buildXlsx(state.evaluatedRows);
    await zip.file("processing_log.xlsx", logBlob);

    const output = await zip.blob();
    const baseName = state.fileName.replace(/\.pdf$/i, "") || "strata-output";
    downloadBlob(output, `${baseName}_split_output.zip`);

    const summary = renderSummary();
    setMessage(
      `Generated ZIP with ${summary.success} valid file(s) and ${summary.review} review file(s).`
    );
  } catch (error) {
    setMessage(`Output failed: ${error.message}`);
  } finally {
    setBusy("");
  }
}

elements.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  setMessage("");
  updateProgress(0, 0);
  state.fileName = file.name;
  state.fileBuffer = await file.arrayBuffer();
  state.rows = [];
  state.evaluatedRows = [];
  elements.fileName.textContent = file.name;
  elements.scanButton.disabled = false;
  elements.zipButton.disabled = true;
  elements.previewTitle.textContent = "No page selected";
  const context = elements.previewCanvas.getContext("2d");
  context.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
  refreshResults();
});

[elements.marker, elements.customRegex].forEach((input) => {
  input.addEventListener("input", () => {
    updateRegexPreview();
    saveSettings();
    if (state.rows.length) {
      refreshResults();
    }
  });
});

elements.preset.addEventListener("change", () => {
  const preset = PRESETS[elements.preset.value];
  if (!preset) return;
  state.segments = structuredClone(preset.segments);
  renderSegments();
  updateRegexPreview();
  saveSettings();
  if (state.rows.length) {
    refreshResults();
  }
});

elements.addSegment.addEventListener("click", () => {
  state.segments.push({ type: "digits", min: 2, max: 2, name: "" });
  renderSegments();
  onSettingsChanged();
});

elements.sampleCode.addEventListener("input", updateSampleTester);

elements.scanButton.addEventListener("click", scanPdf);
elements.zipButton.addEventListener("click", generateZip);

renderPresetOptions();
loadSettings();
renderSegments();
elements.preset.value = matchingPresetKey();
updateRegexPreview();
refreshResults();
