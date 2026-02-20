// expects dataset = [{ log_id: 1, ...}, ...]
// count queries: by default 50% hits, 50% misses. If allMisses true, 100% misses (worst-case for linear/brute).
function buildQueries(dataset, count = 10000, allMisses = false) {
  const maxId = Math.max(...dataset.map((r) => r.log_id));
  let fakeId = maxId + 1;
  if (allMisses) {
    return Array.from({ length: count }, () => ({ log_id: fakeId++ }));
  }
  const half = Math.floor(count / 2);
  const hits = dataset.slice(0, half).map((r) => ({ log_id: r.log_id }));
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
const QUERY_COUNT = 10000;

const algorithmList = [
  ["Hashing (JS Map)", hashingSearch],
  ["Linear Search", linearSearch],
  ["Brute Force", bruteForceSearch],
];

function runOneBenchmark(dataset, queries) {
  const results = [];
  for (const [name, fn] of algorithmList) {
    for (let w = 0; w < WARMUP_RUNS; w++) fn(dataset, queries);
    const times = [];
    for (let i = 0; i < TIMED_RUNS; i++) {
      const { timeMs, result } = timeRun(fn, dataset, queries);
      times.push(timeMs);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    results.push({
      name,
      avgMs: avg,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
    });
  }
  return results;
}

self.onmessage = (event) => {
  const { type, payload } = event.data;

  if (type === "stressTest") {
    const scenarios = [];

    // 1. Input grows 10×: large dataset (n=10,000), 50/50 hits-misses
    const data10k = Array.from({ length: 10000 }, (_, i) => ({ log_id: i + 1 }));
    const queriesGrow = buildQueries(data10k, QUERY_COUNT, false);
    scenarios.push({
      name: "Input grows 10×",
      algorithms: runOneBenchmark(data10k, queriesGrow),
    });

    // 2. Worst-case input: large dataset, 100% misses (linear/brute scan full every time)
    const queriesWorst = buildQueries(data10k, QUERY_COUNT, true);
    scenarios.push({
      name: "Worst-case input",
      algorithms: runOneBenchmark(data10k, queriesWorst),
    });

    // 3. Memory-limited: small dataset (n=100), 50/50
    const data100 = Array.from({ length: 100 }, (_, i) => ({ log_id: i + 1 }));
    const queriesMem = buildQueries(data100, QUERY_COUNT, false);
    scenarios.push({
      name: "Memory-limited",
      algorithms: runOneBenchmark(data100, queriesMem),
    });

    self.postMessage({ type: "stressResults", payload: { scenarios } });
    return;
  }

  if (type !== "benchmark") return;

  const { dataset, label } = payload;
  const queries = buildQueries(dataset);

  const results = runOneBenchmark(dataset, queries);

  self.postMessage({
    type: "results",
    payload: {
      datasetLabel: label,
      datasetLength: dataset.length,
      queriesCount: queries.length,
      warmupRuns: WARMUP_RUNS,
      timedRuns: TIMED_RUNS,
      algorithms: results,
      verificationSum: 0,
    },
  });
};
