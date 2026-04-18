'use client';

/**
 * Create/edit modal for a destination. The form's shape switches on the
 * selected kind so an operator can't accidentally fill a Discord field
 * with a ntfy topic URL — the same invariant the server-side validator
 * enforces, made visible at the UI.
 *
 * Kept deliberately minimal: kind picker + per-kind fields + save/cancel.
 * A full "test this config before save" pass is a nice-to-have we can
 * layer on later; the per-row Test button in the table is the immediate
 * answer.
 */
import { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type {
  DestinationConfig,
  DestinationKind,
} from '@/lib/notifications/types';

export interface DestinationFormValue {
  name: string;
  config: DestinationConfig;
}

export interface DestinationFormProps {
  /** `null` = create; `value` populated = edit. */
  initial?: DestinationFormValue | null;
  isPending?: boolean;
  error?: string;
  onSubmit: (value: DestinationFormValue) => void;
  onCancel: () => void;
}

// Label + placeholder hints per kind, wrapped in a record so adding a
// new kind forces the exhaustive-check to compile.
const KIND_COPY: Record<DestinationKind, { label: string; hint: string }> = {
  webhook: {
    label: 'Generic webhook',
    hint: 'POSTs JSON; optional HMAC-SHA-256 body signature.',
  },
  ntfy: {
    label: 'ntfy (push)',
    hint: 'POSTs plain-text to a topic URL; high-priority for alerts.',
  },
  discord: {
    label: 'Discord webhook',
    hint: 'Coloured-embed POST to a channel webhook URL.',
  },
  email: {
    label: 'Email (SMTP)',
    hint: 'TLS-only (port 465/587); comma-separated recipient list.',
  },
};

// Default config object per kind so the form has fields to bind to
// the moment a user picks a kind. Switching kinds resets the config.
function emptyConfigFor(kind: DestinationKind): DestinationConfig {
  if (kind === 'webhook') return { kind: 'webhook', url: '' };
  if (kind === 'ntfy') return { kind: 'ntfy', topicUrl: '' };
  if (kind === 'discord') return { kind: 'discord', webhookUrl: '' };
  // Sensible email defaults: port 587 / STARTTLS is the most common
  // homelab + cloud-SMTP combo; secure stays false because 587
  // upgrades via STARTTLS, not implicit TLS.
  return {
    kind: 'email',
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    from: '',
    to: [],
  };
}

export function DestinationForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: DestinationFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [config, setConfig] = useState<DestinationConfig>(
    initial?.config ?? emptyConfigFor('webhook'),
  );

  const canSubmit = name.trim().length > 0 && validConfig(config) && !isPending;

  function changeKind(kind: DestinationKind) {
    // Switching kinds discards the previous config by design — mixing
    // a webhook URL into a Discord form would violate our per-kind
    // validator on save anyway, so the UI should mirror that.
    setConfig(emptyConfigFor(kind));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ name: name.trim(), config });
      }}
      className="space-y-4"
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={setName}
          placeholder="Ops webhook"
          autoFocus
        />
      </Field>

      <Field label="Kind">
        <select
          value={config.kind}
          onChange={(e) => changeKind(e.target.value as DestinationKind)}
          disabled={!!initial /* kind locked on edit — changing it wipes the stored secret */}
          className={inputCls}
        >
          {(Object.keys(KIND_COPY) as DestinationKind[]).map((k) => (
            <option key={k} value={k}>{KIND_COPY[k].label}</option>
          ))}
        </select>
        <p className="text-xs text-[var(--color-fg-faint)] mt-1">{KIND_COPY[config.kind].hint}</p>
      </Field>

      {config.kind === 'webhook' && (
        <>
          <Field label="URL">
            <Input
              value={config.url}
              onChange={(url) => setConfig({ ...config, url })}
              placeholder="https://receiver.example.com/hook"
            />
          </Field>
          <Field label="HMAC secret (optional)" hint="Signs the body with X-Nexus-Signature so the receiver can verify origin.">
            <Input
              value={config.hmacSecret ?? ''}
              onChange={(hmacSecret) => setConfig({
                ...config,
                hmacSecret: hmacSecret.length > 0 ? hmacSecret : undefined,
              })}
              type="password"
              placeholder="Leave blank for no signature"
            />
          </Field>
        </>
      )}

      {config.kind === 'ntfy' && (
        <>
          <Field label="Topic URL">
            <Input
              value={config.topicUrl}
              onChange={(topicUrl) => setConfig({ ...config, topicUrl })}
              placeholder="https://ntfy.sh/your-topic"
            />
          </Field>
          <Field label="Basic auth (optional)" hint='Format: "user:password". Used only when the topic is behind ntfy ACL.'>
            <Input
              value={config.basicAuth ?? ''}
              onChange={(basicAuth) => setConfig({
                ...config,
                basicAuth: basicAuth.length > 0 ? basicAuth : undefined,
              })}
              type="password"
              placeholder="me:hunter2"
            />
          </Field>
        </>
      )}

      {config.kind === 'discord' && (
        <Field label="Webhook URL" hint="Server Settings → Integrations → Webhooks → Copy URL.">
          <Input
            value={config.webhookUrl}
            onChange={(webhookUrl) => setConfig({ ...config, webhookUrl })}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </Field>
      )}

      {config.kind === 'email' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field label="SMTP host">
              <Input
                value={config.host}
                onChange={(host) => setConfig({ ...config, host })}
                placeholder="smtp.example.com"
              />
            </Field>
            <Field label="Port" hint="465 = TLS, 587 = STARTTLS. No other ports.">
              <select
                value={config.port}
                onChange={(e) => {
                  const port = Number(e.target.value) as 465 | 587;
                  // Keep secure in sync — 465 is implicit-TLS, 587 is
                  // STARTTLS. Mismatched combos don't connect.
                  setConfig({ ...config, port, secure: port === 465 });
                }}
                className={inputCls}
              >
                <option value={587}>587 (STARTTLS)</option>
                <option value={465}>465 (TLS)</option>
              </select>
            </Field>
            <Field label="TLS cert check" hint="Disable only for self-signed LAN SMTP. Transport stays encrypted either way.">
              <select
                value={config.tlsInsecure ? 'off' : 'on'}
                onChange={(e) => setConfig({ ...config, tlsInsecure: e.target.value === 'off' })}
                className={inputCls}
              >
                <option value="on">Strict (recommended)</option>
                <option value="off">Allow self-signed</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <Input
                value={config.username}
                onChange={(username) => setConfig({ ...config, username })}
                placeholder="me@example.com"
              />
            </Field>
            <Field label="Password / app-password">
              <Input
                value={config.password}
                onChange={(password) => setConfig({ ...config, password })}
                type="password"
                placeholder="(required)"
              />
            </Field>
          </div>

          <Field label="From address" hint="Appears as the 'From:' header; many providers require this to match the auth account.">
            <Input
              value={config.from}
              onChange={(from) => setConfig({ ...config, from })}
              placeholder='"Nexus" <nexus@example.com>'
            />
          </Field>
          <Field label="To addresses" hint="Comma-separated. Each recipient receives every alert matching the bound rule.">
            <Input
              value={config.to.join(', ')}
              onChange={(raw) => setConfig({
                ...config,
                to: raw.split(',').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="ops@example.com, pager@example.com"
            />
          </Field>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {initial ? 'Save changes' : 'Add destination'}
        </Button>
      </div>
    </form>
  );
}

// ─── Presentation helpers ──────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-fg-faint)] mt-1">{hint}</p>}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = 'text', autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={cn(inputCls)}
    />
  );
}

// ─── Validation mirror of validators.ts ────────────────────────────────────
// Keeps the submit button greyed out until the server would accept the form.
function validConfig(config: DestinationConfig): boolean {
  function isHttps(u: string): boolean {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  }
  if (config.kind === 'webhook') return isHttps(config.url);
  if (config.kind === 'ntfy') {
    if (!isHttps(config.topicUrl)) return false;
    if (config.basicAuth && !config.basicAuth.includes(':')) return false;
    return true;
  }
  if (config.kind === 'discord') {
    return isHttps(config.webhookUrl) && config.webhookUrl.includes('/api/webhooks/');
  }
  // Email — all fields populated; port + secure agreement is enforced
  // by the Port dropdown's onChange, so just verify non-empty strings
  // and at least one recipient. Per-address RFC shape is checked
  // server-side on save (the regex lives in validators.ts).
  return (
    config.host.length > 0 &&
    (config.port === 465 || config.port === 587) &&
    config.username.length > 0 &&
    config.password.length > 0 &&
    config.from.length > 0 &&
    config.to.length > 0
  );
}
