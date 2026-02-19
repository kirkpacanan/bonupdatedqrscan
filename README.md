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
- Timing uses 10 timed runs per algorithm; results are shown in ms (avg, min, max).

## Benchmark vs CSV (important)
- **The benchmark uses only the dataset decoded from the QR.** It does not use `sampleData.csv` at all.
- **The benchmark results are the same** whether or not the CSV is loaded. With no local CSV (e.g. file:// or CSV missing), you still get the same timing numbers; only the "Dataset from CSV" table below would show just log_ids instead of full rows.
- **sampleData.csv** is optional and used only to display full row details (guest_name, unit_number, etc.) in the dataset table. For benchmark accuracy you only need the QR.

## Run
```bash
python benchmark.py
```

## Web QR Scanner Benchmark
1. **To see benchmark results:** Scan any of the 3 QRs (or upload an image). The "Benchmark results" panel shows timings in ms. A note there confirms the dataset used is from the QR only.
2. **Optional — full table:** Run a local server so `sampleData.csv` loads and the "Dataset from CSV" table shows all columns (otherwise only log_id is shown there; benchmark is unchanged).

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
