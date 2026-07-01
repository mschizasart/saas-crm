'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, UserCircle, FileText, Calculator,
  FileCheck, CreditCard, DollarSign, FolderKanban, CheckSquare,
  Headphones, BookOpen, FileSignature, Receipt, Target,
  BarChart3, Settings, Bell, Building2, Zap, ClipboardList,
  ChevronDown, ChevronRight, ListTodo, Calendar, Megaphone,
  Activity, Tag, Lock, MessageCircle, MessageSquare, Workflow, Webhook, Key, CalendarCheck, Package, X, FileCode,
  ShieldX, Inbox, KeyRound, Sparkles, Clock, Mail,
  Briefcase, TrendingUp, ShieldCheck, Map, AtSign,
  Wrench, Truck, Upload, Phone, Copy, Code,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useI18n } from '@/lib/i18n/use-i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { Moon, Sun, Monitor, Search, Palette } from 'lucide-react';
import { OrgSwitcher } from '@/components/org-switcher';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface NotifPreview {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifPreview[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const token = () =>
    typeof window === 'undefined' ? null : localStorage.getItem('access_token');

  const loadCount = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count ?? 0);
    } catch {
      /* ignore */
    }
  };

  const loadList = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/notifications?limit=10`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.data ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (notif: NotifPreview) => {
      setCount((c) => c + 1);
      setItems((prev) => [notif, ...prev].slice(0, 10));
    };
    socket.on('notification', handler);
    return () => {
      socket.off('notification', handler);
    };
  }, []);

  useEffect(() => {
    if (open) loadList();
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] bg-red-500 text-white rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg shadow-lg border border-gray-100 dark:border-gray-800 z-50 max-h-96 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            <Link href="/notifications" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-xs text-gray-400 dark:text-gray-500 text-center">No notifications</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-3 py-2 border-b border-gray-50 dark:border-gray-800 text-xs ${
                    n.read ? '' : 'bg-primary/5'
                  }`}
                >
                  <p className="font-medium">{n.title}</p>
                  {n.description && <p className="text-gray-500 dark:text-gray-400 mt-0.5">{n.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  children?: NavItem[];
  badge?: string;
}

/**
 * Pulls the unread inbox count once on mount and on a 60s interval.
 * Stays silent on errors — the badge just won't render.
 */
function useInboxUnreadCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const token = () =>
      typeof window === 'undefined' ? null : localStorage.getItem('access_token');

    const load = async () => {
      try {
        const t = token();
        if (!t) return;
        // The list endpoint doesn't expose an unread-only count, so we
        // approximate by counting unread rows on the first page (cap 50).
        // v2: add a dedicated /inbox/unread-count endpoint for accuracy.
        const res = await fetch(
          `${API_BASE}/api/v1/inbox?isArchived=false&limit=50`,
          { headers: { Authorization: `Bearer ${t}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          const unread = data.data.filter(
            (m: { isRead?: boolean }) => !m.isRead,
          ).length;
          setCount(unread);
        }
      } catch {
        /* silent */
      }
    };

    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return count;
}

/**
 * Pulls the count of approval requests currently pending the logged-in
 * user (Wave E1). Mirrors `useInboxUnreadCount` — silent on errors so
 * the badge just won't render. Polls every 60s; could be socket-driven
 * once the approvals push channel lands.
 */
function useApprovalsPendingCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const token = () =>
      typeof window === 'undefined' ? null : localStorage.getItem('access_token');

    const load = async () => {
      try {
        const t = token();
        if (!t) return;
        const res = await fetch(
          `${API_BASE}/api/v1/approval-requests/my-pending`,
          { headers: { Authorization: `Bearer ${t}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.total === 'number') setCount(data.total);
      } catch {
        /* silent */
      }
    };

    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return count;
}

/**
 * Pulls the count of recent un-stamped mentions for the logged-in user
 * (Wave G3 — Chatter feed). Same shape as `useInboxUnreadCount`: silent
 * on errors so the badge just won't render. Uses limit=1 because we
 * only need the `total` count off the paged response.
 *
 * v2: the API already stamps `notifiedAt` after delivering the
 * notification; once we add an `onlyUnread` query param to
 * `/feed/mentions/my` we can drop the static "1" badge in favour of a
 * real unread count. For now we just light the badge if there are ANY
 * mentions in the inbox.
 */
function useMyMentionsCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const token = () =>
      typeof window === 'undefined' ? null : localStorage.getItem('access_token');

    const load = async () => {
      try {
        const t = token();
        if (!t) return;
        const res = await fetch(
          `${API_BASE}/api/v1/feed/mentions/my?limit=1`,
          { headers: { Authorization: `Bearer ${t}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.total === 'number') setCount(data.total);
      } catch {
        /* silent */
      }
    };

    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return count;
}

function useNavItems(): NavItem[] {
  const { t } = useI18n();
  const inboxUnread = useInboxUnreadCount();
  const approvalsPending = useApprovalsPendingCount();
  const mentionsCount = useMyMentionsCount();
  return [
    { label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
    {
      label: 'Inbox',
      href: '/inbox',
      icon: Inbox,
      badge: inboxUnread > 0 ? (inboxUnread > 99 ? '99+' : String(inboxUnread)) : undefined,
    },
    {
      label: 'Approvals',
      href: '/approvals',
      icon: ShieldCheck,
      badge:
        approvalsPending > 0
          ? approvalsPending > 99 ? '99+' : String(approvalsPending)
          : undefined,
    },
    // Wave G3 — Chatter-style feed mentions inbox.
    {
      label: 'My Mentions',
      href: '/feed/mentions',
      icon: AtSign,
      badge:
        mentionsCount > 0
          ? mentionsCount > 99 ? '99+' : String(mentionsCount)
          : undefined,
    },
    {
      label: t('nav.sales'),
      icon: DollarSign,
      children: [
        { label: t('nav.clients'), href: '/clients', icon: Building2 },
        {
          label: t('nav.leads'),
          icon: UserCircle,
          children: [
            { label: 'All leads', href: '/leads', icon: UserCircle },
            { label: 'Forms', href: '/leads/forms', icon: ClipboardList },
          ],
        },
        // Duplicate detection + record merge (leads + clients)
        { label: 'Duplicates', href: '/duplicates', icon: Copy },
        // Opportunities + Forecasts — Wave D1
        { label: 'Opportunities', href: '/opportunities', icon: Briefcase },
        { label: 'Forecasts', href: '/forecasts', icon: TrendingUp },
        // Quotes (CPQ) — Wave F2
        { label: 'Quotes', href: '/quotes', icon: FileCheck },
        { label: t('nav.proposals'), href: '/proposals', icon: FileCheck },
        {
          label: t('nav.estimates'),
          icon: Calculator,
          children: [
            { label: 'All estimates', href: '/estimates', icon: Calculator },
            { label: 'Request forms', href: '/estimates/forms', icon: ClipboardList },
          ],
        },
        { label: t('nav.invoices'), href: '/invoices', icon: FileText },
        {
          label: t('nav.payments'),
          icon: CreditCard,
          children: [
            { label: 'All payments', href: '/payments', icon: CreditCard },
            { label: 'Batch record', href: '/payments/batch', icon: CreditCard },
          ],
        },
        { label: t('nav.creditNotes'), href: '/credit-notes', icon: Receipt },
        { label: t('nav.expenses'), href: '/expenses', icon: DollarSign },
        { label: t('nav.subscriptions'), href: '/subscriptions', icon: Zap },
        // Wave H1 — Field Service (work orders + dispatch).
        // Service businesses dispatch technicians on-site; WOs live
        // alongside the rest of the post-sale workflow (invoices,
        // subscriptions) because completed WOs feed into billing.
        { label: 'Work Orders', href: '/work-orders', icon: Wrench },
        { label: 'Dispatch', href: '/dispatch', icon: Truck },
      ],
    },
    {
      label: t('nav.projects'),
      icon: FolderKanban,
      children: [
        { label: t('nav.allProjects'), href: '/projects', icon: FolderKanban },
        { label: t('nav.timesheets'), href: '/timesheets', icon: ClipboardList },
      ],
    },
    {
      label: t('nav.productivity'),
      icon: CheckSquare,
      children: [
        { label: t('nav.tasks'), href: '/tasks', icon: CheckSquare },
        { label: t('nav.todos'), href: '/todos', icon: ListTodo },
        { label: t('nav.calendar'), href: '/calendar', icon: Calendar },
        { label: t('nav.goals'), href: '/goals', icon: Target },
        { label: t('nav.timesheets'), href: '/timesheets', icon: ClipboardList },
        { label: t('nav.newsfeed'), href: '/newsfeed', icon: MessageCircle },
      ],
    },
    {
      label: t('nav.support'),
      icon: Headphones,
      children: [
        { label: t('nav.tickets'), href: '/tickets', icon: Headphones },
        { label: 'Calls', href: '/calls', icon: Phone },
        { label: 'Live Chat', href: '/chat', icon: MessageCircle },
        { label: t('nav.knowledgeBase'), href: '/knowledge-base', icon: BookOpen },
      ],
    },
    { label: 'Appointments', href: '/appointments', icon: CalendarCheck },
    {
      label: 'Products',
      icon: Package,
      children: [
        { label: 'All products', href: '/products', icon: Package },
        { label: 'Low stock', href: '/products?tab=low-stock', icon: Package },
      ],
    },
    { label: t('nav.contracts'), href: '/contracts', icon: FileSignature },
    { label: t('nav.vault'), href: '/vault', icon: Lock },
    {
      label: t('nav.marketing'),
      icon: Megaphone,
      children: [
        { label: 'Campaigns', href: '/campaigns', icon: Mail },
        { label: 'Sequences', href: '/sequences', icon: Workflow },
        { label: t('nav.surveys'), href: '/surveys', icon: ClipboardList },
        { label: t('nav.announcements'), href: '/announcements', icon: Megaphone },
        { label: t('nav.knowledgeBase'), href: '/knowledge-base', icon: BookOpen },
      ],
    },
    {
      label: t('nav.reports'),
      icon: BarChart3,
      children: [
        { label: t('nav.reportsHub'), href: '/reports', icon: BarChart3 },
        // Wave D2 — saved report-definitions builder + dashboards composer
        { label: 'Report Builder', href: '/reports/builder', icon: FileCode },
        { label: 'Dashboards', href: '/dashboards', icon: LayoutDashboard },
        { label: 'Items', href: '/reports/items', icon: Package },
        { label: 'Payment modes', href: '/reports/payment-modes', icon: CreditCard },
        { label: 'Expenses by Category', href: '/reports/expenses-by-category', icon: DollarSign },
        { label: t('nav.activityLog'), href: '/activity', icon: Activity },
      ],
    },
    {
      label: t('nav.admin'),
      icon: Users,
      children: [
        { label: t('nav.staff'), href: '/staff', icon: Users },
        { label: t('nav.roles'), href: '/staff/roles', icon: Users },
      ],
    },
    {
      label: t('nav.settings'),
      icon: Settings,
      children: [
        { label: t('nav.general'), href: '/settings?tab=company', icon: Settings },
        { label: 'Organizations', href: '/settings/organizations', icon: Building2 },
        { label: 'Security', href: '/settings/security', icon: KeyRound },
        { label: 'Notifications', href: '/settings/notifications', icon: Bell },
        { label: t('nav.email'), href: '/settings/email', icon: Bell },
        { label: 'Email Add-in', href: '/settings/email-integration', icon: Mail },
        { label: 'AI', href: '/settings/ai', icon: Sparkles },
        { label: 'Tax', href: '/settings/tax', icon: Receipt },
        { label: 'SMS', href: '/settings/sms', icon: MessageSquare },
        { label: 'Payment reminders', href: '/settings/dunning', icon: Clock },
        // Wave F3 — Multi-currency + daily FX rates
        { label: 'Currencies & FX', href: '/settings/fx', icon: DollarSign },
        { label: 'E-Invoice', href: '/settings/einvoice', icon: FileCode },
        { label: 'Branding', href: '/settings/branding', icon: Palette },
        { label: t('nav.paymentGateways'), href: '/settings?tab=gateways', icon: CreditCard },
        { label: t('nav.customFields'), href: '/settings/custom-fields', icon: FileText },
        { label: 'Booking Pages', href: '/settings/booking-pages', icon: CalendarCheck },
        { label: 'Validation Rules', href: '/settings/validation-rules', icon: ShieldCheck },
        { label: 'Custom Objects', href: '/settings/custom-objects', icon: Package },
        // Wave E2 — field history / audit trail
        { label: 'Audit Trail', href: '/audit', icon: Activity },
        { label: t('nav.tags'), href: '/settings/tags', icon: Tag },
        { label: t('nav.roles'), href: '/staff/roles', icon: Users },
        { label: t('nav.savedItems'), href: '/settings/saved-items', icon: BookOpen },
        { label: t('nav.predefinedReplies'), href: '/settings/predefined-replies', icon: FileCheck },
        { label: 'Spam filters', href: '/settings/spam-filters', icon: ShieldX },
        { label: t('nav.leadStatuses'), href: '/settings/lead-statuses', icon: Target },
        { label: t('nav.leadSources'), href: '/settings/lead-sources', icon: UserCircle },
        // Pipelines (opportunity stages) — Wave D1
        { label: 'Pipelines', href: '/settings/pipelines', icon: Briefcase },
        // Territories — Wave G2
        { label: 'Territories', href: '/settings/territories', icon: Map },
        // Team Hierarchy — Wave G1 (drives hierarchical record sharing)
        { label: 'Team Hierarchy', href: '/settings/team-hierarchy', icon: Users },
        // Product Bundles (CPQ catalog) — Wave F2
        { label: 'Product Bundles', href: '/settings/product-bundles', icon: Package },
        // Approval Processes — Wave E1
        { label: 'Approval Processes', href: '/settings/approval-processes', icon: ShieldCheck },
        { label: t('nav.emailTemplates'), href: '/settings/email-templates', icon: FileCheck },
        { label: t('nav.paymentModes'), href: '/settings/payment-modes', icon: CreditCard },
        { label: 'Expense Categories', href: '/settings/expense-categories', icon: DollarSign },
        { label: 'Automations', href: '/settings/automations', icon: Workflow },
        { label: 'Webhooks', href: '/settings/webhooks', icon: Webhook },
        { label: 'API Keys', href: '/settings/api-keys', icon: Key },
        { label: 'Developers', href: '/settings/developers', icon: Code },
        // Wave E3 — public REST API surface (scoped keys + signed
        // outbound webhooks with retry). Distinct from the legacy
        // 'API Keys' / 'Webhooks' entries above, which power the simple
        // in-app integrations console.
        { label: 'API & Webhooks', href: '/settings/api', icon: Webhook },
        { label: 'Chat Widget', href: '/settings/chat-widget', icon: MessageCircle },
        // Wave H2 — Einstein Activity Capture toggles + backfill.
        { label: 'Activity Capture', href: '/settings/activity-capture', icon: Activity },
        // Wave H3 — Bulk API + CSV import. Primary entry is the
        // history list page (which has a "+ New CSV import" CTA
        // that navigates to the upload form).
        { label: 'Bulk Imports', href: '/bulk/imports', icon: Upload },
      ],
    },
  ];
}

function NavItemRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => {
    // Auto-open parent if a child is active
    return item.children?.some((c) => c.href && pathname.startsWith(c.href)) ?? false;
  });

  const isActive = item.href ? pathname === item.href || pathname.startsWith(item.href + '/') : false;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
            'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent',
            depth > 0 && 'pl-8',
          )}
        >
          <item.icon className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {open ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
        {open && (
          <div className="mt-0.5 space-y-0.5">
            {item.children.map((child) => (
              <NavItemRow key={child.label} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href!}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent',
        depth > 0 && 'pl-8',
      )}
    >
      <item.icon className="w-4 h-4 flex-shrink-0" />
      <span>{item.label}</span>
      {item.badge && (
        <span className="ml-auto text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function AdminSidebar({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const navItems = useNavItems();
  const { theme, setTheme } = useTheme();

  const themeOrder: Theme[] = ['light', 'dark', 'system'];
  const themeLabel: Record<Theme, string> = {
    light: 'Light Mode',
    dark: 'Dark Mode',
    system: 'System Theme',
  };
  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme);
    const next = themeOrder[(idx + 1) % themeOrder.length];
    setTheme(next);
  };
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-screen overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-sidebar-border">
        <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-sidebar-foreground flex-1">AppoinlyCRM</span>
        <NotificationBell />
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search hint — opens the global Cmd-K command palette (see components/ui/command-palette.tsx) */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={() => {
            window.dispatchEvent(new Event('open-command-palette'));
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors border border-sidebar-border"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] px-1 py-0.5 rounded bg-sidebar-accent text-sidebar-foreground/40">
            {typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '\u2318' : 'Ctrl+'}K
          </kbd>
        </button>
      </div>

      {/* Org switcher \u2014 renders nothing for single-org users */}
      <div className="px-3 pb-1">
        <OrgSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => (
          <NavItemRow key={item.label} item={item} />
        ))}
      </nav>

      {/* Bottom bar: dark mode toggle + trial */}
      <div className="px-3 pb-4 space-y-3">
        {/* Theme toggle — cycles light → dark → system */}
        <button
          onClick={cycleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          title={`Theme: ${themeLabel[theme]} (click to switch)`}
          aria-label={`Switch theme (current: ${themeLabel[theme]})`}
        >
          <ThemeIcon className="w-4 h-4" />
          <span>{themeLabel[theme]}</span>
        </button>

        {/* Trial banner */}
        <div className="bg-sidebar-accent rounded-lg p-3">
          <p className="text-xs font-medium text-sidebar-foreground">{t('trial.daysLeft')}</p>
          <p className="text-xs text-sidebar-foreground/60 mt-0.5">{t('trial.upgradeMessage')}</p>
          <Link
            href="/billing"
            className="mt-2 block text-center py-1.5 bg-primary text-white text-xs rounded-md hover:bg-primary/90"
          >
            {t('trial.upgradeNow')}
          </Link>
        </div>
      </div>
    </aside>
  );
}
