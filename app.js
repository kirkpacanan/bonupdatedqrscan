// ------------------------
// Grab DOM elements
// ------------------------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const csvResultsEl = document.getElementById("csvResults");
const benchmarkResultsEl = document.getElementById("benchmarkResults");
const searchInput = document.getElementById("searchInput");
const logIdToFindInput = document.getElementById("logIdToFind");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const qrFileInput = document.getElementById("qrFileInput");
const stressTestBtn = document.getElementById("stressTestBtn");

// ------------------------
// Config
// ------------------------
const SCAN_INTERVAL = 100; // ms between scans
let stream = null;
let scanning = false;
let lastScan = 0;

// Last scanned dataset and benchmark output (for re-render on search)
let lastScannedDataset = null;
let lastScannedLabel = null;
let lastBenchmarkPayload = null; // { datasetLabel, datasetLength, algorithms: [{ name, avgMs, minMs, maxMs }], ... }
let lastRunWasStressTest = false;
let lastStressPayload = null;    // { scenarios: [ { name, algorithms: [...] } ] } — only set after "Run stress test"
// Result of "log ID to find" check after scan (shown above benchmark)
let lastLogIdSearchResult = null;
// When true, next render highlights only the row with log_id === search (used after "Log ID to find" auto-fill)
let searchExactLogIdOnce = false;
// Full CSV data: log_id -> full row (all columns), for displaying actual dataset from CSV
let csvRecordsByLogId = new Map();
let csvHeaders = [];
// All columns to show (so we never show only log_id); must match sampleData.csv header row
const ALL_CSV_COLUMNS = [
  "log_id", "qr_id", "authorization_id", "guest_id", "guest_name", "unit_id", "unit_number",
  "frontdesk_id", "frontdesk_name", "action_type", "scanned_at", "result_status",
  "has_authorization_form", "has_luggage", "luggage_count", "luggage_desc", "companions_count",
  "vehicle_plate_no", "remarks"
];

// ------------------------
// Camera functions
// ------------------------
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    statusEl.textContent = "Camera not supported.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
    scanning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Camera started. Scan a QR code!";
    requestAnimationFrame(scanFrame);
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Camera error: ${err.message}`;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  scanning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Camera stopped.";
}

// ------------------------
// Scan QR frames
// ------------------------
function scanFrame(timestamp) {
  if (!scanning) return;
  if (timestamp - lastScan < SCAN_INTERVAL) {
    requestAnimationFrame(scanFrame);
    return;
  }
  lastScan = timestamp;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const scale = Math.min(1, 320 / video.videoWidth);
    const width = Math.floor(video.videoWidth * scale);
    const height = Math.floor(video.videoHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height);
    if (code && code.data) {
      handleScan(code.data.trim());
      return;
    }
  }
  requestAnimationFrame(scanFrame);
}

// ------------------------
// Upload QR image and decode (fallback when camera won't scan)
// ------------------------
function decodeQRFromImageData(imageData, width, height) {
  return jsQR(imageData.data, width, height);
}

function processUploadedImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    statusEl.textContent = "Please choose an image file (e.g. PNG, JPG).";
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const naturalW = img.width;
    const naturalH = img.height;
    const maxDim = 1200;
    let w = naturalW;
    let h = naturalH;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    let imageData = ctx.getImageData(0, 0, w, h);
    let code = decodeQRFromImageData(imageData, w, h);
    if (!code && (w !== naturalW || h !== naturalH)) {
      canvas.width = naturalW;
      canvas.height = naturalH;
      ctx.drawImage(img, 0, 0, naturalW, naturalH);
      imageData = ctx.getImageData(0, 0, naturalW, naturalH);
      code = decodeQRFromImageData(imageData, naturalW, naturalH);
    }
    if (code && code.data) {
      statusEl.textContent = "QR decoded from image.";
      handleScan(code.data.trim());
    } else {
      statusEl.textContent = "No QR code found in this image. Try another photo.";
    }
    qrFileInput.value = "";
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    statusEl.textContent = "Could not load image.";
    qrFileInput.value = "";
  };
  img.src = url;
}

// ------------------------
// Parse DS: payload — Small/Medium = JSON array of ids, Large = RANGE:1-1000 (one QR only)
// ------------------------
function parseDSPayload(data) {
  if (!data || !data.startsWith("DS:")) return null;
  const rest = data.slice(3);
  const parts = rest.split(":");
  if (parts.length < 2) return null;

  const label = parts[0];

  // DS:Large:RANGE:1-1000 — compact, one scannable QR for 1000 rows
  if (label === "Large" && parts[1] === "RANGE" && parts[2]) {
    const rangeMatch = parts[2].match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (!isNaN(start) && !isNaN(end) && start <= end && end - start + 1 <= 10000) {
        const dataset = [];
        for (let i = start; i <= end; i++) dataset.push({ log_id: i });
        return { label, dataset };
      }
    }
  }

  // DS:Small:[1,2,...] or DS:Medium:[1,...,100]
  if (parts.length === 2) {
    let ids;
    try {
      ids = JSON.parse(parts[1]);
    } catch {
      return null;
    }
    if (Array.isArray(ids)) {
      return { label, dataset: ids.map((id) => ({ log_id: id })) };
    }
  }

  return null;
}

// ------------------------
// Handle QR data
// ------------------------
let activeBenchmark = false;
const worker = new Worker("worker.js");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Match row: exact log_id only when searchExactLogIdOnce is set (after "Log ID to find"); else search any column (substring).
function rowMatchesSearch(row, searchTerm, logIdForRow, exactLogIdOnly) {
  if (!searchTerm || !row) return false;
  const q = searchTerm.trim();
  if (exactLogIdOnly) {
    const qNum = parseInt(q, 10);
    return !isNaN(qNum) && Number(logIdForRow) === qNum;
  }
  const qLower = q.toLowerCase();
  for (const key of Object.keys(row)) {
    if (String(row[key]).toLowerCase().includes(qLower)) return true;
  }
  return false;
}

function buildDatasetHtml(dataset, searchTerm) {
  const q = (searchTerm || "").trim();
  const exactOnce = searchExactLogIdOnce && /^\d+$/.test(q);
  if (exactOnce) searchExactLogIdOnce = false;
  const headers = csvHeaders.length >= ALL_CSV_COLUMNS.length ? csvHeaders : ALL_CSV_COLUMNS;
  const rows = dataset.map((r) => {
    const logId = Number(r.log_id);
    const full = csvRecordsByLogId.get(logId) || csvRecordsByLogId.get(r.log_id) || r;
    return { row: full, match: q && rowMatchesSearch(full, searchTerm, logId, exactOnce) };
  });

  let html = '<div class="dataset-table-wrap"><table class="dataset-table"><thead><tr>';
  headers.forEach((h) => {
    html += "<th>" + escapeHtml(h) + "</th>";
  });
  html += "</tr></thead><tbody>";
  rows.forEach(({ row, match }) => {
    const trClass = match ? ' class="highlight-row"' : "";
    html += "<tr" + trClass + ">";
    headers.forEach((h) => {
      const val = row[h] != null ? String(row[h]) : "";
      html += "<td>" + escapeHtml(val) + "</td>";
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

function renderResults() {
  const searchTerm = searchInput ? searchInput.value : "";
  if (csvResultsEl) {
    if (lastScannedDataset && lastScannedLabel) {
      const hasCsvData = csvRecordsByLogId.size > 0;
      let html = '<div class="dataset-block">' + escapeHtml(lastScannedLabel) + " (" + lastScannedDataset.length + " rows)";
      if (!hasCsvData) {
        html += ' <span class="csv-warn">(CSV not loaded — run from a local server, e.g. <code>npx serve</code>)</span>';
      }
      html += "<br>";
      html += buildDatasetHtml(lastScannedDataset, searchTerm);
      html += "</div>";
      csvResultsEl.innerHTML = html;
    } else {
      csvResultsEl.innerHTML = "<pre class=\"results-placeholder\">Scan a QR code to load dataset.</pre>";
    }
  }
  if (benchmarkResultsEl) {
    let benchHtml = "";
    if (lastLogIdSearchResult) {
      benchHtml += "<div class=\"benchmark-logid-result\">" + escapeHtml(lastLogIdSearchResult) + "</div>";
    }
    if (lastStressPayload) {
      // Stress test table: only shown after "Run stress test" completes; each row = different scenario (different constraints)
      const scenarios = lastStressPayload.scenarios || [];
      benchHtml += "<div class=\"benchmark-panel\">";
      benchHtml += "<p class=\"benchmark-meta\">Stress test: 3 scenarios (different constraints). 10,000 queries per scenario.</p>";
      benchHtml += "<table class=\"benchmark-table stress-table\"><thead><tr><th>Scenario</th><th>Hashing (ms)</th><th>Linear Search (ms)</th><th>Brute Force (ms)</th></tr></thead><tbody>";
      scenarios.forEach((s) => {
        const hashAlg = s.algorithms.find((a) => a.name.toLowerCase().includes("hash"));
        const linearAlg = s.algorithms.find((a) => a.name.toLowerCase().includes("linear"));
        const bruteAlg = s.algorithms.find((a) => a.name.toLowerCase().includes("brute"));
        const hashMs = hashAlg ? hashAlg.avgMs.toFixed(4) : "—";
        const linearMs = linearAlg ? linearAlg.avgMs.toFixed(4) : "—";
        const bruteMs = bruteAlg ? bruteAlg.avgMs.toFixed(4) : "—";
        benchHtml += "<tr><td><strong>" + escapeHtml(s.name) + "</strong></td><td>" + hashMs + "</td><td>" + linearMs + "</td><td>" + bruteMs + "</td></tr>";
      });
      benchHtml += "</tbody></table>";
      benchHtml += "</div>";
    } else if (lastBenchmarkPayload) {
      const p = lastBenchmarkPayload;
      benchHtml += "<div class=\"benchmark-panel\">";
      benchHtml += "<p class=\"benchmark-meta\">Dataset: <strong>" + escapeHtml(p.datasetLabel) + "</strong> (" + p.datasetLength + " rows) · " + p.queriesCount + " queries (50% hits, 50% misses)</p>";
      benchHtml += "<p class=\"benchmark-note\">Data from scanned QR only. " + p.warmupRuns + " warm-up + " + p.timedRuns + " timed runs.</p>";
      benchHtml += "<table class=\"benchmark-table\"><thead><tr><th>Algorithm</th><th>Avg (ms)</th><th>Min</th><th>Max</th></tr></thead><tbody>";
      p.algorithms.forEach((a) => {
        benchHtml += "<tr><td>" + escapeHtml(a.name) + "</td><td class=\"benchmark-avg\">" + a.avgMs.toFixed(4) + "</td><td>" + a.minMs.toFixed(4) + "</td><td>" + a.maxMs.toFixed(4) + "</td></tr>";
      });
      benchHtml += "</tbody></table>";
      benchHtml += "<p class=\"benchmark-footer\">All algorithms returned the same match count.</p>";
      benchHtml += "</div>";
    } else if (activeBenchmark) {
      const runningMsg = lastRunWasStressTest ? "Running stress test (3 scenarios)…" : "Running benchmark…";
      benchHtml += "<div class=\"benchmark-panel\"><p class=\"benchmark-meta\">" + escapeHtml(runningMsg) + "</p></div>";
    } else if (!lastLogIdSearchResult) {
      benchHtml += "<p class=\"results-placeholder\">Scan a QR code to see benchmark results here.</p>";
    }
    benchmarkResultsEl.innerHTML = benchHtml || "";
  }
}

worker.onmessage = (e) => {
  const { type, payload } = e.data;
  if (type === "stressResults") {
    lastStressPayload = payload;
    lastBenchmarkPayload = null;
    activeBenchmark = false;
    statusEl.textContent = "Stress test complete!";
    renderResults();
    return;
  }
  if (type === "results") {
    lastBenchmarkPayload = payload;
    lastStressPayload = null;
    lastRunWasStressTest = false;
    renderResults();
    statusEl.textContent = "Benchmark complete!";
    activeBenchmark = false;
  }
};

function handleScan(data) {
  const parsed = parseDSPayload(data);
  if (parsed) {
    if (activeBenchmark) {
      statusEl.textContent = "Benchmark already running...";
      return;
    }
    activeBenchmark = true;
    lastScannedDataset = parsed.dataset;
    lastScannedLabel = parsed.label;
    lastBenchmarkPayload = null;
    lastRunWasStressTest = false;
    lastStressPayload = null;

    // Optional: check if user's "Log ID to find" is in the scanned dataset
    const logIdStr = logIdToFindInput && logIdToFindInput.value.trim();
    if (logIdStr) {
      const logIdNum = parseInt(logIdStr, 10);
      const found = !isNaN(logIdNum) && parsed.dataset.some((r) => Number(r.log_id) === logIdNum);
      lastLogIdSearchResult = found
        ? "Log ID " + logIdStr + ": found in dataset."
        : "Log ID " + logIdStr + ": not in dataset.";
      if (searchInput) {
        searchInput.value = logIdStr;
        searchExactLogIdOnce = true;
      }
    } else {
      lastLogIdSearchResult = null;
    }

    statusEl.textContent = lastLogIdSearchResult
      ? lastLogIdSearchResult + " Running benchmark..."
      : "QR scanned: " + parsed.label + " (" + parsed.dataset.length + " rows). Running benchmark...";
    stopCamera();
    renderResults();
    worker.postMessage({ type: "benchmark", payload: { dataset: parsed.dataset, label: parsed.label } });
    return;
  }

  statusEl.textContent = `Unknown QR: ${data.slice(0, 50)}${data.length > 50 ? "…" : ""}`;
}

// ------------------------
// Event listeners
// ------------------------
startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
if (searchInput) {
  searchInput.addEventListener("input", renderResults);
}
if (qrFileInput) {
  qrFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) processUploadedImage(file);
  });
}
if (stressTestBtn) {
  stressTestBtn.addEventListener("click", () => {
    if (activeBenchmark) {
      statusEl.textContent = "Benchmark already running...";
      return;
    }
    activeBenchmark = true;
    lastBenchmarkPayload = null;
    lastStressPayload = null;
    lastRunWasStressTest = true;
    statusEl.textContent = "Running stress test (3 scenarios)...";
    renderResults();
    worker.postMessage({ type: "stressTest" });
  });
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  const s = String(line).trim().replace(/\r$/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function loadCSV() {
  fetch("sampleData.csv")
    .then((res) => {
      if (!res.ok) throw new Error("CSV not found");
      return res.text();
    })
    .then((text) => {
      const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length < 2) throw new Error("CSV has no data rows");
      const headers = parseCSVLine(lines[0]);
      csvHeaders = headers.slice();
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const obj = {};
        headers.forEach((h, idx) => {
          const raw = values[idx];
          obj[h] = raw != null ? String(raw).trim() : "";
        });
        const logId = parseInt(obj.log_id, 10);
        if (!isNaN(logId)) csvRecordsByLogId.set(logId, obj);
      }
      if (statusEl && statusEl.textContent.startsWith("Loading")) {
        statusEl.textContent = "Start camera and scan a QR code.";
      }
      if (lastScannedDataset) renderResults();
    })
    .catch((err) => {
      console.error(err);
      if (statusEl) statusEl.textContent = "CSV failed to load. Use a local server (e.g. npx serve) so sampleData.csv can load.";
    });
}

loadCSV();
