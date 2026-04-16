'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

const TRIGGER_OPTIONS = [
  { value: 'invoice.created', label: 'Invoice Created' },
  { value: 'invoice.overdue', label: 'Invoice Overdue' },
  { value: 'invoice.sent', label: 'Invoice Sent' },
  { value: 'lead.status_changed', label: 'Lead Status Changed' },
  { value: 'lead.assigned', label: 'Lead Assigned' },
  { value: 'ticket.created', label: 'Ticket Created' },
  { value: 'ticket.status_changed', label: 'Ticket Status Changed' },
  { value: 'ticket.replied', label: 'Ticket Replied' },
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'project.created', label: 'Project Created' },
  { value: 'client.created', label: 'Client Created' },
  { value: 'estimate.sent', label: 'Estimate Sent' },
  { value: 'contract.signed', label: 'Contract Signed' },
  { value: 'payment.received', label: 'Payment Received' },
];

const ACTION_TYPES = [
  { value: 'send_email', label: 'Send Email' },
  { value: 'update_field', label: 'Update Field' },
  { value: 'create_task', label: 'Create Task' },
  { value: 'notify', label: 'Send Notification' },
  { value: 'webhook', label: 'Call Webhook' },
];

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
];

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  conditions: any;
  actions: any[];
  active: boolean;
  createdAt: string;
}

interface ActionConfig {
  type: string;
  config: Record<string, any>;
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('ticket.created');
  const [condEnabled, setCondEnabled] = useState(false);
  const [condField, setCondField] = useState('');
  const [condOp, setCondOp] = useState('equals');
  const [condValue, setCondValue] = useState('');
  const [actions, setActions] = useState<ActionConfig[]>([{ type: 'send_email', config: {} }]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/automations`, { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName(''); setTrigger('ticket.created'); setCondEnabled(false);
    setCondField(''); setCondOp('equals'); setCondValue('');
    setActions([{ type: 'send_email', config: {} }]);
    setEditing(null); setShowForm(false);
  };

  const openEdit = (rule: AutomationRule) => {
    setEditing(rule);
    setName(rule.name);
    setTrigger(rule.trigger);
    if (rule.conditions && rule.conditions.field) {
      setCondEnabled(true);
      setCondField(rule.conditions.field);
      setCondOp(rule.conditions.operator ?? 'equals');
      setCondValue(rule.conditions.value ?? '');
    } else {
      setCondEnabled(false);
    }
    setActions(Array.isArray(rule.actions) ? rule.actions : []);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const body: any = {
      name,
      trigger,
      conditions: condEnabled ? { field: condField, operator: condOp, value: condValue } : null,
      actions,
    };
    try {
      if (editing) {
        await fetch(`${API_BASE}/api/v1/automations/${editing.id}`, {
          method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
        });
      } else {
        await fetch(`${API_BASE}/api/v1/automations`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
        });
      }
      resetForm();
      load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation rule?')) return;
    await fetch(`${API_BASE}/api/v1/automations/${id}`, { method: 'DELETE', headers: authHeaders() });
    load();
  };

  const toggleActive = async (rule: AutomationRule) => {
    await fetch(`${API_BASE}/api/v1/automations/${rule.id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ active: !rule.active }),
    });
    load();
  };

  const updateAction = (idx: number, key: string, val: any) => {
    setActions((prev) => prev.map((a, i) => i === idx ? { ...a, [key]: val } : a));
  };

  const updateActionConfig = (idx: number, key: string, val: any) => {
    setActions((prev) => prev.map((a, i) => i === idx ? { ...a, config: { ...a.config, [key]: val } } : a));
  };

  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automation Rules</h1>
          <p className="text-sm text-gray-500 mt-1">Automate actions when events occur in your CRM</p>
        </div>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
          >
            + New Rule
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6 max-w-3xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit Rule' : 'New Automation Rule'}</h2>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. Auto-assign urgent tickets" />
            </div>
            {/* Trigger */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Trigger Event</label>
              <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {/* Conditions */}
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={condEnabled} onChange={(e) => setCondEnabled(e.target.checked)} className="rounded border-gray-300" />
                Add condition (optional)
              </label>
              {condEnabled && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <input value={condField} onChange={(e) => setCondField(e.target.value)} placeholder="Field (e.g. status)" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  <select value={condOp} onChange={(e) => setCondOp(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder="Value" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              )}
            </div>
            {/* Actions */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Actions</label>
              {actions.map((action, idx) => (
                <div key={idx} className="mb-3 p-3 border border-gray-100 rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <select value={action.type} onChange={(e) => updateAction(idx, 'type', e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1">
                      {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    {actions.length > 1 && (
                      <button onClick={() => setActions((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-red-600 hover:underline">Remove</button>
                    )}
                  </div>
                  {/* Config fields based on type */}
                  {action.type === 'send_email' && (
                    <div className="space-y-2">
                      <input value={action.config.to ?? ''} onChange={(e) => updateActionConfig(idx, 'to', e.target.value)} placeholder="To email" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input value={action.config.subject ?? ''} onChange={(e) => updateActionConfig(idx, 'subject', e.target.value)} placeholder="Subject" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <textarea value={action.config.body ?? ''} onChange={(e) => updateActionConfig(idx, 'body', e.target.value)} placeholder="Email body (HTML)" rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  )}
                  {action.type === 'update_field' && (
                    <div className="grid grid-cols-3 gap-2">
                      <input value={action.config.entityType ?? ''} onChange={(e) => updateActionConfig(idx, 'entityType', e.target.value)} placeholder="Entity (ticket, lead...)" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input value={action.config.field ?? ''} onChange={(e) => updateActionConfig(idx, 'field', e.target.value)} placeholder="Field name" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input value={action.config.value ?? ''} onChange={(e) => updateActionConfig(idx, 'value', e.target.value)} placeholder="New value" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  )}
                  {action.type === 'create_task' && (
                    <div className="space-y-2">
                      <input value={action.config.name ?? ''} onChange={(e) => updateActionConfig(idx, 'name', e.target.value)} placeholder="Task name" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input value={action.config.assignedTo ?? ''} onChange={(e) => updateActionConfig(idx, 'assignedTo', e.target.value)} placeholder="Assign to (user ID)" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input type="date" value={action.config.dueDate ?? ''} onChange={(e) => updateActionConfig(idx, 'dueDate', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  )}
                  {action.type === 'notify' && (
                    <div className="space-y-2">
                      <input value={action.config.userId ?? ''} onChange={(e) => updateActionConfig(idx, 'userId', e.target.value)} placeholder="User ID to notify" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <input value={action.config.message ?? ''} onChange={(e) => updateActionConfig(idx, 'message', e.target.value)} placeholder="Notification message" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  )}
                  {action.type === 'webhook' && (
                    <div className="space-y-2">
                      <input value={action.config.url ?? ''} onChange={(e) => updateActionConfig(idx, 'url', e.target.value)} placeholder="Webhook URL" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                      <select value={action.config.method ?? 'POST'} onChange={(e) => updateActionConfig(idx, 'method', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => setActions((prev) => [...prev, { type: 'send_email', config: {} }])} className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50">+ Add Action</button>
            </div>
            {/* Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleSave} disabled={saving || !name.trim()} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Rule' : 'Create Rule'}
              </button>
              <button onClick={resetForm} className="text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Rules table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Trigger</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Active</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No automation rules yet</td></tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">{rule.name}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    {TRIGGER_OPTIONS.find((t) => t.value === rule.trigger)?.label ?? rule.trigger}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {Array.isArray(rule.actions) ? rule.actions.length : 0} action(s)
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(rule)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${rule.active ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${rule.active ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(rule)} className="text-xs text-primary hover:underline mr-3">Edit</button>
                  <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
