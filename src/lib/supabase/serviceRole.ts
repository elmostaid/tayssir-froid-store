import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * عميل Supabase بمفتاح service role — للاستعمال من الخادم فقط (رفع/حذف
 * صور المنتجات في Supabase Storage). يرجع null إن لم تُضبط المتغيرات
 * البيئية بعد، فيسقط الاستدعاء تلقائياً إلى التخزين المحلي.
 */
export function getSupabaseServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
