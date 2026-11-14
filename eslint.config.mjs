import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // الجلب المسبق الافتراضي لـnext/link كان ~95% من استدعاءات Vercel (راجع
  // src/components/Link.tsx). الرابط يمرّ من الغلاف وحده.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/Link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                'استعمل `import Link from "@/components/Link"`: بلا جلب مسبق تلقائي (كل طلب جلب = استدعاء دالة مدفوع على Vercel).',
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
