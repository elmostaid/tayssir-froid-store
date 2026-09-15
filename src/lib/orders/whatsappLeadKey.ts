"use client";

import type { CartItem } from "@/lib/cart/types";

/**
 * مفتاح idempotency ثابت لزر "أكمل الطلب عبر واتساب" — يبقى نفسه عبر
 * الرجوع للصفحة وإعادة الضغط ما دامت محتويات السلة نفسها، ويتغيّر إن
 * تغيّرت (منتج أُضيف/حُذف أو تغيّرت كميته).
 *
 * التخزين محلي (localStorage) لا في عمر المكوّن وحده (useState) — بنفس
 * سبب سلة الشراء نفسها (CartProvider): مكوّن يُعاد تركيبه بعد تنقّل
 * ذهاباً وإياباً (مثلاً من صفحة السلة إلى منتج ثم رجوعاً) كان يولّد
 * مرجعاً عشوائياً جديداً في كل مرة رغم أن السلة لم تتغيّر — فيُسجَّل
 * نفس الضغط مرتين في لوحة الإدارة.
 */

const STORAGE_KEY = "tf_whatsapp_lead_key_v1";

/** بعد هذه المدة، سلة قديمة تستحقّ مرجعاً جديداً بدل إعادة استعمال واحد قد يكون هجره الزبون منذ أيام. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type StoredKey = { signature: string; idempotencyKey: string; at: number };

/** توقيع مستقرّ لمحتوى السلة (منتج/نوع/كمية) — يتجاهل الاسم والسعر عمداً. */
export function cartSignature(items: CartItem[]): string {
  return items
    .map((item) => `${item.productId}:${item.variantId ?? ""}:${item.quantity}`)
    .sort()
    .join("|");
}

function randomHexKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // بديل يدوي لنفس السبب الذي في orderMessage.ts:randomOrderReference —
    // بعض متصفّحات إنستغرام/فيسبوك الداخلية تفتقد crypto.getRandomValues.
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readStored(): StoredKey | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredKey>;
    if (
      typeof parsed.signature !== "string" ||
      typeof parsed.idempotencyKey !== "string" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    return { signature: parsed.signature, idempotencyKey: parsed.idempotencyKey, at: parsed.at };
  } catch {
    return null;
  }
}

function writeStored(value: StoredKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // تخزين ممتلئ أو محظور (تصفّح خاص) — لا شيء يتعطّل، فقط سيُولَّد
    // مفتاح جديد في كل مرة، وهو أسوأ حالة اليوم بالضبط، لا أسوأ منها.
  }
}

/** مفتاح ثابت لنفس السلة، أو جديد إن تغيّرت السلة أو تقادم المفتاح المحفوظ. */
export function getOrCreateWhatsappLeadKey(items: CartItem[]): string {
  const signature = cartSignature(items);

  if (typeof window === "undefined") return randomHexKey();

  const stored = readStored();
  const fresh = stored !== null && Date.now() - stored.at <= MAX_AGE_MS;
  if (stored && fresh && stored.signature === signature) {
    return stored.idempotencyKey;
  }

  const idempotencyKey = randomHexKey();
  writeStored({ signature, idempotencyKey, at: Date.now() });
  return idempotencyKey;
}
