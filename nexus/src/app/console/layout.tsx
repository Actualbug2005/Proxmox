import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar username={session.username} />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      <CommandPalette />
    </div>
  );
}
