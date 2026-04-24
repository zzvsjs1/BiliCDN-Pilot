# BiliCDN Pilot

BiliCDN Pilot is a Tampermonkey userscript that learns, benchmarks, and applies Bilibili video CDN hosts. It is designed for users who want to experiment with faster or more stable playback routes while keeping host replacement bounded by an allowlist.

The script targets Bilibili video playback pages, intercepts playurl data, collects CDN candidates, benchmarks reachable hosts with small range requests, and applies the best known CDN to video URLs. It also includes optional Worker coverage for player code that performs media requests inside Web Workers.

## Features

- Learns CDN candidates from Bilibili `playurl` responses.
- Benchmarks candidates with `Range` requests instead of downloading full media files.
- Caches benchmark stats and reuses the best CDN on future playback.
- Includes built-in seed CDN regions for extra candidates.
- Supports `*.bilivideo.com` and `*.akamaized.net` by default.
- Rewrites media URLs in playinfo objects, `fetch`, `XMLHttpRequest`, and selected player Workers.
- Adds player settings toggles for enabling/disabling CDN replacement, external CDN hosts, auto benchmarking, and Worker hooks.
- Keeps manual `CustomCDN` overrides ahead of automatic selection.
- Blocks Bilibili article pages from appending source or copyright text to copied selections, with a userscript menu toggle.

## Install

1. Install Tampermonkey or a compatible userscript manager.
2. Open `BiliCDN-Pilot.user.js`.
3. Install or update the script in Tampermonkey.
4. Make sure Tampermonkey has runtime host permissions for:
   - `https://*.bilibili.com/*`
   - `https://*.bilivideo.com/*`
   - `https://*.akamaized.net/*`

If Tampermonkey warns about limited runtime host permissions, browser extension site access is likely too narrow. Set Tampermonkey site access to allow the domains above.

## Configuration

Edit the top configuration block in `BiliCDN-Pilot.user.js` if needed:

```js
var CustomCDN = '';
var AllowExternalCDNDefault = false;
var AutoBestCDNDefault = true;
var CDNBenchmarkBytes = 262144;
var SeedCDNRegions = ['海外', '深圳', '香港'];
var EnableWorkerHookDefault = true;
var EnableCopyCleanPatchDefault = true;
```

`CustomCDN` manually pins a CDN host or URL. When it is set, automatic benchmarking may still learn candidates, but it will not override your manual choice.

`AllowExternalCDNDefault` controls whether hosts outside the built-in allowlist are allowed. With the default `false`, `*.bilivideo.com` and `*.akamaized.net` are still allowed.

`AutoBestCDNDefault` enables automatic CDN learning and benchmarking.

`CDNBenchmarkBytes` controls how many bytes each benchmark request downloads. The default is 256 KiB.

`SeedCDNRegions` selects built-in CDN candidate regions for benchmarking. Add or remove region names from the array to change the seed pool.

`EnableWorkerHookDefault` enables Worker-side request replacement on supported player pages.

`EnableCopyCleanPatchDefault` controls the copy cleanup patch. When enabled, the script registers an early `copy` listener that lets the browser's normal copy behavior continue but stops later Bilibili page handlers from adding source links or copyright text. You can toggle this at runtime from the Tampermonkey userscript menu entry named `Copy cleanup` / `复制清理`.

The player settings panel only exists on player pages, so the copy cleanup switch lives in the userscript manager menu and works on article pages too.

## How Selection Works

The candidate pool is built from:

1. The previously cached `BestCDN`.
2. CDN hosts discovered from the current Bilibili `playurl` response.
3. Built-in seed CDN regions.
4. Previously learned CDN hosts.

The script benchmarks at most a small number of candidates per run. If a newly measured host is faster than the current best by at least 500 ms or 15%, it becomes the new `BestCDN`. This avoids switching CDN hosts for insignificant timing differences.

## Console Logs

Open DevTools and filter for `[BiliCDNPilot]`.

Useful messages:

```text
CDN benchmark started: ...
CDN benchmark testing: host (direct playurl)
CDN benchmark testing: host (host swap)
CDN benchmark OK: host 123ms status=206
CDN benchmark failed: host timeout
Best CDN updated: host (123ms)
Best CDN kept: current (...ms), candidate ... not significantly faster
Worker hooks installed
Worker Blob hook injected
Worker URL hook wrapped: ...
```

`direct playurl` means the script is testing a URL returned directly by Bilibili.

`host swap` means the script is testing a built-in or historical candidate by replacing the host in a known media URL. Some hosts may reject this and fail with timeout, network error, or 403; this is expected.

`status=206` means the CDN accepted the range request and returned partial content, which is ideal for benchmarking.

## Safety Notes

- The script does not use remote script dependencies.
- Built-in seed CDN data is embedded locally.
- The default allowlist only accepts `*.bilivideo.com` and `*.akamaized.net`.
- Worker hooks are installed only on player-like pages and only rewrite outgoing media request URLs.
- Worker response bodies are not read or transformed, keeping overhead lower.
- Copy cleanup does not write clipboard contents itself. It only stops later page `copy` handlers, so default browser copying remains in control.

## Limitations

- CDN performance changes by region, ISP, time, and video.
- Some CDN hosts only work with URLs directly returned by Bilibili.
- Some hosts reject swapped media URLs, which is why failed benchmark logs are normal.
- The first playback after install may use the default CDN until enough data is learned.
- Worker hooking is best-effort and may not catch Workers created before the script runs.

## License

MIT License
