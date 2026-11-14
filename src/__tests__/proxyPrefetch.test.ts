import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

// عدّاد حقيقي لنداءات auth.getUser() — هو كل ما يقيسه هذا الملف.
const getUser = vi.hoisted(() => vi.fn(async () => ({ data: { user: null } })));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from "@/proxy";

beforeEach(() => {
  getUser.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://tayssirfroid.com/admin/orders", { headers });
}

describe("proxy — تجديد الجلسة بلا ضجيج", () => {
  /**
   * العطل الذي يحرسه هذا الاختبار: موجّه Next يجلب مسبقاً كل `<Link>` يدخل
   * الشاشة. وفي لوحة الطلبات ذلك يعني طلب `.rsc` لكل صفّ — وكل واحد منها
   * كان يُنفِّذ auth.getUser()، أي طلب HTTP خارجي حقيقي نحو Supabase.
   * القياس على نسخة مبنيّة: 50 نداءً من فتح اللائحة وحدها.
   */
  test("الجلب المسبق لا يُطلق أي نداء مصادقة", async () => {
    await proxy(request({ "next-router-prefetch": "1" }));
    await proxy(request({ purpose: "prefetch" }));
    await proxy(request({ "x-purpose": "prefetch" }));

    expect(getUser).not.toHaveBeenCalled();
  });

  /**
   * والوجه الآخر، وهو الأهم: التنقّل الحقيقي **يجب** أن يبقى يُجدِّد.
   * هذا الموضع هو الوحيد القادر على كتابة كوكي الجلسة المُجدَّدة (انظر
   * lib/supabase/server.ts: setAll داخل try/catch لأن Server Component لا
   * يستطيع ضبط كوكي). فلو سكت هنا أيضاً، لانتهت صلاحية التوكن ولخرج المدير
   * من حسابه دورياً.
   */
  test("التنقّل الحقيقي يُجدِّد الجلسة كالعادة", async () => {
    await proxy(request());
    expect(getUser).toHaveBeenCalledTimes(1);

    // طلب RSC ناتج عن نقرة فعلية (بلا ترويسة prefetch) تنقّلٌ حقيقي أيضاً.
    await proxy(request({ rsc: "1" }));
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  test("بلا تهيئة Supabase لا يقع أي نداء إطلاقاً", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await proxy(request());

    expect(getUser).not.toHaveBeenCalled();
  });

  // الحماية الحقيقية ليست هنا أصلاً: فشل التجديد لا يجوز أن يُسقط الطلب،
  // لأن getAdminUser() هي التي تفحص الجلسة وجدول admin_profiles وتفشل
  // مغلقةً في كل صفحة وكل Server Action.
  test("فشل التجديد لا يكسر الطلب", async () => {
    getUser.mockRejectedValueOnce(new Error("Supabase Auth غير متاح"));

    const response = await proxy(request());

    expect(response).toBeDefined();
    expect(response.status).toBe(200);
  });
});
