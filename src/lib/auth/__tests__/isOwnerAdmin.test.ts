import { describe, expect, test } from "vitest";
import { isOwnerAdmin, type AdminUser } from "@/lib/auth/requireAdmin";

describe("isOwnerAdmin — فحص الدور الأساسي (بدون قاعدة بيانات)", () => {
  test("true فقط لمستخدم role='admin'", () => {
    const admin: AdminUser = { id: "1", email: "a@x.com", role: "admin" };
    expect(isOwnerAdmin(admin)).toBe(true);
  });

  test("false لمستخدم role='staff'", () => {
    const staff: AdminUser = { id: "2", email: "s@x.com", role: "staff" };
    expect(isOwnerAdmin(staff)).toBe(false);
  });

  test("false لـnull (زائر غير مسجَّل)", () => {
    expect(isOwnerAdmin(null)).toBe(false);
  });
});
