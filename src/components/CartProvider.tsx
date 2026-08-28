"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartItem } from "@/lib/cart/types";
import {
  cartItemKey,
  computeSubtotal,
  snapQuantity,
} from "@/lib/cart/cartMath";

const STORAGE_KEY = "tayssir_cart_v1";

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity: number) => void;
  updateQuantity: (productId: number, variantId: number | null, quantity: number) => void;
  removeItem: (productId: number, variantId: number | null) => void;
  clearCart: () => void;
  isHydrated: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // تحميل السلة من التخزين المحلي عند فتح الصفحة لأول مرة فقط
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // قراءة localStorage غير متاحة أثناء العرض على الخادم (SSR)، لذا
          // يجب أن تحدث هذه المزامنة الأولى داخل useEffect (بعد التحميل في
          // المتصفح) لا عبر lazy initializer في useState الذي يُنفَّذ أيضاً
          // على الخادم حيث لا يوجد window.localStorage إطلاقاً.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setItems(parsed);
        }
      }
    } catch {
      // تخزين تالف أو غير متاح (وضع خاص مثلاً) — نتجاهل ونبدأ بسلة فارغة
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // حفظ أي تغيير في السلة في التخزين المحلي (بعد اكتمال التحميل الأول فقط
  // حتى لا نكتب سلة فارغة فوق سلة محفوظة قبل أن تُحمَّل)
  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // تجاهل أخطاء التخزين (مثلاً امتلاء المساحة)
    }
  }, [items, isHydrated]);

  const addItem = useCallback<CartContextValue["addItem"]>((item, quantity) => {
    setItems((prev) => {
      const key = cartItemKey(item.productId, item.variantId);
      const existingIndex = prev.findIndex(
        (p) => cartItemKey(p.productId, p.variantId) === key
      );

      if (existingIndex !== -1) {
        const next = [...prev];
        const existing = next[existingIndex];
        // إعدادات التسعير تُؤخذ من العنصر الوارد (المُحمَّل للتو من الخادم)
        // لا من المخزَّن قديماً في localStorage — فسلَّة قديمة تُحدَّث تلقائياً
        // إلى سلَّم الأثمنة الحالي بمجرد إضافة نفس المنتج مرة أخرى.
        next[existingIndex] = {
          ...existing,
          unitPrice: item.unitPrice,
          pricing: item.pricing,
          minOrderQty: item.minOrderQty,
          qtyIncrement: item.qtyIncrement,
          quantity: snapQuantity(
            existing.quantity + quantity,
            item.minOrderQty,
            item.qtyIncrement
          ),
        };
        return next;
      }

      return [
        ...prev,
        {
          ...item,
          quantity: snapQuantity(quantity, item.minOrderQty, item.qtyIncrement),
        },
      ];
    });
  }, []);

  const updateQuantity = useCallback<CartContextValue["updateQuantity"]>(
    (productId, variantId, quantity) => {
      setItems((prev) =>
        prev.map((item) => {
          if (cartItemKey(item.productId, item.variantId) !== cartItemKey(productId, variantId)) {
            return item;
          }
          return {
            ...item,
            quantity: snapQuantity(quantity, item.minOrderQty, item.qtyIncrement),
          };
        })
      );
    },
    []
  );

  const removeItem = useCallback<CartContextValue["removeItem"]>(
    (productId, variantId) => {
      setItems((prev) =>
        prev.filter(
          (item) => cartItemKey(item.productId, item.variantId) !== cartItemKey(productId, variantId)
        )
      );
    },
    []
  );

  const clearCart = useCallback(() => setItems([]), []);

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount,
      subtotal,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      isHydrated,
    }),
    [items, itemCount, subtotal, addItem, updateQuantity, removeItem, clearCart, isHydrated]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart يجب أن يُستعمل داخل CartProvider");
  }
  return context;
}
