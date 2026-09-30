// For each app size: generate, build and bench `/` without and with the patch,
// and check that both builds serve identical HTML
// Usage: node scripts/compare.mjs [--seconds=10] [--profile] [pages:components ...]
// Defaults to three app sizes: 20:100, 1000:4000 and 3000:12000
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { bench } from "./bench.mjs";
import { setPatched } from "./patch.mjs";

const args = process.argv.slice(2);
const seconds = Number(args.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 10);
const profile = args.includes("--profile");
const sizes = args.filter((a) => !a.startsWith("--"));
if (sizes.length === 0) sizes.push("20:100", "1000:4000", "3000:12000");

const PORT = Number(process.env.PORT ?? 3456);
const PATHS = ["/", "/p/1"];

async function startServer(cpuProfDir) {
  const nodeArgs = cpuProfDir ? ["--cpu-prof", `--cpu-prof-dir=${cpuProfDir}`] : [];
  const server = spawn(process.execPath, [...nodeArgs, "node_modules/vinext/dist/cli.js", "start", "-p", String(PORT)], {
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://localhost:${PORT}/`);
      return server;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
}

async function stopServer(server) {
  const exited = new Promise((r) => server.once("exit", r));
  server.kill("SIGINT");
  await exited;
}

async function run(patched, cpuProfDir) {
  setPatched(patched);
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { stdio: "inherit" });
  const server = await startServer(cpuProfDir);
  try {
    const html = [];
    for (const path of PATHS) html.push(await (await fetch(`http://localhost:${PORT}${path}`)).text());
    const result = await bench(`http://localhost:${PORT}/`, seconds);
    return { ...result, html: html.join("\n") };
  } finally {
    await stopServer(server);
  }
}

const rows = [];
try {
  for (const size of sizes) {
    const [pages, components] = size.split(":");
    execFileSync("node", ["scripts/generate.mjs", pages, components], { stdio: "inherit" });
    let cpuProfDir;
    if (profile) mkdirSync((cpuProfDir = `profiles/${pages}-pages`), { recursive: true });
    const after = await run(true);
    const before = await run(false, cpuProfDir);
    const manifest = readFileSync("dist/client/.vite/ssr-manifest.json", "utf8");
    const keys = Object.keys(JSON.parse(manifest)).length;
    const mb = (Buffer.byteLength(manifest) / 1e6).toFixed(1);
    rows.push({ pages, components, keys, mb, before, after, same: before.html === after.html });
  }
} finally {
  setPatched(false);
}

console.log(
  "\n| pages | components | ssr-manifest keys | ssr-manifest size | before req/s (p50) | after req/s (p50) | HTML identical |",
);
console.log("|---:|---:|---:|---:|---:|---:|:---:|");
for (const r of rows) {
  const fmt = (x) => `${x.rps.toFixed(0)} (${x.p50} ms)`;
  console.log(
    `| ${r.pages} | ${r.components} | ${r.keys} | ${r.mb} MB | ${fmt(r.before)} | ${fmt(r.after)} | ${r.same ? "yes" : "NO"} |`,
  );
}
if (rows.some((r) => !r.same)) process.exitCode = 1;
