/**
 * Frontend catalogue for the Automations builder UI.
 *
 * The backend (`apps/api/src/modules/automations/automations.service.ts`) does NOT
 * currently expose a discovery endpoint, so this catalogue mirrors the trigger
 * names, condition operators, and action types that the service actually handles.
 *
 * If you add a new `@OnEvent(...)` listener or action `case` in the service,
 * mirror it here — otherwise the dropdown will not surface it.
 */

export interface TriggerDef {
  /** Event name — must match `@OnEvent(...)` strings in the API service. */
  value: string;
  label: string;
  description: string;
  /** Hint fields the rule engine can read on the event payload's main entity. */
  fields: string[];
}

export interface OperatorDef {
  value: string;
  label: string;
  /** Whether the operator needs a value input (always true for the current set). */
  needsValue: boolean;
}

export interface ActionDef {
  value: string;
  label: string;
  description: string;
  fields: ActionFieldDef[];
}

export type ActionFieldKind = 'text' | 'textarea' | 'date' | 'select';

export interface ActionFieldDef {
  key: string;
  label: string;
  kind: ActionFieldKind;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

/**
 * Triggers — each one corresponds to an `@OnEvent(...)` in `automations.service.ts`.
 * The `fields` list is a best-effort hint of the entity properties the rule engine
 * walks via `payload.ticket ?? payload.invoice ?? payload.lead ?? payload.task ?? payload`.
 */
export const TRIGGERS: TriggerDef[] = [
  {
    value: 'invoice.created',
    label: 'Invoice Created',
    description: 'Fires when a new invoice is created.',
    fields: ['status', 'total', 'currency', 'clientId'],
  },
  {
    value: 'invoice.overdue',
    label: 'Invoice Overdue',
    description: 'Fires when an invoice passes its due date without payment.',
    fields: ['status', 'total', 'currency', 'clientId'],
  },
  {
    value: 'invoice.sent',
    label: 'Invoice Sent',
    description: 'Fires when an invoice is marked as sent to the client.',
    fields: ['status', 'total', 'currency', 'clientId'],
  },
  {
    value: 'lead.status_changed',
    label: 'Lead Status Changed',
    description: 'Fires when a lead moves to a new status.',
    fields: ['status', 'source', 'assignedTo', 'value'],
  },
  {
    value: 'lead.assigned',
    label: 'Lead Assigned',
    description: 'Fires when a lead is assigned to a user.',
    fields: ['status', 'source', 'assignedTo'],
  },
  {
    value: 'ticket.created',
    label: 'Ticket Created',
    description: 'Fires when a new support ticket is created.',
    fields: ['priority', 'status', 'departmentId', 'clientId', 'subject'],
  },
  {
    value: 'ticket.status_changed',
    label: 'Ticket Status Changed',
    description: 'Fires when a ticket moves to a new status.',
    fields: ['priority', 'status', 'departmentId', 'clientId'],
  },
  {
    value: 'ticket.replied',
    label: 'Ticket Replied',
    description: 'Fires when someone replies to a ticket.',
    fields: ['priority', 'status', 'departmentId', 'clientId'],
  },
  {
    value: 'task.created',
    label: 'Task Created',
    description: 'Fires when a task is created.',
    fields: ['status', 'priority', 'projectId', 'dueDate'],
  },
  {
    value: 'task.completed',
    label: 'Task Completed',
    description: 'Fires when a task is marked complete.',
    fields: ['status', 'priority', 'projectId'],
  },
  {
    value: 'project.created',
    label: 'Project Created',
    description: 'Fires when a new project is created.',
    fields: ['status', 'clientId', 'budget'],
  },
  {
    value: 'client.created',
    label: 'Client Created',
    description: 'Fires when a new client is added.',
    fields: ['type', 'country', 'currency', 'groupId'],
  },
  {
    value: 'estimate.sent',
    label: 'Estimate Sent',
    description: 'Fires when an estimate is sent to the client.',
    fields: ['status', 'total', 'currency', 'clientId'],
  },
  {
    value: 'contract.signed',
    label: 'Contract Signed',
    description: 'Fires when a contract is signed.',
    fields: ['status', 'value', 'clientId'],
  },
  {
    value: 'payment.received',
    label: 'Payment Received',
    description: 'Fires when a payment is recorded.',
    fields: ['amount', 'currency', 'invoiceId', 'method'],
  },
];

/**
 * Operators — must match the `switch` in `evaluateConditions()` in
 * `automations.service.ts`. Adding more here without backend support is a no-op
 * (engine will fall through to `default: return true`).
 */
export const OPERATORS: OperatorDef[] = [
  { value: 'equals', label: 'Equals', needsValue: true },
  { value: 'not_equals', label: 'Does not equal', needsValue: true },
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'greater_than', label: 'Greater than', needsValue: true },
  { value: 'less_than', label: 'Less than', needsValue: true },
];

/**
 * Action types — must match the `switch` in `executeAction()` in
 * `automations.service.ts`. Each has a config-shape declared via `fields`,
 * which drives the per-action form in the builder.
 */
export const ACTIONS: ActionDef[] = [
  {
    value: 'send_email',
    label: 'Send Email',
    description: 'Send an email through the queued mailer.',
    fields: [
      { key: 'to', label: 'To (email address)', kind: 'text', placeholder: 'name@example.com', required: true },
      { key: 'subject', label: 'Subject', kind: 'text', placeholder: 'Automation Notification' },
      { key: 'body', label: 'Body (HTML allowed)', kind: 'textarea', placeholder: '<p>Automated notification</p>' },
    ],
  },
  {
    value: 'update_field',
    label: 'Update Field',
    description: 'Update a single field on the triggering entity.',
    fields: [
      {
        key: 'entityType',
        label: 'Entity type',
        kind: 'select',
        required: true,
        options: [
          { value: 'ticket', label: 'Ticket' },
          { value: 'invoice', label: 'Invoice' },
          { value: 'lead', label: 'Lead' },
          { value: 'task', label: 'Task' },
          { value: 'project', label: 'Project' },
          { value: 'client', label: 'Client' },
          { value: 'estimate', label: 'Estimate' },
          { value: 'proposal', label: 'Proposal' },
          { value: 'contract', label: 'Contract' },
          { value: 'expense', label: 'Expense' },
        ],
      },
      { key: 'field', label: 'Field name', kind: 'text', placeholder: 'status', required: true },
      { key: 'value', label: 'New value', kind: 'text', placeholder: 'closed', required: true },
    ],
  },
  {
    value: 'create_task',
    label: 'Create Task',
    description: 'Create a follow-up task in the same organization.',
    fields: [
      { key: 'name', label: 'Task name', kind: 'text', placeholder: 'Follow-up task', required: true },
      { key: 'assignedTo', label: 'Assign to (user ID)', kind: 'text', placeholder: 'uuid' },
      { key: 'dueDate', label: 'Due date', kind: 'date' },
    ],
  },
  {
    value: 'notify',
    label: 'Send Notification',
    description: 'Push an in-app notification to a user.',
    fields: [
      { key: 'userId', label: 'User ID', kind: 'text', placeholder: 'uuid', required: true },
      { key: 'message', label: 'Message', kind: 'text', placeholder: 'Heads up!', required: true },
    ],
  },
  {
    value: 'webhook',
    label: 'Call Webhook',
    description: 'POST/PUT/PATCH the event payload to an external URL.',
    fields: [
      { key: 'url', label: 'Webhook URL', kind: 'text', placeholder: 'https://example.com/hook', required: true },
      {
        key: 'method',
        label: 'HTTP method',
        kind: 'select',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
        ],
      },
    ],
  },
];

export function findTrigger(value: string): TriggerDef | undefined {
  return TRIGGERS.find((t) => t.value === value);
}

export function findAction(value: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.value === value);
}

export function findOperator(value: string): OperatorDef | undefined {
  return OPERATORS.find((o) => o.value === value);
}
