import { supabaseProjectRef, type DiagnosticsEnv } from "@/lib/diagnostics/previewOnly";

/**
 * التحقّق من أن مفتاحَي ANON وSERVICE_ROLE يخصّان نفس مشروع Supabase الذي
 * يشير إليه NEXT_PUBLIC_SUPABASE_URL — **بلا كشف قيمة أي مفتاح**.
 *
 * لماذا احتجنا هذا أصلاً: Vercel تصنّف المفتاحين `sensitive` فلا تُرجع
 * قيمتهما لأي قراءة، وصفحة الدخول تستعمل Server Action فلا يُضمَّن أي مفتاح
 * في حزمة المتصفح. فالطريق الوحيد الآمن هو أن يفحص الخادم مفتاحه بنفسه
 * ويُبلِّغ عن **النتيجة** لا عن المفتاح.
 *
 * فحصان مستقلّان لكل مفتاح:
 *
 *  • الادّعاء: المفاتيح القديمة رموز JWT تحمل في حمولتها حقل `ref` وهو
 *    معرّف المشروع (معرّف عام، يظهر في الرابط نفسه). نقرأ هذا الحقل وحده.
 *    المفاتيح الحديثة (`sb_publishable_…` / `sb_secret_…`) ليست JWT فلا
 *    ادّعاء فيها — ونقول ذلك صراحةً بدل تخمينه.
 *  • الإثبات: طلب HTTP حقيقي إلى المشروع بالمفتاح. Supabase ترفض مفتاح
 *    مشروع آخر بـ401 قبل أي شيء آخر، فنجاح الطلب إثباتٌ عملي على الانتماء
 *    لا مجرّد قراءة حقل. نُبلِّغ برمز الحالة وحده.
 *
 * ما لا يخرج من هذه الوحدة أبداً: المفتاح، أو أي جزء منه، أو طوله، أو أي
 * رابط اتصال بقاعدة البيانات. والمقطع الوحيد الذي يُنقَل هو `ref` العام.
 */

export type KeyFormat = "legacy-jwt" | "publishable" | "secret" | "absent" | "unknown";

export type KeyIdentity = {
  format: KeyFormat;
  /** معرّف المشروع المُدَّعى داخل الرمز (JWT وحدها) — معرّف عام لا سرّ. */
  claimedRef: string | null;
  /** رمز حالة طلب التحقّق الحقيقي، أو null إن لم يُنفَّذ. */
  probeStatus: number | null;
  /** 200/2xx يعني أن المشروع قبل المفتاح فعلاً. */
  acceptedByProject: boolean | null;
  probeError: string | null;
};

const PROBE_TIMEOUT_MS = 5000;

export function classifyKeyFormat(key: string | undefined): KeyFormat {
  if (!key || key.trim() === "") return "absent";
  const value = key.trim();
  if (value.startsWith("sb_publishable_")) return "publishable";
  if (value.startsWith("sb_secret_")) return "secret";
  if (value.split(".").length === 3 && value.startsWith("ey")) return "legacy-jwt";
  return "unknown";
}

/**
 * يقرأ حقل `ref` من حمولة JWT. لا يتحقّق من التوقيع ولا يحتاج ذلك: هذا
 * ادّعاء يُقارَن بالرابط، والإثبات هو الطلب الحقيقي أدناه.
 */
export function claimedProjectRef(key: string | undefined): string | null {
  if (classifyKeyFormat(key) !== "legacy-jwt") return null;
  try {
    const payload = key!.trim().split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "ref" in parsed) {
      const ref = (parsed as { ref?: unknown }).ref;
      return typeof ref === "string" ? ref : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function probe(url: string, path: string, headers: HeadersInit): Promise<{ status: number | null; error: string | null }> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { status: response.status, error: null };
  } catch (error) {
    // لا نُمرِّر نص الخطأ كما هو: رسائل fetch قد تحتوي الرابط كاملاً.
    return { status: null, error: error instanceof Error ? error.name : "unknown" };
  }
}

/**
 * مفتاح ANON: `/auth/v1/settings` نقطة عمومية تقبل مفتاح المشروع وترفض
 * مفتاح غيره بـ401 — ولا تقرأ ولا تكتب أي بيانات زبون.
 */
export async function verifyAnonKey(
  url: string | undefined,
  key: string | undefined
): Promise<KeyIdentity> {
  const format = classifyKeyFormat(key);
  const identity: KeyIdentity = {
    format,
    claimedRef: claimedProjectRef(key),
    probeStatus: null,
    acceptedByProject: null,
    probeError: null,
  };
  if (!url || format === "absent") return identity;

  const { status, error } = await probe(url, "/auth/v1/settings", {
    apikey: key!.trim(),
  });
  identity.probeStatus = status;
  identity.probeError = error;
  identity.acceptedByProject = status === null ? null : status >= 200 && status < 300;
  return identity;
}

/**
 * مفتاح SERVICE_ROLE: سرد الدلاء (`/storage/v1/bucket`) — عملية قراءة
 * بحتة على بيانات وصفية للتخزين، لا تمسّ أي صفّ ولا أي ملف، وترفض مفتاح
 * مشروع آخر بـ401. نُبلِّغ بالحالة وحدها، لا بأسماء الدلاء.
 */
export async function verifyServiceRoleKey(
  url: string | undefined,
  key: string | undefined
): Promise<KeyIdentity> {
  const format = classifyKeyFormat(key);
  const identity: KeyIdentity = {
    format,
    claimedRef: claimedProjectRef(key),
    probeStatus: null,
    acceptedByProject: null,
    probeError: null,
  };
  if (!url || format === "absent") return identity;

  const trimmed = key!.trim();
  const { status, error } = await probe(url, "/storage/v1/bucket", {
    apikey: trimmed,
    Authorization: `Bearer ${trimmed}`,
  });
  identity.probeStatus = status;
  identity.probeError = error;
  identity.acceptedByProject = status === null ? null : status >= 200 && status < 300;
  return identity;
}

export type ProjectKeyReport = {
  urlRef: string | null;
  anon: KeyIdentity;
  serviceRole: KeyIdentity;
  /** هل كل ما يمكن إثباته يشير إلى نفس المشروع؟ */
  consistent: boolean;
  notes: string[];
};

export async function reportProjectKeys(
  env: DiagnosticsEnv = process.env
): Promise<ProjectKeyReport> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const urlRef = supabaseProjectRef(url);
  const [anon, serviceRole] = await Promise.all([
    verifyAnonKey(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    verifyServiceRoleKey(url, env.SUPABASE_SERVICE_ROLE_KEY),
  ]);

  const notes: string[] = [];
  for (const [name, identity] of [
    ["anon", anon],
    ["service_role", serviceRole],
  ] as const) {
    if (identity.format === "absent") notes.push(`${name}: غير مضبوط`);
    else if (identity.claimedRef && urlRef && identity.claimedRef !== urlRef)
      notes.push(`${name}: الادّعاء داخل الرمز لا يطابق الرابط`);
    else if (identity.acceptedByProject === false)
      notes.push(`${name}: المشروع رفض المفتاح (${identity.probeStatus})`);
    else if (identity.acceptedByProject === null)
      notes.push(`${name}: تعذّر التحقّق (${identity.probeError ?? "لا جواب"})`);
  }

  const consistent =
    notes.length === 0 &&
    anon.acceptedByProject === true &&
    serviceRole.acceptedByProject === true;

  return { urlRef, anon, serviceRole, consistent, notes };
}
