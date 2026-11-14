#!/usr/bin/env node
// حمولة Purchase تجريبية لأداة Test Events في Meta — لا تمسّ التقارير الحقيقية.
//
// الافتراضي: **يطبع فقط**. لا يرسل شيئاً إلا بثلاثة شروط معاً:
//   --send، وMETA_TEST_EVENT_CODE (من Events Manager ← Test Events)،
//   وNEXT_PUBLIC_META_PIXEL_ID + META_CONVERSIONS_API_ACCESS_TOKEN.
// بلا test_event_code يرفض الإرسال نهائياً: حدثٌ بلا هذا الرمز حدثٌ حقيقي.
//
// البيانات مصطنعة بالكامل (هاتف 0600000000، قيمة 1 درهم): لا طلبية حقيقية
// تُعاد إرسالها من هنا أبداً.
//
//   node scripts/meta-test-event.mjs --channel=chat
//   node scripts/meta-test-event.mjs --channel=website --send
import { createHash, randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const CHANNELS = ["website", "chat", "phone_call", "physical_store", "other"];
const channel = args.channel ?? "chat";
if (!CHANNELS.includes(channel)) {
  console.error(`--channel يجب أن يكون واحداً من: ${CHANNELS.join(", ")}`);
  process.exit(1);
}

const hash = (v) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const phone = "212600000000";
const event = {
  event_name: "Purchase",
  event_time: Math.floor(Date.now() / 1000),
  event_id: `test-purchase:${randomUUID()}`,
  action_source: channel,
  ...(channel === "website" ? { event_source_url: "https://www.tayssirfroid.com/checkout" } : {}),
  user_data: { ph: [hash(phone)], external_id: [hash(phone)], country: [hash("ma")] },
  custom_data: {
    currency: "MAD",
    value: 1,
    content_type: "product",
    content_ids: ["TEST-SKU"],
    contents: [{ id: "TEST-SKU", quantity: 1, item_price: 1 }],
    num_items: 1,
  },
};

const testCode = process.env.META_TEST_EVENT_CODE?.trim();
const body = { data: [event], ...(testCode ? { test_event_code: testCode } : {}) };
console.log(JSON.stringify(body, null, 2));

if (!args.send) {
  console.error("\nطباعة فقط — لم يُرسَل شيء. أضف --send للإرسال إلى Test Events.");
  process.exit(0);
}
if (!testCode) {
  console.error("\nمرفوض: META_TEST_EVENT_CODE غير مضبوط. بدونه يصير الحدث حقيقياً في التقارير.");
  process.exit(1);
}
const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
const token = process.env.META_CONVERSIONS_API_ACCESS_TOKEN?.trim();
if (!pixelId || !token) {
  console.error("\nمرفوض: NEXT_PUBLIC_META_PIXEL_ID أو META_CONVERSIONS_API_ACCESS_TOKEN غير مضبوط.");
  process.exit(1);
}

const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...body, access_token: token }),
});
console.error(`\nHTTP ${res.status}: ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
