/**
 * CRUD for approval process definitions (Wave E1).
 *
 * A process is a multi-step approval chain tied to one entity type
 * (invoice / opportunity / expense / custom). Each step resolves to a
 * specific user, any user in a role, or the requester's manager
 * (manager-type is reserved — see TODO in approval-requests.service.ts).
 *
 * Tenant isolation: every read AND write includes an explicit
 * `where: { ..., organizationId: orgId }` clause. The Wave D code
 * reviewer caught three slices missing this on writes — do not regress.
 *
 * Step inserts run inside the same $transaction as the process row so
 * a partial process (header without steps) can never be persisted.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateProcessDto,
  CreateStepDto,
  UpdateProcessDto,
} from './approvals.dto';

@Injectable()
export class ApprovalProcessesService {
  constructor(private prisma: PrismaService) {}

  // ─── List / Find ──────────────────────────────────────────────

  async list(
    orgId: string,
    query: {
      entityType?: string;
      active?: boolean;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { entityType, active } = query;
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const where: any = { organizationId: orgId };
      if (entityType) where.entityType = entityType;
      if (typeof active === 'boolean') where.active = active;

      const [data, total] = await Promise.all([
        tx.approvalProcess.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
          include: {
            steps: { orderBy: { order: 'asc' } },
            _count: { select: { requests: true } },
          },
        }),
        tx.approvalProcess.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const row = await tx.approvalProcess.findFirst({
        where: { id, organizationId: orgId },
        include: {
          steps: { orderBy: { order: 'asc' } },
        },
      });
      if (!row) throw new NotFoundException('Approval process not found');
      return row;
    });
  }

  // ─── Create ───────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreateProcessDto) {
    await this.validateSteps(orgId, dto.steps);

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // TOCTOU re-check: the pre-transaction validateSteps gives a clean
      // 400 UX, but a user/role could be deleted between that check and
      // the createMany below. Re-verify cross-tenant membership inside
      // the transaction; if anything dropped, abort with 409.
      await this.assertStepRefsStillExist(tx, orgId, dto.steps);

      const process = await tx.approvalProcess.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          entityType: dto.entityType,
          active: dto.active ?? true,
          triggerCondition: (dto.triggerCondition ?? {}) as object,
          createdById: userId ?? null,
        },
      });

      // Insert steps inside the SAME transaction so a half-built
      // process (header without steps) can never be persisted.
      await tx.approvalStep.createMany({
        data: dto.steps.map((s) => ({
          organizationId: orgId,
          processId: process.id,
          order: s.order,
          approverType: s.approverType,
          approverUserId: s.approverUserId ?? null,
          approverRoleId: s.approverRoleId ?? null,
          name: s.name ?? null,
        })),
      });

      return tx.approvalProcess.findFirst({
        where: { id: process.id, organizationId: orgId },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ─── Update ───────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateProcessDto) {
    // Pre-flight tenant + existence check (throws 404 if missing).
    await this.findOne(orgId, id);
    if (dto.steps) {
      await this.validateSteps(orgId, dto.steps);
    }

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      await tx.approvalProcess.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.entityType !== undefined && { entityType: dto.entityType }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.triggerCondition !== undefined && {
            triggerCondition: dto.triggerCondition as object,
          }),
        },
      });

      // If steps were sent, replace the existing set. We delete + insert
      // (rather than diff in-place) because step ordering is critical
      // and a partial sync would leave the table in a transient state
      // where a concurrent decide() could see a half-applied chain.
      // Atomic inside the same $transaction.
      if (dto.steps) {
        // TOCTOU re-check (see create()): re-verify approver refs still
        // belong to this org inside the transaction so a delete between
        // pre-flight validateSteps and createMany can't slip through.
        await this.assertStepRefsStillExist(tx, orgId, dto.steps);

        await tx.approvalStep.deleteMany({
          where: { processId: id, organizationId: orgId },
        });
        await tx.approvalStep.createMany({
          data: dto.steps.map((s) => ({
            organizationId: orgId,
            processId: id,
            order: s.order,
            approverType: s.approverType,
            approverUserId: s.approverUserId ?? null,
            approverRoleId: s.approverRoleId ?? null,
            name: s.name ?? null,
          })),
        });
      }

      return tx.approvalProcess.findFirst({
        where: { id, organizationId: orgId },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ─── Delete ───────────────────────────────────────────────────

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // Refuse delete while any pending requests reference the process
      // — the SQL FK is ON DELETE RESTRICT, but we surface a clean 400
      // instead of letting Postgres raise an opaque constraint error.
      const pendingCount = await tx.approvalRequest.count({
        where: { processId: id, organizationId: orgId, status: 'pending' },
      });
      if (pendingCount > 0) {
        throw new BadRequestException(
          `Cannot delete process — ${pendingCount} pending request(s) still reference it`,
        );
      }

      // Also refuse if ANY (completed) requests exist — the audit trail
      // would be orphaned. Cancel/archive workflow is a follow-up.
      const anyCount = await tx.approvalRequest.count({
        where: { processId: id, organizationId: orgId },
      });
      if (anyCount > 0) {
        throw new BadRequestException(
          `Cannot delete process — ${anyCount} historical request(s) reference it. Mark it inactive instead.`,
        );
      }

      await tx.approvalProcess.delete({
        where: { id, organizationId: orgId },
      });
      return { deleted: true };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Validate each step's approver references belong to the SAME org.
   * Runs BEFORE the create/update $transaction so we can return a clean
   * 400 without rolling back a partially-built row.
   */
  private async validateSteps(orgId: string, steps: CreateStepDto[]) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('At least one approval step is required');
    }

    // Unique orders (otherwise the chain can't advance deterministically).
    const orders = new Set<number>();
    for (const s of steps) {
      if (orders.has(s.order)) {
        throw new BadRequestException(
          `Duplicate step order ${s.order} — each step must have a unique order`,
        );
      }
      orders.add(s.order);

      if (s.approverType === 'user') {
        if (!s.approverUserId) {
          throw new BadRequestException(
            'approverUserId is required when approverType=user',
          );
        }
      } else if (s.approverType === 'role') {
        if (!s.approverRoleId) {
          throw new BadRequestException(
            'approverRoleId is required when approverType=role',
          );
        }
      }
      // 'manager' needs no FK at definition time — it's resolved
      // dynamically at decide-time against the requester's manager.
    }

    // Batch cross-tenant guards for FKs accepted from input.
    const userIds = steps
      .filter((s) => s.approverType === 'user' && s.approverUserId)
      .map((s) => s.approverUserId as string);
    const roleIds = steps
      .filter((s) => s.approverType === 'role' && s.approverRoleId)
      .map((s) => s.approverRoleId as string);

    await this.prisma.withOrganization(orgId, async (tx: any) => {
      if (userIds.length) {
        const found = await tx.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true },
        });
        if (found.length !== new Set(userIds).size) {
          throw new BadRequestException(
            'One or more approverUserId values do not belong to this organization',
          );
        }
      }
      if (roleIds.length) {
        const found = await tx.role.findMany({
          where: { id: { in: roleIds }, organizationId: orgId },
          select: { id: true },
        });
        if (found.length !== new Set(roleIds).size) {
          throw new BadRequestException(
            'One or more approverRoleId values do not belong to this organization',
          );
        }
      }
    });
  }

  /**
   * Transaction-scoped re-validation of step approver refs.
   *
   * Closes the TOCTOU window between the pre-flight validateSteps()
   * (which returns a clean 400 to the caller) and the actual
   * createMany() that persists the steps. If a user or role was
   * deleted between the two checks, abort with 409 so the caller knows
   * to re-fetch the org's approvers and try again.
   */
  private async assertStepRefsStillExist(
    tx: any,
    orgId: string,
    steps: CreateStepDto[],
  ) {
    const userIds = Array.from(
      new Set(
        steps
          .filter((s) => s.approverType === 'user' && s.approverUserId)
          .map((s) => s.approverUserId as string),
      ),
    );
    const roleIds = Array.from(
      new Set(
        steps
          .filter((s) => s.approverType === 'role' && s.approverRoleId)
          .map((s) => s.approverRoleId as string),
      ),
    );

    if (userIds.length) {
      const found = await tx.user.findMany({
        where: { id: { in: userIds }, organizationId: orgId },
        select: { id: true },
      });
      if (found.length !== userIds.length) {
        throw new ConflictException(
          'Approver(s) no longer in this organization — re-validate the process',
        );
      }
    }
    if (roleIds.length) {
      const found = await tx.role.findMany({
        where: { id: { in: roleIds }, organizationId: orgId },
        select: { id: true },
      });
      if (found.length !== roleIds.length) {
        throw new ConflictException(
          'Approver(s) no longer in this organization — re-validate the process',
        );
      }
    }
  }
}
