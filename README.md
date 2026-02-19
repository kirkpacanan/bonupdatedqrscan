# Feelvie Benchmark App

This benchmark compares three algorithms using the same dataset sizes, the same QR query inputs, and the same timing method. Each test is run 10 times and averaged.

## Algorithms
- Hashing (set membership)
- Linear Search (early exit on match)
- Brute Force (full scan, no early exit)

## Dataset Sizes (3 QRs only)
- **Small:** 10 rows (one QR)
- **Medium:** 100 rows (one QR)
- **Large:** 1,000 rows (one QR, compact RANGE payload so it stays scannable)

## How It Works
- Small and Medium QRs store the log_id list; Large uses a short `RANGE:1-1000` payload so one QR stays easy to scan.
- Deterministic QR payloads ensure the same datasets and queries across runs.
- Each dataset has 100 QR queries.
- By default, inputs are actual QR images (PNG bytes), not just strings.
- Timing uses `time.perf_counter()` and averages 10 runs per algorithm in milliseconds (4 decimal places).

## Run
```bash
python benchmark.py
```

## Web QR Scanner Benchmark
Run a **local server** so `sampleData.csv` can load (required for full dataset table with all columns). Then open the app, allow camera access, and scan a QR code.

```bash
npx serve .
# or: python -m http.server 8000
# Then open http://localhost:3000 (or :8000)
```

If you open `index.html` directly (file://), the CSV won't load and only log_id will show in the dataset table.

## PNG QR Codes
Generate 3 PNG files (Small, Medium, Large) under `qr/`.

```bash
node generate_qr_pngs.js
```

## Notes
- Run on the same machine for consistent comparisons.
- All algorithms receive the same dataset and query list per size.
- Set `USE_QR_IMAGES = False` in `benchmark.py` to benchmark payload strings instead.
