/**
 * Shared mock API responses used across page tests. Keep these
 * in sync with the actual server response shapes — tests will
 * catch most drift, but if the API changes a key these fixtures
 * need to change too.
 */

export interface PaginatedListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ClientFixture {
  id: string;
  company: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  active: boolean;
}

export const clientsListResponse: PaginatedListResponse<ClientFixture> = {
  data: [
    {
      id: 'c1',
      company: 'Acme Industries',
      phone: '+1 555 0101',
      website: 'https://acme.example.com',
      city: 'Boston',
      country: 'USA',
      active: true,
    },
    {
      id: 'c2',
      company: 'Globex Corp',
      phone: '+1 555 0202',
      website: null,
      city: 'Chicago',
      country: 'USA',
      active: true,
    },
    {
      id: 'c3',
      company: 'Initech',
      phone: null,
      website: 'https://initech.example.com',
      city: 'Austin',
      country: 'USA',
      active: false,
    },
  ],
  total: 3,
  page: 1,
  limit: 15,
  totalPages: 1,
};

export interface LeadFixture {
  id: string;
  name: string;
  company: string | null;
  budget: number | null;
  currency: string | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  status: string;
}

export const leadsListResponse = {
  data: {
    new: [
      {
        id: 'l1',
        name: 'Alice Smith',
        company: 'Acme',
        budget: 5000,
        currency: 'USD',
        assignedTo: { id: 'u1', firstName: 'Bob', lastName: 'Jones' },
        status: 'new',
      },
    ],
    contacted: [
      {
        id: 'l2',
        name: 'Charlie Brown',
        company: 'Initech',
        budget: 12000,
        currency: 'USD',
        assignedTo: null,
        status: 'contacted',
      },
    ],
    qualified: [],
    proposal: [],
    negotiation: [],
    won: [
      {
        id: 'l3',
        name: 'Dana Lee',
        company: 'Globex',
        budget: 75000,
        currency: 'USD',
        assignedTo: null,
        status: 'won',
      },
    ],
    lost: [],
  },
};

export const inboxMessageResponse = {
  data: [
    {
      id: 'm1',
      messageId: '<m1@example.com>',
      fromEmail: 'sender@example.com',
      fromName: 'Jane Sender',
      toEmails: ['inbox@appoinly.com'],
      ccEmails: [],
      subject: 'Hello there',
      bodyText: 'Hi — this is a test message body.',
      bodyHtml: null,
      receivedAt: new Date('2026-04-01T12:00:00Z').toISOString(),
      attachmentCount: 0,
      routedTo: 'lead' as const,
      routedToId: 'l1',
      isRead: false,
      isStarred: false,
      isArchived: false,
    },
    {
      id: 'm2',
      messageId: '<m2@example.com>',
      fromEmail: 'invoice@example.com',
      fromName: null,
      toEmails: ['inbox@appoinly.com'],
      ccEmails: [],
      subject: 'Invoice 1234 paid',
      bodyText: 'Payment received.',
      bodyHtml: null,
      receivedAt: new Date('2026-04-02T08:30:00Z').toISOString(),
      attachmentCount: 1,
      routedTo: 'invoice' as const,
      routedToId: 'inv1',
      isRead: true,
      isStarred: true,
      isArchived: false,
    },
  ],
  total: 2,
  page: 1,
  limit: 25,
  totalPages: 1,
};

export const emptyListResponse: PaginatedListResponse<never> = {
  data: [],
  total: 0,
  page: 1,
  limit: 15,
  totalPages: 0,
};

/**
 * Build a Response-shape object that the mocked apiFetch returns. Use
 * this to keep page tests terse:
 *   mockApiFetch.mockResolvedValue(jsonOk(clientsListResponse));
 */
export function jsonOk(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response;
}

export function jsonError(status: number, body: unknown = { message: 'Error' }): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response;
}
