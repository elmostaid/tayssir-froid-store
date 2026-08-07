"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type LoginState = { error: string | null };

export async function signInAdmin(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "لوحة الإدارة غير مُهيَّأة بعد." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "أدخل البريد الإلكتروني وكلمة المرور." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "بيانات الدخول غير صحيحة." };
  }

  // المصادقة عبر Supabase نجحت، لكن هذا وحده لا يكفي: يجب أن يكون هذا
  // المستخدم موجوداً فعلاً في admin_profiles حتى يُعتبر مديراً.
  const rows = await sql<{ id: string; role: string }[]>`
    select id, role from public.admin_profiles where id = ${data.user.id} limit 1
  `;

  if (rows.length === 0) {
    await supabase.auth.signOut();
    return { error: "هذا الحساب غير مخوَّل بالدخول إلى لوحة الإدارة." };
  }

  // Staff ليس له حق الدخول إلى /admin (لوحة التحكم الرئيسية) — توجيهه مباشرة
  // إلى /admin/orders بدل تركه يصطدم بارتداد فوري (نفس منطق الصلاحيات فـ
  // isOwnerAdmin، لكن لا يمكن استيراده هنا مباشرة لأن هذا مسار عام قبل أي
  // صفحة محمية).
  redirect(rows[0].role === "admin" ? "/admin" : "/admin/orders");
}
