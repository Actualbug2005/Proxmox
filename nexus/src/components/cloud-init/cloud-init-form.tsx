'use client';

/**
 * CloudInitForm — pure collection with lifted state.
 *
 * The parent wizard owns `CloudInitFormState` and passes it in along
 * with `onChange`. The form emits no side effects; translation to PVE's
 * UpdateVMConfigParams happens via `cloudInitStateToUpdateParams()`
 * below, which the wizard calls on submit.
 *
 * Validation is inline and field-level. Real parsing/rejection lives
 * in lib/cloud-init.ts so it can be tested without React.
 */

import { useState } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HOSTNAME_RE,
  USERNAME_RE,
  IPV4_CIDR_RE,
  IPV4_RE,
  buildIpconfig,
  normalizeSshKeys,
  type NicConfigInput,
  type Ipv4Mode,
  type Ipv6Mode,
} from '@/lib/cloud-init';
import type { UpdateVMConfigParamsPublic } from '@/types/proxmox';

// ─── State shape + translator ───────────────────────────────────────────────

export interface CloudInitFormState {
  hostname: string;
  username: string;
  password: string;
  sshKeysRaw: string;
  nic0: NicConfigInput;
  nameserver: string;
  searchdomain: string;
}

export const EMPTY_CLOUD_INIT_STATE: CloudInitFormState = {
  hostname: '',
  username: '',
  password: '',
  sshKeysRaw: '',
  nic0: {
    ipv4Mode: 'dhcp',
    ipv4Cidr: '',
    ipv4Gw: '',
    ipv6Mode: 'none',
    ipv6Cidr: '',
    ipv6Gw: '',
  },
  nameserver: '',
  searchdomain: '',
};

export type CloudInitTranslation =
  | { ok: true; params: Partial<UpdateVMConfigParamsPublic>; fieldCount: number }
  | { ok: false; errors: string[] };

/**
 * Translate the form state into a `UpdateVMConfigParams` patch. Empty
 * strings are DROPPED (we never send `ciuser: ""`, which PVE would
 * interpret as "clear this field"). On SSH-key parse failure returns
 * `{ok: false, errors}` so the wizard can render them and block submit.
 *
 * Hostname is sent as `name` on the VM config — PVE doesn't expose a
 * separate `hostname` param for QEMU; cloud-init reads the VM name
 * by default. If the template sets `ciuser`, that's what cloud-init
 * uses for the default username.
 */
export function cloudInitStateToUpdateParams(state: CloudInitFormState): CloudInitTranslation {
  const patch: Partial<UpdateVMConfigParamsPublic> = {};

  if (state.hostname) patch.name = state.hostname;
  if (state.username) patch.ciuser = state.username;
  if (state.password) patch.cipassword = state.password;

  if (state.sshKeysRaw.trim()) {
    const norm = normalizeSshKeys(state.sshKeysRaw);
    if (!norm.ok) return { ok: false, errors: norm.errors };
    if (norm.value.length > 0) patch.sshkeys = norm.value;
  }

  const ip = buildIpconfig(state.nic0);
  if (ip.length > 0) patch.ipconfig0 = ip;

  if (state.nameserver.trim()) patch.nameserver = state.nameserver.trim();
  if (state.searchdomain.trim()) patch.searchdomain = state.searchdomain.trim();

  return { ok: true, params: patch, fieldCount: Object.keys(patch).length };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CloudInitFormProps {
  value: CloudInitFormState;
  onChange: (next: CloudInitFormState) => void;
  /** Errors from the parent's most recent translation attempt (typically
   *  SSH-key parse errors). Rendered inline under the textarea. */
  sshKeyErrors?: string[];
}

const inputCls =
  'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

export function CloudInitForm({ value, onChange, sshKeyErrors }: CloudInitFormProps) {
  const set = <K extends keyof CloudInitFormState>(k: K, v: CloudInitFormState[K]) =>
    onChange({ ...value, [k]: v });
  const setNic = (patch: Partial<NicConfigInput>) =>
    onChange({ ...value, nic0: { ...value.nic0, ...patch } });

  const [showPassword, setShowPassword] = useState(false);

  const hostnameValid = value.hostname === '' || HOSTNAME_RE.test(value.hostname);
  const usernameValid = value.username === '' || USERNAME_RE.test(value.username);
  const v4CidrValid = value.nic0.ipv4Mode !== 'static' || value.nic0.ipv4Cidr === '' || IPV4_CIDR_RE.test(value.nic0.ipv4Cidr ?? '');
  const v4GwValid = value.nic0.ipv4Mode !== 'static' || !value.nic0.ipv4Gw || IPV4_RE.test(value.nic0.ipv4Gw);

  const ipPreview = buildIpconfig(value.nic0);

  return (
    <div className="space-y-4">
      {/* Hostname + user */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Hostname</label>
          <input
            value={value.hostname}
            onChange={(e) => set('hostname', e.target.value)}
            placeholder="web01"
            className={cn(inputCls, 'font-mono', !hostnameValid && 'border-red-500/50')}
          />
          {!hostnameValid && (
            <p className="text-xs text-red-400 mt-1">
              Lowercase letters, digits, hyphens; max 63 chars; no leading/trailing hyphen.
            </p>
          )}
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Default user</label>
          <input
            value={value.username}
            onChange={(e) => set('username', e.target.value)}
            placeholder="ubuntu"
            className={cn(inputCls, 'font-mono', !usernameValid && 'border-red-500/50')}
            autoComplete="off"
          />
          {!usernameValid && (
            <p className="text-xs text-red-400 mt-1">
              Lowercase POSIX username: start with letter or underscore.
            </p>
          )}
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Password (optional)</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={value.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder="—"
            autoComplete="new-password"
            className={cn(inputCls, 'pr-10')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-1 flex items-center gap-1">
          <Info className="w-3 h-3" /> Sent in cleartext over the HTTPS proxy; PVE hashes it server-side.
        </p>
      </div>

      {/* SSH keys */}
      <div>
        <label className="text-xs text-zinc-500 block mb-1">SSH authorized keys</label>
        <textarea
          value={value.sshKeysRaw}
          onChange={(e) => set('sshKeysRaw', e.target.value)}
          placeholder="ssh-ed25519 AAAA... user@host"
          rows={4}
          className={cn(inputCls, 'font-mono text-xs')}
          spellCheck={false}
        />
        {sshKeyErrors && sshKeyErrors.length > 0 && (
          <ul className="text-xs text-red-400 mt-1 list-disc pl-4 space-y-0.5">
            {sshKeyErrors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        )}
        <p className="text-xs text-zinc-600 mt-1">
          One key per line. Comment lines and blanks are ignored.
        </p>
      </div>

      {/* NIC 0 */}
      <div className="rounded-lg border border-zinc-800/60 p-3 space-y-3">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Network — eth0</p>

        <div className="grid grid-cols-2 gap-3">
          {/* IPv4 */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">IPv4</label>
            <select
              value={value.nic0.ipv4Mode}
              onChange={(e) => setNic({ ipv4Mode: e.target.value as Ipv4Mode })}
              className={inputCls}
            >
              <option value="dhcp">DHCP</option>
              <option value="static">Static</option>
              <option value="none">None</option>
            </select>
          </div>
          {/* IPv6 */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">IPv6</label>
            <select
              value={value.nic0.ipv6Mode}
              onChange={(e) => setNic({ ipv6Mode: e.target.value as Ipv6Mode })}
              className={inputCls}
            >
              <option value="none">None</option>
              <option value="auto">SLAAC (auto)</option>
              <option value="dhcp">DHCPv6</option>
              <option value="static">Static</option>
            </select>
          </div>
        </div>

        {value.nic0.ipv4Mode === 'static' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">IPv4 address / prefix</label>
              <input
                value={value.nic0.ipv4Cidr ?? ''}
                onChange={(e) => setNic({ ipv4Cidr: e.target.value })}
                placeholder="10.0.0.5/24"
                className={cn(inputCls, 'font-mono', !v4CidrValid && 'border-red-500/50')}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">IPv4 gateway</label>
              <input
                value={value.nic0.ipv4Gw ?? ''}
                onChange={(e) => setNic({ ipv4Gw: e.target.value })}
                placeholder="10.0.0.1"
                className={cn(inputCls, 'font-mono', !v4GwValid && 'border-red-500/50')}
              />
            </div>
          </div>
        )}

        {value.nic0.ipv6Mode === 'static' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">IPv6 address / prefix</label>
              <input
                value={value.nic0.ipv6Cidr ?? ''}
                onChange={(e) => setNic({ ipv6Cidr: e.target.value })}
                placeholder="fd00::5/64"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">IPv6 gateway</label>
              <input
                value={value.nic0.ipv6Gw ?? ''}
                onChange={(e) => setNic({ ipv6Gw: e.target.value })}
                placeholder="fd00::1"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>
        )}

        {ipPreview && (
          <p className="text-[11px] text-zinc-600 font-mono break-all">
            → ipconfig0 = <span className="text-zinc-400">{ipPreview}</span>
          </p>
        )}
      </div>

      {/* DNS */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Nameservers (optional)</label>
          <input
            value={value.nameserver}
            onChange={(e) => set('nameserver', e.target.value)}
            placeholder="1.1.1.1 8.8.8.8"
            className={cn(inputCls, 'font-mono')}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Search domain (optional)</label>
          <input
            value={value.searchdomain}
            onChange={(e) => set('searchdomain', e.target.value)}
            placeholder="lan"
            className={cn(inputCls, 'font-mono')}
          />
        </div>
      </div>
    </div>
  );
}
