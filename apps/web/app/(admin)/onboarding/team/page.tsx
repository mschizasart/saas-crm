'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';
import { FormField, inputClass } from '@/components/ui/form-field';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { patchOnboarding } from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

type Role = 'admin' | 'staff';
interface InviteRow {
  email: string;
  role: Role;
}

/**
 * Step 3 — invite teammates. Delegates to `POST /me/invite-team` which
 * calls into the existing UsersService.create flow (no parallel invite
 * model). Empty rows are dropped; we surface a per-row error if the API
 * reports one (e.g. duplicate email).
 */
export default function OnboardingTeamPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InviteRow[]>([
    { email: '', role: 'staff' },
  ]);
  const [saving, setSaving] = useState(false);

  const addRow = () => setRows([...rows, { email: '', role: 'staff' }]);
  const removeRow = (i: number) =>
    setRows(rows.length === 1 ? rows : rows.filter((_, j) => j !== i));
  const update = (i: number, patch: Partial<InviteRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const goToNext = async () => {
    await patchOnboarding({ step: 'team' });
    router.push(nextStepPath('team'));
  };

  const onContinue = async () => {
    const cleanInvites = rows
      .map((r) => ({ email: r.email.trim().toLowerCase(), role: r.role }))
      .filter((r) => r.email.length > 0);

    if (cleanInvites.length === 0) {
      // Nothing to send — equivalent to skip but we still advance the step.
      await goToNext();
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/organizations/me/invite-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invites: cleanInvites }),
      });
      if (!res.ok) {
        toast.error('Failed to send invites');
        return;
      }
      const data = await res.json();
      const failures = (data?.invites ?? []).filter((i: any) => !i.ok);
      const successes = (data?.invites ?? []).filter((i: any) => i.ok);
      if (successes.length > 0) {
        toast.success(
          `Invited ${successes.length} teammate${successes.length === 1 ? '' : 's'}`,
        );
      }
      if (failures.length > 0) {
        toast.error(
          `${failures.length} invite${failures.length === 1 ? '' : 's'} failed: ${failures
            .map((f: any) => `${f.email} (${f.error})`)
            .join(', ')}`,
        );
        // Still advance — partial success is fine for a setup wizard.
      }
      await goToNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="Invite your team"
        subtitle="Add the email addresses of teammates who should have access. They'll receive a sign-in link."
      />

      <div className="mt-8 max-w-2xl">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row, i) => (
            <div key={i} className="p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
              <div className="flex-1 w-full">
                <FormField label={i === 0 ? 'Email' : undefined}>
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => update(i, { email: e.target.value })}
                    className={inputClass}
                    placeholder="teammate@company.com"
                  />
                </FormField>
              </div>
              <div className="w-full sm:w-40">
                <FormField label={i === 0 ? 'Role' : undefined}>
                  <select
                    value={row.role}
                    onChange={(e) => update(i, { role: e.target.value as Role })}
                    className={inputClass}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </FormField>
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                aria-label="Remove invite"
                className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="p-3">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              Add another
            </button>
          </div>
        </div>

        <div className="mt-4 inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          You can manage roles and permissions in Settings → Staff later.
        </div>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('team');
          if (p) router.push(p);
        }}
        onContinue={onContinue}
        onSkip={goToNext}
        continueLoading={saving}
        continueLabel="Send invites & continue"
      />
    </div>
  );
}
