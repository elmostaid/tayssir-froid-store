import { createBrowserClient } from "@supabase/ssr";

/** عميل Supabase لاستعماله داخل مكوّنات المتصفح (Client Components) فقط. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  );
}
