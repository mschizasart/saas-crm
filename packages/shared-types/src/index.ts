// ─── Shared types between API and Web ────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
}

// ─── Organization ─────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  customDomain?: string;
  logo?: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt?: string;
  planId?: string;
  settings: OrganizationSettings;
  createdAt: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';

export interface OrganizationSettings {
  currency?: string;
  timezone?: string;
  dateFormat?: string;
  invoicePrefix?: string;
  estimatePrefix?: string;
  proposalPrefix?: string;
  ticketPrefix?: string;
  defaultLanguage?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  [key: string]: any;
}

// ─── User ─────────────────────────────────────────────────────

export interface User {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  type: 'staff' | 'contact';
  isAdmin: boolean;
  active: boolean;
  roleId?: string;
  role?: Role;
  avatar?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  twoFaEnabled: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: RolePermissions;
}

export type RolePermissions = Record<string, Record<string, boolean>>;

// ─── Client ───────────────────────────────────────────────────

export interface Client {
  id: string;
  organizationId: string;
  company: string;
  address?: string;
  city?: string;
  country?: string;
  website?: string;
  phone?: string;
  active: boolean;
  currencyId?: string;
  createdAt: string;
}

// ─── Invoice ──────────────────────────────────────────────────

export interface Invoice {
  id: string;
  organizationId: string;
  clientId?: string;
  client?: Client;
  number: string;
  status: InvoiceStatus;
  date: string;
  dueDate?: string;
  subTotal: string;
  discount: string;
  total: string;
  totalTax: string;
  items: InvoiceItem[];
  isRecurring: boolean;
  hash: string;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceItem {
  id: string;
  description: string;
  qty: string;
  rate: string;
  tax1?: string;
  tax2?: string;
  unit?: string;
  order: number;
}

// ─── Lead ─────────────────────────────────────────────────────

export interface Lead {
  id: string;
  organizationId: string;
  statusId?: string;
  status?: LeadStatus;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  value?: string;
  position: number;
  createdAt: string;
}

export interface LeadStatus {
  id: string;
  name: string;
  color: string;
  position: number;
}

// ─── Project ──────────────────────────────────────────────────

export interface Project {
  id: string;
  organizationId: string;
  clientId?: string;
  client?: Client;
  name: string;
  status: ProjectStatus;
  startDate?: string;
  deadline?: string;
  progress: number;
  createdAt: string;
}

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'cancelled' | 'finished';

// ─── Task ─────────────────────────────────────────────────────

export interface Task {
  id: string;
  organizationId: string;
  projectId?: string;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  order: number;
  createdAt: string;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'testing' | 'awaiting_feedback' | 'complete';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

// ─── Ticket ───────────────────────────────────────────────────

export interface Ticket {
  id: string;
  organizationId: string;
  clientId?: string;
  subject: string;
  status: TicketStatus;
  priority: TaskPriority;
  createdAt: string;
}

export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'on_hold' | 'closed';

// ─── Auth types ───────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse extends AuthTokens {
  requires2fa?: boolean;
  tempToken?: string;
}
