import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AppShell } from '@/components/dashboard/app-shell';
import { CommandPalette } from '@/components/dashboard/command-palette';
import { JobStatusBar } from '@/components/script-jobs/JobStatusBar';

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
 *   - At lg+ pl-[272px] reserves 16px gap + 240px capsule + 16px breathing
 *     on the left so content clears the floating sidebar; below lg the
 *     sidebar hides behind a hamburger drawer (see AppShell).
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
      <AppShell username={session.username}>{children}</AppShell>

      <CommandPalette />

      {/* Floating script-job status bar — renders itself null when idle,
       * so it only appears on screens where the user has actually kicked
       * off a community script. Mounted at the layout level so long-running
       * scripts remain visible while the user navigates to other pages. */}
      <JobStatusBar />
    </>
  );
}
