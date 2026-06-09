/**
 * Live approval requests + decisions (Wave E1).
 *
 * The load-bearing method is `decide()`: it executes the eligibility
 * check, the decision insert, the request status update, and the step
 * advance inside ONE `prisma.$transaction` so the chain can never
 * advance without a matching decision row (and vice-versa).
 *
 * Tenant isolation: every read AND write includes an explicit
 * `where: { organizationId: orgId }` clause — defense in depth. The
 * Wave D code reviewer caught three slices missing this on writes.
 *
 * Future-proof hook: when a request transitions to a terminal state
 * (approved / rejected / cancelled) we call `onCompleted()` which today
 * just logs; downstream subsystems (invoice send, opportunity unlock,
 * expense reimburse) will subscribe here.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateRequestDto, DecisionDto } from './approvals.dto';

@Injectable()
export class ApprovalRequestsService {
  private readonly logger = new Logger(ApprovalRequestsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── List / Find ──────────────────────────────────────────────

  async list(
    orgId: string,
    query: {
      status?: string;
      targetType?: string;
      targetId?: string;
      requestedById?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { status, targetType, targetId, requestedById } = query;
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (targetType) where.targetType = targetType;
      if (targetId) where.targetId = targetId;
      if (requestedById) where.requestedById = requestedById;

      const [data, total] = await Promise.all([
        tx.approvalRequest.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: limit,
          include: {
            process: {
              select: { id: true, name: true, entityType: true },
            },
          },
        }),
        tx.approvalRequest.count({ where }),
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
      const row = await tx.approvalRequest.findFirst({
        where: { id, organizationId: orgId },
        include: {
          process: {
            include: { steps: { orderBy: { order: 'asc' } } },
          },
          decisions: { orderBy: { decidedAt: 'asc' } },
        },
      });
      if (!row) throw new NotFoundException('Approval request not found');
      return row;
    });
  }

  /**
   * Requests currently pending the given user's decision.
   *
   * A request matches if its current step:
   *   - is approverType='user' and approverUserId === userId, OR
   *   - is approverType='role' and the user holds that role (legacy
   *     User.roleId OR any UserOrganizationMembership.roleId for the
   *     same org)
   *
   * TODO(approval-manager): approverType='manager' is not yet
   * implemented — we don't track a reports-to chain. Resolve at
   * decide-time once the org-chart slice lands.
   */
  async myPending(orgId: string, userId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // 1) Figure out which roles the user holds in this org. Both
      //    the legacy primary roleId on `users` and any matching
      //    membership row are considered, mirroring what RbacGuard
      //    accepts elsewhere in the codebase.
      const [user, memberships] = await Promise.all([
        tx.user.findFirst({
          where: { id: userId, organizationId: orgId },
          select: { roleId: true },
        }),
        tx.userOrganizationMembership.findMany({
          where: { userId, organizationId: orgId },
          select: { roleId: true },
        }),
      ]);

      const roleIds = new Set<string>();
      if (user?.roleId) roleIds.add(user.roleId);
      for (const m of memberships) {
        if (m.roleId) roleIds.add(m.roleId);
      }

      // 2) Pull every pending request in the org and filter in JS.
      //    For the page sizes we expect (<1k pending per org) this is
      //    cheaper and clearer than a relational anti-join, and the
      //    queries each have a covering index.
      // Cap at 500 — orgs with more than 500 concurrent pending
      // requests need a Postgres-side eligibility join (TODO Wave E1.1).
      const pending = await tx.approvalRequest.findMany({
        where: { organizationId: orgId, status: 'pending' },
        orderBy: { startedAt: 'desc' },
        take: 500,
        include: {
          decisions: { select: { stepOrder: true, decidedById: true } },
          process: {
            include: { steps: { orderBy: { order: 'asc' } } },
          },
        },
      });

      const mine = pending.filter((req: any) => {
        const step = req.process.steps.find(
          (s: any) => s.order === req.currentStepOrder,
        );
        if (!step) return false;
        let eligible = false;
        if (step.approverType === 'user') {
          eligible = step.approverUserId === userId;
        } else if (step.approverType === 'role') {
          eligible = !!(step.approverRoleId && roleIds.has(step.approverRoleId));
        } else {
          // 'manager' — see TODO above.
          eligible = false;
        }
        if (!eligible) return false;
        // Exclude requests where the user has already decided the
        // current step (e.g. role-based approvals where the user
        // already submitted a decision on a prior visit — without
        // this, the same row stays in their pending list forever).
        const alreadyDecided = req.decisions.some(
          (d: any) =>
            d.stepOrder === req.currentStepOrder && d.decidedById === userId,
        );
        if (alreadyDecided) return false;
        return true;
      });

      return { data: mine, total: mine.length };
    });
  }

  // ─── Create ───────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreateRequestDto) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // Cross-tenant guard on processId (FK alone allows cross-tenant
      // ids — guard explicitly so a forged id can't escape the tenant).
      const process = await tx.approvalProcess.findFirst({
        where: { id: dto.processId, organizationId: orgId },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
      if (!process) {
        throw new BadRequestException('Approval process not found for this organization');
      }
      if (!process.active) {
        throw new BadRequestException('Approval process is inactive');
      }
      if (!process.steps.length) {
        throw new BadRequestException('Approval process has no steps configured');
      }

      // Start at the first step's order.
      const firstOrder = process.steps[0].order;

      return tx.approvalRequest.create({
        data: {
          organizationId: orgId,
          processId: process.id,
          targetType: dto.targetType,
          targetId: dto.targetId,
          status: 'pending',
          currentStepOrder: firstOrder,
          requestedById: userId,
        },
        include: {
          process: { select: { id: true, name: true, entityType: true } },
        },
      });
    });
  }

  // ─── Decide (transactional) ───────────────────────────────────

  /**
   * Apply a single approve/reject decision to a pending request.
   *
   * All three writes — decision insert, request status update,
   * current-step advance — happen inside ONE `$transaction` callback.
   * Without that, a crashed request could leave the chain advanced
   * without a corresponding decision row in the audit log.
   *
   * Eligibility:
   *   - approverType='user' → user must equal the step's approverUserId.
   *   - approverType='role' → user must hold the step's role (via
   *     User.roleId OR a matching UserOrganizationMembership row).
   *   - approverType='manager' → currently throws 400 (not implemented).
   */
  async decide(
    orgId: string,
    userId: string,
    requestId: string,
    dto: DecisionDto,
  ) {
    let completedRequestId: string | null = null;
    let completedStatus: 'approved' | 'rejected' | null = null;

    let result;
    try {
      result = await this.prisma.withOrganization(orgId, async (tx: any) => {
      // Load the request + its process + steps under the tenant lock.
      const request = await tx.approvalRequest.findFirst({
        where: { id: requestId, organizationId: orgId },
        include: {
          process: {
            include: { steps: { orderBy: { order: 'asc' } } },
          },
        },
      });
      if (!request) throw new NotFoundException('Approval request not found');
      if (request.status !== 'pending') {
        throw new BadRequestException(
          `Request is ${request.status} — only pending requests accept decisions`,
        );
      }

      const currentStep = request.process.steps.find(
        (s: any) => s.order === request.currentStepOrder,
      );
      if (!currentStep) {
        throw new BadRequestException(
          'Current step not found in process — process configuration drift',
        );
      }

      // ─── Eligibility check ────────────────────────────────
      if (currentStep.approverType === 'user') {
        if (currentStep.approverUserId !== userId) {
          throw new ForbiddenException(
            'You are not the approver for the current step',
          );
        }
      } else if (currentStep.approverType === 'role') {
        if (!currentStep.approverRoleId) {
          throw new BadRequestException(
            'Step is misconfigured: approverType=role but approverRoleId is null',
          );
        }
        const [user, memberships] = await Promise.all([
          tx.user.findFirst({
            where: { id: userId, organizationId: orgId },
            select: { roleId: true },
          }),
          tx.userOrganizationMembership.findMany({
            where: { userId, organizationId: orgId },
            select: { roleId: true },
          }),
        ]);
        const roleIds = new Set<string>();
        if (user?.roleId) roleIds.add(user.roleId);
        for (const m of memberships) if (m.roleId) roleIds.add(m.roleId);

        if (!roleIds.has(currentStep.approverRoleId)) {
          throw new ForbiddenException(
            'You do not hold the role required to decide on the current step',
          );
        }
      } else {
        // 'manager' — see TODO at the top of the file.
        throw new BadRequestException(
          "approverType='manager' is not yet implemented",
        );
      }

      // ─── Decision insert ──────────────────────────────────
      await tx.approvalDecision.create({
        data: {
          organizationId: orgId,
          requestId: request.id,
          stepOrder: request.currentStepOrder,
          decidedById: userId,
          decision: dto.decision,
          comment: dto.comment ?? null,
        },
      });

      // ─── Advance / terminate ──────────────────────────────
      if (dto.decision === 'reject') {
        // One reject anywhere in the chain kills the request.
        const updated = await tx.approvalRequest.update({
          where: { id: request.id, organizationId: orgId },
          data: { status: 'rejected', completedAt: new Date() },
          include: {
            decisions: { orderBy: { decidedAt: 'asc' } },
            process: { select: { id: true, name: true, entityType: true } },
          },
        });
        completedRequestId = updated.id;
        completedStatus = 'rejected';
        return updated;
      }

      // Approve: look for the next step (strictly greater order).
      const nextStep = request.process.steps.find(
        (s: any) => s.order > request.currentStepOrder,
      );
      if (!nextStep) {
        // Last step approved — request is fully approved.
        const updated = await tx.approvalRequest.update({
          where: { id: request.id, organizationId: orgId },
          data: { status: 'approved', completedAt: new Date() },
          include: {
            decisions: { orderBy: { decidedAt: 'asc' } },
            process: { select: { id: true, name: true, entityType: true } },
          },
        });
        completedRequestId = updated.id;
        completedStatus = 'approved';
        return updated;
      }

      // Mid-chain approval — advance to the next step.
      return tx.approvalRequest.update({
        where: { id: request.id, organizationId: orgId },
        data: { currentStepOrder: nextStep.order },
        include: {
          decisions: { orderBy: { decidedAt: 'asc' } },
          process: { select: { id: true, name: true, entityType: true } },
        },
      });
    });
    } catch (err: any) {
      // P2002 on (requestId, stepOrder) — a concurrent decide() won the
      // race and already inserted a decision for this exact step. The
      // unique constraint added in migration 030 prevents the double-
      // decide that would otherwise corrupt the audit log and double-
      // advance the chain. Surface as a clean 409 to the caller.
      if (err?.code === 'P2002') {
        throw new ConflictException('This step has already been decided');
      }
      throw err;
    }

    // Fire the completion hook AFTER the transaction commits — never
    // inside the callback (don't want side-effects to see a half-
    // committed view, and don't want a thrown hook to roll back the
    // decision).
    if (completedRequestId && completedStatus) {
      this.onCompleted(orgId, completedRequestId, completedStatus);
    }

    return result;
  }

  // ─── Cancel ───────────────────────────────────────────────────

  /**
   * Cancel a pending request. Only the original requester may cancel;
   * approvers reject (which is recorded in the decision audit log).
   */
  async cancel(orgId: string, userId: string, requestId: string) {
    const updated = await this.prisma.withOrganization(orgId, async (tx: any) => {
      const request = await tx.approvalRequest.findFirst({
        where: { id: requestId, organizationId: orgId },
        select: { id: true, status: true, requestedById: true },
      });
      if (!request) throw new NotFoundException('Approval request not found');
      if (request.status !== 'pending') {
        throw new BadRequestException(
          `Request is ${request.status} — only pending requests can be cancelled`,
        );
      }
      if (request.requestedById !== userId) {
        throw new ForbiddenException(
          'Only the requester can cancel a pending request',
        );
      }
      return tx.approvalRequest.update({
        where: { id: requestId, organizationId: orgId },
        data: { status: 'cancelled', completedAt: new Date() },
      });
    });

    this.onCompleted(orgId, updated.id, 'cancelled');
    return updated;
  }

  // ─── Future-proof completion hook ─────────────────────────────

  /**
   * Stub completion hook — wired today to a log line. Downstream
   * subsystems (e.g. "if the request was for an invoice over $10K and
   * it's now approved, mark the invoice as cleared-to-send") will
   * subscribe here. Kept on the service itself rather than via the
   * EventEmitter for now so the call site stays type-safe; a future
   * refactor can route through EventEmitterModule with no API change
   * to the caller of `decide()`.
   */
  private onCompleted(
    orgId: string,
    requestId: string,
    finalStatus: 'approved' | 'rejected' | 'cancelled',
  ) {
    this.logger.log(
      `[approval.onCompleted] org=${orgId} request=${requestId} status=${finalStatus}`,
    );
  }
}
