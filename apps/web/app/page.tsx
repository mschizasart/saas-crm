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
  Sparkles,
  Inbox,
  KeyRound,
  Command,
  FileSignature,
  Workflow,
  Search,
  Building2,
  Palette,
  Percent,
  Calculator,
  ChevronDown,
} from 'lucide-react';

export const metadata = {
  title: 'Appoinly CRM — The all-in-one CRM for modern service businesses',
  description:
    'Sales pipeline, invoicing, projects, support, inventory, e-signatures, AI, multi-tenant, white-label — everything your team needs in one place.',
};

// Stable Unsplash CDN photos (decorative; layout holds if any fail to load).
const IMG = {
  hero: 'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1400&q=80',
  sales:
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1000&q=80',
  team: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1000&q=80',
  ai: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1000&q=80',
  support:
    'https://images.unsplash.com/photo-1556745757-8d76bdb6984b?auto=format&fit=crop&w=1000&q=80',
};

const PILLARS: Array<{ icon: React.ReactNode; title: string; blurb: string }> = [
  {
    icon: <Target className="w-6 h-6" />,
    title: 'Sales pipeline',
    blurb: 'Capture leads, score them with AI, qualify, and win — no spreadsheet chaos.',
  },
  {
    icon: <Receipt className="w-6 h-6" />,
    title: 'Billing that pays',
    blurb: 'Invoices, subscriptions, credit notes, automatic tax, online payments.',
  },
  {
    icon: <FolderKanban className="w-6 h-6" />,
    title: 'Projects that ship',
    blurb: 'Projects, tasks, milestones, and time tracking in one place.',
  },
  {
    icon: <LifeBuoy className="w-6 h-6" />,
    title: 'Support your customers',
    blurb: 'Tickets, SMS, a client portal, and a record of every interaction.',
  },
];

interface FeatureGroup {
  icon: React.ReactNode;
  title: string;
  image: string;
  blurb: string;
  items: string[];
}

const GROUPS: FeatureGroup[] = [
  {
    icon: <Target className="w-5 h-5" />,
    title: 'Sales & CRM',
    image: IMG.sales,
    blurb: 'From first touch to closed-won, all tracked.',
    items: [
      'Kanban lead pipeline with drag-to-move stages',
      'AI lead scoring (0–100) with reasoning',
      'Web-to-lead forms + public quote-request forms',
      'Proposals, estimates & contracts with e-signatures',
      'Sales reports: items, payment modes, profit & loss',
    ],
  },
  {
    icon: <Receipt className="w-5 h-5" />,
    title: 'Billing & finance',
    image: IMG.team,
    blurb: 'Invoicing that handles the hard parts.',
    items: [
      'One-off & recurring invoices, credit notes',
      'Automatic sales tax / VAT (TaxJar & Avalara)',
      'Stripe & PayPal checkout, payment tracking',
      'Email open/click tracking on sent invoices',
      'Bulk PDF, bulk status, invoice merge',
    ],
  },
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: 'AI built in',
    image: IMG.ai,
    blurb: 'Bring your own Anthropic or OpenAI key.',
    items: [
      'AI inbox assistant — summarize threads & draft replies',
      'AI text improve — tone, length, clarity, anywhere',
      'AI lead scoring from activity + signal extraction',
      'Per-tenant provider + model + monthly token cap',
    ],
  },
  {
    icon: <LifeBuoy className="w-5 h-5" />,
    title: 'Support & comms',
    image: IMG.support,
    blurb: 'Every channel, one timeline.',
    items: [
      'Support tickets with spam filters & canned replies',
      'Two-way SMS (Twilio) on tickets & leads',
      'Per-tenant email (SMTP or Gmail/Outlook OAuth)',
      'IMAP inbox sync routed to the right record',
      'Client portal for invoices, tickets & documents',
    ],
  },
];

const CAPABILITIES: Array<{ icon: React.ReactNode; label: string; desc: string }> = [
  { icon: <Building2 className="w-5 h-5" />, label: 'Multi-tenant & multi-org', desc: 'One account across many organizations, switch in a click.' },
  { icon: <Shield className="w-5 h-5" />, label: 'Per-org RBAC', desc: 'Granular, role-based permissions scoped per organization.' },
  { icon: <KeyRound className="w-5 h-5" />, label: '2FA / TOTP', desc: 'Authenticator-based two-factor with recovery codes.' },
  { icon: <Palette className="w-5 h-5" />, label: 'White-label', desc: 'Your logo, colors, domain, and email footer.' },
  { icon: <FileSignature className="w-5 h-5" />, label: 'E-signatures', desc: 'Sign proposals & contracts with a full audit trail.' },
  { icon: <Layers className="w-5 h-5" />, label: 'Documents + versioning', desc: 'Attach files to any record, keep every version.' },
  { icon: <Package className="w-5 h-5" />, label: 'Inventory', desc: 'Stock tracking, low-stock alerts, auto-decrement on sale.' },
  { icon: <Workflow className="w-5 h-5" />, label: 'Workflow automation', desc: 'Trigger → condition → action, built visually.' },
  { icon: <Calculator className="w-5 h-5" />, label: 'Custom fields v2', desc: 'Formula, lookup & rollup fields on any record.' },
  { icon: <Search className="w-5 h-5" />, label: 'Global search', desc: '⌘K command palette with fuzzy full-text search.' },
  { icon: <Upload className="w-5 h-5" />, label: 'CSV import / export', desc: 'Bulk in and out on every list page.' },
  { icon: <Inbox className="w-5 h-5" />, label: 'PWA + push', desc: 'Installable, offline-ready, with web push notifications.' },
];

const LOGINS = [
  {
    href: '/login',
    icon: <LayoutDashboard className="w-6 h-6" />,
    title: 'Staff / Tenant',
    sub: 'Day-to-day CRM for your team.',
    path: '/login',
  },
  {
    href: '/portal/login',
    icon: <Users className="w-6 h-6" />,
    title: 'Client portal',
    sub: 'Where your customers see invoices & tickets.',
    path: '/portal/login',
  },
  {
    href: '/platform/login',
    icon: <Shield className="w-6 h-6" />,
    title: 'Platform admin',
    sub: 'Manage tenants across the SaaS.',
    path: '/platform/login',
  },
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
          <nav className="flex items-center gap-2 sm:gap-5 text-sm">
            <a href="#features" className="text-gray-600 dark:text-gray-400 hover:text-primary hidden md:inline">Features</a>
            <a href="#capabilities" className="text-gray-600 dark:text-gray-400 hover:text-primary hidden md:inline">Platform</a>

            {/* Login dropdown — no-JS <details> so this stays a server component */}
            <details className="relative group">
              <summary className="list-none cursor-pointer inline-flex items-center gap-1 text-gray-700 dark:text-gray-300 hover:text-primary select-none">
                Login
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl overflow-hidden">
                {LOGINS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-primary mt-0.5">{l.icon}</span>
                    <span>
                      <span className="block text-sm font-medium">{l.title}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{l.sub}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </details>

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
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-6">
              <Zap className="w-3.5 h-3.5" />
              All-in-one · multi-tenant · AI-native
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
              Run your whole business from{' '}
              <span className="text-primary">one CRM</span>.
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-xl">
              Leads, proposals, invoices, projects, tickets, inventory, SMS,
              e-signatures, automatic tax, AI — every workflow you had spread
              across five tools, unified and white-labeled.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
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
                See everything it does
              </a>
            </div>
          </div>
          <div className="relative">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl bg-gray-100 dark:bg-gray-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMG.hero}
                alt="Team collaborating on a dashboard"
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
            <div className="absolute -bottom-4 -left-4 hidden sm:flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 shadow-lg">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">AI lead scoring built in</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-7xl mx-auto px-6 py-12">
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

      {/* Feature groups (alternating image rows) */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything, already shipped</h2>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Not a roadmap. Every capability below works today, per tenant, in production.
          </p>
        </div>

        <div className="space-y-16">
          {GROUPS.map((g, i) => (
            <div
              key={g.title}
              className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}
            >
              <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-lg aspect-[3/2] bg-gray-100 dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.image} alt={g.title} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    {g.icon}
                  </div>
                  <h3 className="text-2xl font-bold">{g.title}</h3>
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{g.blurb}</p>
                <ul className="space-y-2">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform capabilities grid */}
      <section id="capabilities" className="bg-gray-50 dark:bg-gray-900/40 border-y border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built like a platform</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              The infrastructure most CRMs charge enterprise tiers for — standard here.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map((c) => (
              <div
                key={c.label}
                className="flex items-start gap-3 p-5 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  {c.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{c.label}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Logins */}
      <section id="logins" className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Sign in</h2>
          <p className="text-gray-600 dark:text-gray-400">Three doors for three audiences.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {LOGINS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary hover:shadow-lg transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                {l.icon}
              </div>
              <h3 className="font-semibold mb-1">{l.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{l.sub}</p>
              <span className="text-sm text-primary font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                {l.path} <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="p-10 md:p-14 rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to run it?</h2>
          <p className="text-white/90 mb-8 max-w-xl mx-auto">
            Your tenant is provisioned and the database is waiting. Open the CRM and start moving.
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
            <Link href="/login" className="hover:text-primary">Staff login</Link>
            <Link href="/portal/login" className="hover:text-primary">Client portal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
