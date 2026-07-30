export type CartItemInput = {
  productId: number;
  variantId: number | null;
  quantity: number;
};

export type CustomerInput = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  notes: string | null;
};

export type CreateOrderInput = {
  items: CartItemInput[];
  customer: CustomerInput;
  idempotencyKey: string;
};

export type CreateOrderFieldError = {
  /** اسم الحقل، أو "items" لخطأ عام على السلة، أو productId كنص لخطأ خاص بسطر معيّن */
  field: string;
  message: string;
};

export type CreateOrderResult =
  | { ok: true; publicReference: string }
  | { ok: false; errors: CreateOrderFieldError[] };
