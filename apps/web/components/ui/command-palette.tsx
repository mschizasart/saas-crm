'use client';

/**
 * Universal Cmd-K / Ctrl-K command palette for the admin app.
 *
 * Mounted once in apps/web/app/(admin)/layout.tsx. Self-manages open state via
 * a global keydown listener and a custom 'open-command-palette' window event so
 * other UI (e.g. the sidebar "Search..." hint, the mobile topbar shortcut) can
 * trigger it without import coupling.
 *
 * Sections:
 *   - Actions: static "Create new ..." / nav verbs, filtered by query substring.
 *   - Records: live results from /api/v1/search (fired only when q.length >= 2).
 *   - Pages:   static admin pages, filtered by query substring.
 *
 * The pages list is duplicated (not imported) from apps/web/components/admin-sidebar.tsx
 * because the source uses translation hooks + an inbox-count fetch that we don't
 * want to run inside the palette. Keep both in sync if you add a top-level page.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Loader2,
  ArrowRight,
  LayoutDashboard,
  Inbox,
  Settings,
  Users,
  UserCircle,
  Building2,
  FileText,
  FileCheck,
  Calculator,
  CreditCard,
  DollarSign,
  Receipt,
  Zap,
  FolderKanban,
  CheckSquare,
  ListTodo,
  Calendar,
  Target,
  ClipboardList,
  MessageCircle,
  Headphones,
  BookOpen,
  CalendarCheck,
  Package,
  FileSignature,
  Lock,
  Megaphone,
  BarChart3,
  Activity,
  Tag,
  Workflow,
  Webhook,
  Key,
  Plus,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useModalA11y } from './use-modal-a11y';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type Section = 'actions' | 'records' | 'pages';

interface PaletteItem {
  id: string;
  section: Section;
  label: string;
  sublabel?: string;
  url: string;
  icon: LucideIcon;
  /** Optional hint text shown on the right (e.g. record type, shortcut). */
  hint?: string;
}

interface SearchApiResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

// --------------------------------------------------------------------------
// Static lists
// --------------------------------------------------------------------------

const ACTIONS: ReadonlyArray<Omit<PaletteItem, 'section'>> = [
  { id: 'a-new-lead', label: 'Create new lead', url: '/leads/new', icon: Plus, hint: 'Lead' },
  { id: 'a-new-client', label: 'Create new client', url: '/clients/new', icon: Plus, hint: 'Client' },
  { id: 'a-new-invoice', label: 'Create new invoice', url: '/invoices/new', icon: Plus, hint: 'Invoice' },
  { id: 'a-new-estimate', label: 'Create new estimate', url: '/estimates/new', icon: Plus, hint: 'Estimate' },
  { id: 'a-new-proposal', label: 'Create new proposal', url: '/proposals/new', icon: Plus, hint: 'Proposal' },
  { id: 'a-new-ticket', label: 'Create new ticket', url: '/tickets/new', icon: Plus, hint: 'Ticket' },
  { id: 'a-dashboard', label: 'View dashboard', url: '/dashboard', icon: LayoutDashboard },
  { id: 'a-inbox', label: 'Inbox', url: '/inbox', icon: Inbox },
  { id: 'a-settings', label: 'Settings', url: '/settings', icon: Settings },
];

// Mirrors the leaf entries (children with hrefs) in admin-sidebar.tsx -> useNavItems().
// If you change the sidebar nav, mirror it here.
const PAGES: ReadonlyArray<Omit<PaletteItem, 'section'>> = [
  { id: 'p-dashboard', label: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { id: 'p-inbox', label: 'Inbox', url: '/inbox', icon: Inbox },
  { id: 'p-clients', label: 'Clients', url: '/clients', icon: Building2 },
  { id: 'p-leads', label: 'Leads', url: '/leads', icon: UserCircle },
  { id: 'p-lead-forms', label: 'Lead forms', url: '/leads/forms', icon: ClipboardList },
  { id: 'p-proposals', label: 'Proposals', url: '/proposals', icon: FileCheck },
  { id: 'p-estimates', label: 'Estimates', url: '/estimates', icon: Calculator },
  { id: 'p-estimate-forms', label: 'Estimate request forms', url: '/estimates/forms', icon: ClipboardList },
  { id: 'p-invoices', label: 'Invoices', url: '/invoices', icon: FileText },
  { id: 'p-payments', label: 'Payments', url: '/payments', icon: CreditCard },
  { id: 'p-payments-batch', label: 'Batch record payment', url: '/payments/batch', icon: CreditCard },
  { id: 'p-credit-notes', label: 'Credit notes', url: '/credit-notes', icon: Receipt },
  { id: 'p-expenses', label: 'Expenses', url: '/expenses', icon: DollarSign },
  { id: 'p-subscriptions', label: 'Subscriptions', url: '/subscriptions', icon: Zap },
  { id: 'p-projects', label: 'Projects', url: '/projects', icon: FolderKanban },
  { id: 'p-timesheets', label: 'Timesheets', url: '/timesheets', icon: ClipboardList },
  { id: 'p-tasks', label: 'Tasks', url: '/tasks', icon: CheckSquare },
  { id: 'p-todos', label: 'Todos', url: '/todos', icon: ListTodo },
  { id: 'p-calendar', label: 'Calendar', url: '/calendar', icon: Calendar },
  { id: 'p-goals', label: 'Goals', url: '/goals', icon: Target },
  { id: 'p-newsfeed', label: 'Newsfeed', url: '/newsfeed', icon: MessageCircle },
  { id: 'p-tickets', label: 'Tickets', url: '/tickets', icon: Headphones },
  { id: 'p-chat', label: 'Live Chat', url: '/chat', icon: MessageCircle },
  { id: 'p-knowledge-base', label: 'Knowledge base', url: '/knowledge-base', icon: BookOpen },
  { id: 'p-appointments', label: 'Appointments', url: '/appointments', icon: CalendarCheck },
  { id: 'p-products', label: 'Products', url: '/products', icon: Package },
  { id: 'p-contracts', label: 'Contracts', url: '/contracts', icon: FileSignature },
  { id: 'p-vault', label: 'Vault', url: '/vault', icon: Lock },
  { id: 'p-surveys', label: 'Surveys', url: '/surveys', icon: ClipboardList },
  { id: 'p-announcements', label: 'Announcements', url: '/announcements', icon: Megaphone },
  { id: 'p-reports', label: 'Reports hub', url: '/reports', icon: BarChart3 },
  { id: 'p-reports-items', label: 'Report: Items', url: '/reports/items', icon: Package },
  { id: 'p-reports-payment-modes', label: 'Report: Payment modes', url: '/reports/payment-modes', icon: CreditCard },
  { id: 'p-reports-expenses', label: 'Report: Expenses by category', url: '/reports/expenses-by-category', icon: DollarSign },
  { id: 'p-activity', label: 'Activity log', url: '/activity', icon: Activity },
  { id: 'p-staff', label: 'Staff', url: '/staff', icon: Users },
  { id: 'p-roles', label: 'Roles', url: '/staff/roles', icon: Users },
  { id: 'p-settings', label: 'Settings: General', url: '/settings?tab=company', icon: Settings },
  { id: 'p-settings-email', label: 'Settings: Email', url: '/settings/email', icon: Settings },
  { id: 'p-settings-einvoice', label: 'Settings: E-Invoice', url: '/settings/einvoice', icon: Settings },
  { id: 'p-settings-gateways', label: 'Settings: Payment gateways', url: '/settings?tab=gateways', icon: CreditCard },
  { id: 'p-settings-custom-fields', label: 'Settings: Custom fields', url: '/settings/custom-fields', icon: FileText },
  { id: 'p-settings-tags', label: 'Settings: Tags', url: '/settings/tags', icon: Tag },
  { id: 'p-settings-saved-items', label: 'Settings: Saved items', url: '/settings/saved-items', icon: BookOpen },
  { id: 'p-settings-replies', label: 'Settings: Predefined replies', url: '/settings/predefined-replies', icon: FileCheck },
  { id: 'p-settings-spam', label: 'Settings: Spam filters', url: '/settings/spam-filters', icon: Settings },
  { id: 'p-settings-lead-statuses', label: 'Settings: Lead statuses', url: '/settings/lead-statuses', icon: Target },
  { id: 'p-settings-lead-sources', label: 'Settings: Lead sources', url: '/settings/lead-sources', icon: UserCircle },
  { id: 'p-settings-email-templates', label: 'Settings: Email templates', url: '/settings/email-templates', icon: FileCheck },
  { id: 'p-settings-payment-modes', label: 'Settings: Payment modes', url: '/settings/payment-modes', icon: CreditCard },
  { id: 'p-settings-expense-cats', label: 'Settings: Expense categories', url: '/settings/expense-categories', icon: DollarSign },
  { id: 'p-settings-automations', label: 'Settings: Automations', url: '/settings/automations', icon: Workflow },
  { id: 'p-settings-webhooks', label: 'Settings: Webhooks', url: '/settings/webhooks', icon: Webhook },
  { id: 'p-settings-api-keys', label: 'Settings: API keys', url: '/settings/api-keys', icon: Key },
  { id: 'p-settings-chat-widget', label: 'Settings: Chat widget', url: '/settings/chat-widget', icon: MessageCircle },
];

const RECORD_ICON: Record<string, LucideIcon> = {
  client: Building2,
  lead: UserCircle,
  invoice: FileText,
  ticket: Headphones,
  project: FolderKanban,
  staff: Users,
};

const RECORD_TYPE_LABEL: Record<string, string> = {
  client: 'Client',
  lead: 'Lead',
  invoice: 'Invoice',
  ticket: 'Ticket',
  project: 'Project',
  staff: 'Staff',
};

// --------------------------------------------------------------------------
// Hooks
// --------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

const MAX_VISIBLE = 12;
const MAX_RECORDS_PER_TYPE = 5;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<SearchApiResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const containerRef = useModalA11y(open, close);

  // Open on Cmd+K / Ctrl+K, and on a custom 'open-command-palette' window event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const onCustom = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onCustom as EventListener);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(
        'open-command-palette',
        onCustom as EventListener,
      );
    };
  }, []);

  // Reset on open and focus the input. The a11y hook focuses the first focusable
  // element which is the input, but we also explicitly select() so the user can
  // start typing immediately even if they re-opened with stale text.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRecords([]);
    setActiveIndex(0);
    setLoading(false);
    // Defer a tick so the modal mounts before we try to focus.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced live search.
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  useEffect(() => {
    if (!open) return;
    if (debouncedQuery.length < 2) {
      setRecords([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setRecords([]);
          return;
        }
        const data = await res.json().catch(() => null);
        setRecords(normalizeSearchResponse(data));
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  // Build the flat result list (in display order). Memoized so keyboard nav is stable.
  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchAction = (label: string) =>
      q.length === 0 || label.toLowerCase().includes(q);

    const actionItems: PaletteItem[] = ACTIONS.filter((a) =>
      matchAction(a.label),
    ).map((a) => ({ ...a, section: 'actions' }));

    // Records: cap at MAX_RECORDS_PER_TYPE per type, preserving server order.
    const perType: Record<string, number> = {};
    const recordItems: PaletteItem[] = [];
    for (const r of records) {
      perType[r.type] = (perType[r.type] ?? 0) + 1;
      if (perType[r.type] > MAX_RECORDS_PER_TYPE) continue;
      const Icon = RECORD_ICON[r.type] ?? Briefcase;
      const typeLabel = RECORD_TYPE_LABEL[r.type] ?? r.type;
      const sub = [typeLabel, r.subtitle].filter(Boolean).join(' \u00B7 ');
      recordItems.push({
        id: `r-${r.type}-${r.id}`,
        section: 'records',
        label: r.title || '(untitled)',
        sublabel: sub,
        url: r.url,
        icon: Icon,
        hint: typeLabel,
      });
    }

    const pageItems: PaletteItem[] = PAGES.filter((p) =>
      matchAction(p.label),
    ).map((p) => ({ ...p, section: 'pages' }));

    return [...actionItems, ...recordItems, ...pageItems];
  }, [query, records]);

  // Clamp activeIndex when the list shrinks.
  useEffect(() => {
    setActiveIndex((i) => {
      if (items.length === 0) return 0;
      return Math.min(i, items.length - 1);
    });
  }, [items.length]);

  // Scroll the active row into view when navigating with the keyboard.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const navigate = useCallback(
    (url: string) => {
      setOpen(false);
      router.push(url);
    },
    [router],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (items.length === 0 ? 0 : Math.min(i + 1, items.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) navigate(item.url);
      }
      // Escape is handled by useModalA11y.
    },
    [items, activeIndex, navigate],
  );

  if (!open) return null;

  // Group items for rendering (keep flat indices for keyboard nav).
  let flatIdx = -1;
  const groups: { key: Section; title: string; rows: { item: PaletteItem; idx: number }[] }[] = [];
  for (const section of ['actions', 'records', 'pages'] as Section[]) {
    const rows: { item: PaletteItem; idx: number }[] = [];
    for (const item of items) {
      if (item.section !== section) continue;
      flatIdx++;
      rows.push({ item, idx: flatIdx });
    }
    if (rows.length === 0) continue;
    groups.push({
      key: section,
      title:
        section === 'actions' ? 'Actions' : section === 'records' ? 'Records' : 'Pages',
      rows,
    });
  }

  // Approx row height ~52px → cap visible at MAX_VISIBLE * 52 = 624px.
  const maxListHeight = `${MAX_VISIBLE * 52}px`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[14vh] px-4"
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={close}
      />

      {/* Card */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-[640px] bg-white dark:bg-[rgb(24,24,32)] rounded-2xl shadow-2xl border border-gray-200 dark:border-[rgb(45,45,58)] overflow-hidden"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-[rgb(45,45,58)]">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={'Type to search records or commands\u2026'}
            aria-label="Search records or commands"
            aria-controls="command-palette-results"
            aria-activedescendant={
              items[activeIndex] ? `cmdk-row-${items[activeIndex].id}` : undefined
            }
            className="flex-1 text-sm bg-transparent outline-none text-gray-900 placeholder-gray-400 dark:text-gray-100"
          />
          {loading && (
            <Loader2
              className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0"
              aria-label="Searching"
            />
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-[rgb(45,45,58)] rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          className="overflow-y-auto"
          style={{ maxHeight: maxListHeight }}
        >
          {groups.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              {debouncedQuery.length >= 2 && !loading
                ? `No matches for \u201C${debouncedQuery}\u201D`
                : 'Type to search\u2026'}

            </div>
          )}

          {groups.map((group) => (
            <div key={group.key}>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-[rgb(18,18,24)] sticky top-0">
                {group.title}
              </div>
              {group.rows.map(({ item, idx }) => {
                const isActive = idx === activeIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    id={`cmdk-row-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => navigate(item.url)}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[rgb(35,35,48)]',
                    ].join(' ')}
                  >
                    <Icon
                      className={[
                        'w-4 h-4 flex-shrink-0',
                        isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.label}</div>
                      {item.sublabel && (
                        <div className="text-xs text-gray-400 truncate">
                          {item.sublabel}
                        </div>
                      )}
                    </div>
                    {item.hint && (
                      <span className="hidden sm:inline-flex text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 dark:bg-[rgb(45,45,58)] rounded px-1.5 py-0.5 flex-shrink-0">
                        {item.hint}
                      </span>
                    )}
                    {isActive && (
                      <ArrowRight
                        className="w-3.5 h-3.5 text-primary flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-[rgb(45,45,58)] flex items-center gap-4 text-[10px] text-gray-400">
          <span>
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[rgb(45,45,58)] rounded">
              {'\u2191\u2193'}
            </kbd>{' '}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[rgb(45,45,58)] rounded">
              Enter
            </kbd>{' '}
            select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[rgb(45,45,58)] rounded">
              Esc
            </kbd>{' '}
            close
          </span>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * The /api/v1/search endpoint currently returns `{ results: [{ type, id, title, subtitle?, url }] }`,
 * but to stay resilient to future shape changes (e.g. a grouped `{ leads: [...], clients: [...] }`
 * variant) we accept either. Anything we can't recognize is ignored silently.
 */
function normalizeSearchResponse(data: unknown): SearchApiResult[] {
  if (!data || typeof data !== 'object') return [];

  // Shape A: { results: [...] }
  const flat = (data as { results?: unknown }).results;
  if (Array.isArray(flat)) {
    return flat.filter(isSearchResult);
  }

  // Shape B: { leads: [...], clients: [...], invoices: [...], ... }
  // Map known keys → record type. Tries to be tolerant: only keeps rows that
  // already provide id+title (and synthesize a url if the server omits one).
  const out: SearchApiResult[] = [];
  const known: Record<string, string> = {
    leads: 'lead',
    clients: 'client',
    invoices: 'invoice',
    tickets: 'ticket',
    projects: 'project',
    staff: 'staff',
    contacts: 'staff',
  };
  for (const [key, type] of Object.entries(known)) {
    const arr = (data as Record<string, unknown>)[key];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : undefined;
      if (!id) continue;
      const title =
        typeof r.title === 'string'
          ? r.title
          : typeof r.name === 'string'
            ? r.name
            : typeof r.company === 'string'
              ? r.company
              : typeof r.subject === 'string'
                ? r.subject
                : typeof r.number === 'string'
                  ? `Invoice ${r.number}`
                  : undefined;
      if (!title) continue;
      const subtitle =
        typeof r.subtitle === 'string'
          ? r.subtitle
          : typeof r.email === 'string'
            ? r.email
            : typeof r.status === 'string'
              ? r.status
              : undefined;
      const url =
        typeof r.url === 'string' ? r.url : `/${pluralUrlBase(type)}/${id}`;
      out.push({ type, id, title, subtitle, url });
    }
  }
  return out;
}

function isSearchResult(x: unknown): x is SearchApiResult {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.type === 'string' &&
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.url === 'string'
  );
}

function pluralUrlBase(type: string): string {
  switch (type) {
    case 'client':
      return 'clients';
    case 'lead':
      return 'leads';
    case 'invoice':
      return 'invoices';
    case 'ticket':
      return 'tickets';
    case 'project':
      return 'projects';
    case 'staff':
      return 'staff';
    default:
      return type + 's';
  }
}

export default CommandPalette;
