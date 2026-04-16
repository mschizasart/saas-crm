import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(orgId: string, query: string, limit = 10) {
    if (!query || query.length < 2) return { results: [] };
    const q = { contains: query, mode: 'insensitive' as const };

    const [clients, leads, invoices, tickets, projects, contacts] =
      await Promise.all([
        this.prisma.client.findMany({
          where: { organizationId: orgId, company: q },
          select: { id: true, company: true },
          take: limit,
        }),
        this.prisma.lead.findMany({
          where: {
            organizationId: orgId,
            OR: [{ name: q }, { email: q }, { company: q }],
          },
          select: { id: true, name: true, email: true },
          take: limit,
        }),
        this.prisma.invoice.findMany({
          where: { organizationId: orgId, number: q },
          select: { id: true, number: true, total: true, status: true },
          take: limit,
        }),
        this.prisma.ticket.findMany({
          where: { organizationId: orgId, subject: q },
          select: { id: true, subject: true, status: true },
          take: limit,
        }),
        this.prisma.project.findMany({
          where: { organizationId: orgId, name: q },
          select: { id: true, name: true, status: true },
          take: limit,
        }),
        this.prisma.user.findMany({
          where: {
            organizationId: orgId,
            OR: [{ firstName: q }, { lastName: q }, { email: q }],
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            type: true,
          },
          take: limit,
        }),
      ]);

    return {
      results: [
        ...clients.map((c) => ({
          type: 'client',
          id: c.id,
          title: c.company,
          url: `/clients/${c.id}`,
        })),
        ...leads.map((l) => ({
          type: 'lead',
          id: l.id,
          title: l.name,
          subtitle: l.email,
          url: `/leads/${l.id}`,
        })),
        ...invoices.map((i) => ({
          type: 'invoice',
          id: i.id,
          title: `Invoice ${i.number}`,
          subtitle: i.status,
          url: `/invoices/${i.id}`,
        })),
        ...tickets.map((t) => ({
          type: 'ticket',
          id: t.id,
          title: t.subject,
          subtitle: t.status,
          url: `/tickets/${t.id}`,
        })),
        ...projects.map((p) => ({
          type: 'project',
          id: p.id,
          title: p.name,
          subtitle: p.status,
          url: `/projects/${p.id}`,
        })),
        ...contacts.map((u) => ({
          type: 'staff',
          id: u.id,
          title: `${u.firstName} ${u.lastName}`,
          subtitle: u.email,
          url: `/staff/${u.id}`,
        })),
      ],
    };
  }
}
