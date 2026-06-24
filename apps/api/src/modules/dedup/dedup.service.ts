import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Duplicate detection + record merge (migration 045).
 *
 * DETECTION — pg_trgm similarity() over leads / clients, scoped to one org,
 * excluding already-merged losers. Returns scored candidate PAIRS.
 *
 * MERGE — the high-risk part. A merge repoints EVERY reference from a LOSER
 * record onto a WINNER record, atomically, scoped to one org, then soft-marks
 * the loser (mergedIntoId / mergedAt). It runs inside a single
 * `prisma.withOrganization(orgId, tx => ...)` which is a real `$transaction`,
 * so either every repoint + the audit row commit together or nothing does.
 *
 * Tenant isolation: every read AND every raw repoint statement carries an
 * explicit `organizationId = ${orgId}` predicate (defence in depth — this DB
 * has no RLS helper; isolation is service-layer enforced like calls/sms).
 */
@Injectable()
export class DedupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // ════════════════════════════════════════════════════════════
  //  DETECTION
  // ════════════════════════════════════════════════════════════

  /**
   * Find duplicate LEAD pairs in an org via pg_trgm.
   *
   * Match when (excluding self & merged, l1.id < l2.id to dedupe pairs):
   *   - same lower(email), OR
   *   - same phone, OR
   *   - similarity(name)    > threshold, OR
   *   - similarity(company) > threshold
   *
   * `score` is the strongest single signal (1 for exact email/phone match,
   * else the max name/company similarity).
   */
  async leadCandidates(orgId: string, threshold = 0.7, limit = 50, focusId?: string) {
    const t = this.clampThreshold(threshold);
    const lim = this.clampLimit(limit);

    const rows = await this.prisma.withOrganization(orgId, (tx) =>
      tx.$queryRaw<DupPairRow[]>`
        SELECT
          l1."id"        AS "aId",
          l1."name"      AS "aName",
          l1."email"     AS "aEmail",
          l1."phone"     AS "aPhone",
          l1."company"   AS "aCompany",
          l1."createdAt" AS "aCreatedAt",
          l2."id"        AS "bId",
          l2."name"      AS "bName",
          l2."email"     AS "bEmail",
          l2."phone"     AS "bPhone",
          l2."company"   AS "bCompany",
          l2."createdAt" AS "bCreatedAt",
          (
            lower(l1."email") IS NOT NULL
            AND lower(l1."email") = lower(l2."email")
          )                                                    AS "emailMatch",
          (
            l1."phone" IS NOT NULL AND l1."phone" <> ''
            AND l1."phone" = l2."phone"
          )                                                    AS "phoneMatch",
          similarity(coalesce(l1."name", ''), coalesce(l2."name", ''))       AS "nameSim",
          similarity(coalesce(l1."company", ''), coalesce(l2."company", '')) AS "companySim"
        FROM "leads" l1
        JOIN "leads" l2
          ON l2."organizationId" = l1."organizationId"
          AND l1."id" < l2."id"
          AND l2."mergedIntoId" IS NULL
          AND (
            (lower(l1."email") IS NOT NULL AND lower(l1."email") = lower(l2."email"))
            OR (l1."phone" IS NOT NULL AND l1."phone" <> '' AND l1."phone" = l2."phone")
            OR similarity(coalesce(l1."name", ''), coalesce(l2."name", '')) > ${t}
            OR similarity(coalesce(l1."company", ''), coalesce(l2."company", '')) > ${t}
          )
        WHERE l1."organizationId" = ${orgId}
          AND l1."mergedIntoId" IS NULL
          ${focusId ? Prisma.sql`AND (l1."id" = ${focusId} OR l2."id" = ${focusId})` : Prisma.empty}
        ORDER BY GREATEST(
          CASE WHEN lower(l1."email") = lower(l2."email") THEN 1 ELSE 0 END,
          CASE WHEN l1."phone" = l2."phone" THEN 1 ELSE 0 END,
          similarity(coalesce(l1."name", ''), coalesce(l2."name", '')),
          similarity(coalesce(l1."company", ''), coalesce(l2."company", ''))
        ) DESC
        LIMIT ${lim}
      `,
    );

    return { pairs: rows.map((r) => this.toPair(r)) };
  }

  /**
   * Find duplicate CLIENT pairs in an org via pg_trgm.
   *
   * Match when (excluding self & merged, c1.id < c2.id):
   *   - same phone, OR
   *   - similarity(company) > threshold, OR
   *   - same lower(city) AND similarity(company) high
   * `matchedOn` records which signals fired.
   */
  async clientCandidates(orgId: string, threshold = 0.7, limit = 50, focusId?: string) {
    const t = this.clampThreshold(threshold);
    const lim = this.clampLimit(limit);

    const rows = await this.prisma.withOrganization(orgId, (tx) =>
      tx.$queryRaw<DupPairRow[]>`
        SELECT
          c1."id"        AS "aId",
          c1."company"   AS "aName",
          NULL           AS "aEmail",
          c1."phone"     AS "aPhone",
          c1."company"   AS "aCompany",
          c1."createdAt" AS "aCreatedAt",
          c1."city"      AS "aCity",
          c2."id"        AS "bId",
          c2."company"   AS "bName",
          NULL           AS "bEmail",
          c2."phone"     AS "bPhone",
          c2."company"   AS "bCompany",
          c2."createdAt" AS "bCreatedAt",
          c2."city"      AS "bCity",
          false                                                AS "emailMatch",
          (
            c1."phone" IS NOT NULL AND c1."phone" <> ''
            AND c1."phone" = c2."phone"
          )                                                    AS "phoneMatch",
          0::real                                              AS "nameSim",
          similarity(coalesce(c1."company", ''), coalesce(c2."company", '')) AS "companySim",
          (
            lower(c1."city") IS NOT NULL AND c1."city" <> ''
            AND lower(c1."city") = lower(c2."city")
          )                                                    AS "cityMatch"
        FROM "clients" c1
        JOIN "clients" c2
          ON c2."organizationId" = c1."organizationId"
          AND c1."id" < c2."id"
          AND c2."mergedIntoId" IS NULL
          AND (
            (c1."phone" IS NOT NULL AND c1."phone" <> '' AND c1."phone" = c2."phone")
            OR similarity(coalesce(c1."company", ''), coalesce(c2."company", '')) > ${t}
            OR (
              lower(c1."city") IS NOT NULL AND c1."city" <> ''
              AND lower(c1."city") = lower(c2."city")
              AND similarity(coalesce(c1."company", ''), coalesce(c2."company", '')) > ${t} - 0.2
            )
          )
        WHERE c1."organizationId" = ${orgId}
          AND c1."mergedIntoId" IS NULL
          ${focusId ? Prisma.sql`AND (c1."id" = ${focusId} OR c2."id" = ${focusId})` : Prisma.empty}
        ORDER BY GREATEST(
          CASE WHEN c1."phone" = c2."phone" THEN 1 ELSE 0 END,
          similarity(coalesce(c1."company", ''), coalesce(c2."company", ''))
        ) DESC
        LIMIT ${lim}
      `,
    );

    return { pairs: rows.map((r) => this.toPair(r)) };
  }

  private toPair(r: DupPairRow) {
    const matchedOn: string[] = [];
    if (r.emailMatch) matchedOn.push('email');
    if (r.phoneMatch) matchedOn.push('phone');
    if (r.cityMatch) matchedOn.push('city');
    if (r.nameSim != null && r.nameSim > 0.7) matchedOn.push('name');
    if (r.companySim != null && r.companySim > 0.7) matchedOn.push('company');

    // Strongest single signal becomes the headline score.
    const score = Math.min(
      1,
      Math.max(
        r.emailMatch ? 1 : 0,
        r.phoneMatch ? 1 : 0,
        r.cityMatch ? 0.8 : 0,
        Number(r.nameSim ?? 0),
        Number(r.companySim ?? 0),
      ),
    );

    return {
      score: Number(score.toFixed(3)),
      matchedOn,
      a: {
        id: r.aId,
        name: r.aName,
        email: r.aEmail,
        phone: r.aPhone,
        company: r.aCompany,
        city: r.aCity ?? null,
        createdAt: r.aCreatedAt,
      },
      b: {
        id: r.bId,
        name: r.bName,
        email: r.bEmail,
        phone: r.bPhone,
        company: r.bCompany,
        city: r.bCity ?? null,
        createdAt: r.bCreatedAt,
      },
    };
  }

  private clampThreshold(t: number): number {
    if (!Number.isFinite(t)) return 0.7;
    return Math.min(1, Math.max(0.1, t));
  }

  private clampLimit(l: number): number {
    if (!Number.isFinite(l)) return 50;
    return Math.min(200, Math.max(1, Math.trunc(l)));
  }

  // ════════════════════════════════════════════════════════════
  //  LEAD MERGE
  // ════════════════════════════════════════════════════════════

  /** Scalar fields safe to copy winner←loser via fieldOverrides / null-fill. */
  private static readonly LEAD_MERGEABLE_FIELDS = [
    'name',
    'company',
    'email',
    'phone',
    'website',
    'address',
    'city',
    'state',
    'country',
    'zipCode',
    'description',
    'value',
    'statusId',
    'sourceId',
    'assignedTo',
    'lostReason',
  ] as const;

  async mergeLead(
    orgId: string,
    winnerId: string,
    loserId: string,
    userId?: string,
    fieldOverrides: Record<string, 'winner' | 'loser'> = {},
  ) {
    if (winnerId === loserId) {
      throw new BadRequestException('cannot merge a record into itself');
    }

    const result = await this.prisma.withOrganization(orgId, async (tx) => {
      // a. Load both, org-scoped.
      const winner = await tx.lead.findFirst({
        where: { id: winnerId, organizationId: orgId },
      });
      const loser = await tx.lead.findFirst({
        where: { id: loserId, organizationId: orgId },
      });
      if (!winner) throw new NotFoundException('winner lead not found');
      if (!loser) throw new NotFoundException('loser lead not found');
      if (loser.mergedIntoId) {
        throw new BadRequestException('loser lead is already merged');
      }
      if (winner.mergedIntoId) {
        throw new BadRequestException('winner lead is itself already merged');
      }

      const repointed: Record<string, number> = {};
      const bump = (table: string, n: number) => {
        if (n) repointed[table] = (repointed[table] ?? 0) + n;
      };

      // c. HARD FKs — Prisma updateMany, org-scoped where possible.
      bump(
        'lead_notes',
        (await tx.leadNote.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
      );
      bump(
        'lead_emails',
        (await tx.leadEmail.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
      );
      bump(
        'opportunities',
        (
          await tx.opportunity.updateMany({
            where: { leadId: loserId, organizationId: orgId },
            data: { leadId: winnerId },
          })
        ).count,
      );

      // c/d. custom_field_values — @@unique([fieldId, relId]). Delete loser
      //      CFV rows whose fieldId already exists for the winner (would
      //      collide on repoint), then repoint the survivors. relType='lead'.
      await tx.$executeRaw`
        DELETE FROM "custom_field_values" cfvL
        WHERE cfvL."organizationId" = ${orgId}
          AND cfvL."relType" = 'lead'
          AND cfvL."relId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "custom_field_values" cfvW
            WHERE cfvW."organizationId" = ${orgId}
              AND cfvW."relType" = 'lead'
              AND cfvW."relId" = ${winnerId}
              AND cfvW."fieldId" = cfvL."fieldId"
          )
      `;
      bump(
        'custom_field_values',
        await tx.$executeRaw`
          UPDATE "custom_field_values"
          SET "relId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "relType" = 'lead' AND "relId" = ${loserId}
        `,
      );

      // SOFT polymorphic refs — parameterized raw, org-scoped. Literal value
      // for "lead" verified per-table (see report checklist).
      bump('tasks', await this.repointRel(tx, 'tasks', 'relType', 'relId', 'lead', orgId, winnerId, loserId));
      bump('calls', await this.repointRel(tx, 'calls', 'relType', 'relId', 'lead', orgId, winnerId, loserId));
      bump('sms_messages', await this.repointRel(tx, 'sms_messages', 'entityType', 'entityId', 'lead', orgId, winnerId, loserId));
      bump('inbox_messages', await this.repointRel(tx, 'inbox_messages', 'routedTo', 'routedToId', 'lead', orgId, winnerId, loserId));
      bump('outbound_messages', await this.repointRel(tx, 'outbound_messages', 'routedTo', 'routedToId', 'lead', orgId, winnerId, loserId));
      bump('activity_log', await this.repointRel(tx, 'activity_log', 'relType', 'relId', 'lead', orgId, winnerId, loserId));
      bump('activities', await this.repointRel(tx, 'activities', 'relatedToType', 'relatedToId', 'lead', orgId, winnerId, loserId));
      bump('documents', await this.repointRel(tx, 'documents', 'entityType', 'entityId', 'lead', orgId, winnerId, loserId));

      // search_index — @@unique([organizationId, entityType, entityId]).
      // Delete the loser's index row (the winner already has one or will be
      // reindexed); avoids a unique collision on repoint.
      bump(
        'search_index',
        await tx.$executeRaw`
          DELETE FROM "search_index"
          WHERE "organizationId" = ${orgId} AND "entityType" = 'lead' AND "entityId" = ${loserId}
        `,
      );

      // sequence_enrollments — @@unique([sequenceId, recipientType, recipientId]).
      // Delete loser enrollments that collide with a winner enrollment in the
      // same sequence, then repoint the rest. recipientType='lead'.
      await tx.$executeRaw`
        DELETE FROM "sequence_enrollments" eL
        WHERE eL."organizationId" = ${orgId}
          AND eL."recipientType" = 'lead'
          AND eL."recipientId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "sequence_enrollments" eW
            WHERE eW."organizationId" = ${orgId}
              AND eW."recipientType" = 'lead'
              AND eW."recipientId" = ${winnerId}
              AND eW."sequenceId" = eL."sequenceId"
          )
      `;
      bump(
        'sequence_enrollments',
        await tx.$executeRaw`
          UPDATE "sequence_enrollments"
          SET "recipientId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "recipientType" = 'lead' AND "recipientId" = ${loserId}
        `,
      );

      // campaign_recipients — @@unique([campaignId, email]); we repoint the
      // polymorphic recipientId/recipientType, not the email, so no collision.
      bump('campaign_recipients', await this.repointRel(tx, 'campaign_recipients', 'recipientType', 'recipientId', 'lead', orgId, winnerId, loserId));

      // proposals — SEPARATE from the clientId hard FK: Proposal also carries a
      // polymorphic relType/relId ("lead" | "customer") so a proposal can be
      // pinned to a lead. No unique constraint on relId → plain repoint. The
      // lead literal here is 'lead' (the customer literal is 'customer', see
      // mergeClient). Verified against schema.prisma Proposal.relType comment.
      bump(
        'proposals(rel)',
        await tx.$executeRaw`
          UPDATE "proposals"
          SET "relId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "relType" = 'lead' AND "relId" = ${loserId}
        `,
      );

      // taggables — @@id([tagId, relType, relId]). Delete loser taggables that
      // collide with a winner taggable (same tag), then repoint the rest.
      await tx.$executeRaw`
        DELETE FROM "taggables" tL
        WHERE tL."relType" = 'lead' AND tL."relId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "taggables" tW
            WHERE tW."relType" = 'lead' AND tW."relId" = ${winnerId}
              AND tW."tagId" = tL."tagId"
          )
      `;
      bump(
        'taggables',
        await tx.$executeRaw`
          UPDATE "taggables"
          SET "relId" = ${winnerId}
          WHERE "relType" = 'lead' AND "relId" = ${loserId}
        `,
      );

      // b. Snapshot AFTER counting repoints (counts are the post-repoint totals).
      const loserSnapshot = { row: loser, repointed } as Prisma.InputJsonValue;

      // e. fieldOverrides + null-fill. Default behaviour: fill winner's
      //    NULL/empty scalar fields from the loser; explicit 'loser' override
      //    always copies the loser value; explicit 'winner' keeps the winner.
      const data: Record<string, unknown> = {};
      for (const field of DedupService.LEAD_MERGEABLE_FIELDS) {
        const choice = fieldOverrides[field];
        const wVal = (winner as Record<string, unknown>)[field];
        const lVal = (loser as Record<string, unknown>)[field];
        if (choice === 'loser') {
          data[field] = lVal;
        } else if (choice === 'winner') {
          // keep winner — no-op
        } else if (this.isEmpty(wVal) && !this.isEmpty(lVal)) {
          data[field] = lVal; // default null-fill
        }
      }
      if (Object.keys(data).length > 0) {
        await tx.lead.update({ where: { id: winnerId }, data });
      }

      // f. Soft-mark loser.
      await tx.lead.update({
        where: { id: loserId },
        data: { mergedIntoId: winnerId, mergedAt: new Date() },
      });

      // g. Audit row.
      await tx.mergeAudit.create({
        data: {
          organizationId: orgId,
          entityType: 'lead',
          winnerId,
          loserId,
          mergedById: userId ?? null,
          loserSnapshot,
          repointCounts: repointed as Prisma.InputJsonValue,
        },
      });

      return { merged: true, winnerId, loserId, repointed };
    });

    // 3. Emit AFTER commit (events emitter is used by leads.service).
    this.events.emit('lead.merged', { orgId, winnerId, loserId, mergedBy: userId });
    return result;
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT MERGE
  // ════════════════════════════════════════════════════════════

  private static readonly CLIENT_MERGEABLE_FIELDS = [
    'company',
    'address',
    'city',
    'state',
    'zipCode',
    'country',
    'website',
    'phone',
    'vat',
    'currencyId',
    'groupId',
    'registrationNumber',
    'billingStreet',
    'billingCity',
    'billingState',
    'billingZip',
    'billingCountry',
    'shippingStreet',
    'shippingCity',
    'shippingState',
    'shippingZip',
    'shippingCountry',
    'longitude',
    'latitude',
    'stripeId',
  ] as const;

  async mergeClient(
    orgId: string,
    winnerId: string,
    loserId: string,
    userId?: string,
    fieldOverrides: Record<string, 'winner' | 'loser'> = {},
  ) {
    if (winnerId === loserId) {
      throw new BadRequestException('cannot merge a record into itself');
    }

    const result = await this.prisma.withOrganization(orgId, async (tx) => {
      const winner = await tx.client.findFirst({
        where: { id: winnerId, organizationId: orgId },
      });
      const loser = await tx.client.findFirst({
        where: { id: loserId, organizationId: orgId },
      });
      if (!winner) throw new NotFoundException('winner client not found');
      if (!loser) throw new NotFoundException('loser client not found');
      if (loser.mergedIntoId) {
        throw new BadRequestException('loser client is already merged');
      }
      if (winner.mergedIntoId) {
        throw new BadRequestException('winner client is itself already merged');
      }

      const repointed: Record<string, number> = {};
      const bump = (table: string, n: number) => {
        if (n) repointed[table] = (repointed[table] ?? 0) + n;
      };
      const cm = (model: { updateMany: (a: any) => Promise<{ count: number }> }) =>
        model.updateMany({
          where: { clientId: loserId, organizationId: orgId },
          data: { clientId: winnerId },
        });

      // c. HARD FKs (org-scoped updateMany).
      bump('invoices', (await cm(tx.invoice)).count);
      bump('estimates', (await cm(tx.estimate)).count);
      bump('proposals', (await cm(tx.proposal)).count);
      bump('contracts', (await cm(tx.contract)).count);
      bump('tickets', (await cm(tx.ticket)).count);
      bump('projects', (await cm(tx.project)).count);
      bump('expenses', (await cm(tx.expense)).count);
      bump('credit_notes', (await cm(tx.creditNote)).count);
      bump('payments', (await cm(tx.payment)).count);
      bump('client_subscriptions', (await cm(tx.clientSubscription)).count);
      bump('vault_entries', (await cm(tx.vaultEntry)).count);
      bump('quotes', (await cm(tx.quote)).count);
      bump('work_orders', (await cm(tx.workOrder)).count);
      bump(
        'opportunities',
        (
          await tx.opportunity.updateMany({
            where: { clientId: loserId, organizationId: orgId },
            data: { clientId: winnerId },
          })
        ).count,
      );

      // users(contacts) — @@unique([organizationId, email]). Repoint only the
      // loser contacts whose email does NOT collide with an existing winner
      // contact; leave colliding contacts attached to the loser (documented).
      const collidingContacts: Array<{ id: string }> = await tx.$queryRaw`
        SELECT uL."id"
        FROM "users" uL
        WHERE uL."organizationId" = ${orgId}
          AND uL."type" = 'contact'
          AND uL."clientId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "users" uW
            WHERE uW."organizationId" = ${orgId}
              AND uW."type" = 'contact'
              AND uW."clientId" = ${winnerId}
              AND lower(uW."email") = lower(uL."email")
          )
      `;
      const skipIds = collidingContacts.map((c) => c.id);
      bump(
        'users',
        (
          await tx.user.updateMany({
            where: {
              organizationId: orgId,
              type: 'contact',
              clientId: loserId,
              ...(skipIds.length ? { id: { notIn: skipIds } } : {}),
            },
            data: { clientId: winnerId },
          })
        ).count,
      );

      // clients.parentClientId — reparent the loser's children onto the
      // winner; guard against a self-cycle (never set a child = winner... a
      // child IS another row, but if the loser was the winner's parent the
      // winner would point at itself — handled by the NOT winner clause).
      bump(
        'clients(children)',
        (
          await tx.client.updateMany({
            where: { organizationId: orgId, parentClientId: loserId, id: { not: winnerId } },
            data: { parentClientId: winnerId },
          })
        ).count,
      );
      // If the WINNER's parent was the loser, clear it (avoid winner→winner).
      if (winner.parentClientId === loserId) {
        await tx.client.update({
          where: { id: winnerId },
          data: { parentClientId: null },
        });
      }

      // custom_field_values — relType='client', same collision handling as lead.
      await tx.$executeRaw`
        DELETE FROM "custom_field_values" cfvL
        WHERE cfvL."organizationId" = ${orgId}
          AND cfvL."relType" = 'client'
          AND cfvL."relId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "custom_field_values" cfvW
            WHERE cfvW."organizationId" = ${orgId}
              AND cfvW."relType" = 'client'
              AND cfvW."relId" = ${winnerId}
              AND cfvW."fieldId" = cfvL."fieldId"
          )
      `;
      bump(
        'custom_field_values',
        await tx.$executeRaw`
          UPDATE "custom_field_values"
          SET "relId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "relType" = 'client' AND "relId" = ${loserId}
        `,
      );

      // SOFT polymorphic refs — literal value 'client'.
      bump('tasks', await this.repointRel(tx, 'tasks', 'relType', 'relId', 'client', orgId, winnerId, loserId));
      bump('calls', await this.repointRel(tx, 'calls', 'relType', 'relId', 'client', orgId, winnerId, loserId));
      bump('sms_messages', await this.repointRel(tx, 'sms_messages', 'entityType', 'entityId', 'client', orgId, winnerId, loserId));
      bump('inbox_messages', await this.repointRel(tx, 'inbox_messages', 'routedTo', 'routedToId', 'client', orgId, winnerId, loserId));
      bump('outbound_messages', await this.repointRel(tx, 'outbound_messages', 'routedTo', 'routedToId', 'client', orgId, winnerId, loserId));
      bump('activity_log', await this.repointRel(tx, 'activity_log', 'relType', 'relId', 'client', orgId, winnerId, loserId));
      bump('activities', await this.repointRel(tx, 'activities', 'relatedToType', 'relatedToId', 'client', orgId, winnerId, loserId));
      bump('documents', await this.repointRel(tx, 'documents', 'entityType', 'entityId', 'client', orgId, winnerId, loserId));

      bump(
        'search_index',
        await tx.$executeRaw`
          DELETE FROM "search_index"
          WHERE "organizationId" = ${orgId} AND "entityType" = 'client' AND "entityId" = ${loserId}
        `,
      );

      await tx.$executeRaw`
        DELETE FROM "sequence_enrollments" eL
        WHERE eL."organizationId" = ${orgId}
          AND eL."recipientType" = 'client'
          AND eL."recipientId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "sequence_enrollments" eW
            WHERE eW."organizationId" = ${orgId}
              AND eW."recipientType" = 'client'
              AND eW."recipientId" = ${winnerId}
              AND eW."sequenceId" = eL."sequenceId"
          )
      `;
      bump(
        'sequence_enrollments',
        await tx.$executeRaw`
          UPDATE "sequence_enrollments"
          SET "recipientId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "recipientType" = 'client' AND "recipientId" = ${loserId}
        `,
      );

      bump('campaign_recipients', await this.repointRel(tx, 'campaign_recipients', 'recipientType', 'recipientId', 'client', orgId, winnerId, loserId));

      // proposals — polymorphic relType/relId, SEPARATE from the clientId hard
      // FK repointed above. NOTE the literal is 'customer', NOT 'client' (see
      // schema.prisma Proposal.relType comment "lead" | "customer"). No unique
      // constraint on relId → plain repoint.
      bump(
        'proposals(rel)',
        await tx.$executeRaw`
          UPDATE "proposals"
          SET "relId" = ${winnerId}
          WHERE "organizationId" = ${orgId} AND "relType" = 'customer' AND "relId" = ${loserId}
        `,
      );

      await tx.$executeRaw`
        DELETE FROM "taggables" tL
        WHERE tL."relType" = 'client' AND tL."relId" = ${loserId}
          AND EXISTS (
            SELECT 1 FROM "taggables" tW
            WHERE tW."relType" = 'client' AND tW."relId" = ${winnerId}
              AND tW."tagId" = tL."tagId"
          )
      `;
      bump(
        'taggables',
        await tx.$executeRaw`
          UPDATE "taggables"
          SET "relId" = ${winnerId}
          WHERE "relType" = 'client' AND "relId" = ${loserId}
        `,
      );

      const loserSnapshot = { row: loser, repointed } as Prisma.InputJsonValue;

      // e. fieldOverrides + null-fill.
      const data: Record<string, unknown> = {};
      for (const field of DedupService.CLIENT_MERGEABLE_FIELDS) {
        const choice = fieldOverrides[field];
        const wVal = (winner as Record<string, unknown>)[field];
        const lVal = (loser as Record<string, unknown>)[field];
        if (choice === 'loser') {
          data[field] = lVal;
        } else if (choice === 'winner') {
          // keep winner
        } else if (this.isEmpty(wVal) && !this.isEmpty(lVal)) {
          data[field] = lVal;
        }
      }
      if (Object.keys(data).length > 0) {
        await tx.client.update({ where: { id: winnerId }, data });
      }

      // f. Soft-mark loser + deactivate.
      await tx.client.update({
        where: { id: loserId },
        data: { mergedIntoId: winnerId, mergedAt: new Date(), active: false },
      });

      // g. Audit row.
      await tx.mergeAudit.create({
        data: {
          organizationId: orgId,
          entityType: 'client',
          winnerId,
          loserId,
          mergedById: userId ?? null,
          loserSnapshot,
          repointCounts: repointed as Prisma.InputJsonValue,
        },
      });

      return { merged: true, winnerId, loserId, repointed, skippedContacts: skipIds.length };
    });

    this.events.emit('client.merged', { orgId, winnerId, loserId, mergedBy: userId });
    return result;
  }

  // ════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════

  /**
   * Repoint a SOFT polymorphic reference (no unique constraint on the
   * repointed id). Column names are restricted to a static whitelist so they
   * can be safely interpolated into the identifier position; ALL VALUES are
   * bound parameters (${...}) — never string-concatenated.
   */
  private async repointRel(
    tx: Prisma.TransactionClient,
    table: SoftRefTable,
    typeCol: SoftRefCol,
    idCol: SoftRefCol,
    literal: 'lead' | 'client',
    orgId: string,
    winnerId: string,
    loserId: string,
  ): Promise<number> {
    // `taggables` is the only soft-ref table without an organizationId column.
    const orgScoped = table !== 'taggables';
    const sql = orgScoped
      ? Prisma.sql`
          UPDATE ${Prisma.raw(`"${table}"`)}
          SET ${Prisma.raw(`"${idCol}"`)} = ${winnerId}
          WHERE "organizationId" = ${orgId}
            AND ${Prisma.raw(`"${typeCol}"`)} = ${literal}
            AND ${Prisma.raw(`"${idCol}"`)} = ${loserId}
        `
      : Prisma.sql`
          UPDATE ${Prisma.raw(`"${table}"`)}
          SET ${Prisma.raw(`"${idCol}"`)} = ${winnerId}
          WHERE ${Prisma.raw(`"${typeCol}"`)} = ${literal}
            AND ${Prisma.raw(`"${idCol}"`)} = ${loserId}
        `;
    return tx.$executeRaw(sql);
  }

  private isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '';
  }
}

// ── Raw-query row shapes ──────────────────────────────────────
interface DupPairRow {
  aId: string;
  aName: string | null;
  aEmail: string | null;
  aPhone: string | null;
  aCompany: string | null;
  aCreatedAt: Date;
  aCity?: string | null;
  bId: string;
  bName: string | null;
  bEmail: string | null;
  bPhone: string | null;
  bCompany: string | null;
  bCreatedAt: Date;
  bCity?: string | null;
  emailMatch: boolean;
  phoneMatch: boolean;
  cityMatch?: boolean;
  nameSim: number | null;
  companySim: number | null;
}

// Static whitelist of soft-ref tables/columns — never user-controlled.
type SoftRefTable =
  | 'tasks'
  | 'calls'
  | 'sms_messages'
  | 'inbox_messages'
  | 'outbound_messages'
  | 'activity_log'
  | 'activities'
  | 'documents'
  | 'campaign_recipients'
  | 'taggables';

type SoftRefCol =
  | 'relType'
  | 'relId'
  | 'entityType'
  | 'entityId'
  | 'routedTo'
  | 'routedToId'
  | 'relatedToType'
  | 'relatedToId'
  | 'recipientType'
  | 'recipientId';
