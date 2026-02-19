# Feelvie Benchmark App

This benchmark compares three algorithms using the same dataset sizes, the same QR query inputs, and the same timing method. Each test is run 10 times and averaged.

## Algorithms
- Hashing (set membership)
- Linear Search (early exit on match)
- Brute Force (full scan, no early exit)

## Dataset Sizes (encoded in the QR)
- **Small:** 10 rows of dataset (one QR)
- **Medium:** 100 rows (one QR)
- **Large:** 1,000 rows (two QRs: scan part 1/2 then part 2/2 to run)

## How It Works
- The dataset (log_id list) is stored inside each QR code. Small and Medium use a single QR; Large uses two QRs (500 rows each) due to QR size limits.
- Deterministic QR payloads ensure the same datasets and queries across runs.
- Each dataset has 100 QR queries.
- By default, inputs are actual QR images (PNG bytes), not just strings.
- Timing uses `time.perf_counter()` and averages 10 runs per algorithm in milliseconds (4 decimal places).

## Run
```bash
python benchmark.py
```

## Web QR Scanner Benchmark
Open `index.html` in a browser (Chrome recommended). Allow camera access, then scan
any QR code shown on the page. Each code triggers a benchmark with the matching
dataset size.

```bash
# macOS quick open
open index.html
```

## PNG QR Codes
Generate PNG files with dataset payloads (Small, Medium, Large part 1, Large part 2) under `qr/`.

```bash
node generate_qr_pngs.js
```

## Notes
- Run on the same machine for consistent comparisons.
- All algorithms receive the same dataset and query list per size.
- Set `USE_QR_IMAGES = False` in `benchmark.py` to benchmark payload strings instead.
