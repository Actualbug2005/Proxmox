import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="relative flex min-h-screen bg-canvas">
      {/* Ambient backdrop — provides something for the translucent sidebar
       * (Liquid Glass) to blur against. Without this, backdrop-blur has nothing
       * to bite into and the active-pill effect collapses to flat tint. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10
                   bg-[radial-gradient(ellipse_80%_60%_at_top_left,rgba(249,115,22,0.07),transparent_55%),radial-gradient(ellipse_60%_60%_at_bottom_right,rgba(59,130,246,0.04),transparent_55%)]"
      />
      <Sidebar username={session.username} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <CommandPalette />
    </div>
  );
}
