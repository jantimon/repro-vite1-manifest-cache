// Load-tests a running `vinext start` server and prints requests/s
// Usage: node scripts/bench.mjs [url=http://localhost:3000/] [seconds=10]
import autocannon from "autocannon";

const [url = `http://localhost:${process.env.PORT ?? 3000}/`, seconds = "10"] = process.argv.slice(2);

export async function bench(target, duration) {
  const warmup = await fetch(target);
  if (!warmup.ok) throw new Error(`${target} returned ${warmup.status}`);
  const result = await autocannon({ url: target, connections: 10, duration });
  if (result.non2xx || result.errors) throw new Error(`${result.non2xx} non-2xx, ${result.errors} errors`);
  return { rps: result.requests.average, p50: result.latency.p50, p99: result.latency.p99 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rps, p50, p99 } = await bench(url, Number(seconds));
  console.log(`${url}: ${rps.toFixed(1)} req/s, p50 ${p50} ms, p99 ${p99} ms`);
}
