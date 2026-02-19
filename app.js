// ------------------------
// Grab DOM elements
// ------------------------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

// ------------------------
// Config
// ------------------------
const SCAN_INTERVAL = 100; // ms between scans
let stream = null;
let scanning = false;
let lastScan = 0;

// ------------------------
// Load CSV dataset
// ------------------------
let allRecords = []; // global dataset

fetch("sampleData.csv")
  .then(res => res.text())
  .then(text => {
    const rows = text.trim().split("\n");
    const headers = rows.shift().split(",");
    allRecords = rows.map(row => {
      const values = row.split(",");
      const obj = {};
      headers.forEach((h, i) => (obj[h] = values[i]));
      obj.log_id = parseInt(obj.log_id); // make log_id number
      return obj;
    });
    statusEl.textContent = "Dataset loaded!";
  })
  .catch(err => {
    console.error(err);
    statusEl.textContent = "Failed to load dataset.";
  });

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
    stream.getTracks().forEach(t => t.stop());
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
// Handle QR data
// ------------------------
let activeBenchmark = false;
const worker = new Worker("worker.js");

worker.onmessage = (e) => {
  const { type, payload } = e.data;
  if (type === "results") {
    resultsEl.textContent = payload.lines.join("\n");
    statusEl.textContent = "Benchmark complete!";
    activeBenchmark = false;
  }
};

function handleScan(data) {
  if (!data.startsWith("SIZE:")) {
    statusEl.textContent = `Unknown QR code: ${data}`;
    return;
  }
  const sizeLabel = data.replace("SIZE:", "");
  const size = { Small: 10, Medium: 100, Large: 1000 }[sizeLabel];
  if (!size) return;

  if (activeBenchmark) {
    statusEl.textContent = "Benchmark already running...";
    return;
  }

  activeBenchmark = true;
  statusEl.textContent = `QR scanned: ${sizeLabel}. Running benchmark...`;
  stopCamera(); // stop camera while running benchmark

  // slice dataset according to scanned QR
  const dataset = allRecords.slice(0, size).map(r => ({ log_id: r.log_id }));

  worker.postMessage({ type: "benchmark", payload: { dataset, label: sizeLabel } });
}

// ------------------------
// Event listeners
// ------------------------
startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
