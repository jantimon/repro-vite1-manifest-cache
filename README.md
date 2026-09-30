# vinext Pages Router: per-request SSR manifest scans

In production, every Pages Router request walks the whole SSR manifest several times while building asset tags, so SSR throughput drops as the app grows.

## Numbers

`/` of a synthetic app, `vinext start` with `NODE_ENV=production`, autocannon with 10 connections for 10 s, one Node process:

| pages | components | ssr-manifest keys | ssr-manifest size | vinext 1.0.0 req/s (p50) | with patch req/s (p50) | HTML identical |
|---:|---:|---:|---:|---:|---:|:---:|
| 20 | 100 | 323 | 0.05 MB | 1917 (4 ms) | 4410 (1 ms) | yes |
| 1000 | 4000 | 3265 | 1.0 MB | 152 (58 ms) | 4434 (1 ms) | yes |
| 3000 | 12000 | 21481 | 4.5 MB | 25 (352 ms) | 4545 (1 ms) | yes |

With the patch, throughput no longer depends on app size. We first saw this on a real app with a 51 MB SSR manifest (31k keys): 5 req/s, with `collectAssetTags` at 58% self time.

## Repro

```sh
npm i
npm run compare             # about 3 minutes
npm run compare -- --profile 3000:12000   # also writes a CPU profile of the unpatched server to profiles/
```

For each size, `compare` generates the app, builds and benchmarks with and without the patch, and compares the HTML of `/` and `/p/1`. The patch has to go in before `vite build` because vinext bundles its server code into `dist/server`.

Manual steps: `npm run generate -- 3000 12000 && npm run build && npm start`, then `npm run bench` in a second terminal. `npm run patch` / `npm run unpatch` toggle the patch; rebuild after toggling.

## Cause

All in [`pages-asset-tags.ts`](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts) (vinext 1.0.0, unchanged on `main`). The results depend only on the build and the matched route, yet they are recomputed on every request. Shares of total CPU below come from an unminified build of the 3000-page app:

- **Suffix-scan fallback (22%).** The Pages handler passes `route.filePath` and the `_app` path as absolute paths (`/abs/path/pages/index.jsx`); manifest keys are root-relative (`pages/index.jsx`). The exact lookup never hits, so [`getManifestFilesForModule`](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts#L44-L51) runs `for (const key in manifest)` with `endsWith`, four times per request (page and `_app`, from `resolveClientModuleUrl` and `collectAssetTags`). [`collectGraphOrderedCss`'s `findKey`](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts#L63-L70) does the same over `cssGraph` (3%).
- **Shared-chunk scan (32%).** [`collectAssetTags`](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts#L254-L273) visits every file of every manifest entry and runs `file.split("/").pop()` to find `framework-` / `vinext-` chunks. The result has one copy per module that references those chunks, so it is full of duplicates.
- **`Object.keys(manifest).length` (12%).** [`resolveSsrManifest`](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts#L28) allocates the full key array three times per request just to check that the manifest isn't empty. An early-return `for...in` is not enough: V8 still collects all keys of a large object.
- **`new Set(lazyChunks)`.** [Built on every request](https://github.com/cloudflare/vinext/blob/ca67493fb4f4599dedd55b10e56808424371de6a/packages/vinext/src/server/pages-asset-tags.ts#L201) (8920 entries here). Only 1% before the fix, but it takes most of the CPU once the scans above are gone.

## Suggested fix

[`patches/vinext-1.0.0-cache-manifest-lookups.patch`](patches/vinext-1.0.0-cache-manifest-lookups.patch) applies the following to the built `dist/server/pages-asset-tags.js`. Each cache is a `WeakMap`/`WeakSet` keyed by the manifest object, so a new manifest gets fresh entries:

- memoize the suffix lookup per `(record, moduleId)`, shared by `getManifestFilesForModule` and `findKey`
- compute the shared framework/vinext chunk list once per manifest, deduplicated
- remember manifests already known to be non-empty
- reuse one `Set` per `lazyChunks` array

Tag strings are still built per request because the nonce changes. An alternative is to do this at build time: key the lookup by the root-relative path, and emit the shared-chunk list and the lazy-chunk set as part of the client assets.

## Environment

vinext 1.0.0, vite 8.3.0, rolldown 1.2.11, react 19.2.8, Node 24.13.0, macOS 26.6 on an Apple M1 Max.
