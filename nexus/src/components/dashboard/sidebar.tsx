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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readCsrfCookie } from '@/lib/proxmox-client';

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
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

interface SidebarProps {
  username?: string;
}

export function Sidebar({ username }: SidebarProps) {
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
      className="sticky top-0 z-40 flex h-screen w-56 shrink-0 flex-col
                 liquid-glass border-r border-zinc-800/40"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-zinc-800/60 px-4 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500">
          <Server className="h-4 w-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-zinc-50">Nexus</span>
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Proxmox UI</p>
        </div>
      </div>

      {/* Command Palette trigger */}
      <div className="border-b border-zinc-800/60 px-3 py-3">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg
                     border border-zinc-800/60 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-500
                     transition hover:border-zinc-700 hover:text-zinc-300"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="tabular font-mono text-zinc-600">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-zinc-800 font-medium text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-300',
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
      <div className="border-t border-zinc-800/60 p-3">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-300">
            {username?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-300">{username ?? 'Unknown'}</p>
            <p className="text-[11px] uppercase tracking-widest text-zinc-600">Proxmox</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-zinc-500 transition hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
