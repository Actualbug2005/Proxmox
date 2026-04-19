'use client';

/**
 * AlertRuleModal — opens an in-page modal with RuleForm pre-filled from
 * a RuleDraft. Used by the bell-icon affordance on pressure widgets so
 * operators don't have to navigate to /dashboard/notifications to create
 * an alert targeting the widget's scope.
 *
 * Only supports *creating* a rule. Editing an existing rule still lives
 * on the notifications page — from here, the user sees their draft land
 * there after save.
 */

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';
import { RuleForm, type RuleFormValue } from '@/components/notifications/rule-form';
import { useDestinations, useCreateRule } from '@/hooks/use-notifications';
import type { RuleMatch } from '@/lib/notifications/types';

export interface RuleDraft {
  /** Initial human name for the rule. Operator will edit in the form. */
  name: string;
  /** Predicate — event kind + optional metric/threshold/scope. */
  match: RuleMatch;
  /** Optional starter message template. Falls back to a sensible default. */
  messageTemplate?: string;
  /** Optional title prefix for destinations that want one. */
  title?: string;
}

export interface AlertRuleModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled rule state; re-evaluated when the modal (re)opens. */
  draft: RuleDraft;
}

// Default tailored for metric.threshold.crossed events (pressure widgets
// are the primary caller). For PushedEvent kinds (e.g. guest.service.failed)
// `{{metric}}` and `{{value}}` render blank — parents should pass a
// kind-appropriate `messageTemplate` via the draft in that case.
const DEFAULT_TEMPLATE = 'Nexus alert: {{metric}} = {{value}} on {{scope}}';

export function AlertRuleModal({ open, onClose, draft }: AlertRuleModalProps) {
  const { data: destinations = [] } = useDestinations();
  const createRule = useCreateRule();

  // Seed the RuleForm. Important: this memo is keyed on the draft so
  // reopening the modal for a different widget picks up the new seed,
  // but internal edits during the current session persist via RuleForm's
  // own state. `destinations` is included so the default destination
  // picks up once the query resolves.
  const initial: RuleFormValue = useMemo(
    () => ({
      name: draft.name,
      enabled: true,
      title: draft.title,
      match: draft.match,
      destinationId: destinations[0]?.id ?? '',
      messageTemplate: draft.messageTemplate ?? DEFAULT_TEMPLATE,
    }),
    [draft, destinations],
  );

  if (!open) return null;

  function handleSubmit(value: RuleFormValue) {
    // Explicitly map to RuleCreateInput. Today RuleFormValue and
    // RuleCreateInput are shape-compatible, but keep this explicit in
    // case they drift.
    createRule.mutate(
      {
        name: value.name,
        enabled: value.enabled,
        title: value.title,
        match: value.match,
        destinationId: value.destinationId,
        messageTemplate: value.messageTemplate,
        resolveMessageTemplate: value.resolveMessageTemplate,
        backoff: value.backoff,
        resolvePolicy: value.resolvePolicy,
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <ModalShell size="2xl" onClose={onClose}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-fg-secondary)]">
            Create alert rule
          </h2>
          <p className="text-xs text-[var(--color-fg-subtle)] mt-0.5">
            Pre-filled from the widget you clicked. Tweak and save.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)]/50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <RuleForm
        initial={initial}
        destinations={destinations}
        isPending={createRule.isPending}
        error={createRule.error?.message}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </ModalShell>
  );
}
