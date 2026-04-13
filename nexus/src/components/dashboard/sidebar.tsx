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
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
  { href: '/dashboard/storage', label: 'Storage', icon: HardDrive },
  { href: '/dashboard/tasks', label: 'Tasks', icon: Activity },
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/scripts', label: 'Community Scripts', icon: Code2 },
];

interface SidebarProps {
  username?: string;
}

export function Sidebar({ username }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
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
