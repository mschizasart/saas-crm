import Link from 'next/link';
import {
  ArrowRight,
  Users,
  Target,
  FileText,
  Receipt,
  FolderKanban,
  Clock,
  LifeBuoy,
  Package,
  BarChart3,
  Mail,
  Shield,
  Zap,
  Globe,
  CreditCard,
  Layers,
  MessageSquare,
  Upload,
  LayoutDashboard,
  Moon,
  CheckCircle2,
} from 'lucide-react';

export const metadata = {
  title: 'Appoinly CRM — Everything your team needs to run the business',
  description:
    'Multi-tenant SaaS CRM: sales pipeline, invoicing, projects, support, inventory, reports — and more.',
};

const PILLARS: Array<{ icon: React.ReactNode; title: string; blurb: string }> = [
  {
    icon: <Target className="w-6 h-6" />,
    title: 'Sales pipeline',
    blurb: 'Capture leads, qualify, and win — without spreadsheet chaos.',
  },
  {
    icon: <Receipt className="w-6 h-6" />,
    title: 'Billing that pays',
    blurb: 'Invoices, subscriptions, credit notes, and online payments built in.',
  },
  {
    icon: <FolderKanban className="w-6 h-6" />,
    title: 'Projects that ship',
    blurb: 'Projects, tasks, milestones, and time tracking in one place.',
  },
  {
    icon: <LifeBuoy className="w-6 h-6" />,
    title: 'Support your customers',
    blurb: 'Tickets, portal, and a clear record of every interaction.',
  },
];

interface Feature {
  icon: React.ReactNode;
  title: string;
  items: string[];
}

const FEATURES: Feature[] = [
  {
    icon: <Target className="w-5 h-5" />,
    title: 'Leads & sales',
    items: [
      'Kanban pipeline with drag-to-move stages',
      'Web-to-lead forms with iframe embed',
      'Lead sources, assignees, status tracking',
      'Convert leads to clients in one click',
    ],
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: 'Clients & contacts',
    items: [
      'Unlimited clients per tenant',
      'Per-client portal access',
      'Custom contacts with roles',
      'CSV import for bulk onboarding',
    ],
  },
  {
    icon: <FileText className="w-5 h-5" />,
    title: 'Proposals & estimates',
    items: [
      'Rich proposal editor',
      'Bulk status changes',
      'Estimate → invoice conversion',
      'PDF export',
    ],
  },
  {
    icon: <Receipt className="w-5 h-5" />,
    title: 'Invoicing & billing',
    items: [
      'One-off and recurring invoices',
      'Credit notes & apply-to-invoice',
      'Bulk PDF, bulk status, bulk merge',
      'Stripe & PayPal checkout',
    ],
  },
  {
    icon: <Layers className="w-5 h-5" />,
    title: 'Contracts',
    items: [
      'Contract templates',
      'Signature & acceptance flow',
      'Linked to clients and projects',
      'Renewal tracking',
    ],
  },
  {
    icon: <FolderKanban className="w-5 h-5" />,
    title: 'Projects & tasks',
    items: [
      'Project timelines with milestones',
      'Task assignments and deadlines',
      'Time tracking per task',
      'Project-level expenses',
    ],
  },
  {
    icon: <Clock className="w-5 h-5" />,
    title: 'Time tracking',
    items: [
      'Timer & manual entries',
      'Per-user timesheets',
      'Billable vs non-billable',
      'Roll into invoices',
    ],
  },
  {
    icon: <LifeBuoy className="w-5 h-5" />,
    title: 'Support tickets',
    items: [
      'Inbound ticket creation',
      'Status, priority, assignee',
      'Client portal replies',
      'Canned response patterns',
    ],
  },
  {
    icon: <Package className="w-5 h-5" />,
    title: 'Products & inventory',
    items: [
      'Product catalog',
      'Stock movements & adjustments',
      'Low-stock alerts',
      'Auto-decrement on invoice sent',
    ],
  },
  {
    icon: <BarChart3 className="w-5 h-5" />,
    title: 'Reports',
    items: [
      'Sales, leads, clients, tickets',
      'Items & payment-modes breakdown',
      'Profit & loss, income vs expense',
      'CSV export',
    ],
  },
  {
    icon: <Mail className="w-5 h-5" />,
    title: 'Email & communications',
    items: [
      'Per-tenant SMTP settings',
      'Encrypted credential storage',
      'Send test emails from UI',
      'Automated lead form notifications',
    ],
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: 'Team & permissions',
    items: [
      'Role-based access (RBAC)',
      'Per-user permission overrides',
      'Audit trail of actions',
      'Staff management',
    ],
  },
];

const EXTRAS: Array<{ icon: React.ReactNode; label: string }> = [
  { icon: <Upload className="w-4 h-4" />, label: 'CSV import' },
  { icon: <Globe className="w-4 h-4" />, label: 'Multi-tenant' },
  { icon: <Moon className="w-4 h-4" />, label: 'Dark mode' },
  { icon: <LayoutDashboard className="w-4 h-4" />, label: 'Modern UI' },
  { icon: <MessageSquare className="w-4 h-4" />, label: 'Client portal' },
  { icon: <CreditCard className="w-4 h-4" />, label: 'Online payments' },
  { icon: <Zap className="w-4 h-4" />, label: 'Real-time updates' },
  { icon: <CheckCircle2 className="w-4 h-4" />, label: 'RLS-isolated data' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center text-sm font-bold">A</span>
            <span className="text-lg">Appoinly CRM</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-gray-600 dark:text-gray-400 hover:text-primary hidden md:inline">
              Features
            </a>
            <a href="#logins" className="text-gray-600 dark:text-gray-400 hover:text-primary hidden md:inline">
              Sign in
            </a>
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-medium transition-colors"
            >
              Open CRM
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-6">
          <Zap className="w-3.5 h-3.5" />
          Everything your team needs, in one place
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 max-w-4xl mx-auto">
          Run your whole business from{' '}
          <span className="text-primary">one CRM</span>.
        </h1>
        <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10">
          Leads, proposals, invoices, projects, tickets, inventory, reports —
          every workflow you had spread across five tools, unified and multi-tenant.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-medium transition-colors"
          >
            Open the CRM <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#features"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 font-medium transition-colors"
          >
            See features
          </a>
        </div>

        {/* Extras chip row */}
        <div className="mt-12 flex items-center justify-center gap-2 flex-wrap">
          {EXTRAS.map((e) => (
            <span
              key={e.label}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300"
            >
              {e.icon}
              {e.label}
            </span>
          ))}
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                {p.icon}
              </div>
              <h3 className="font-semibold text-lg mb-2">{p.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{p.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Every feature, already shipped</h2>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Not a roadmap. Not an early-access beta. Everything below works today, per tenant, in production.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  {f.icon}
                </div>
                <h3 className="font-semibold">{f.title}</h3>
              </div>
              <ul className="space-y-2">
                {f.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Logins */}
      <section id="logins" className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Sign in</h2>
          <p className="text-gray-600 dark:text-gray-400">Three doors for three audiences.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          <Link
            href="/login"
            className="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary hover:shadow-lg transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <LayoutDashboard className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-1">Staff</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Day-to-day CRM for your team.
            </p>
            <span className="text-sm text-primary font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              /login <ArrowRight className="w-4 h-4" />
            </span>
          </Link>

          <Link
            href="/portal/login"
            className="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary hover:shadow-lg transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-1">Client portal</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Where your customers see their invoices and tickets.
            </p>
            <span className="text-sm text-primary font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              /portal/login <ArrowRight className="w-4 h-4" />
            </span>
          </Link>

          <Link
            href="/platform/login"
            className="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary hover:shadow-lg transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-1">Platform admin</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Manage tenants across the SaaS.
            </p>
            <span className="text-sm text-primary font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              /platform/login <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="p-10 md:p-14 rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to run it?</h2>
          <p className="text-white/90 mb-8 max-w-xl mx-auto">
            Your tenant is provisioned, the database is waiting. Open the CRM and start moving.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-primary font-medium hover:bg-white/95 transition-colors"
          >
            Open the CRM <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 flex-wrap gap-4">
          <span>© {new Date().getFullYear()} Appoinly CRM</span>
          <div className="flex items-center gap-6">
            <Link href="/privacy-policy" className="hover:text-primary">Privacy</Link>
            <Link href="/terms-of-service" className="hover:text-primary">Terms</Link>
            <Link href="/login" className="hover:text-primary">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
