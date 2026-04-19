'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Server,
  Terminal,
  Code2,
  HardDrive,
  Activity,
  Monitor,
  Box,
  Play,
  Square,
  RotateCcw,
  LogOut,
  Search,
} from 'lucide-react';
import { useClusterResources } from '@/hooks/use-cluster';
import { api, readCsrfCookie } from '@/lib/proxmox-client';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { data: resources } = useClusterResources();
  const toast = useToast();

  const vms = resources?.filter((r) => r.type === 'qemu') ?? [];
  const cts = resources?.filter((r) => r.type === 'lxc') ?? [];

  // Listen for CMD+K / Ctrl+K
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  async function handleVMAction(
    action: 'start' | 'stop' | 'reboot',
    node: string,
    vmid: number,
    type: 'vm' | 'lxc',
  ) {
    setOpen(false);
    try {
      if (type === 'vm') {
        if (action === 'start') await api.vms.start(node, vmid);
        if (action === 'stop') await api.vms.stop(node, vmid);
        if (action === 'reboot') await api.vms.reboot(node, vmid);
      } else {
        if (action === 'start') await api.containers.start(node, vmid);
        if (action === 'stop') await api.containers.stop(node, vmid);
        if (action === 'reboot') await api.containers.reboot(node, vmid);
      }
      toast.success(`${action[0].toUpperCase() + action.slice(1)} queued`, `${type.toUpperCase()} ${vmid}`);
    } catch (err) {
      toast.error(`Failed to ${action}`, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLogout() {
    setOpen(false);
    const csrf = readCsrfCookie();
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: csrf ? { 'X-Nexus-CSRF': csrf } : undefined,
    });
    router.push('/login');
    router.refresh();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl mx-4 studio-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-[var(--color-fg-faint)] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2"
          shouldFilter={false}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
            <Search className="w-4 h-4 text-[var(--color-fg-subtle)] shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search pages, VMs, containers…"
              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
              autoFocus
            />
            <kbd className="text-xs text-[var(--color-fg-faint)] border border-[var(--color-border-subtle)] rounded px-1.5 py-0.5">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-96 overflow-y-auto py-2">
            <Command.Empty className="py-8 text-center text-sm text-[var(--color-fg-faint)]">
              No results for &ldquo;{search}&rdquo;
            </Command.Empty>

            {/* Navigation */}
            <Command.Group heading="Navigation">
              {[
                { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
                { label: 'Nodes', href: '/dashboard/nodes', icon: Server },
                { label: 'Storage', href: '/dashboard/storage', icon: HardDrive },
                { label: 'Tasks', href: '/dashboard/tasks', icon: Activity },
                { label: 'Console', href: '/console', icon: Terminal },
                { label: 'Community Scripts', href: '/scripts', icon: Code2 },
              ]
                .filter(
                  (item) =>
                    !search || item.label.toLowerCase().includes(search.toLowerCase()),
                )
                .map(({ label, href, icon: Icon }) => (
                  <CommandItem
                    key={href}
                    onSelect={() => navigate(href)}
                    icon={<Icon className="w-4 h-4" />}
                    label={label}
                    hint="Go to"
                  />
                ))}
            </Command.Group>

            {/* VMs */}
            {vms.length > 0 && (
              <Command.Group heading="Virtual Machines">
                {vms
                  .filter(
                    (v) =>
                      !search ||
                      v.name?.toLowerCase().includes(search.toLowerCase()) ||
                      String(v.vmid).includes(search),
                  )
                  .slice(0, 6)
                  .map((vm) => (
                    <div key={vm.id} className="px-2">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg group">
                        <Monitor className="w-3.5 h-3.5 text-[var(--color-fg-subtle)]" />
                        <span className="flex-1 text-sm text-[var(--color-fg-secondary)]">
                          {vm.name ?? vm.vmid}
                          <span className="text-[var(--color-fg-faint)] text-xs ml-1">({vm.vmid})</span>
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                          {vm.status !== 'running' && (
                            <ActionButton
                              icon={<Play className="w-3 h-3" />}
                              label="Start"
                              onClick={() => handleVMAction('start', vm.node!, vm.vmid!, 'vm')}
                            />
                          )}
                          {vm.status === 'running' && (
                            <>
                              <ActionButton
                                icon={<RotateCcw className="w-3 h-3" />}
                                label="Reboot"
                                onClick={() => handleVMAction('reboot', vm.node!, vm.vmid!, 'vm')}
                              />
                              <ActionButton
                                icon={<Square className="w-3 h-3" />}
                                label="Stop"
                                onClick={() => handleVMAction('stop', vm.node!, vm.vmid!, 'vm')}
                                danger
                              />
                            </>
                          )}
                          <ActionButton
                            icon={<Terminal className="w-3 h-3" />}
                            label="Console"
                            onClick={() => navigate(`/console?node=${encodeURIComponent(vm.node!)}&vmid=${vm.vmid}&type=qemu`)}
                          />
                        </div>
                        <span
                          className={cn(
                            'text-xs shrink-0',
                            vm.status === 'running' ? 'text-[var(--color-ok)]' : 'text-[var(--color-fg-faint)]',
                          )}
                        >
                          {vm.status}
                        </span>
                      </div>
                    </div>
                  ))}
              </Command.Group>
            )}

            {/* Containers */}
            {cts.length > 0 && (
              <Command.Group heading="Containers">
                {cts
                  .filter(
                    (c) =>
                      !search ||
                      c.name?.toLowerCase().includes(search.toLowerCase()) ||
                      String(c.vmid).includes(search),
                  )
                  .slice(0, 6)
                  .map((ct) => (
                    <div key={ct.id} className="px-2">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg group">
                        <Box className="w-3.5 h-3.5 text-[var(--color-fg-subtle)]" />
                        <span className="flex-1 text-sm text-[var(--color-fg-secondary)]">
                          {ct.name ?? ct.vmid}
                          <span className="text-[var(--color-fg-faint)] text-xs ml-1">({ct.vmid})</span>
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                          {ct.status !== 'running' && (
                            <ActionButton
                              icon={<Play className="w-3 h-3" />}
                              label="Start"
                              onClick={() => handleVMAction('start', ct.node!, ct.vmid!, 'lxc')}
                            />
                          )}
                          {ct.status === 'running' && (
                            <>
                              <ActionButton
                                icon={<RotateCcw className="w-3 h-3" />}
                                label="Reboot"
                                onClick={() => handleVMAction('reboot', ct.node!, ct.vmid!, 'lxc')}
                              />
                              <ActionButton
                                icon={<Square className="w-3 h-3" />}
                                label="Stop"
                                onClick={() => handleVMAction('stop', ct.node!, ct.vmid!, 'lxc')}
                                danger
                              />
                            </>
                          )}
                          <ActionButton
                            icon={<Terminal className="w-3 h-3" />}
                            label="Console"
                            onClick={() => navigate(`/console?node=${encodeURIComponent(ct.node!)}&vmid=${ct.vmid}&type=lxc`)}
                          />
                        </div>
                        <span
                          className={cn(
                            'text-xs shrink-0',
                            ct.status === 'running' ? 'text-[var(--color-ok)]' : 'text-[var(--color-fg-faint)]',
                          )}
                        >
                          {ct.status}
                        </span>
                      </div>
                    </div>
                  ))}
              </Command.Group>
            )}

            {/* Account */}
            <Command.Group heading="Account">
              <CommandItem
                onSelect={handleLogout}
                icon={<LogOut className="w-4 h-4" />}
                label="Sign out"
                hint="Logout"
                danger
              />
            </Command.Group>
          </Command.List>

          <div className="px-4 py-2 border-t border-[var(--color-border-subtle)] flex items-center gap-4">
            <span className="text-xs text-[var(--color-fg-faint)]">
              <kbd className="border border-[var(--color-border-subtle)] rounded px-1">↑↓</kbd> navigate
            </span>
            <span className="text-xs text-[var(--color-fg-faint)]">
              <kbd className="border border-[var(--color-border-subtle)] rounded px-1">↵</kbd> select
            </span>
            <span className="text-xs text-[var(--color-fg-faint)]">
              <kbd className="border border-[var(--color-border-subtle)] rounded px-1">ESC</kbd> close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({
  onSelect,
  icon,
  label,
  hint,
  danger,
}: {
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-3 px-4 py-2 cursor-pointer transition',
        'data-[selected=true]:bg-[var(--color-overlay)]',
        danger ? 'text-[var(--color-err)] data-[selected=true]:text-[var(--color-err)]' : 'text-[var(--color-fg-secondary)]',
      )}
    >
      <span className="text-[var(--color-fg-subtle)]">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      {hint && <span className="text-xs text-[var(--color-fg-faint)]">{hint}</span>}
    </Command.Item>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'p-1 rounded transition text-xs',
        danger
          ? 'text-[var(--color-err)] hover:bg-[var(--color-err)]/20'
          : 'text-[var(--color-fg-subtle)] hover:bg-[var(--color-overlay)] hover:text-[var(--color-fg-secondary)]',
      )}
    >
      {icon}
    </button>
  );
}
