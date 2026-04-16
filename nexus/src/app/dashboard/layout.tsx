import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { CommandPalette } from '@/components/dashboard/command-palette';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    // Z-axis layout (Apple Liquid Glass HIG): sidebar is a floating capsule
    // positioned above the content plane; <main> spans the full viewport and
    // scrolls underneath. The left padding reserves optical space for the
    // capsule so content isn't obscured at the top of the scroll, but as the
    // user scrolls the body flows freely behind the glass.
    //
    // No background here — the body's radial gradients feed the sidebar's
    // backdrop-filter. A solid wrapper bg would flatten the glass.
    <>
      <Sidebar username={session.username} />
      {/* Gutters match the sidebar capsule's inset (top-4/left-4/bottom-4).
       *   pl-[272px]  = 16px gap + 240px capsule + 16px breathing
       *   pr-4 py-4   = symmetric breathing on the other three sides
       * The content scrolls beneath the floating glass per Apple HIG. */}
      <main className="min-h-screen w-full pl-[272px] pr-4 py-4">
        {children}
      </main>
      <CommandPalette />
    </>
  );
}
