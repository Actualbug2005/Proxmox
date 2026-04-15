'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Server,
  LayoutDashboard,
  Terminal,
  Code2,
  LogOut,
  ChevronRight,
  Activity,
  HardDrive,
  Monitor,
  Box,
  Settings,
  Zap,
  Package,
  Network,
  ShieldCheck,
  ScrollText,
  ChevronDown,
  Layers,
  HeartPulse,
  Shield,
  Users,
  FolderTree,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readCsrfCookie } from '@/lib/proxmox-client';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
  { href: '/dashboard/vms', label: 'Virtual Machines', icon: Monitor },
  { href: '/dashboard/cts', label: 'Containers', icon: Box },
  { href: '/dashboard/storage', label: 'Storage', icon: HardDrive },
  { href: '/dashboard/tasks', label: 'Tasks', icon: Activity },
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/scripts', label: 'Community Scripts', icon: Code2 },
];

const systemNav = [
  { href: '/dashboard/system/power', label: 'Power', icon: Zap },
  { href: '/dashboard/system/packages', label: 'Packages', icon: Package },
  { href: '/dashboard/system/network', label: 'Network', icon: Network },
  { href: '/dashboard/system/certificates', label: 'Certificates', icon: ShieldCheck },
  { href: '/dashboard/system/logs', label: 'Logs', icon: ScrollText },
];

const clusterNav = [
  { href: '/dashboard/cluster/ha', label: 'Status & HA', icon: HeartPulse },
  { href: '/dashboard/cluster/firewall', label: 'Firewall', icon: Shield },
  { href: '/dashboard/cluster/access', label: 'Users & ACL', icon: Users },
  { href: '/dashboard/cluster/pools', label: 'Pools', icon: FolderTree },
  { href: '/dashboard/cluster/backups', label: 'Backups', icon: Archive },
];

interface SidebarProps {
  username?: string;
}

export function Sidebar({ username }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const systemActive = pathname.startsWith('/dashboard/system');
  const clusterActive = pathname.startsWith('/dashboard/cluster');

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
    <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-gray-800">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
          <Server className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-white">Nexus</span>
          <p className="text-xs text-gray-500">Proxmox UI</p>
        </div>
      </div>

      {/* CMD+K hint */}
      <div className="px-3 py-3 border-b border-gray-800">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-750 rounded-lg text-xs text-gray-500 transition cursor-pointer"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-gray-600 font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition group',
                active
                  ? 'bg-orange-500/10 text-orange-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3 h-3 opacity-60" />}
            </Link>
          );
        })}

        {/* System group */}
        <div>
          <Link
            href="/dashboard/system/power"
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition w-full',
              systemActive
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
            )}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="flex-1">System</span>
            <ChevronDown className={cn('w-3 h-3 opacity-60 transition-transform', systemActive && 'rotate-180')} />
          </Link>

          {systemActive && (
            <div className="ml-3 pl-3 border-l border-gray-800 mt-0.5 space-y-0.5">
              {systemNav.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition',
                      active
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Cluster group */}
        <div>
          <Link
            href="/dashboard/cluster/ha"
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition w-full',
              clusterActive
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
            )}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span className="flex-1">Cluster</span>
            <ChevronDown className={cn('w-3 h-3 opacity-60 transition-transform', clusterActive && 'rotate-180')} />
          </Link>

          {clusterActive && (
            <div className="ml-3 pl-3 border-l border-gray-800 mt-0.5 space-y-0.5">
              {clusterNav.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition',
                      active
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* User */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-orange-400">
              {username?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-300 truncate">{username ?? 'Unknown'}</p>
            <p className="text-xs text-gray-600">Proxmox</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-gray-600 hover:text-red-400 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
