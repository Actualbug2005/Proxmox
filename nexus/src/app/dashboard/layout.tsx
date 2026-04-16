import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    // No bg here on purpose: the body's radial gradients feed the sidebar's
    // .liquid-glass blur. Painting a solid color here would flatten the glass.
    <div className="flex min-h-screen">
      <Sidebar username={session.username} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <CommandPalette />
    </div>
  );
}
