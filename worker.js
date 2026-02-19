// expects dataset = [{ log_id: 1, ...}, ...]
function buildQueries(dataset, count = 100) {
  const half = Math.floor(count / 2);
  const hits = dataset.slice(0, half).map(r => ({ log_id: r.log_id }));
  let fakeId = Math.max(...dataset.map(r => r.log_id)) + 1;
  const misses = [];
  while (misses.length < count - hits.length) {
    misses.push({ log_id: fakeId++ });
  }
  return hits.concat(misses);
}

function hashingSearch(dataset, queries) {
  const map = new Map(dataset.map(r => [r.log_id, r]));
  let found = 0;
  for (const q of queries) if (map.has(q.log_id)) found++;
  return found;
}

function linearSearch(dataset, queries) {
  let found = 0;
  for (const q of queries) {
    for (const r of dataset) {
      if (r.log_id === q.log_id) {
        found++;
        break;
      }
    }
  }
  return found;
}

function bruteForceSearch(dataset, queries) {
  let found = 0;
  for (const q of queries) {
    for (const r of dataset) if (r.log_id === q.log_id) found++;
  }
  return found;
}

function timeRun(fn, dataset, queries) {
  const start = performance.now();
  fn(dataset, queries);
  return performance.now() - start;
}

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

  const lines = [`Dataset Size: ${label} (${dataset.length})`];
  for (const [name, fn] of algorithms) {
    const times = [];
    for (let i = 0; i < 10; i++) times.push(timeRun(fn, dataset, queries));
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    lines.push(`${name}: ${avg.toFixed(4)} ms`);
  }

  self.postMessage({ type: "results", payload: { lines } });
};
