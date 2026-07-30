/**
 * لوحة الإدارة تعتمد على Supabase Auth. بدون هذين المتغيرين، تبقى لوحة
 * الإدارة مقفلة بالكامل تلقائياً — لا يوجد أي باب دخول بديل أو تجريبي.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
