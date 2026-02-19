// ------------------------
// Grab DOM elements
// ------------------------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const searchInput = document.getElementById("searchInput");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

// ------------------------
// Config
// ------------------------
const SCAN_INTERVAL = 100; // ms between scans
let stream = null;
let scanning = false;
let lastScan = 0;

// Pending multi-part QR (e.g. Large = 2 parts)
let pendingParts = {};
// Last scanned dataset and benchmark output (for re-render on search)
let lastScannedDataset = null;
let lastScannedLabel = null;
let lastBenchmarkLines = null;

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
// Parse DS: payload and return { label, dataset } or null if multi-part (then caller accumulates)
// ------------------------
function parseDSPayload(data) {
  if (!data || !data.startsWith("DS:")) return null;
  const rest = data.slice(3);
  const parts = rest.split(":");
  if (parts.length < 2) return null;

  const label = parts[0];
  let ids;

  if (parts.length === 2) {
    // DS:Small:[1,2,...] or DS:Medium:[...]
    try {
      ids = JSON.parse(parts[1]);
    } catch {
      return null;
    }
    return { label, dataset: ids.map((id) => ({ log_id: id })) };
  }

  if (parts.length >= 4) {
    // DS:Large:1:2:[...]
    const partIndex = parseInt(parts[1], 10);
    const totalParts = parseInt(parts[2], 10);
    const jsonStr = parts.slice(3).join(":");
    try {
      ids = JSON.parse(jsonStr);
    } catch {
      return null;
    }
    if (!pendingParts[label]) {
      pendingParts[label] = { parts: {}, total: totalParts };
    }
    pendingParts[label].parts[partIndex] = ids;
    const collected = pendingParts[label].parts;
    if (Object.keys(collected).length === totalParts) {
      const merged = [];
      for (let i = 1; i <= totalParts; i++) merged.push(...collected[i]);
      delete pendingParts[label];
      return { label, dataset: merged.map((id) => ({ log_id: id })) };
    }
    return null; // need to scan the other part(s)
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

function buildDatasetHtml(dataset, searchTerm) {
  const ids = dataset.map((r) => r.log_id);
  const q = (searchTerm || "").trim().toLowerCase();
  const parts = ids.map((id) => {
    const s = String(id);
    const match = q && s.toLowerCase().includes(q);
    const safe = escapeHtml(s);
    return match ? '<span class="highlight">' + safe + "</span>" : safe;
  });
  return parts.join(", ");
}

function renderResults() {
  const searchTerm = searchInput ? searchInput.value : "";
  let html = "";
  if (lastScannedDataset && lastScannedLabel) {
    html += '<div class="dataset-block">Dataset from QR (' + escapeHtml(lastScannedLabel) + ", " + lastScannedDataset.length + " rows):<br><span class=\"dataset-ids\">";
    html += buildDatasetHtml(lastScannedDataset, searchTerm);
    html += "</span></div>";
  }
  if (lastBenchmarkLines && lastBenchmarkLines.length) {
    html += "<pre>" + escapeHtml(lastBenchmarkLines.join("\n")) + "</pre>";
  } else if (lastScannedDataset && activeBenchmark) {
    html += "<pre>Running benchmark...</pre>";
  }
  resultsEl.innerHTML = html || "<pre></pre>";
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
    statusEl.textContent = `QR scanned: ${parsed.label} (${parsed.dataset.length} rows). Running benchmark...`;
    stopCamera();
    lastBenchmarkLines = null;
    renderResults();
    worker.postMessage({ type: "benchmark", payload: { dataset: parsed.dataset, label: parsed.label } });
    return;
  }

  // Multi-part: we stored one part and returned null; prompt for the other
  if (data.startsWith("DS:") && Object.keys(pendingParts).length > 0) {
    statusEl.textContent = "Large: scan the other part (1/2 or 2/2) to run benchmark.";
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
