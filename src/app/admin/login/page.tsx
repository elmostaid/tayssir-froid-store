import Image from "next/image";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/admin/SupabaseNotConfigured";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تسجيل الدخول - لوحة الإدارة",
};

export default function AdminLoginPage() {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10" dir="rtl">
      <div className="flex flex-col items-center">
        <Image
          src="/brand/logo-tayssir-froid.png"
          alt="Tayssir Froid"
          width={169}
          height={60}
          className="h-10 w-auto"
        />
        <h1 className="mt-4 text-lg font-bold text-neutral-800">
          دخول لوحة الإدارة
        </h1>
      </div>
      <LoginForm />
    </div>
  );
}
