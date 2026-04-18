'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Server, Lock, User, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    host: '',
    username: '',
    password: '',
    realm: 'pam' as 'pam' | 'pve',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Login failed');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center">
            <Server className="w-5 h-5 text-zinc-900" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Nexus</h1>
            <p className="text-xs text-[var(--color-fg-subtle)]">Proxmox Management</p>
          </div>
        </div>

        {/* Card */}
        <div className="studio-card p-8">
          <h2 className="text-lg font-semibold text-white mb-1">Sign in</h2>
          <p className="text-sm text-[var(--color-fg-subtle)] mb-6">Connect to your Proxmox cluster</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Host */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-fg-muted)] mb-1.5">
                Proxmox Host
              </label>
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
                <input
                  type="text"
                  placeholder="192.168.1.10 or hostname"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  className="w-full bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-300 focus:border-zinc-300 transition"
                />
              </div>
              <p className="text-xs text-[var(--color-fg-faint)] mt-1">Leave blank to use localhost</p>
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-fg-muted)] mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
                <input
                  type="text"
                  placeholder="root"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                  className="w-full bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-300 focus:border-zinc-300 transition"
                />
              </div>
            </div>

            {/* Realm */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-fg-muted)] mb-1.5">Realm</label>
              <div className="grid grid-cols-2 gap-2">
                {(['pam', 'pve'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm({ ...form, realm: r })}
                    className={cn(
                      'py-2 rounded-lg text-sm font-medium border transition',
                      form.realm === r
                        ? 'bg-white/5 border-zinc-200 text-indigo-400'
                        : 'bg-[var(--color-overlay)] border-[var(--color-border-subtle)] text-[var(--color-fg-muted)] hover:border-gray-600',
                    )}
                  >
                    {r === 'pam' ? 'PAM (Linux)' : 'PVE (Built-in)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-fg-muted)] mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  className="w-full bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-300 focus:border-zinc-300 transition"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-[var(--color-err)] shrink-0" />
                <p className="text-sm text-[var(--color-err)]">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-zinc-300 hover:bg-zinc-200 disabled:bg-zinc-300/50 text-zinc-900 font-medium py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--color-fg-faint)] mt-6">
          Nexus — Proxmox VE Management Overlay
        </p>
      </div>
    </div>
  );
}
