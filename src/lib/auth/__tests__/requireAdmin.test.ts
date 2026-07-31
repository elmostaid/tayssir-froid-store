import { describe, expect, test } from "vitest";
import { getAdminUser } from "@/lib/auth/requireAdmin";

// بدون NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (وهو وضع الاختبارات/CI الحالي)
// يجب أن تبقى لوحة الإدارة مقفلة بالكامل — لا يوجد أي باب دخول بديل.
describe("getAdminUser — زائر بدون تهيئة Supabase", () => {
  test("يرجع null دائماً عندما لا تكون متغيرات Supabase مضبوطة", async () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeFalsy();
    const admin = await getAdminUser();
    expect(admin).toBeNull();
  });
});
