'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Server,
  LayoutDashboard,
  Terminal,
  Code2,
  LogOut,
  Activity,
  HardDrive,
  Monitor,
  Box,
  Zap,
  Package,
  Network,
  ShieldCheck,
  ScrollText,
  HeartPulse,
  Shield,
  Users,
  FolderTree,
  Archive,
  RefreshCw,
  Clock,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readCsrfCookie } from '@/lib/proxmox-client';
import { ThemeToggle } from '@/components/dashboard/theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Core',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/tasks', label: 'Tasks', icon: Activity },
      { href: '/console', label: 'Console', icon: Terminal },
      { href: '/scripts', label: 'Community Scripts', icon: Code2 },
      { href: '/dashboard/schedules', label: 'Scheduled Jobs', icon: Clock },
      { href: '/dashboard/chains', label: 'Script Chains', icon: Workflow },
      { href: '/dashboard/health', label: 'Health', icon: HeartPulse },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
      { href: '/dashboard/vms', label: 'Virtual Machines', icon: Monitor },
      { href: '/dashboard/cts', label: 'Containers', icon: Box },
      { href: '/dashboard/storage', label: 'Storage', icon: HardDrive },
      { href: '/dashboard/cluster/ha', label: 'HA & Status', icon: HeartPulse },
      { href: '/dashboard/cluster/firewall', label: 'Firewall', icon: Shield },
      { href: '/dashboard/cluster/pools', label: 'Pools', icon: FolderTree },
      { href: '/dashboard/cluster/backups', label: 'Backups', icon: Archive },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/cluster/access', label: 'Users & ACL', icon: Users },
      { href: '/dashboard/system/power', label: 'Power', icon: Zap },
      { href: '/dashboard/system/packages', label: 'Packages', icon: Package },
      { href: '/dashboard/system/network', label: 'Network', icon: Network },
      { href: '/dashboard/system/certificates', label: 'Certificates', icon: ShieldCheck },
      { href: '/dashboard/system/logs', label: 'Logs', icon: ScrollText },
      { href: '/dashboard/system/updates', label: 'Updates', icon: RefreshCw },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

interface SidebarProps {
  username?: string;
  /** Drawer state for the mobile breakpoint. Ignored at lg+ where the
   *  sidebar is always visible. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ username, open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const csrf = readCsrfCookie();
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: csrf ? { 'X-Nexus-CSRF': csrf } : undefined,
    });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside
      // No overflow-hidden on the outer capsule: the rounded-[24px] corners
      // would otherwise clip the inner nav's scrollbar track. Each interior
      // section handles its own edge paint via the translucent dividers.
      //
      // Mobile: slide-in drawer. Below lg we translate the capsule off-screen
      // by default and bring it in when `open` is true. At lg+ the sidebar
      // ignores `open` entirely and stays put.
      className={cn(
        'fixed top-4 left-4 bottom-4 z-40 flex w-60 flex-col',
        'liquid-glass rounded-[24px]',
        'transition-transform duration-300',
        open ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]',
        'lg:translate-x-0',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
          <Server className="h-4 w-4 text-zinc-900" />
        </div>
        <div>
          <span className="text-sm font-semibold text-[var(--color-fg)]">Nexus</span>
          <p className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Proxmox UI</p>
        </div>
      </div>

      {/* Command Palette trigger — translucent inside the capsule so it
       * reads as part of the glass layer, not a solid inset panel. */}
      <div className="border-b border-white/5 px-3 py-3">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg
                     border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-[var(--color-fg-muted)]
                     transition hover:border-white/20 hover:bg-white/[0.06] hover:text-[var(--color-fg-secondary)]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="tabular font-mono text-[var(--color-fg-subtle)]">⌘K</kbd>
        </button>
      </div>

      {/* Nav — pt-2 gives breathing room under the divider so the first
       * section label doesn't kiss the border, and mr-1 keeps the
       * scrollbar thumb from scraping the translucent capsule edge. */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pt-2 pb-3 mr-1">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={cn(
                      // rounded-xl for the inner pills gives a clean concentric
                      // ratio against the 24px capsule (roughly 1:2).
                      'group flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
                      active
                        // mix-blend-plus-lighter: compositing the fill over
                        // the translucent glass additively produces an
                        // 'etched highlight' rather than a glow. Raw opacity
                        // stays low (10% zinc fill + 5% ring) so luminance
                        // is bounded; the blend mode supplies the crispness.
                        // shadow-inner + text-[var(--color-fg-secondary)] complete the inset
                        // reading.
                        ? 'bg-zinc-500/10 ring-1 ring-inset ring-white/5 text-[var(--color-fg-secondary)] mix-blend-plus-lighter shadow-inner font-medium'
                        : 'text-[var(--color-fg-muted)] hover:bg-white/[0.06] hover:text-[var(--color-fg)]',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-secondary)]',
                      )}
                    />
                    <span className="flex-1 truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-white/5 p-3">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-[var(--color-fg)] ring-1 ring-inset ring-white/10">
            {username?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-[var(--color-fg-secondary)]">{username ?? 'Unknown'}</p>
            <p className="text-[11px] uppercase tracking-widest text-[var(--color-fg-faint)]">Proxmox</p>
          </div>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-md p-1 text-[var(--color-fg-subtle)] transition hover:text-[var(--color-err)]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
