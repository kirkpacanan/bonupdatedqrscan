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
let lastBenchmarkLines = null;
// Result of "log ID to find" check after scan (shown above benchmark)
let lastLogIdSearchResult = null;
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

function rowMatchesSearch(row, searchTerm) {
  if (!searchTerm || !row) return false;
  const q = searchTerm.trim().toLowerCase();
  for (const key of Object.keys(row)) {
    if (String(row[key]).toLowerCase().includes(q)) return true;
  }
  return false;
}

function buildDatasetHtml(dataset, searchTerm) {
  const q = (searchTerm || "").trim().toLowerCase();
  const headers = csvHeaders.length >= ALL_CSV_COLUMNS.length ? csvHeaders : ALL_CSV_COLUMNS;
  const rows = dataset.map((r) => {
    const logId = Number(r.log_id);
    const full = csvRecordsByLogId.get(logId) || csvRecordsByLogId.get(r.log_id) || r;
    return { row: full, match: q && rowMatchesSearch(full, searchTerm) };
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
      benchHtml += "<pre class=\"logid-search-result\">" + escapeHtml(lastLogIdSearchResult) + "</pre>";
    }
    if (lastBenchmarkLines && lastBenchmarkLines.length) {
      benchHtml += "<pre>" + escapeHtml(lastBenchmarkLines.join("\n")) + "</pre>";
    } else if (lastScannedDataset && activeBenchmark) {
      benchHtml += "<pre>Running benchmark...</pre>";
    } else if (!lastLogIdSearchResult) {
      benchHtml += "<pre class=\"results-placeholder\">Benchmark results will appear here after scanning a QR.</pre>";
    }
    benchmarkResultsEl.innerHTML = benchHtml || "<pre></pre>";
  }
}

worker.onmessage = (e) => {
  const { type, payload } = e.data;
  if (type === "results") {
    lastBenchmarkLines = payload.lines;
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
    lastBenchmarkLines = null;

    // Optional: check if user's "Log ID to find" is in the scanned dataset
    const logIdStr = logIdToFindInput && logIdToFindInput.value.trim();
    if (logIdStr) {
      const logIdNum = parseInt(logIdStr, 10);
      const found = !isNaN(logIdNum) && parsed.dataset.some((r) => Number(r.log_id) === logIdNum);
      lastLogIdSearchResult = found
        ? "Log ID " + logIdStr + ": found in dataset."
        : "Log ID " + logIdStr + ": not in dataset.";
      if (searchInput) searchInput.value = logIdStr;
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
