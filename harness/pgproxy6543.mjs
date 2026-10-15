// وسيط TCP أمام Postgres المحلي: يَعُدّ الاتصالات المتزامنة الحقيقية
// (بما فيها ما تفتحه الترويسة والفوتر)، ويستطيع محاكاة انقطاع مؤقّت.
//
// التحكّم عبر HTTP على 9099:
//   GET /reset            صفّر العدّادات وأعد الوضع الطبيعي
//   GET /stats            اقرأ القياس
//   GET /blackhole?after=N   اقبل المقابس الجديدة ولا تصلها بالخادم أبداً
//                            بعد أول N اتصالاً (محاكاة فشل فتح اتصال)
//   GET /normal           أعد التوصيل الطبيعي
import net from "node:net";
import http from "node:http";

const LISTEN = Number(process.env.PROXY_PORT || 5435);
const UP_HOST = process.env.UP_HOST || "127.0.0.1";
const UP_PORT = Number(process.env.UP_PORT || 6543);

let live = 0, peak = 0, total = 0, blackholed = 0;
let mode = "normal", blackholeAfter = Infinity;
const events = [];
const t0 = Date.now();
const mark = (kind) => events.push({ ms: Date.now() - t0, kind, live, peak });

net.createServer((client) => {
  total += 1;
  if (mode === "blackhole" && total > blackholeAfter) {
    blackholed += 1;
    mark("blackhole");
    client.on("error", () => {});
    return; // مقبس مقبول لا يُوصَل ولا يُغلَق — الصمت التام
  }
  live += 1;
  peak = Math.max(peak, live);
  mark("open");
  const up = net.connect(UP_PORT, UP_HOST);
  const done = () => { if (!client.destroyed) client.destroy(); if (!up.destroyed) up.destroy(); };
  client.on("error", done); up.on("error", done);
  client.on("close", () => { live -= 1; mark("close"); done(); });
  up.on("close", done);
  client.pipe(up); up.pipe(client);
}).listen(LISTEN, "127.0.0.1", () => console.log(`pgproxy ${LISTEN} -> ${UP_HOST}:${UP_PORT}`));

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/reset") {
    // التصفير يمسّ العدّادات وحدها — الوضع (normal/blackhole) يُغيَّر بمساره الخاص
    peak = live; total = 0; blackholed = 0; events.length = 0;
  } else if (url.pathname === "/blackhole") {
    mode = "blackhole"; blackholeAfter = Number(url.searchParams.get("after") || 0);
  } else if (url.pathname === "/normal") {
    mode = "normal"; blackholeAfter = Infinity;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ mode, blackholeAfter, live, peak, total, blackholed, events }, null, 1));
}).listen(9099, "127.0.0.1");
