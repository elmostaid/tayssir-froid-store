/**
 * نتيجة رفع ملف واحد فوضع JSON (`x-upload-mode: json`) — مشتركة بين مسار
 * الرفع والرفع المتعدد فالمتصفح.
 */
export type UploadOutcome =
  | {
      status: "created" | "already";
      invoiceId: number;
      invoiceNumber?: string;
      carrier?: string;
      parcels?: number;
      duplicates?: number;
      notes: string[];
    }
  | { status: "rejected"; invoiceId?: number; message: string; notes: string[] };
