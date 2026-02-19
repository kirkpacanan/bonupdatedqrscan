const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const outputDir = path.join(__dirname, "qr");
const csvPath = path.join(__dirname, "sampleData.csv");

// Only 3 QRs: Small (10), Medium (100), Large (1000). Large uses RANGE so one small, scannable QR.
// Low error correction (L) = less black, easier to scan. Larger width = bigger modules.
const BASE_OPTS = {
  margin: 4,
  errorCorrectionLevel: "L", // 7% — less dense than M, much easier to scan
  color: { dark: "#0f172a", light: "#ffffff" },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseCSV(text) {
  const rows = text.trim().split("\n");
  const headers = rows.shift().split(",");
  return rows.map((row) => {
    const values = row.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i]));
    obj.log_id = parseInt(obj.log_id, 10);
    return obj;
  });
}

async function generate() {
  ensureDir(outputDir);

  const csvText = fs.readFileSync(csvPath, "utf8");
  const allRecords = parseCSV(csvText);

  const smallIds = allRecords.slice(0, 10).map((r) => r.log_id);
  const mediumIds = allRecords.slice(0, 100).map((r) => r.log_id);

  const tasks = [
    { payload: `DS:Small:${JSON.stringify(smallIds)}`, filename: "qr-small.png", width: 260 },
    { payload: `DS:Medium:${JSON.stringify(mediumIds)}`, filename: "qr-medium.png", width: 340 },
    { payload: "DS:Large:RANGE:1-1000", filename: "qr-large.png", width: 260 },
  ];

  for (const { payload, filename, width } of tasks) {
    const filePath = path.join(outputDir, filename);
    await QRCode.toFile(filePath, payload, { ...BASE_OPTS, width });
    console.log(`Generated ${filePath} (${payload.length} chars, ${width}px, EC:L)`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
