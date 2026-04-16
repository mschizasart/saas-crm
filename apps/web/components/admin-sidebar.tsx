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
  Activity, Tag, Lock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useI18n } from '@/lib/i18n/use-i18n';

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
        <div className="absolute left-0 top-full mt-2 w-72 bg-white text-gray-900 rounded-lg shadow-lg border border-gray-100 z-50 max-h-96 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            <Link href="/notifications" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-xs text-gray-400 text-center">No notifications</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-3 py-2 border-b border-gray-50 text-xs ${
                    n.read ? '' : 'bg-primary/5'
                  }`}
                >
                  <p className="font-medium">{n.title}</p>
                  {n.description && <p className="text-gray-500 mt-0.5">{n.description}</p>}
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

function useNavItems(): NavItem[] {
  const { t } = useI18n();
  return [
    { label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
    {
      label: t('nav.sales'),
      icon: DollarSign,
      children: [
        { label: t('nav.clients'), href: '/clients', icon: Building2 },
        { label: t('nav.leads'), href: '/leads', icon: UserCircle },
        { label: t('nav.proposals'), href: '/proposals', icon: FileCheck },
        { label: t('nav.estimates'), href: '/estimates', icon: Calculator },
        { label: t('nav.invoices'), href: '/invoices', icon: FileText },
        { label: t('nav.payments'), href: '/payments', icon: CreditCard },
        { label: t('nav.creditNotes'), href: '/credit-notes', icon: Receipt },
        { label: t('nav.expenses'), href: '/expenses', icon: DollarSign },
        { label: t('nav.subscriptions'), href: '/subscriptions', icon: Zap },
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
      ],
    },
    {
      label: t('nav.support'),
      icon: Headphones,
      children: [
        { label: t('nav.tickets'), href: '/tickets', icon: Headphones },
        { label: t('nav.knowledgeBase'), href: '/knowledge-base', icon: BookOpen },
      ],
    },
    { label: t('nav.contracts'), href: '/contracts', icon: FileSignature },
    { label: t('nav.vault'), href: '/vault', icon: Lock },
    {
      label: t('nav.marketing'),
      icon: Megaphone,
      children: [
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
        { label: t('nav.general'), href: '/settings/general', icon: Settings },
        { label: t('nav.email'), href: '/settings/email', icon: Bell },
        { label: t('nav.paymentGateways'), href: '/settings/payments', icon: CreditCard },
        { label: t('nav.customFields'), href: '/settings/custom-fields', icon: FileText },
        { label: t('nav.tags'), href: '/settings/tags', icon: Tag },
        { label: t('nav.roles'), href: '/settings/roles', icon: Users },
        { label: t('nav.savedItems'), href: '/settings/saved-items', icon: BookOpen },
        { label: t('nav.predefinedReplies'), href: '/settings/predefined-replies', icon: FileCheck },
        { label: t('nav.leadStatuses'), href: '/settings/lead-statuses', icon: Target },
        { label: t('nav.leadSources'), href: '/settings/lead-sources', icon: UserCircle },
        { label: t('nav.emailTemplates'), href: '/settings/email-templates', icon: FileCheck },
        { label: t('nav.paymentModes'), href: '/settings/payment-modes', icon: CreditCard },
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

export function AdminSidebar() {
  const { t } = useI18n();
  const navItems = useNavItems();

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-screen overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-sidebar-border">
        <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-sidebar-foreground flex-1">AppoinlyCRM</span>
        <NotificationBell />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => (
          <NavItemRow key={item.label} item={item} />
        ))}
      </nav>

      {/* Trial banner */}
      <div className="px-3 pb-4">
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
