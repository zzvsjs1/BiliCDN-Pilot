// ==UserScript==
// @name         BiliCDN Pilot
// @name:zh-CN   BiliCDN Pilot - 智能 CDN 优选
// @name:zh-TW   BiliCDN Pilot - 智慧 CDN 優選
// @name:ja      BiliCDN Pilot - CDN自動選択
// @name:en      BiliCDN Pilot
// @namespace    https://github.com/placeholder/bilicdn-pilot
// @copyright    Free For Personal Use
// @license      No License
// @version      0.4.0
// @description       Learn, benchmark, and apply Bilibili video CDN hosts with safer allowlists and Worker coverage
// @description:zh-CN 自动学习、测速并应用哔哩哔哩视频 CDN, 支持白名单与 Worker 内替换
// @description:en    Learn, benchmark, and apply Bilibili video CDN hosts with safer allowlists and Worker coverage
// @description:zh-TW 自動學習、測速並套用 Bilibili 影片 CDN, 支援白名單與 Worker 內替換
// @description:ja    Bilibili動画CDNを学習・測定・適用し, ホワイトリストとWorker内置換に対応
// @author       PlaceholderDev
// @run-at       document-start
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/blackboard/*
// @match        https://live.bilibili.com/blanc/*
// @match        https://www.bilibili.com/?*
// @match        https://www.bilibili.com/
// @match        https://www.bilibili.com/mooc/*
// @match        https://www.bilibili.com/v/*
// @match        https://www.bilibili.com/documentary/*
// @match        https://www.bilibili.com/variety/*
// @match        https://www.bilibili.com/tv/*
// @match        https://www.bilibili.com/guochuang/*
// @match        https://www.bilibili.com/movie/*
// @match        https://www.bilibili.com/anime/*
// @match        https://www.bilibili.com/match/*
// @match        https://www.bilibili.com/cheese/*
// @match        https://music.bilibili.com/pc/music-center/*
// @match        https://search.bilibili.com/*
// @match        https://m.bilibili.com/video/*
// @match        https://m.bilibili.com/bangumi/play/*
// @match        https://m.bilibili.com/?*
// @match        https://m.bilibili.com/
// @match        *://*.bilibili.com/*
// @icon         https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      bilivideo.com
// @connect      *.bilivideo.com
// @connect      akamaized.net
// @connect      *.akamaized.net
//
//
// ==/UserScript==

// ========================= User configuration =========================
// Enter a custom CDN hostname or full URL here. Set to null to disable a custom override.
// Examples: 'upos-sz-mirrorali.bilivideo.com' or 'https://upos-sz-mirrorali.bilivideo.com/'
var CustomCDN = '';

// Allow CDN hosts outside the allowlist. When false, *.bilivideo.com and *.akamaized.net are still allowed.
// This can also be toggled in the player settings UI.
var AllowExternalCDNDefault = false;

// Learn CDN candidates from playurl responses and benchmark the fastest host. CustomCDN is never overridden.
var AutoBestCDNDefault = true;

// Bytes to download per CDN benchmark candidate. Default: 256KB.
var CDNBenchmarkBytes = 262144;

// Built-in CDN seed regions for the benchmark pool. Add or remove region names from the list below as needed.
var SeedCDNRegions = ['海外', '深圳', '香港'];

// Install CDN replacement hooks inside player Workers.
var EnableWorkerHookDefault = true;
// ======================= End user configuration ============================

(function () {
  'use strict';

    // Prevent pages from appending source URLs or copyright text on copy.
    (function enableCopyCleanPatch() {
        const stopCopyHijack = (e) => {
            // Keep the browser's default copy behavior, but block later page scripts from rewriting clipboard data.
            e.stopImmediatePropagation();
        };

        // Use the capture phase to run before most page handlers.
        window.addEventListener('copy', stopCopyHijack, true);
        document.addEventListener('copy', stopCopyHijack, true);

        // Some pages attach listeners after DOMContentLoaded, so register once more for stability.
        document.addEventListener('DOMContentLoaded', () => {
            window.addEventListener('copy', stopCopyHijack, true);
            document.addEventListener('copy', stopCopyHijack, true);
        }, { once: true });
    })();

  const PluginName = 'BiliCDNPilot';
  const log = console.log.bind(console, `[${PluginName}]:`);

  const Language = (() => {
    const lang = (navigator.language || navigator.browserLanguage || (navigator.languages || ['en'])[0]).substring(0, 2);
    return (lang === 'zh' || lang === 'ja') ? lang : 'en';
  })();

  // i18n labels
  const I18N = {
    title: { zh: '拦截修改视频CDN', en: 'CDN Switcher', ja: 'CDNスイッチャー' },
    allowExt: { zh: '允许外部 CDN 域名', en: 'Allow external CDN domains', ja: '外部CDNドメインを許可' },
    allowExtTip: {
      zh: '仅在完全信任该域名时开启', en: 'Enable only if you fully trust the domain', ja: '信頼できる場合のみ有効化してください'
    },
    autoBest: { zh: '自动测速选择 CDN', en: 'Auto-pick fastest CDN', ja: '最速CDNを自動選択' },
    autoBestTip: {
      zh: '从播放接口学习候选 CDN, 后台短测后保存最快节点',
      en: 'Learn CDN candidates from playurl responses and keep the fastest tested host',
      ja: 'playurl応答から候補CDNを学習し, 最速ホストを保存します'
    },
    workerHook: { zh: 'Worker 内替换 CDN', en: 'Patch CDN inside Workers', ja: 'Worker内CDN置換' },
    workerHookTip: {
      zh: '仅在播放器页面安装 Worker 钩子, 用于拦截 Worker 内的媒体请求',
      en: 'Install Worker hooks only on player pages to catch media requests inside Workers',
      ja: 'プレイヤーページでのみWorker内のメディアリクエストを捕捉します'
    },
    enabled: { zh: '已启用', en: 'Enabled', ja: '有効化' },
    disabled: { zh: '已禁用', en: 'Disabled', ja: '無効化' },
    blockedExt: {
      zh: '外部 CDN 已被拦截, 仅允许 *.bilivideo.com 或 *.akamaized.net',
      en: 'External CDN blocked, only *.bilivideo.com or *.akamaized.net is allowed',
      ja: '外部CDNはブロックされました, *.bilivideo.com または *.akamaized.net のみ許可'
    }
  };

  // Load persisted state
  let disabled = !!GM_getValue('disabled');
  let allowExternalCDN = GM_getValue('AllowExternalCDN');
  if (typeof allowExternalCDN !== 'boolean') allowExternalCDN = !!AllowExternalCDNDefault;
  let autoBestCDN = GM_getValue('AutoBestCDN');
  if (typeof autoBestCDN !== 'boolean') autoBestCDN = !!AutoBestCDNDefault;
  let enableWorkerHook = GM_getValue('EnableWorkerHook');
  if (typeof enableWorkerHook !== 'boolean') enableWorkerHook = !!EnableWorkerHookDefault;

  // URL helpers
  function toAbsoluteUrlLike(u) {
    if (!u) return '';
    if (typeof u !== 'string') u = String(u);
    if (u.indexOf('://') === -1) u = 'https://' + u;
    return u.endsWith('/') ? u : (u + '/');
  }

  function normalizeUrl(u) {
    try {
      if (typeof u === 'string') return u;
      if (u && typeof u === 'object') {
        if ('url' in u && typeof u.url === 'string') return u.url;
        if ('href' in u && typeof u.href === 'string') return u.href;
      }
      return String(u);
    } catch (e) { return ''; }
  }

  function getCdnUrl(u) {
    try {
      const parsed = new URL(toAbsoluteUrlLike(u));
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed : null;
    } catch {
      return null;
    }
  }

  function isAllowedCDNHost(host) {
    return /(^|\.)(bilivideo\.com|akamaized\.net)$/i.test(host || '');
  }

  const DefaultCDNByLanguage = { zh: 'cn-jxnc-cmcc-bcache-06.bilivideo.com', en: 'upos-sz-mirroraliov.bilivideo.com', ja: 'upos-sz-mirroralib.bilivideo.com' };
  const CDNHostsStorageKey = 'CDNHosts';
  const CDNStatsStorageKey = 'CDNStats';
  const BestCDNStorageKey = 'BestCDN';
  const CDNStatsTTL = 12 * 60 * 60 * 1000;
  const MaxStoredCDNHosts = 80;
  const MaxBenchmarkHosts = 8;
  const BenchmarkTimeoutMs = 3500;
  const MinBestImprovementRatio = 0.15;
  const MinBestImprovementMs = 500;
  const BuiltInCDNByRegion = {
    '上海': ['cn-sh-ct-01-01.bilivideo.com', 'cn-sh-ct-01-06.bilivideo.com', 'cn-sh-ct-01-13.bilivideo.com', 'cn-sh-ct-01-15.bilivideo.com', 'cn-sh-ct-01-23.bilivideo.com', 'cn-sh-ct-01-24.bilivideo.com', 'cn-sh-ct-01-35.bilivideo.com', 'cn-sh-ct-01-36.bilivideo.com', 'cn-sh-office-bcache-01.bilivideo.com'],
    '北京': ['cn-bj-cc-03-14.bilivideo.com', 'cn-bj-cc-03-17.bilivideo.com', 'cn-bj-fx-01-04.bilivideo.com', 'cn-bj-fx-01-05.bilivideo.com', 'cn-bj-se-01-05.bilivideo.com'],
    '南京': ['cn-jsnj-fx-02-05.bilivideo.com', 'cn-jsnj-fx-02-07.bilivideo.com', 'cn-jsnj-fx-02-10.bilivideo.com', 'cn-jsnj-gd-01-02.bilivideo.com'],
    '呼市': ['cn-nmghhht-cm-01-11.bilivideo.com', 'cn-nmghhht-cu-01-01.bilivideo.com', 'cn-nmghhht-cu-01-08.bilivideo.com', 'cn-nmghhht-cu-01-09.bilivideo.com', 'cn-nmghhht-cu-01-10.bilivideo.com', 'cn-nmghhht-cu-01-12.bilivideo.com', 'cn-nmghhht-cu-01-15.bilivideo.com'],
    '哈市': ['cn-hljheb-cm-01-01.bilivideo.com', 'cn-hljheb-cm-01-03.bilivideo.com', 'cn-hljheb-ct-01-02.bilivideo.com', 'cn-hljheb-ct-01-03.bilivideo.com', 'cn-hljheb-ct-01-04.bilivideo.com', 'cn-hljheb-ct-01-07.bilivideo.com'],
    '外建': ['c0--cn-gotcha01.bilivideo.com', 'd0--cn-gotcha09.bilivideo.com', 'd1--cn-gotcha04b.bilivideo.com', 'd1--cn-gotcha07b.bilivideo.com', 'd1--cn-gotcha101.bilivideo.com', 'd1--cn-gotcha102.bilivideo.com', 'd1--cn-gotcha204-1.bilivideo.com', 'd1--cn-gotcha204-3.bilivideo.com', 'd1--cn-gotcha204-4.bilivideo.com', 'd1--cn-gotcha207.bilivideo.com', 'd1--cn-gotcha208b.bilivideo.com', 'd1--cn-gotcha211.bilivideo.com', 'd1--cn-gotcha308.bilivideo.com', 'd1--ov-gotcha01.bilivideo.com', 'd1--ov-gotcha03.bilivideo.com', 'd1--ov-gotcha207.bilivideo.com', 'd1--ov-gotcha207b.bilivideo.com', 'd1--ov-gotcha208.bilivideo.com', 'd1--ov-gotcha209.bilivideo.com', 'd1--ov-gotcha210.bilivideo.com', 'd1--p1--cn-gotcha04.bilivideo.com', 'd1--tf-gotcha04.bilivideo.com'],
    '天津': ['cn-tj-cm-02-01.bilivideo.com', 'cn-tj-cm-02-02.bilivideo.com', 'cn-tj-cm-02-04.bilivideo.com', 'cn-tj-cm-02-05.bilivideo.com', 'cn-tj-cm-02-06.bilivideo.com', 'cn-tj-cm-02-07.bilivideo.com', 'cn-tj-cu-01-02.bilivideo.com', 'cn-tj-cu-01-03.bilivideo.com', 'cn-tj-cu-01-04.bilivideo.com', 'cn-tj-cu-01-05.bilivideo.com', 'cn-tj-cu-01-06.bilivideo.com', 'cn-tj-cu-01-07.bilivideo.com', 'cn-tj-cu-01-09.bilivideo.com', 'cn-tj-cu-01-10.bilivideo.com', 'cn-tj-cu-01-11.bilivideo.com', 'cn-tj-cu-01-12.bilivideo.com', 'cn-tj-cu-01-13.bilivideo.com'],
    '广州': ['cn-gdgz-cm-01-02.bilivideo.com', 'cn-gdgz-cm-01-10.bilivideo.com', 'cn-gdgz-fx-01-01.bilivideo.com', 'cn-gdgz-fx-01-02.bilivideo.com', 'cn-gdgz-fx-01-03.bilivideo.com', 'cn-gdgz-fx-01-04.bilivideo.com', 'cn-gdgz-fx-01-08.bilivideo.com', 'cn-gdgz-fx-01-10.bilivideo.com', 'cn-gdgz-gd-01-01.bilivideo.com'],
    '成都': ['cn-sccd-cm-03-02.bilivideo.com', 'cn-sccd-cm-03-05.bilivideo.com', 'cn-sccd-ct-01-02.bilivideo.com', 'cn-sccd-ct-01-08.bilivideo.com', 'cn-sccd-ct-01-10.bilivideo.com', 'cn-sccd-ct-01-17.bilivideo.com', 'cn-sccd-ct-01-18.bilivideo.com', 'cn-sccd-ct-01-19.bilivideo.com', 'cn-sccd-ct-01-20.bilivideo.com', 'cn-sccd-ct-01-21.bilivideo.com', 'cn-sccd-ct-01-22.bilivideo.com', 'cn-sccd-ct-01-23.bilivideo.com', 'cn-sccd-ct-01-24.bilivideo.com', 'cn-sccd-ct-01-25.bilivideo.com', 'cn-sccd-ct-01-26.bilivideo.com', 'cn-sccd-ct-01-27.bilivideo.com', 'cn-sccd-ct-01-29.bilivideo.com', 'cn-sccd-cu-01-02.bilivideo.com', 'cn-sccd-cu-01-03.bilivideo.com', 'cn-sccd-cu-01-04.bilivideo.com', 'cn-sccd-cu-01-05.bilivideo.com', 'cn-sccd-cu-01-06.bilivideo.com', 'cn-sccd-cu-01-07.bilivideo.com', 'cn-sccd-cu-01-09.bilivideo.com', 'cn-sccd-fx-01-01.bilivideo.com', 'cn-sccd-fx-01-06.bilivideo.com'],
    '新疆': ['cn-xj-cm-02-01.bilivideo.com', 'cn-xj-cm-02-03.bilivideo.com', 'cn-xj-cm-02-04.bilivideo.com', 'cn-xj-cm-02-06.bilivideo.com', 'cn-xj-ct-01-01.bilivideo.com', 'cn-xj-ct-01-02.bilivideo.com', 'cn-xj-ct-01-03.bilivideo.com', 'cn-xj-ct-01-04.bilivideo.com', 'cn-xj-ct-01-05.bilivideo.com', 'cn-xj-ct-02-02.bilivideo.com'],
    '杭州': ['cn-zjhz-cm-01-01.bilivideo.com', 'cn-zjhz-cm-01-04.bilivideo.com', 'cn-zjhz-cm-01-07.bilivideo.com', 'cn-zjhz-cm-01-12.bilivideo.com', 'cn-zjhz-cm-01-17.bilivideo.com', 'cn-zjhz-cu-01-01.bilivideo.com', 'cn-zjhz-cu-01-02.bilivideo.com', 'cn-zjhz-cu-01-05.bilivideo.com', 'cn-zjhz-cu-v-02.bilivideo.com'],
    '武汉': ['cn-hbwh-cm-01-01.bilivideo.com', 'cn-hbwh-cm-01-02.bilivideo.com', 'cn-hbwh-cm-01-04.bilivideo.com', 'cn-hbwh-cm-01-05.bilivideo.com', 'cn-hbwh-cm-01-06.bilivideo.com', 'cn-hbwh-cm-01-08.bilivideo.com', 'cn-hbwh-cm-01-09.bilivideo.com', 'cn-hbwh-cm-01-10.bilivideo.com', 'cn-hbwh-cm-01-12.bilivideo.com', 'cn-hbwh-cm-01-13.bilivideo.com', 'cn-hbwh-cm-01-17.bilivideo.com', 'cn-hbwh-cm-01-19.bilivideo.com', 'cn-hbwh-fx-01-01.bilivideo.com', 'cn-hbwh-fx-01-02.bilivideo.com', 'cn-hbwh-fx-01-12.bilivideo.com', 'cn-hbwh-fx-01-13.bilivideo.com'],
    '沈阳': ['cn-lnsy-cm-01-01.bilivideo.com', 'cn-lnsy-cm-01-03.bilivideo.com', 'cn-lnsy-cm-01-04.bilivideo.com', 'cn-lnsy-cm-01-05.bilivideo.com', 'cn-lnsy-cm-01-06.bilivideo.com', 'cn-lnsy-cu-01-03.bilivideo.com', 'cn-lnsy-cu-01-06.bilivideo.com'],
    '海外': ['upos-hz-mirrorakam.akamaized.net', 'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorcosov.bilivideo.com'],
    '深圳': ['upos-sz-302kodo.bilivideo.com', 'upos-sz-dynqn.bilivideo.com', 'upos-sz-estgcos.bilivideo.com', 'upos-sz-estghw.bilivideo.com', 'upos-sz-mirror08c.bilivideo.com', 'upos-sz-mirror08h.bilivideo.com', 'upos-sz-mirroralibstar1.bilivideo.com', 'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorbd.bilivideo.com', 'upos-sz-mirrorcf1ov.bilivideo.com', 'upos-sz-mirrorcosbstar.bilivideo.com', 'upos-sz-mirrorcosdisp.bilivideo.com', 'upos-sz-mirrorctos.bilivideo.com', 'upos-sz-mirrorhwdisp.bilivideo.com', 'upos-sz-originbstar.bilivideo.com', 'upos-sz-origincosgzhw.bilivideo.com', 'upos-sz-origincosv.bilivideo.com'],
    '福建': ['cn-fjfz-fx-01-01.bilivideo.com', 'cn-fjfz-fx-01-02.bilivideo.com', 'cn-fjfz-fx-01-03.bilivideo.com', 'cn-fjfz-fx-01-04.bilivideo.com', 'cn-fjfz-fx-01-05.bilivideo.com', 'cn-fjfz-fx-01-06.bilivideo.com', 'cn-fjqz-cm-01-01.bilivideo.com', 'cn-fjqz-cm-01-02.bilivideo.com', 'cn-fjqz-cm-01-03.bilivideo.com', 'cn-fjqz-cm-01-04.bilivideo.com', 'cn-fjqz-cm-01-05.bilivideo.com', 'cn-fjqz-cm-01-06.bilivideo.com', 'cn-fjqz-cm-01-07.bilivideo.com', 'cn-fjqz-cm-01-08.bilivideo.com'],
    '西安': ['cn-sxxa-cm-01-01.bilivideo.com', 'cn-sxxa-cm-01-02.bilivideo.com', 'cn-sxxa-cm-01-04.bilivideo.com', 'cn-sxxa-cm-01-09.bilivideo.com', 'cn-sxxa-cm-01-12.bilivideo.com', 'cn-sxxa-ct-03-02.bilivideo.com', 'cn-sxxa-ct-03-03.bilivideo.com', 'cn-sxxa-ct-03-04.bilivideo.com', 'cn-sxxa-cu-02-01.bilivideo.com', 'cn-sxxa-cu-02-02.bilivideo.com'],
    '郑州': ['cn-hnzz-cm-01-01.bilivideo.com', 'cn-hnzz-cm-01-02.bilivideo.com', 'cn-hnzz-cm-01-03.bilivideo.com', 'cn-hnzz-cm-01-04.bilivideo.com', 'cn-hnzz-cm-01-05.bilivideo.com', 'cn-hnzz-cm-01-06.bilivideo.com', 'cn-hnzz-cm-01-09.bilivideo.com', 'cn-hnzz-cm-01-11.bilivideo.com', 'cn-hnzz-fx-01-01.bilivideo.com', 'cn-hnzz-fx-01-08.bilivideo.com'],
    '香港': ['cn-hk-eq-01-01.bilivideo.com', 'cn-hk-eq-01-03.bilivideo.com', 'cn-hk-eq-01-09.bilivideo.com', 'cn-hk-eq-01-10.bilivideo.com', 'cn-hk-eq-01-12.bilivideo.com', 'cn-hk-eq-01-13.bilivideo.com', 'cn-hk-eq-01-14.bilivideo.com', 'cn-hk-eq-bcache-13.bilivideo.com']
  };
  let benchmarkRunning = false;

  function normalizeCDNHost(value) {
    if (!value) return '';
    try {
      const parsed = getCdnUrl(value);
      const host = parsed ? parsed.hostname : String(value).trim();
      return isAllowedCDNHost(host) ? host.toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function loadCDNHosts() {
    const saved = GM_getValue(CDNHostsStorageKey, []);
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.map(normalizeCDNHost).filter(Boolean))].slice(0, MaxStoredCDNHosts);
  }

  function loadCDNStats() {
    const saved = GM_getValue(CDNStatsStorageKey, {});
    return (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {};
  }

  function getSeedCDNHosts() {
    const regions = Array.isArray(SeedCDNRegions) && SeedCDNRegions.length ? SeedCDNRegions : ['海外', '深圳', '香港'];
    const hosts = regions.flatMap(region => BuiltInCDNByRegion[region] || []);
    return [...new Set(hosts.map(normalizeCDNHost).filter(Boolean))];
  }

  function saveCDNHosts(hosts) {
    const safeHosts = [...new Set(hosts.map(normalizeCDNHost).filter(Boolean))].slice(0, MaxStoredCDNHosts);
    GM_setValue(CDNHostsStorageKey, safeHosts);
    return safeHosts;
  }

  function rememberCDNHosts(hosts) {
    const merged = [...hosts, ...loadCDNHosts()];
    const saved = saveCDNHosts(merged);
    if (hosts.length) log(`CDN hosts learned: ${saved.length}`);
    return saved;
  }

  function getBestStoredCDNHost() {
    const now = Date.now();
    const stats = loadCDNStats();
    const storedBest = normalizeCDNHost(GM_getValue(BestCDNStorageKey, ''));
    const candidates = [...new Set([storedBest, ...loadCDNHosts(), ...getSeedCDNHosts(), ...Object.keys(stats)].map(normalizeCDNHost).filter(Boolean))]
      .map(host => ({ host, stat: stats[host] }))
      .filter(item => item.stat && item.stat.ok > 0 && now - item.stat.ts < CDNStatsTTL)
      .sort((a, b) => a.stat.score - b.stat.score);
    return candidates[0]?.host || storedBest || '';
  }

  function collectCDNUrlsFromPlayInfo(playInfo) {
    const urls = [];
    const addUrl = value => {
      if (typeof value === 'string') {
        urls.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(addUrl);
      }
    };
    const addItem = item => {
      if (!item || typeof item !== 'object') return;
      addUrl(item.base_url);
      addUrl(item.baseUrl);
      addUrl(item.backup_url);
      addUrl(item.backupUrl);
      addUrl(item.url);
      addUrl(item.readyVideoUrl);
      if (Array.isArray(item.durl)) item.durl.forEach(addItem);
    };
    const addVideoInfo = info => {
      if (!info || typeof info !== 'object') return;
      addItem(info);
      info.dash?.video?.forEach(addItem);
      info.dash?.audio?.forEach(addItem);
      info.durl?.forEach(addItem);
      info.durls?.forEach(item => item?.durl?.forEach(addItem));
    };
    addVideoInfo(playInfo);
    addVideoInfo(playInfo?.data);
    addVideoInfo(playInfo?.result);
    addVideoInfo(playInfo?.result?.video_info);
    return [...new Set(urls)];
  }

  function collectCDNHostsFromUrls(urls) {
    return [...new Set(urls.map(url => {
      try { return normalizeCDNHost(new URL(url).hostname); } catch { return ''; }
    }).filter(Boolean))];
  }

  function mapCDNUrlsByHost(urls) {
    const map = {};
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const host = normalizeCDNHost(parsed.hostname);
        if (host && !map[host]) map[host] = url;
      } catch {}
    }
    return map;
  }

  function replaceUrlHost(url, host) {
    try {
      const parsed = new URL(url);
      parsed.hostname = host;
      return parsed.href;
    } catch {
      return '';
    }
  }

  function benchmarkCDNHost(sampleUrl, host, directUrl) {
    return new Promise(resolve => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        log(`CDN benchmark skipped: GM_xmlhttpRequest unavailable for ${host}`);
        resolve({ host, ok: false, score: Infinity, error: 'GM_xmlhttpRequest unavailable' });
        return;
      }

      const testUrl = directUrl || replaceUrlHost(sampleUrl, host);
      if (!testUrl) {
        log(`CDN benchmark skipped: invalid test URL for ${host}`);
        resolve({ host, ok: false, score: Infinity, error: 'invalid url' });
        return;
      }

      log(`CDN benchmark testing: ${host}${directUrl ? ' (direct playurl)' : ' (host swap)'}`);
      const start = performance.now();
      GM_xmlhttpRequest({
        method: 'GET',
        url: testUrl,
        headers: {
          Range: `bytes=0-${Math.max(0, CDNBenchmarkBytes - 1)}`,
          Referer: location.href
        },
        responseType: 'arraybuffer',
        timeout: BenchmarkTimeoutMs,
        onload: res => {
          const elapsed = performance.now() - start;
          const ok = (res.status >= 200 && res.status < 300) || res.status === 206;
          if (ok) {
            log(`CDN benchmark OK: ${host} ${Math.round(elapsed)}ms status=${res.status}`);
          } else {
            log(`CDN benchmark failed: ${host} status=${res.status}`);
          }
          resolve({ host, ok, score: ok ? elapsed : Infinity, status: res.status, ts: Date.now() });
        },
        onerror: () => {
          log(`CDN benchmark failed: ${host} network error`);
          resolve({ host, ok: false, score: Infinity, error: 'network', ts: Date.now() });
        },
        ontimeout: () => {
          log(`CDN benchmark failed: ${host} timeout`);
          resolve({ host, ok: false, score: Infinity, error: 'timeout', ts: Date.now() });
        }
      });
    });
  }

  async function runCDNBenchmarks(sampleUrl, hosts, urlsByHost) {
    const results = [];
    const queue = hosts.slice(0, MaxBenchmarkHosts);
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const host = queue.shift();
        results.push(await benchmarkCDNHost(sampleUrl, host, urlsByHost[host]));
      }
    });
    await Promise.all(workers);
    return results;
  }

  function saveCDNBenchmarkResults(results) {
    const stats = loadCDNStats();
    for (const result of results) {
      const old = stats[result.host] || { ok: 0, fail: 0, score: Infinity, ts: 0 };
      if (result.ok) {
        stats[result.host] = {
          ok: old.ok + 1,
          fail: old.fail || 0,
          score: Number.isFinite(old.score) ? (old.score * 0.6 + result.score * 0.4) : result.score,
          lastMs: Math.round(result.score),
          ts: result.ts || Date.now()
        };
      } else {
        stats[result.host] = {
          ok: old.ok || 0,
          fail: (old.fail || 0) + 1,
          score: old.score,
          lastMs: old.lastMs,
          ts: Date.now()
        };
      }
    }
    GM_setValue(CDNStatsStorageKey, stats);
  }

  function shouldUpdateBestCDN(candidate, results) {
    const currentHost = normalizeCDNHost(GM_getValue(BestCDNStorageKey, ''));
    if (!currentHost || currentHost === candidate.host) return true;

    const currentResult = results.find(item => item.ok && item.host === currentHost);
    if (!currentResult) return true;

    const improvement = currentResult.score - candidate.score;
    const enoughAbsoluteGain = improvement >= MinBestImprovementMs;
    const enoughRelativeGain = candidate.score <= currentResult.score * (1 - MinBestImprovementRatio);
    if (enoughAbsoluteGain || enoughRelativeGain) return true;

    log(`Best CDN kept: ${currentHost} (${Math.round(currentResult.score)}ms), candidate ${candidate.host} (${Math.round(candidate.score)}ms) not significantly faster`);
    return false;
  }

  function scheduleCDNBenchmark(playInfo) {
    if (disabled || !autoBestCDN || benchmarkRunning) return;

    const urls = collectCDNUrlsFromPlayInfo(playInfo);
    const discoveredHosts = collectCDNHostsFromUrls(urls);
    const urlsByHost = mapCDNUrlsByHost(urls);
    if (!urls.length || !discoveredHosts.length) return;

    rememberCDNHosts(discoveredHosts);
    if (manualCDNConfigured) return;

    const sampleUrl = urls.find(url => {
      try { return isAllowedCDNHost(new URL(url).hostname); } catch { return false; }
    });
    if (!sampleUrl) return;

    const seedHosts = getSeedCDNHosts();
    const hosts = [...new Set([getBestStoredCDNHost(), ...discoveredHosts, ...seedHosts, ...loadCDNHosts()].filter(Boolean))];
    if (seedHosts.length) log(`Built-in CDN seeds enabled: ${seedHosts.length} hosts from ${SeedCDNRegions.join(', ')}`);
    log(`CDN benchmark started: ${hosts.slice(0, MaxBenchmarkHosts).join(', ')}`);
    benchmarkRunning = true;
    runCDNBenchmarks(sampleUrl, hosts, urlsByHost).then(results => {
      saveCDNBenchmarkResults(results);
      const best = results.filter(item => item.ok).sort((a, b) => a.score - b.score)[0];
      if (best) {
        if (shouldUpdateBestCDN(best, results)) {
          GM_setValue(BestCDNStorageKey, best.host);
          Replacement = toAbsoluteUrlLike(best.host);
          log(`Best CDN updated: ${best.host} (${Math.round(best.score)}ms)`);
        }
      } else {
        log('CDN benchmark finished: no usable CDN found');
      }
    }).catch(err => {
      log('CDN benchmark failed:', err);
    }).finally(() => {
      benchmarkRunning = false;
    });
  }

  // Resolve the active replacement CDN and enforce the allowlist
  const stored = GM_getValue('CustomCDN');
  CustomCDN = (CustomCDN === 'null') ? null : CustomCDN;
  let domain;
  let manualCDNConfigured = false;
  if (CustomCDN && CustomCDN !== '') {
    domain = CustomCDN;
    manualCDNConfigured = true;
    if (CustomCDN !== stored) {
      GM_setValue('CustomCDN', domain);
      log('CustomCDN saved to GM storage');
    }
  } else if (CustomCDN === null && stored !== null) {
    GM_setValue('CustomCDN', null);
    log('CustomCDN deleted from GM storage');
  } else if (stored) {
    domain = stored;
    manualCDNConfigured = true;
  }

  // Without a manual CDN, prefer the most recently benchmarked best host, then fall back to the default CDN.
  if (!domain) {
    domain = (autoBestCDN && getBestStoredCDNHost()) || DefaultCDNByLanguage[Language];
  }

  // Allowlist enforcement
  const candidateUrl = getCdnUrl(domain);
  const candidateAbs = candidateUrl ? candidateUrl.href : '';
  const candidateHost = candidateUrl ? candidateUrl.hostname : '';
  let Replacement;
  if (!candidateHost) {
    Replacement = toAbsoluteUrlLike(DefaultCDNByLanguage[Language]);
    log('Invalid custom CDN, fallback to default CDN');
  } else if (!allowExternalCDN && !isAllowedCDNHost(candidateHost)) {
    // Block disallowed external hosts and fall back to the default official host.
    const fallback = DefaultCDNByLanguage[Language];
    Replacement = toAbsoluteUrlLike(fallback);
    log(I18N.blockedExt[Language]);
  } else {
    Replacement = candidateAbs;
  }

  log(`CDN=${Replacement}`);

  const SettingsBarTitle = I18N.title[Language];

  const MediaDomainRE = /(?:^|\.)(?:(?:bilivideo|acgvideo)\.(?:com|cn)|akamaized\.net)$/i;
  const IgnoreMediaHostRE = /^(?:bvc|data|pbp|api|api\w+)\./i;

  function getReplacementHost() {
    try { return new URL(Replacement).host; } catch { return ''; }
  }

  function hasMediaDomain(value) {
    if (typeof value !== 'string') return false;
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
      return MediaDomainRE.test(parsed.hostname);
    } catch {
      const match = value.match(/^https?:\/\/([^/]+)/i) || value.match(/^\/\/([^/]+)/) || value.match(/^([^/\s]+\.(?:(?:bilivideo|acgvideo)\.(?:com|cn)|akamaized\.net))(?:\/|$)/i);
      return !!(match && MediaDomainRE.test(match[1]));
    }
  }

  function isIgnoredMediaHost(value) {
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
      return IgnoreMediaHostRE.test(parsed.hostname);
    } catch {
      const match = value.match(/^https?:\/\/([^/]+)/i) || value.match(/^\/\/([^/]+)/) || value.match(/^([^/\s]+)/);
      return !!(match && IgnoreMediaHostRE.test(match[1]));
    }
  }

  function replaceCdnUrl(url) {
    if (typeof url !== 'string') return url;
    if (disabled || !hasMediaDomain(url) || isIgnoredMediaHost(url)) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url.replace(/^https?:\/\/[^/]+\//i, Replacement);
    if (url.startsWith('//')) return url.replace(/^\/\/[^/]+\//, Replacement.replace(/^https?:/i, ''));
    if (/^[^/\s]+\//.test(url)) return url.replace(/^[^/\s]+\//, `${getReplacementHost()}/`);
    return url;
  }

  function replaceCdnHostValue(host) {
    if (typeof host !== 'string') return host;
    if (disabled || !hasMediaDomain(host) || isIgnoredMediaHost(host)) return host;
    if (host.startsWith('http://') || host.startsWith('https://')) return Replacement.replace(/\/$/, '');
    if (host.startsWith('//')) return Replacement.replace(/^https?:/i, '').replace(/\/$/, '');
    if (/^[^/\s]+$/.test(host)) return getReplacementHost();
    return host;
  }

  function shouldInstallWorkerHooks() {
    if (disabled || !enableWorkerHook) return false;
    const host = location.host;
    const path = location.pathname || '/';
    if (host === 'player.bilibili.com') return true;
    if (host === 'www.bilibili.com') {
      return path.startsWith('/video/')
        || path.startsWith('/bangumi/play/')
        || path.startsWith('/cheese/')
        || path.startsWith('/blackboard/video-diagnostics.html');
    }
    return host === 'm.bilibili.com' && (path.startsWith('/video/') || path.startsWith('/bangumi/play/'));
  }

  function workerScriptLooksRelevant(scriptText) {
    if (typeof scriptText !== 'string') return false;
    if (scriptText.length > 1024 * 1024) return false;
    return /bilivideo|acgvideo|akamaized|bilibili|bili|player|m4s|dash/i.test(scriptText);
  }

  function shouldWrapWorkerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) return false;
    try {
      const parsed = new URL(rawUrl, location.href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (!/(^|\.)bilibili\.com$/i.test(parsed.hostname)) return false;
      return /player|bili|worker|web|video|bangumi/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function installWorkerRuntime(cfg) {
    const ReplacementInWorker = cfg?.replacement || '';
    const MediaDomainREInWorker = /(?:^|\.)(?:(?:bilivideo|acgvideo)\.(?:com|cn)|akamaized\.net)$/i;
    const IgnoreHostREInWorker = /^(?:bvc|data|pbp|api|api\w+)\./i;

    function replacementHost() {
      try { return new URL(ReplacementInWorker).host; } catch { return ''; }
    }

    function hasMedia(value) {
      if (typeof value !== 'string') return false;
      try {
        const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
        return MediaDomainREInWorker.test(parsed.hostname);
      } catch {
        const match = value.match(/^https?:\/\/([^/]+)/i) || value.match(/^\/\/([^/]+)/) || value.match(/^([^/\s]+\.(?:(?:bilivideo|acgvideo)\.(?:com|cn)|akamaized\.net))(?:\/|$)/i);
        return !!(match && MediaDomainREInWorker.test(match[1]));
      }
    }

    function ignored(value) {
      try {
        const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
        return IgnoreHostREInWorker.test(parsed.hostname);
      } catch {
        const match = value.match(/^https?:\/\/([^/]+)/i) || value.match(/^\/\/([^/]+)/) || value.match(/^([^/\s]+)/);
        return !!(match && IgnoreHostREInWorker.test(match[1]));
      }
    }

    function replaceUrl(value) {
      if (!ReplacementInWorker || typeof value !== 'string') return value;
      if (!hasMedia(value) || ignored(value)) return value;
      if (value.startsWith('http://') || value.startsWith('https://')) return value.replace(/^https?:\/\/[^/]+\//i, ReplacementInWorker);
      if (value.startsWith('//')) return value.replace(/^\/\/[^/]+\//, ReplacementInWorker.replace(/^https?:/i, ''));
      if (/^[^/\s]+\//.test(value)) return value.replace(/^[^/\s]+\//, `${replacementHost()}/`);
      return value;
    }

    try {
      const OriginalFetchInWorker = self.fetch;
      if (OriginalFetchInWorker && !self.__BILI_CDN_SWITCHER_FETCH__) {
        self.fetch = (input, init) => {
          try {
            const sourceUrl = typeof input === 'string' ? input : (input && input.url);
            if (typeof sourceUrl === 'string') {
              const replacedUrl = replaceUrl(sourceUrl);
              if (replacedUrl !== sourceUrl) {
                input = typeof input === 'string' ? replacedUrl : new Request(replacedUrl, input);
              }
            }
          } catch {}
          return OriginalFetchInWorker(input, init);
        };
        self.__BILI_CDN_SWITCHER_FETCH__ = true;
      }
    } catch {}

    try {
      const OriginalXHRInWorker = self.XMLHttpRequest;
      if (OriginalXHRInWorker && !self.__BILI_CDN_SWITCHER_XHR__) {
        class WorkerXHRPatched extends OriginalXHRInWorker {
          open(...args) {
            try {
              if (typeof args[1] === 'string') args[1] = replaceUrl(args[1]);
            } catch {}
            return super.open(...args);
          }
        }
        self.XMLHttpRequest = WorkerXHRPatched;
        self.__BILI_CDN_SWITCHER_XHR__ = true;
      }
    } catch {}
  }

  function buildWorkerPrelude() {
    const cfg = { replacement: Replacement };
    return `(() => {
      if (self.__BILI_CDN_SWITCHER_WORKER__) return;
      self.__BILI_CDN_SWITCHER_WORKER__ = true;
      try { (${installWorkerRuntime.toString()})(${JSON.stringify(cfg)}); } catch (_) {}
    })();\n`;
  }

  // Transform playinfo JSON structures
  const playInfoTransformer = playInfo => {
    if (playInfo.code !== (void 0) && playInfo.code !== 0) {
      log('Failed to get playInfo, message:', playInfo.message);
      return;
    }

    scheduleCDNBenchmark(playInfo);

    const seen = new WeakSet();
    const deepReplacePlayInfo = obj => {
      if (!obj || typeof obj !== 'object') return;
      if (seen.has(obj)) return;
      seen.add(obj);

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const value = obj[i];
          if (typeof value === 'string') {
            obj[i] = replaceCdnUrl(value);
          } else {
            deepReplacePlayInfo(value);
          }
        }
        return;
      }

      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const value = obj[key];
        if (typeof value === 'string') {
          obj[key] = key === 'host' ? replaceCdnHostValue(value) : replaceCdnUrl(value);
        } else {
          deepReplacePlayInfo(value);
        }
      }
    };

    deepReplacePlayInfo(playInfo);
    return;
  };

  // Network interception wrapper with Request-aware fetch handling and null-safe transforms.
  const interceptNetResponse = (theWindow => {
    const interceptors = [];
    const interceptNetResponse = handler => interceptors.push(handler);

    function handleInterceptedResponse(response, urlLike) {
      const url = normalizeUrl(urlLike);
      return interceptors.reduce((modified, handler) => {
        try {
          const ret = handler(modified, url);
          return (ret !== undefined && ret !== null) ? ret : modified; // Allow an empty string as a valid transform result.
        } catch (e) {
          // Interceptor errors must not break the original request.
          return modified;
        }
      }, response);
    }

    const OriginalXMLHttpRequest = theWindow.XMLHttpRequest;
    class XMLHttpRequestPatched extends OriginalXMLHttpRequest {
      open(...args) {
        try {
          if (typeof args[1] === 'string') args[1] = replaceCdnUrl(args[1]);
        } catch {}
        return super.open(...args);
      }
      get responseText() {
        if (this.readyState !== this.DONE) return super.responseText;
        try { return handleInterceptedResponse(super.responseText, this.responseURL); } catch { return super.responseText; }
      }
      get response() {
        if (this.readyState !== this.DONE) return super.response;
        try { return handleInterceptedResponse(super.response, this.responseURL); } catch { return super.response; }
      }
    }
    theWindow.XMLHttpRequest = XMLHttpRequestPatched;

    const OriginalFetch = theWindow.fetch.bind(theWindow);
    theWindow.fetch = (input, init) => {
      try {
        const sourceUrl = typeof input === 'string' ? input : (input && input.url);
        if (typeof sourceUrl === 'string') {
          const replacedUrl = replaceCdnUrl(sourceUrl);
          if (replacedUrl !== sourceUrl) {
            input = typeof input === 'string' ? replacedUrl : new (theWindow.Request || Request)(replacedUrl, input);
          }
        }
      } catch {}

      let shouldIntercept = false;
      try {
        shouldIntercept = !!handleInterceptedResponse(null, input);
      } catch (e) { shouldIntercept = false; }
      if (!shouldIntercept) return OriginalFetch(input, init);

      return OriginalFetch(input, init).then(response =>
        response.text().then(text => {
          try {
            const replaced = handleInterceptedResponse(text, input);
            // Copy headers to avoid sharing mutable references.
            const headers = new Headers(response.headers);
            return new Response(replaced, { status: response.status, statusText: response.statusText, headers });
          } catch (e) {
            return response; // Fall back to the original response on failure.
          }
        })
      );
    };

    function installWorkerHooks() {
      if (!shouldInstallWorkerHooks() || theWindow.__BILI_CDN_SWITCHER_WORKER_HOOKED__) return;

      try {
        const OriginalBlob = theWindow.Blob;
        if (OriginalBlob) {
          theWindow.Blob = function (parts, options) {
            try {
              const sourceParts = Array.isArray(parts) ? parts : [parts];
              let scanned = '';
              for (const part of sourceParts) {
                if (typeof part !== 'string') continue;
                scanned += part.slice(0, Math.max(0, 262144 - scanned.length));
                if (scanned.length >= 262144) break;
              }
              const type = options && options.type ? String(options.type) : '';
              const looksWorkerJs = /javascript|ecmascript/i.test(type) && workerScriptLooksRelevant(scanned);
              if (shouldInstallWorkerHooks() && looksWorkerJs) {
                if (!theWindow.__BILI_CDN_SWITCHER_WORKER_BLOB_LOGGED__) {
                  log('Worker Blob hook injected');
                  theWindow.__BILI_CDN_SWITCHER_WORKER_BLOB_LOGGED__ = true;
                }
                return new OriginalBlob([buildWorkerPrelude(), ...sourceParts], options);
              }
            } catch {}
            return new OriginalBlob(parts, options);
          };
          try {
            Object.setPrototypeOf(theWindow.Blob, OriginalBlob);
            theWindow.Blob.prototype = OriginalBlob.prototype;
          } catch {}
        }
      } catch (err) {
        log('Worker Blob hook install failed:', err);
      }

      try {
        const OriginalWorker = theWindow.Worker;
        if (OriginalWorker) {
          theWindow.Worker = function (scriptURL, options) {
            try {
              const isModule = options && options.type === 'module';
              const rawUrl = typeof scriptURL === 'string' ? scriptURL : String(scriptURL);
              if (shouldInstallWorkerHooks() && !isModule && shouldWrapWorkerUrl(rawUrl)) {
                const absoluteUrl = new URL(rawUrl, location.href).href;
                const wrapperCode = `${buildWorkerPrelude()}importScripts(${JSON.stringify(absoluteUrl)});\n`;
                const blob = new theWindow.Blob([wrapperCode], { type: 'application/javascript' });
                const wrappedUrl = theWindow.URL.createObjectURL(blob);
                if (!theWindow.__BILI_CDN_SWITCHER_WORKER_URL_LOGGED__) {
                  log('Worker URL hook wrapped:', absoluteUrl);
                  theWindow.__BILI_CDN_SWITCHER_WORKER_URL_LOGGED__ = true;
                }
                const worker = new OriginalWorker(wrappedUrl, options);
                try { setTimeout(() => theWindow.URL.revokeObjectURL(wrappedUrl), 60000); } catch {}
                return worker;
              }
            } catch (err) {
              if (!theWindow.__BILI_CDN_SWITCHER_WORKER_FALLBACK_LOGGED__) {
                log('Worker URL hook fallback:', err);
                theWindow.__BILI_CDN_SWITCHER_WORKER_FALLBACK_LOGGED__ = true;
              }
            }
            return new OriginalWorker(scriptURL, options);
          };
          try {
            Object.setPrototypeOf(theWindow.Worker, OriginalWorker);
            theWindow.Worker.prototype = OriginalWorker.prototype;
          } catch {}
        }
      } catch (err) {
        log('Worker URL hook install failed:', err);
      }

      theWindow.__BILI_CDN_SWITCHER_WORKER_HOOKED__ = true;
      log('Worker hooks installed');
    }

    installWorkerHooks();

    return interceptNetResponse;
  })(unsafeWindow);

  function watchWindowObject(name, transformer) {
    try {
      if (!disabled && unsafeWindow[name] && typeof unsafeWindow[name] === 'object') {
        log(`Directly modify window.${name}`);
        transformer(unsafeWindow[name]);
      }

      let internalValue = unsafeWindow[name];
      Object.defineProperty(unsafeWindow, name, {
        configurable: true,
        get: () => internalValue,
        set: v => {
          if (!disabled && v && typeof v === 'object') transformer(v);
          internalValue = v;
        }
      });
    } catch (err) {
      log(`Failed to watch window.${name}:`, err);
    }
  }

  // Patch page-level playinfo objects directly on mobile and desktop pages.
  function patchWindowPlayInfo() {
    if (location.host === 'm.bilibili.com') {
      const optionsTransformer = opts => { if (opts && typeof opts.readyVideoUrl === 'string') opts.readyVideoUrl = replaceCdnUrl(opts.readyVideoUrl); };
      if (!disabled && unsafeWindow.options) {
        log('Directly modify window.options');
        optionsTransformer(unsafeWindow.options);
      } else {
        let internalOptions = unsafeWindow.options;
        Object.defineProperty(unsafeWindow, 'options', {
          configurable: true,
          get: () => internalOptions,
          set: v => { if (!disabled) optionsTransformer(v); internalOptions = v; }
        });
      }
    } else {
      watchWindowObject('__playinfo__', playInfoTransformer);
      watchWindowObject('__INITIAL_STATE__', playInfoTransformer);
    }
  }

  // Intercept Bilibili playurl APIs.
  interceptNetResponse((response, url) => {
    if (disabled) return;
    const targets = [
      'https://api.bilibili.com/x/player/wbi/playurl',
      'https://api.bilibili.com/pgc/player/web/v2/playurl',
      'https://api.bilibili.com/x/player/playurl',
      'https://api.bilibili.com/pgc/player/web/playurl',
      'https://api.bilibili.com/pgc/player/api/playurl',
      'https://api.bilibili.com/pugv/player/web/playurl',
      'https://api.bilibili.com/ogv/player/playview'
    ];
    const hit = typeof url === 'string' && targets.some(p => url.startsWith(p));
    if (!hit) return;

    if (response === null) return true; // Declare that this interceptor can handle the response.
    try {
      log('(Intercepted) playurl api response');
      const playInfo = JSON.parse(response);
      playInfoTransformer(playInfo);
      return JSON.stringify(playInfo);
    } catch (e) {
      // If JSON parsing fails, leave the response unchanged.
      return response;
    }
  });

  // DOM helpers
  const waitForElm = selector => new Promise(resolve => {
    const ele = document.querySelector(selector);
    if (ele) return resolve(ele);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    log('waitForElm, MutationObserver started.');
  });

  function fromHTML(html) {
    if (!html) throw Error('html cannot be null or undefined');
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const result = template.content.children;
    return result.length === 1 ? result[0] : result;
  }

  // Initialize window object patches.
  patchWindowPlayInfo();

  function bindSettingsCheckbox(root, input, onChange) {
    if (!root || !input) return;
    input.addEventListener('change', () => onChange(!!input.checked));
    root.addEventListener('click', event => {
      if (event.target === input) return;
      event.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // UI: add controls to the player settings panel.
  const addSettingsUI = () => {
    const selector = '#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-video-area > div.bpx-player-control-wrap > div.bpx-player-control-entity > div.bpx-player-control-bottom > div.bpx-player-control-bottom-right > div.bpx-player-ctrl-btn.bpx-player-ctrl-setting > div.bpx-player-ctrl-setting-box > div > div > div > div > div > div > div.bpx-player-ctrl-setting-others';
    waitForElm(selector).then(settingsBar => {
      settingsBar.appendChild(fromHTML(`<div class="bpx-player-ctrl-setting-others-title">${SettingsBarTitle}</div>`));

      // Toggle: enable or disable the CDN replacement.
      const chk1 = fromHTML(`<div class="bpx-player-ctrl-setting-checkbox bpx-player-ctrl-setting-blackgap bui bui-checkbox bui-dark"><div class="bui-area"><input class="bui-checkbox-input" type="checkbox" ${!disabled ? 'checked' : ''} aria-label="${SettingsBarTitle}"><label class="bui-checkbox-label"><span class="bui-checkbox-icon bui-checkbox-icon-default"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-icon bui-checkbox-icon-selected"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-name">${SettingsBarTitle}</span></label></div></div>`);
      const chk1Input = chk1.querySelector('input');
      bindSettingsCheckbox(chk1, chk1Input, checked => {
        disabled = !checked; // Keep the UI meaning: checked means enabled.
        GM_setValue('disabled', disabled);
        log(`${disabled ? I18N.disabled[Language] : I18N.enabled[Language]} ${SettingsBarTitle}`);
      });
      settingsBar.appendChild(chk1);

      // Toggle: allow external CDN hosts outside the allowlist.
      const chk2 = fromHTML(`<div class="bpx-player-ctrl-setting-checkbox bpx-player-ctrl-setting-blackgap bui bui-checkbox bui-dark" title="${I18N.allowExtTip[Language]}"><div class="bui-area"><input class="bui-checkbox-input" type="checkbox" ${allowExternalCDN ? 'checked' : ''} aria-label="${I18N.allowExt[Language]}"><label class="bui-checkbox-label"><span class="bui-checkbox-icon bui-checkbox-icon-default"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-icon bui-checkbox-icon-selected"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-name">${I18N.allowExt[Language]}</span></label></div></div>`);
      const chk2Input = chk2.querySelector('input');
      bindSettingsCheckbox(chk2, chk2Input, checked => {
        allowExternalCDN = !!checked;
        GM_setValue('AllowExternalCDN', allowExternalCDN);
        log(`${allowExternalCDN ? I18N.enabled[Language] : I18N.disabled[Language]}: ${I18N.allowExt[Language]}`);
      });
      settingsBar.appendChild(chk2);

      // Toggle: auto-benchmark and pick the fastest CDN.
      const chk3 = fromHTML(`<div class="bpx-player-ctrl-setting-checkbox bpx-player-ctrl-setting-blackgap bui bui-checkbox bui-dark" title="${I18N.autoBestTip[Language]}"><div class="bui-area"><input class="bui-checkbox-input" type="checkbox" ${autoBestCDN ? 'checked' : ''} aria-label="${I18N.autoBest[Language]}"><label class="bui-checkbox-label"><span class="bui-checkbox-icon bui-checkbox-icon-default"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-icon bui-checkbox-icon-selected"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-name">${I18N.autoBest[Language]}</span></label></div></div>`);
      const chk3Input = chk3.querySelector('input');
      bindSettingsCheckbox(chk3, chk3Input, checked => {
        autoBestCDN = !!checked;
        GM_setValue('AutoBestCDN', autoBestCDN);
        log(`${autoBestCDN ? I18N.enabled[Language] : I18N.disabled[Language]}: ${I18N.autoBest[Language]}`);
      });
      settingsBar.appendChild(chk3);

      // Toggle: patch CDN URLs inside player Workers.
      const chk4 = fromHTML(`<div class="bpx-player-ctrl-setting-checkbox bpx-player-ctrl-setting-blackgap bui bui-checkbox bui-dark" title="${I18N.workerHookTip[Language]}"><div class="bui-area"><input class="bui-checkbox-input" type="checkbox" ${enableWorkerHook ? 'checked' : ''} aria-label="${I18N.workerHook[Language]}"><label class="bui-checkbox-label"><span class="bui-checkbox-icon bui-checkbox-icon-default"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-icon bui-checkbox-icon-selected"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 32 32"><path d="m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z"></path></svg></span><span class="bui-checkbox-name">${I18N.workerHook[Language]}</span></label></div></div>`);
      const chk4Input = chk4.querySelector('input');
      bindSettingsCheckbox(chk4, chk4Input, checked => {
        enableWorkerHook = !!checked;
        GM_setValue('EnableWorkerHook', enableWorkerHook);
        log(`${enableWorkerHook ? I18N.enabled[Language] : I18N.disabled[Language]}: ${I18N.workerHook[Language]}`);
      });
      settingsBar.appendChild(chk4);

      log('checkboxes added, MutationObserver disconnected.');
    });
  };

  if (location.href.startsWith('https://www.bilibili.com/video/') || location.href.startsWith('https://www.bilibili.com/bangumi/play/')) {
    addSettingsUI();
  }
})();
