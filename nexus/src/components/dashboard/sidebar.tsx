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
      className="sticky top-0 flex h-screen w-56 shrink-0 flex-col
                 border-r border-white/5
                 bg-zinc-950/60 backdrop-blur-2xl backdrop-saturate-150
                 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 shadow-[0_0_20px_-6px_rgba(249,115,22,0.6)]">
          <Server className="h-4 w-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-zinc-50">Nexus</span>
          <p className="text-micro text-zinc-500 uppercase tracking-[0.14em]">Proxmox UI</p>
        </div>
      </div>

      {/* Command Palette trigger */}
      <div className="border-b border-white/5 px-3 py-3">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg
                     bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-500
                     ring-1 ring-inset ring-white/5
                     transition hover:bg-white/[0.06] hover:text-zinc-300"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="tabular font-mono text-zinc-600">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-zinc-500">
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
                      // base
                      'group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                      active
                        ? [
                            // Apple-style Liquid Glass active pill:
                            //   1. Tinted translucent fill
                            //   2. Backdrop blur + saturation (needs something behind it — provided by the radial-gradient overlay in layout.tsx)
                            //   3. Inset specular highlight (top edge)
                            //   4. Soft outer accent glow
                            'font-medium text-orange-200',
                            'bg-orange-500/15 backdrop-blur-xl backdrop-saturate-150',
                            'ring-1 ring-inset ring-white/10',
                            'shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_-10px_rgba(249,115,22,0.55)]',
                            // 2px left accent bar
                            'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-orange-400',
                          ]
                        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-orange-300' : 'text-zinc-500 group-hover:text-zinc-300')} />
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
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-orange-500/30 bg-orange-500/15">
            <span className="text-[11px] font-medium text-orange-300">
              {username?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-300">{username ?? 'Unknown'}</p>
            <p className="text-micro uppercase tracking-[0.12em] text-zinc-600">Proxmox</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-zinc-600 transition hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
