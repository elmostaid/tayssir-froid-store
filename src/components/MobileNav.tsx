"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Category } from "@/lib/types";

export function MobileNav({
  categories,
  whatsappLink,
}: {
  categories: Category[];
  whatsappLink: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="فتح القائمة"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative me-auto ms-0 flex h-full w-[85vw] max-w-sm flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-800">القائمة</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <form
              action="/search"
              method="GET"
              className="mt-4 flex gap-2"
              onSubmit={() => setOpen(false)}
            >
              <input
                type="search"
                name="q"
                placeholder="قلب على اسم القطعة أو الكود"
                aria-label="ابحث عن اسم القطعة أو الكود"
                className="w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm focus:border-brand-turquoise focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-brand-turquoise px-4 py-2.5 text-sm font-semibold text-white"
              >
                بحث
              </button>
            </form>

            {categories.length > 0 && (
              <nav aria-label="التصنيفات" className="mt-5 flex flex-col gap-1">
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    href={`/category/${category.slug}`}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                  >
                    {category.name_ar}
                  </Link>
                ))}
              </nav>
            )}

            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-full bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white"
            >
              تواصل عبر واتساب
            </a>
          </div>
          </div>,
          document.body
        )}
    </div>
  );
}
