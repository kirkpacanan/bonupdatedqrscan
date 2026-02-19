const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const outputDir = path.join(__dirname, "qr");
const csvPath = path.join(__dirname, "sampleData.csv");

// Small: 10 rows, Medium: 100 rows, Large: 1000 rows (split into 2 QRs)
const LARGE_CHUNK = 500; // each Large QR holds 500 ids (fits in ~2500 bytes)

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

function buildPayload(sizeLabel, ids, partIndex, totalParts) {
  const arr = JSON.stringify(ids);
  if (totalParts > 1) {
    return `DS:${sizeLabel}:${partIndex}:${totalParts}:${arr}`;
  }
  return `DS:${sizeLabel}:${arr}`;
}

async function generate() {
  ensureDir(outputDir);

  const csvText = fs.readFileSync(csvPath, "utf8");
  const allRecords = parseCSV(csvText);

  const smallIds = allRecords.slice(0, 10).map((r) => r.log_id);
  const mediumIds = allRecords.slice(0, 100).map((r) => r.log_id);
  const largeIds = allRecords.slice(0, 1000).map((r) => r.log_id);
  const large1 = largeIds.slice(0, LARGE_CHUNK);
  const large2 = largeIds.slice(LARGE_CHUNK, 1000);

  const tasks = [
    {
      payload: buildPayload("Small", smallIds),
      filename: "qr-small.png",
      size: 100,
    },
    {
      payload: buildPayload("Medium", mediumIds),
      filename: "qr-medium.png",
      size: 120,
    },
    {
      payload: buildPayload("Large", large1, 1, 2),
      filename: "qr-large-1.png",
      size: 200,
    },
    {
      payload: buildPayload("Large", large2, 2, 2),
      filename: "qr-large-2.png",
      size: 200,
    },
  ];

  for (const { payload, filename, size } of tasks) {
    const filePath = path.join(outputDir, filename);
    await QRCode.toFile(filePath, payload, {
      width: size,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    console.log(`Generated ${filePath} (${payload.length} chars)`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
