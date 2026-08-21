import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const LABEL = process.env.LABEL || "prod";
const PAGES = [
  ["home", "/"],
  ["category", "/category/refrigerator-spare-parts"],
  ["product", "/product/tf-gwh-001"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
];
const PROFILES = {
  fast4g: { downloadThroughput: 9000 * 1024 / 8, uploadThroughput: 1500 * 1024 / 8, latency: 85 },
  mid4g:  { downloadThroughput: 1500 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150 },
  slow4g: { downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8, latency: 400 },
};
const WANT = (process.env.PROFILES || "fast4g,mid4g,slow4g").split(",");
const SETTLE_MS = Number(process.env.SETTLE_MS || 12000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const results = [];

for (const profile of WANT) {
  for (const [name, path] of PAGES) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/448.0.0.34.113;]",
    });
    await ctx.addInitScript(() => {
      window.__fbq = [];
      const rec = function (...a) { window.__fbq.push({ t: performance.now(), ev: a.slice(0, 2).join(" ") }); };
      rec.queue = []; rec.loaded = true; rec.version = "2.0"; rec.push = rec; rec.callMethod = null;
      window.fbq = rec; window._fbq = rec;
      window.__v = { lcp: 0, lcpUrl: "", cls: 0 };
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__v.lcp = e.startTime; window.__v.lcpUrl = e.url || (e.element && e.element.tagName) || ""; } })
          .observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; })
          .observe({ type: "layout-shift", buffered: true });
      } catch {}
    });
    const page = await ctx.newPage();

    // نعدّ البايتات من طبقة الشبكة لا من Resource Timing: صور Supabase
    // من نطاق آخر بلا Timing-Allow-Origin، فـtransferSize يرجع 0 لها
    // ويُخفي أثقل شيء في الصفحة تماماً.
    const net = { total: 0, images: 0, js: 0, imageCount: 0, requests: 0, largestImage: 0, largestImageUrl: "" };
    let atLoad = null;
    page.on("response", async (r) => {
      try {
        const h = await r.allHeaders();
        const len = Number(h["content-length"] || 0);
        const ct = h["content-type"] || "";
        net.requests += 1;
        net.total += len;
        if (ct.startsWith("image/")) {
          net.images += len;
          net.imageCount += 1;
          if (len > net.largestImage) { net.largestImage = len; net.largestImageUrl = r.url().slice(-60); }
        } else if (ct.includes("javascript")) net.js += len;
      } catch {}
    });

    await page.route("**connect.facebook.net/**", (r) => r.abort());
    await page.route("**/api/pixel-events", (r) => r.abort());
    await page.route("**/api/analytics", (r) => r.abort());

    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...PROFILES[profile] });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    try {
      await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
    } catch { /* keep whatever loaded */ }
    atLoad = { ...net };

    // زبون حقيقي يمرّر الصفحة — وعندها تُحمَّل الصور المؤجَّلة. نقيس
    // الحالتين: وزن التحميل الأولي، ثم الوزن بعد تصفّح الصفحة كاملة.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.9;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 350));
      }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const res = performance.getEntriesByType("resource");
      const size = (r) => r.transferSize || r.encodedBodySize || 0;
      const isImg = (r) => r.initiatorType === "img" || /\.(jpe?g|png|webp|avif|gif|svg)(\?|$)/i.test(r.name);
      const isJs = (r) => /\.js(\?|$)/i.test(r.name) || r.initiatorType === "script";
      const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
      const lcpRes = res.find((r) => r.name === window.__v.lcpUrl);
      return {
        ttfb: Math.round(nav.responseStart || 0),
        fcp: Math.round(fcp ? fcp.startTime : 0),
        lcp: Math.round(window.__v.lcp),
        cls: Number(window.__v.cls.toFixed(4)),
        load: Math.round(nav.loadEventEnd || 0),
        requests: res.length + 1,
        bytesTotal: res.reduce((s, r) => s + size(r), 0) + (nav.transferSize || 0),
        bytesImages: res.filter(isImg).reduce((s, r) => s + size(r), 0),
        bytesJs: res.filter(isJs).reduce((s, r) => s + size(r), 0),
        imageCount: res.filter(isImg).length,
        largestImage: Math.max(0, ...res.filter(isImg).map(size)),
        lcpImageMs: lcpRes ? Math.round(lcpRes.responseEnd) : null,
        pageView: (window.__fbq.find((c) => c.ev === "track PageView") || {}).t ?? null,
      };
    });

    results.push({
      label: LABEL, profile, page: name, ...m,
      pageView: m.pageView === null ? null : Math.round(m.pageView),
      initialBytes: atLoad.total, initialImages: atLoad.images, initialRequests: atLoad.requests,
      fullBytes: net.total, fullImages: net.images, fullJs: net.js,
      fullRequests: net.requests, fullImageCount: net.imageCount,
      largestImage: net.largestImage, largestImageUrl: net.largestImageUrl,
    });
    console.log(JSON.stringify(results[results.length - 1]));
    await ctx.close();
  }
}

await browser.close();
