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
      {/* Studio Dark: the indigo body glow is the entire background layer.
       * No fixed-position DOM nodes needed — the glow is painted by `body`
       * and fixed via background-attachment, so it stays spatially stable
       * as tables scroll. */}
      <Sidebar username={session.username} />

      <main className="pl-[272px] pr-4 py-4 min-h-screen w-full transition-all duration-300">
        {children}
      </main>

      <CommandPalette />
    </>
  );
}
