import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  ScheduleDto,
  StatusTransitionDto,
  CompleteWorkOrderDto,
  WorkOrderLineItemDto,
  ListWorkOrdersQueryDto,
} from './field-service.dto';

// ─── Status state machine ────────────────────────────────────────
//
// Wave H1 mirror of the Wave F2 (CPQ) ALLOWED_TRANSITIONS table —
// keeps the legal moves in ONE place so we never accidentally
// allow a transition by checking ad-hoc booleans.
//
//   draft       → scheduled | cancelled
//   scheduled   → in_progress | cancelled
//   in_progress → completed | cancelled
//   completed   → ∅  (terminal)
//   cancelled   → ∅  (terminal)
//
// Final states have empty arrays so a lookup miss is a clean
// "not allowed" rather than a special-case check.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

/**
 * Field-service work orders: CRUD + lifecycle + dispatch helpers.
 *
 * Design principles (mirroring Wave D opportunities + Wave F2 CPQ):
 *
 * - Status transitions go through dedicated endpoints (schedule, start,
 *   complete, cancel). The generic `update` refuses status changes.
 * - Every transition is written to `work_order_status_history` inside the
 *   SAME transaction as the parent update so the audit log can never drift.
 * - Cross-tenant FK guards on EVERY id accepted from user input
 *   (clientId, opportunityId, technicianId, productId on each line).
 *   Done in BULK (one query per kind of id) — never an N+1 loop.
 * - Defense-in-depth: every `update`/`delete` `where` clause includes
 *   `organizationId` so a forged id can't sneak past the tenant boundary.
 * - Technician assignability: a user can only be assigned as `technicianId`
 *   when `isTechnician = true`. Verified server-side; UI hint only.
 * - Line totals (`lineTotal`) are recomputed server-side. The client can't
 *   ship a pre-computed total.
 */
@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Helpers ────────────────────────────────────────────────

  /** Coerce Decimal | string | number → JS number safely. */
  private toNum(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    const asObj = v as { toNumber?: () => number };
    if (typeof asObj.toNumber === 'function') return asObj.toNumber();
    return 0;
  }

  /** Round to 2dp — money should never carry float drift. */
  private money(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Validate that every FK accepted from user input is in the caller's org.
   * BULK queries (one per id-kind) — never an N+1 loop. The optional
   * `requireTechnicianFlag` ensures a technicianId actually belongs to a
   * user with `isTechnician = true`.
   */
  private async assertTenantFks(
    orgId: string,
    args: {
      clientId?: string;
      opportunityId?: string | null;
      technicianId?: string | null;
      lineItems?: WorkOrderLineItemDto[];
    },
  ): Promise<void> {
    const { clientId, opportunityId, technicianId, lineItems } = args;

    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, organizationId: orgId },
        select: { id: true },
      });
      if (!client) {
        throw new BadRequestException('Client not found for this organization');
      }
    }

    if (opportunityId) {
      const opp = await this.prisma.opportunity.findFirst({
        where: { id: opportunityId, organizationId: orgId },
        select: { id: true },
      });
      if (!opp) {
        throw new BadRequestException(
          'Opportunity not found for this organization',
        );
      }
    }

    if (technicianId) {
      const tech = await this.prisma.user.findFirst({
        where: { id: technicianId, organizationId: orgId },
        select: { id: true, isTechnician: true, active: true },
      });
      if (!tech) {
        throw new BadRequestException(
          'Technician not found for this organization',
        );
      }
      if (!tech.isTechnician) {
        throw new BadRequestException(
          'Assigned user is not a technician — toggle isTechnician on their staff record first',
        );
      }
      if (!tech.active) {
        throw new BadRequestException(
          'Assigned technician is inactive and cannot take new work orders',
        );
      }
    }

    if (lineItems && lineItems.length > 0) {
      const productIds = Array.from(
        new Set(
          lineItems
            .map((l) => l.productId)
            .filter((v): v is string => !!v),
        ),
      );
      if (productIds.length > 0) {
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds }, organizationId: orgId },
          select: { id: true },
        });
        if (products.length !== productIds.length) {
          throw new BadRequestException(
            'One or more products do not belong to your organization',
          );
        }
      }
    }
  }

  /**
   * Build persisted row data for each line item + accumulate the subtotal.
   * The math lives ONLY here — `lineTotal` is NEVER trusted from the
   * client.
   */
  private buildLineRows(
    orgId: string,
    workOrderId: string,
    dto: WorkOrderLineItemDto[],
  ): { rows: any[]; subtotal: number } {
    let subtotal = 0;
    const rows = dto.map((li, idx) => {
      const qty = this.toNum(li.quantity);
      const unit = this.toNum(li.unitPrice);
      const lineTotal = this.money(qty * unit);
      subtotal += lineTotal;
      return {
        organizationId: orgId,
        workOrderId,
        type: li.type,
        productId: li.productId ?? null,
        description: li.description,
        quantity: qty,
        unitPrice: this.money(unit),
        lineTotal,
        order: li.order ?? idx,
      };
    });
    return { rows, subtotal: this.money(subtotal) };
  }

  /**
   * Per-org sequence "WO-YYYY-NNNN". Mirrors the quote / invoice
   * pattern — not strictly collision-safe under high concurrency, but the
   * @@unique([organizationId, number]) constraint catches it as a P2002
   * the caller can retry. Good enough for the human-paced dispatch
   * workflow this powers.
   */
  private async generateWorkOrderNumber(
    orgId: string,
    tx: any,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.workOrder.count({
      where: { organizationId: orgId },
    });
    return `WO-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Common include set — used by findOne and the post-transition
   * fetch so the controller hands a fully hydrated object back to the UI.
   */
  private readonly detailInclude = {
    client: { select: { id: true, company: true } },
    opportunity: { select: { id: true, name: true } },
    lineItems: { orderBy: { order: 'asc' as const } },
    statusHistory: {
      orderBy: { changedAt: 'desc' as const },
      take: 50,
    },
  };

  // ─── List ───────────────────────────────────────────────────

  async list(orgId: string, query: ListWorkOrdersQueryDto) {
    const {
      page,
      limit,
      status,
      technicianId,
      clientId,
      startAfter,
      startBefore,
    } = query;
    // Defense-in-depth: the DTO has @Max(100) / @Min(1), but if the
    // ValidationPipe is bypassed (direct service call, internal caller,
    // tests) we still want hard server-side caps. Mirrors the Wave E/F/G
    // list-service convention.
    const safePage = Math.max(1, page ?? 1);
    const safeLimit = Math.min(limit ?? 20, 100);
    const skip = (safePage - 1) * safeLimit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (technicianId) where.technicianId = technicianId;
      if (clientId) where.clientId = clientId;
      if (startAfter || startBefore) {
        where.scheduledStart = {};
        if (startAfter) where.scheduledStart.gte = new Date(startAfter);
        if (startBefore) where.scheduledStart.lte = new Date(startBefore);
      }

      const [data, total] = await Promise.all([
        tx.workOrder.findMany({
          where,
          skip,
          take: safeLimit,
          orderBy: [{ scheduledStart: 'desc' }, { createdAt: 'desc' }],
          include: {
            client: { select: { id: true, company: true } },
            _count: { select: { lineItems: true } },
          },
        }),
        tx.workOrder.count({ where }),
      ]);

      return {
        data,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    });
  }

  // ─── Find one ───────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id, organizationId: orgId },
        include: this.detailInclude,
      });
      if (!wo) throw new NotFoundException('Work order not found');
      // Hydrate the technician + the actor on history rows in a follow-up
      // pass. We avoid declaring formal Prisma back-relations on User
      // (self-contained pattern — Wave G2) so do it manually.
      const userIds = new Set<string>();
      if (wo.technicianId) userIds.add(wo.technicianId);
      for (const h of wo.statusHistory) {
        if (h.changedById) userIds.add(h.changedById);
      }
      const users =
        userIds.size > 0
          ? await tx.user.findMany({
              where: { id: { in: Array.from(userIds) }, organizationId: orgId },
              select: { id: true, firstName: true, lastName: true, email: true },
            })
          : [];
      const userMap = new Map(users.map((u) => [u.id, u]));
      return {
        ...wo,
        technician: wo.technicianId ? userMap.get(wo.technicianId) ?? null : null,
        statusHistory: wo.statusHistory.map((h) => ({
          ...h,
          changedBy: h.changedById ? userMap.get(h.changedById) ?? null : null,
        })),
      };
    });
  }

  // ─── Create ─────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreateWorkOrderDto) {
    await this.assertTenantFks(orgId, {
      clientId: dto.clientId,
      opportunityId: dto.opportunityId ?? null,
      technicianId: dto.technicianId ?? null,
      lineItems: dto.lineItems,
    });

    if (dto.scheduledStart && dto.scheduledEnd) {
      if (new Date(dto.scheduledEnd) <= new Date(dto.scheduledStart)) {
        throw new BadRequestException(
          'scheduledEnd must be after scheduledStart',
        );
      }
    }

    try {
      return await this.prisma.withOrganization(orgId, async (tx) => {
        const number = await this.generateWorkOrderNumber(orgId, tx);

        const built = dto.lineItems && dto.lineItems.length > 0
          ? this.buildLineRows(orgId, '__placeholder__', dto.lineItems)
          : { rows: [], subtotal: 0 };

        const created = await tx.workOrder.create({
          data: {
            organizationId: orgId,
            number,
            clientId: dto.clientId,
            opportunityId: dto.opportunityId ?? null,
            locationAddress: dto.locationAddress ?? null,
            scheduledStart: dto.scheduledStart
              ? new Date(dto.scheduledStart)
              : null,
            scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
            status: 'draft',
            technicianId: dto.technicianId ?? null,
            priority: dto.priority ?? 'normal',
            description: dto.description ?? null,
            createdById: userId,
            lineItems:
              built.rows.length > 0
                ? {
                    create: built.rows.map(({ workOrderId: _w, ...rest }) => rest),
                  }
                : undefined,
          },
          include: this.detailInclude,
        });

        // Seed the status_history audit log with the create event so the
        // timeline is complete (mirrors opportunity_stage_history seeding).
        await tx.workOrderStatusHistory.create({
          data: {
            organizationId: orgId,
            workOrderId: created.id,
            fromStatus: null,
            toStatus: 'draft',
            changedById: userId,
          },
        });

        return created;
      });
    } catch (err: any) {
      // @@unique([organizationId, number]) — under concurrent creates the
      // count-based numbering can collide. Surface as a retryable 409
      // instead of leaking a raw 500.
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'Work order number collision — please retry',
        );
      }
      throw err;
    }
  }

  // ─── Update (non-terminal only, no status changes) ──────────

  async update(orgId: string, id: string, dto: UpdateWorkOrderDto) {
    // Refuse stray `status` field even if the DTO whitelist let it
    // slip through — service-layer belt-and-braces.
    if ((dto as any).status !== undefined) {
      throw new BadRequestException(
        'Use the dedicated lifecycle endpoints to change status',
      );
    }

    const existing = await this.findOne(orgId, id);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new BadRequestException(
        `Cannot edit a work order in '${existing.status}' status — terminal states are immutable`,
      );
    }

    // Cross-tenant guards on anything that changes.
    await this.assertTenantFks(orgId, {
      clientId: dto.clientId,
      opportunityId:
        dto.opportunityId === undefined ? undefined : dto.opportunityId,
      technicianId:
        dto.technicianId === undefined ? undefined : dto.technicianId,
      lineItems: dto.lineItems,
    });

    // Partial-update temporal inversion guard: resolve missing values
    // from the existing row before comparing, so PATCH'ing only one of
    // the two fields can't silently persist an inverted window. A field
    // explicitly cleared to `null` short-circuits the comparison (no
    // window after the clear).
    const startCleared =
      dto.scheduledStart === null || dto.scheduledStart === '';
    const endCleared = dto.scheduledEnd === null || dto.scheduledEnd === '';
    if (!startCleared && !endCleared) {
      const newStart =
        dto.scheduledStart !== undefined
          ? new Date(dto.scheduledStart)
          : existing.scheduledStart;
      const newEnd =
        dto.scheduledEnd !== undefined
          ? new Date(dto.scheduledEnd)
          : existing.scheduledEnd;
      if (newStart && newEnd && newEnd <= newStart) {
        throw new BadRequestException(
          'scheduledEnd must be after scheduledStart',
        );
      }
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      if (dto.lineItems) {
        await tx.workOrderLineItem.deleteMany({
          where: { workOrderId: id, organizationId: orgId },
        });
        const built = this.buildLineRows(orgId, id, dto.lineItems);
        if (built.rows.length > 0) {
          await tx.workOrderLineItem.createMany({ data: built.rows });
        }
      }

      // Defense-in-depth: organizationId in `where` clause.
      const updated = await tx.workOrder.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.opportunityId !== undefined && {
            opportunityId: dto.opportunityId,
          }),
          ...(dto.locationAddress !== undefined && {
            locationAddress: dto.locationAddress,
          }),
          ...(dto.scheduledStart !== undefined && {
            scheduledStart: dto.scheduledStart
              ? new Date(dto.scheduledStart)
              : null,
          }),
          ...(dto.scheduledEnd !== undefined && {
            scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
          }),
          ...(dto.technicianId !== undefined && {
            technicianId: dto.technicianId,
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
        },
        include: this.detailInclude,
      });

      return updated;
    });
  }

  // ─── Remove (drafts only) ──────────────────────────────────

  async remove(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        `Cannot delete a work order in '${existing.status}' status — cancel it instead so the audit history is preserved`,
      );
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      // Defense-in-depth: organizationId in `where`.
      await tx.workOrder.delete({
        where: { id, organizationId: orgId },
      });
    });
  }

  // ─── Schedule ──────────────────────────────────────────────

  /**
   * Assign a technician + window. Allowed from `draft` (becomes
   * `scheduled`) or `scheduled` (re-schedule). The status_history
   * row is written in the SAME transaction as the work_order
   * update so the audit log can never drift.
   *
   * Schedule conflict detection: if the new window overlaps another
   * scheduled / in-progress work order for the same technician, we
   * LOG a warning but allow the write (double-booking is a real
   * field-service scenario — admins make the call).
   */
  async schedule(
    orgId: string,
    userId: string,
    id: string,
    dto: ScheduleDto,
  ) {
    const existing = await this.findOne(orgId, id);
    // Drive the legality check off ALLOWED_TRANSITIONS so the state
    // machine lives in ONE place (matches start/complete/cancel).
    // Special carve-out: re-scheduling an already-scheduled WO is valid
    // even though `scheduled → scheduled` isn't in the transition table.
    const allows =
      ALLOWED_TRANSITIONS[existing.status]?.includes('scheduled') ?? false;
    const reschedule = existing.status === 'scheduled';
    if (!allows && !reschedule) {
      throw new BadRequestException(
        `Cannot schedule a work order in state '${existing.status}'`,
      );
    }
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end <= start) {
      throw new BadRequestException(
        'scheduledEnd must be after scheduledStart',
      );
    }

    // Tenant + flag check on the technician.
    await this.assertTenantFks(orgId, { technicianId: dto.technicianId });

    // Best-effort conflict warning. The dispatch board surfaces these
    // explicitly; we don't block the write.
    const conflict = await this.prisma.workOrder.findFirst({
      where: {
        organizationId: orgId,
        id: { not: id },
        technicianId: dto.technicianId,
        status: { in: ['scheduled', 'in_progress'] },
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
      },
      select: { id: true, number: true },
    });
    if (conflict) {
      this.logger.warn(
        `[Wave H1] Double-booking warning: WO ${id} overlaps WO ${conflict.number} (${conflict.id}) for technician ${dto.technicianId} (org ${orgId})`,
      );
    }

    const fromStatus = existing.status;
    const toStatus = 'scheduled';

    return this.prisma.withOrganization(orgId, async (tx) => {
      await tx.workOrder.update({
        where: { id, organizationId: orgId },
        data: {
          technicianId: dto.technicianId,
          scheduledStart: start,
          scheduledEnd: end,
          status: toStatus,
        },
      });
      if (fromStatus !== toStatus) {
        await tx.workOrderStatusHistory.create({
          data: {
            organizationId: orgId,
            workOrderId: id,
            fromStatus,
            toStatus,
            changedById: userId,
          },
        });
      } else {
        // Re-schedule (same status). Still log it so the timeline shows
        // the change of window + technician — operationally the audit
        // story is "this WO was re-dispatched".
        await tx.workOrderStatusHistory.create({
          data: {
            organizationId: orgId,
            workOrderId: id,
            fromStatus,
            toStatus,
            changedById: userId,
            notes: 'Rescheduled',
          },
        });
      }
      return tx.workOrder.findFirst({
        where: { id, organizationId: orgId },
        include: this.detailInclude,
      });
    });
  }

  // ─── Start (scheduled → in_progress) ───────────────────────

  /**
   * Technician marks the WO as "I'm on site, work has begun".
   *
   * Authorization: the calling user must EITHER be the assigned
   * technician OR hold the `field-service.manage` permission (admin
   * override, e.g. dispatcher starts on the tech's behalf when their
   * phone is dead). We accept a small caller profile from the
   * controller rather than re-querying the user inside the service —
   * the caller already has the JWT context.
   */
  async start(
    orgId: string,
    user: {
      id: string;
      isAdmin?: boolean;
      role?: { permissions?: Record<string, Record<string, boolean>> };
    },
    id: string,
    dto: StatusTransitionDto,
  ) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('in_progress')) {
      throw new BadRequestException(
        `Work order in '${existing.status}' status cannot be started`,
      );
    }

    const isAssignedTech =
      !!existing.technicianId && existing.technicianId === user.id;
    const canManage =
      user.isAdmin === true ||
      user.role?.permissions?.['field-service']?.manage === true;
    if (!isAssignedTech && !canManage) {
      throw new ForbiddenException(
        'Only the assigned technician (or a dispatcher with field-service.manage) can start this work order',
      );
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      await tx.workOrder.update({
        where: { id, organizationId: orgId },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
        },
      });
      await tx.workOrderStatusHistory.create({
        data: {
          organizationId: orgId,
          workOrderId: id,
          fromStatus: existing.status,
          toStatus: 'in_progress',
          changedById: user.id,
          notes: dto.notes ?? null,
        },
      });
      return tx.workOrder.findFirst({
        where: { id, organizationId: orgId },
        include: this.detailInclude,
      });
    });
  }

  // ─── Complete (in_progress → completed) ────────────────────

  /**
   * Technician closes out the work order. May replace the line items
   * with the actual materials used + labor performed (the original draft
   * lines were estimates).
   */
  async complete(
    orgId: string,
    user: {
      id: string;
      isAdmin?: boolean;
      role?: { permissions?: Record<string, Record<string, boolean>> };
    },
    id: string,
    dto: CompleteWorkOrderDto,
  ) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('completed')) {
      throw new BadRequestException(
        `Work order in '${existing.status}' status cannot be completed`,
      );
    }

    const isAssignedTech =
      !!existing.technicianId && existing.technicianId === user.id;
    const canManage =
      user.isAdmin === true ||
      user.role?.permissions?.['field-service']?.manage === true;
    if (!isAssignedTech && !canManage) {
      throw new ForbiddenException(
        'Only the assigned technician (or a dispatcher with field-service.manage) can complete this work order',
      );
    }

    if (dto.finalLineItems) {
      await this.assertTenantFks(orgId, { lineItems: dto.finalLineItems });
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      if (dto.finalLineItems) {
        await tx.workOrderLineItem.deleteMany({
          where: { workOrderId: id, organizationId: orgId },
        });
        const built = this.buildLineRows(orgId, id, dto.finalLineItems);
        if (built.rows.length > 0) {
          await tx.workOrderLineItem.createMany({ data: built.rows });
        }
      }

      await tx.workOrder.update({
        where: { id, organizationId: orgId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          ...(dto.notes !== undefined && { completionNotes: dto.notes }),
        },
      });
      await tx.workOrderStatusHistory.create({
        data: {
          organizationId: orgId,
          workOrderId: id,
          fromStatus: existing.status,
          toStatus: 'completed',
          changedById: user.id,
          notes: dto.notes ?? null,
        },
      });
      return tx.workOrder.findFirst({
        where: { id, organizationId: orgId },
        include: this.detailInclude,
      });
    });
  }

  // ─── Cancel ────────────────────────────────────────────────

  /**
   * Cancel a non-terminal WO. Stamps `cancelledAt` + writes history.
   * Allowed from draft / scheduled / in_progress.
   */
  async cancel(
    orgId: string,
    userId: string,
    id: string,
    dto: StatusTransitionDto,
  ) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('cancelled')) {
      throw new BadRequestException(
        `Work order in '${existing.status}' status cannot be cancelled (already terminal)`,
      );
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      await tx.workOrder.update({
        where: { id, organizationId: orgId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      });
      await tx.workOrderStatusHistory.create({
        data: {
          organizationId: orgId,
          workOrderId: id,
          fromStatus: existing.status,
          toStatus: 'cancelled',
          changedById: userId,
          notes: dto.notes ?? null,
        },
      });
      return tx.workOrder.findFirst({
        where: { id, organizationId: orgId },
        include: this.detailInclude,
      });
    });
  }
}
