import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function ScriptsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    // Z-axis geometry matches /dashboard: floating sidebar capsule over
    // content plane. No wrapper bg — body radial gradients feed the glass.
    <>
      <Sidebar username={session.username} />
      <main className="min-h-screen w-full pl-[272px] pr-4 py-4">
        {children}
      </main>
      <CommandPalette />
    </>
  );
}
