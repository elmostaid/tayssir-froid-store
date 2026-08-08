// أيقونات SVG خفيفة (بدون تحميل أي صورة) مبنية على كلمات مفتاحية في اسم/رابط
// التصنيف، مع أيقونة ثلج عامة كخيار افتراضي لأي تصنيف مستقبلي غير معروف.
export function CategoryIcon({
  slug,
  name,
  className,
}: {
  slug: string;
  name: string;
  className?: string;
}) {
  const text = `${slug} ${name}`;

  if (text.includes("washing") || text.includes("غسيل")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth={1.5} />
        <circle cx="12" cy="13" r="5" stroke="currentColor" strokeWidth={1.5} />
        <path d="M9.5 13a2.5 2.5 0 0 1 2.5-2.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx="6.5" cy="6" r="0.75" fill="currentColor" />
        <circle cx="9" cy="6" r="0.75" fill="currentColor" />
      </svg>
    );
  }

  if (text.includes("refrigerator") || text.includes("ثلاج") || text.includes("مجمد")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="5" y="2.5" width="14" height="19" rx="1.5" stroke="currentColor" strokeWidth={1.5} />
        <path d="M5 9.5h14" stroke="currentColor" strokeWidth={1.5} />
        <path d="M8.5 5v2.5M8.5 12.5v2.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }

  if (text.includes("ac-parts") || text.includes("split") || text.includes("مكيف")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="2.5" y="6" width="19" height="6" rx="1.5" stroke="currentColor" strokeWidth={1.5} />
        <path
          d="M6 15v3M10 15v4M14 15v3M18 15v4"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2v20M4.2 6.5l15.6 11M19.8 6.5 4.2 17.5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
