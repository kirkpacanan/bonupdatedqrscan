const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const outputDir = path.join(__dirname, "qr");
const codes = [
  { label: "Small", size: 100, filename: "qr-small.png" },
  { label: "Medium", size: 200, filename: "qr-medium.png" },
  { label: "Large", size: 280, filename: "qr-large.png" },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function generate() {
  ensureDir(outputDir);

  for (const code of codes) {
    const payload = `SIZE:${code.label}`;
    const filePath = path.join(outputDir, code.filename);
    await QRCode.toFile(filePath, payload, {
      width: code.size,
      margin: 1,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });
    console.log(`Generated ${filePath}`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
