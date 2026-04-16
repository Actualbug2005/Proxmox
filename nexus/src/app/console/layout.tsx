import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    // Z-axis geometry matches /dashboard: sidebar is a floating capsule
    // sitting above the content plane. No wrapper bg — the body's radial
    // gradients feed the glass refraction.
    //
    // overflow-hidden here is intentional: xterm.js manages its own
    // scrollback and we don't want the outer page to scroll when long
    // terminal output overflows.
    <>
      <Sidebar username={session.username} />
      <main className="min-h-screen w-full pl-[272px] pr-4 py-4 overflow-hidden">
        {children}
      </main>
      <CommandPalette />
    </>
  );
}
