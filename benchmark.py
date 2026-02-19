import time
import pandas as pd
from typing import Callable, Dict, List

# Config
CSV_FILE = "sampleData.csv"
SIZES = {"Small": 10, "Medium": 100, "Large": 1000}
RUNS = 10
NUM_QUERIES = 100

# Load CSV
df = pd.read_csv(CSV_FILE)
all_log_ids = df["log_id"].tolist()  # only log_id for benchmarking

def build_queries(dataset: List[int], num_queries: int) -> List[int]:
    hits_count = min(len(dataset), num_queries // 2)
    hits = dataset[:hits_count]
    misses = list(range(max(dataset)+1, max(dataset)+1 + (num_queries - hits_count)))
    return hits + misses

def hashing_search(dataset: List[int], queries: List[int]) -> int:
    dataset_set = set(dataset)
    return sum(1 for q in queries if q in dataset_set)

def linear_search(dataset: List[int], queries: List[int]) -> int:
    found = 0
    for q in queries:
        for item in dataset:
            if item == q:
                found += 1
                break
    return found

def brute_force_search(dataset: List[int], queries: List[int]) -> int:
    found = 0
    for q in queries:
        for item in dataset:
            if item == q:
                found += 1
    return found

def time_run(fn: Callable[[List[int], List[int]], int], dataset: List[int], queries: List[int]) -> float:
    start = time.perf_counter()
    _ = fn(dataset, queries)
    end = time.perf_counter()
    return (end - start) * 1000.0

def benchmark() -> Dict[str, Dict[str, float]]:
    results = {}
    for label, size in SIZES.items():
        dataset = all_log_ids[:size]
        queries = build_queries(dataset, NUM_QUERIES)
        results[label] = {}
        for name, fn in [("Hashing", hashing_search), ("Linear Search", linear_search), ("Brute Force", brute_force_search)]:
            times = [time_run(fn, dataset, queries) for _ in range(RUNS)]
            results[label][name] = sum(times) / len(times)
    return results

def print_results(results: Dict[str, Dict[str, float]]):
    print("Dataset | Hashing (ms) | Linear Search (ms) | Brute Force (ms)")
    print("-" * 60)
    for label in SIZES:
        row = results[label]
        print(f"{label} | {row['Hashing']:.4f} | {row['Linear Search']:.4f} | {row['Brute Force']:.4f}")

if __name__ == "__main__":
    results = benchmark()
    print_results(results)
