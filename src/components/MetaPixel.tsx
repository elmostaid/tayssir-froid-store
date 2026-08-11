import Script from "next/script";
import { getMetaPixelId } from "@/lib/pixel/config";
import { PixelPageViewTracker } from "@/components/PixelPageViewTracker";

/**
 * تهيئة Meta Pixel فقط (fbq('init', ...)) — عمداً بلا fbq('track','PageView')
 * هنا: PixelPageViewTracker (مكوّن "use client" منفصل، مثبَّت بجانب هذا
 * السكريبت فـlayout.tsx) هو المسؤول الوحيد عن إطلاق PageView، لتفادي
 * ازدواجية التتبع بين تحميل السكريبت وmount المكوّن. بدون
 * NEXT_PUBLIC_META_PIXEL_ID، لا يُحمَّل أي سكريبت إطلاقاً.
 */
export function MetaPixel() {
  const pixelId = getMetaPixelId();
  if (!pixelId) return null;

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
      <PixelPageViewTracker />
    </>
  );
}
