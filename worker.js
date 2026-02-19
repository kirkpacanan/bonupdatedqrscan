// expects dataset = [{ log_id: 1, ...}, ...]
// 10000 queries: 5000 hits (from dataset), 5000 misses (ids not in dataset) — same as Python benchmark
function buildQueries(dataset, count = 10000) {
  const half = Math.floor(count / 2);
  const hits = dataset.slice(0, half).map((r) => ({ log_id: r.log_id }));
  let fakeId = Math.max(...dataset.map((r) => r.log_id)) + 1;
  const misses = [];
  while (misses.length < count - hits.length) {
    misses.push({ log_id: fakeId++ });
  }
  return hits.concat(misses);
}

// 1. Hashing: build set/map once, O(1) lookup per query — real set membership
function hashingSearch(dataset, queries) {
  const map = new Map();
  for (let i = 0; i < dataset.length; i++) {
    const r = dataset[i];
    map.set(r.log_id, r);
  }
  let found = 0;
  for (let i = 0; i < queries.length; i++) {
    if (map.has(queries[i].log_id)) found++;
  }
  return found;
}

// 2. Linear search: scan dataset per query, early exit on first match — real linear scan with break
function linearSearch(dataset, queries) {
  let found = 0;
  for (let i = 0; i < queries.length; i++) {
    const qid = queries[i].log_id;
    for (let j = 0; j < dataset.length; j++) {
      if (dataset[j].log_id === qid) {
        found++;
        break;
      }
    }
  }
  return found;
}

// 3. Brute force: full scan per query, no early exit — real O(n) per query, no shortcut
function bruteForceSearch(dataset, queries) {
  let found = 0;
  for (let i = 0; i < queries.length; i++) {
    const qid = queries[i].log_id;
    for (let j = 0; j < dataset.length; j++) {
      if (dataset[j].log_id === qid) found++;
    }
  }
  return found;
}

// Time a single run; return { timeMs, result } so result is used (avoids dead-code elimination)
function timeRun(fn, dataset, queries) {
  const start = performance.now();
  const result = fn(dataset, queries);
  const end = performance.now();
  return { timeMs: end - start, result };
}

// Warm-up runs so JIT is hot; then timed runs with proper averaging
const WARMUP_RUNS = 5;
const TIMED_RUNS = 10;

self.onmessage = (event) => {
  const { type, payload } = event.data;
  if (type !== "benchmark") return;

  const { dataset, label } = payload;
  const queries = buildQueries(dataset);

  const algorithms = [
    ["Hashing (JS Map)", hashingSearch],
    ["Linear Search", linearSearch],
    ["Brute Force", bruteForceSearch],
  ];

  const results = [];
  let verificationSum = 0;

  for (const [name, fn] of algorithms) {
    for (let w = 0; w < WARMUP_RUNS; w++) verificationSum += fn(dataset, queries);
    const times = [];
    for (let i = 0; i < TIMED_RUNS; i++) {
      const { timeMs, result } = timeRun(fn, dataset, queries);
      times.push(timeMs);
      verificationSum += result;
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    results.push({
      name,
      avgMs: avg,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
    });
  }

  self.postMessage({
    type: "results",
    payload: {
      datasetLabel: label,
      datasetLength: dataset.length,
      queriesCount: queries.length,
      warmupRuns: WARMUP_RUNS,
      timedRuns: TIMED_RUNS,
      algorithms: results,
      verificationSum,
    },
  });
};
