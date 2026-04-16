import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

/**
 * Master authenticated shell — applied to every route under (app).
 *
 * The (app) route group exists so /dashboard, /scripts, and /console can
 * share one layout (session gate + floating sidebar capsule + command
 * palette) without polluting URL paths. Route groups are Next.js-only
 * filesystem markers; the parens don't appear in the browser URL.
 *
 * Geometry (Apple Liquid Glass HIG):
 *   - No wrapper bg — the body's radial gradients feed the sidebar's
 *     backdrop-filter. Painting a colour here would flatten the glass.
 *   - pl-[272px] reserves 16px gap + 240px capsule + 16px breathing on
 *     the left so content clears the floating sidebar.
 *   - pr-4 py-4 mirror the same gutter on the other three sides.
 *   - transition-all duration-300 makes the padding animate gracefully if
 *     a future collapse/expand feature changes the sidebar width.
 */
export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <>
      {/* 1. Deep Aurora Mesh Background (z-index: -2) */}
      <div className="ambient-container" aria-hidden="true">
        <div className="aurora-node aurora-1" />
        <div className="aurora-node aurora-2" />
        <div className="aurora-node aurora-3" />
      </div>

      {/* 2. Matte Grain Texture Overlay (z-index: -1) */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* 3. The Floating Glass Sidebar */}
      <Sidebar username={session.username} />

      {/* 4. The Universal Workspace Canvas */}
      <main className="pl-[272px] pr-4 py-4 min-h-screen w-full transition-all duration-300">
        {children}
      </main>

      <CommandPalette />
    </>
  );
}
