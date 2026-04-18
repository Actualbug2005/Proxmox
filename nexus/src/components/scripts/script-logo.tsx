'use client';

/**
 * ScriptLogo — small image renderer with placeholder fallback.
 * Extracted from src/app/(app)/scripts/page.tsx (audit god-file split).
 */
import { Package } from 'lucide-react';
import type { CommunityScript } from '@/lib/community-scripts';

export const TYPE_VARIANT: Record<CommunityScript['type'], 'info' | 'warning' | 'outline' | 'success'> = {
  ct: 'info',
  vm: 'warning',
  misc: 'outline',
  addon: 'success',
};

interface ScriptLogoProps {
  script: Pick<CommunityScript, 'logo' | 'name'>;
  size?: number;
}

export function ScriptLogo({ script, size = 36 }: ScriptLogoProps) {
  if (script.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={script.logo}
        alt=""
        width={size}
        height={size}
        className="rounded-md bg-white/5 object-contain"
        loading="lazy"
        onError={(e) => {
          // Fall back to placeholder when upstream CDN 404s.
          (e.currentTarget as HTMLImageElement).style.display = 'none';
          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = 'flex';
        }}
      />
    );
  }
  return (
    <div
      className="rounded-md bg-white/5 text-indigo-400 flex items-center justify-center"
      style={{ width: size, height: size, display: script.logo ? 'none' : 'flex' }}
      aria-hidden
    >
      <Package className="w-4 h-4" />
    </div>
  );
}
