import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class GdprService {
  constructor(private prisma: PrismaService) {}

  // ─── Export a staff user's data ────────────────────────────
  async exportUserData(orgId: string, userId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: orgId },
        include: {
          role: true,
          sessions: true,
          notifications: true,
          assignedTasks: { include: { task: true } },
          timeEntries: true,
          activityLogs: true,
        },
      });
      if (!user) throw new NotFoundException('User not found');

      const [createdInvoices, assignedTickets, taskComments, leadNotes] =
        await Promise.all([
          tx.activityLog.findMany({
            where: { organizationId: orgId, userId, relType: 'invoice' },
          }),
          tx.ticket.findMany({
            where: { organizationId: orgId, assignedTo: userId },
          }),
          tx.taskComment.findMany({ where: { userId } }),
          tx.leadNote.findMany({ where: { userId } }),
        ]);

      // Strip sensitive fields
      const { password, twoFaSecret, ...profile } = user as any;

      return {
        exportedAt: new Date().toISOString(),
        type: 'user-data-export',
        profile,
        relatedInvoiceActivity: createdInvoices,
        assignedTickets,
        taskComments,
        leadNotes,
      };
    });
  }

  // ─── Full client export ────────────────────────────────────
  async exportClientData(orgId: string, clientId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, organizationId: orgId },
        include: {
          group: true,
          currency: true,
          contacts: true,
          invoices: { include: { items: true, payments: true } },
          estimates: { include: { items: true } },
          proposals: { include: { items: true, comments: true } },
          projects: true,
          tickets: { include: { replies: true, attachments: true } },
          contracts: { include: { comments: true } },
          payments: true,
          creditNotes: { include: { items: true } },
          expenses: true,
          subscriptions: true,
          vaultEntries: true,
          customFieldValues: true,
        },
      });
      if (!client) throw new NotFoundException('Client not found');

      const activity = await tx.activityLog.findMany({
        where: { organizationId: orgId, relType: 'client', relId: clientId },
      });

      // Mask sensitive fields on contacts (passwords / 2fa secrets)
      (client.contacts as any[]).forEach((c) => {
        delete c.password;
        delete c.twoFaSecret;
      });
      // Mask vault passwords
      (client.vaultEntries as any[]).forEach((v) => {
        v.password = v.password ? '[encrypted]' : null;
      });

      return {
        exportedAt: new Date().toISOString(),
        type: 'client-data-export',
        client,
        activity,
      };
    });
  }

  // ─── Anonymize staff user (preserve audit trail) ───────────
  async anonymizeUser(orgId: string, userId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: orgId },
      });
      if (!user) throw new NotFoundException('User not found');

      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@anonymized`,
          firstName: 'Deleted',
          lastName: 'User',
          phone: null,
          phoneMobile: null,
          avatar: null,
          skype: null,
          oauthProvider: null,
          oauthId: null,
          twoFaSecret: null,
          twoFaEnabled: false,
          password: null,
          active: false,
        },
      });

      // Kill sessions
      await tx.userSession.deleteMany({ where: { userId } });

      return { anonymized: true, userId };
    });
  }

  // ─── Hard delete client (cascades) ─────────────────────────
  async deleteClientCompletely(orgId: string, clientId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, organizationId: orgId },
      });
      if (!client) throw new NotFoundException('Client not found');

      // Null-out cross references that may block the delete
      await tx.invoice.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.estimate.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.proposal.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.contract.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.ticket.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.expense.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.project.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.creditNote.updateMany({
        where: { clientId },
        data: { clientId: null },
      });
      await tx.payment.updateMany({
        where: { clientId },
        data: { clientId: null },
      });

      // Delete contact users tied to client
      await tx.user.deleteMany({
        where: { organizationId: orgId, clientId, type: 'contact' },
      });

      await tx.client.delete({ where: { id: clientId } });
      return { deleted: true, clientId };
    });
  }

  // ─── Data retention report ─────────────────────────────────
  async getDataRetentionReport(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalClients,
        inactiveClients,
        anonymizedUsers,
        expiredSessions,
        oldActivityLogs,
        oldNotifications,
        orphanedVaultEntries,
        oldMailQueue,
      ] = await Promise.all([
        tx.client.count({ where: { organizationId: orgId } }),
        tx.client.count({
          where: { organizationId: orgId, active: false },
        }),
        tx.user.count({
          where: {
            organizationId: orgId,
            email: { contains: '@anonymized' },
          },
        }),
        tx.userSession.count({
          where: { expiresAt: { lt: now } },
        }),
        tx.activityLog.count({
          where: { organizationId: orgId, createdAt: { lt: oneYearAgo } },
        }),
        tx.notification.count({
          where: {
            organizationId: orgId,
            read: true,
            createdAt: { lt: thirtyDaysAgo },
          },
        }),
        tx.vaultEntry.count({ where: { organizationId: orgId } }),
        tx.mailQueue.count({
          where: {
            organizationId: orgId,
            status: 'sent',
            createdAt: { lt: thirtyDaysAgo },
          },
        }),
      ]);

      return {
        generatedAt: now.toISOString(),
        counts: {
          totalClients,
          inactiveClients,
          anonymizedUsers,
          expiredSessions,
          activityLogsOlderThan1Year: oldActivityLogs,
          readNotificationsOlderThan30Days: oldNotifications,
          vaultEntries: orphanedVaultEntries,
          sentMailQueueOlderThan30Days: oldMailQueue,
        },
        recommendations: [
          'Delete expired user sessions',
          'Archive activity logs older than 1 year',
          'Purge already-read notifications older than 30 days',
          'Purge sent mail queue older than 30 days',
        ],
      };
    });
  }
}
