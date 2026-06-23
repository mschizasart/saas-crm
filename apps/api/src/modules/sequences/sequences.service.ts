import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';

// ─── DTOs (inline, matching campaigns convention — plain interfaces) ─────────

export interface CreateSequenceDto {
  name: string;
}

export interface UpdateSequenceDto {
  name?: string;
  description?: string;
}

export interface CreateStepDto {
  type: 'email' | 'task' | 'wait';
  delayMinutes?: number;
  emailSubject?: string | null;
  emailBody?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
  position?: number;
}

export type UpdateStepDto = Partial<CreateStepDto>;

export interface ReorderStepsDto {
  orderedStepIds: string[];
}

export interface EnrollDto {
  recipients: Array<{ type: 'lead' | 'client'; id: string }>;
}

const VALID_STEP_TYPES = ['email', 'task', 'wait'];

@Injectable()
export class SequencesService {
  private readonly logger = new Logger(SequencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailsService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const rows = await tx.sequence.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
      const ids = rows.map((r: any) => r.id);
      const enrolledBySeq = new Map<string, number>();
      const activeBySeq = new Map<string, number>();
      if (ids.length > 0) {
        const grouped = await tx.sequenceEnrollment.groupBy({
          by: ['sequenceId', 'status'],
          where: { organizationId: orgId, sequenceId: { in: ids } },
          _count: { _all: true },
        });
        for (const g of grouped) {
          enrolledBySeq.set(
            g.sequenceId,
            (enrolledBySeq.get(g.sequenceId) ?? 0) + g._count._all,
          );
          if (g.status === 'active') {
            activeBySeq.set(g.sequenceId, g._count._all);
          }
        }
      }
      return rows.map((r: any) => ({
        ...r,
        enrolledCount: enrolledBySeq.get(r.id) ?? 0,
        activeCount: activeBySeq.get(r.id) ?? 0,
      }));
    });
  }

  async findOne(orgId: string, id: string) {
    const sequence = await this.prisma.withOrganization(orgId, async (tx: any) => {
      const seq = await tx.sequence.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!seq) return null;
      const steps = await tx.sequenceStep.findMany({
        where: { sequenceId: id, organizationId: orgId },
        orderBy: { position: 'asc' },
      });
      return { ...seq, steps };
    });
    if (!sequence) throw new NotFoundException('Sequence not found');
    return sequence;
  }

  async create(orgId: string, dto: CreateSequenceDto, userId?: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Sequence name is required');
    }
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          status: 'draft',
          createdById: userId ?? null,
        },
      }),
    );
  }

  async update(orgId: string, id: string, dto: UpdateSequenceDto) {
    await this.getSequenceOrThrow(orgId, id);
    const data: any = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim()) {
        throw new BadRequestException('Sequence name cannot be empty');
      }
      data.name = dto.name.trim();
    }
    if (dto.description !== undefined) data.description = dto.description;
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.update({ where: { id }, data }),
    );
  }

  async remove(orgId: string, id: string) {
    const seq = await this.getSequenceOrThrow(orgId, id);
    if (seq.status !== 'draft') {
      throw new ConflictException('Only draft sequences can be deleted');
    }
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      // Steps + enrollments cascade via FK (migration 043).
      await tx.sequence.delete({ where: { id } });
    });
    return { deleted: true };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async activate(orgId: string, id: string) {
    const seq = await this.getSequenceOrThrow(orgId, id);
    const steps = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequenceStep.findMany({
        where: { sequenceId: id, organizationId: orgId },
        orderBy: { position: 'asc' },
      }),
    );
    if (steps.length === 0) {
      throw new BadRequestException(
        'Cannot activate a sequence with no steps',
      );
    }
    for (const s of steps) {
      if (s.type === 'email' && (!s.emailSubject?.trim() || !s.emailBody?.trim())) {
        throw new BadRequestException(
          `Email step at position ${s.position} is missing a subject or body`,
        );
      }
    }
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.update({ where: { id }, data: { status: 'active' } }),
    );
  }

  async pause(orgId: string, id: string) {
    await this.getSequenceOrThrow(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.update({ where: { id }, data: { status: 'paused' } }),
    );
  }

  async resume(orgId: string, id: string) {
    const seq = await this.getSequenceOrThrow(orgId, id);
    if (seq.status !== 'paused') {
      throw new ConflictException('Only a paused sequence can be resumed');
    }
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.update({ where: { id }, data: { status: 'active' } }),
    );
  }

  // ─── Steps ─────────────────────────────────────────────────────────────

  async addStep(orgId: string, sequenceId: string, dto: CreateStepDto) {
    await this.getSequenceOrThrow(orgId, sequenceId);
    if (!VALID_STEP_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Invalid step type: ${dto.type}`);
    }
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // Append at the end unless an explicit position is given.
      const last = await tx.sequenceStep.findFirst({
        where: { sequenceId, organizationId: orgId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const position =
        dto.position !== undefined ? dto.position : (last ? last.position + 1 : 0);
      return tx.sequenceStep.create({
        data: {
          sequenceId,
          organizationId: orgId,
          position,
          type: dto.type,
          delayMinutes: dto.delayMinutes ?? 0,
          emailSubject: dto.emailSubject ?? null,
          emailBody: dto.emailBody ?? null,
          taskTitle: dto.taskTitle ?? null,
          taskDescription: dto.taskDescription ?? null,
        },
      });
    });
  }

  async updateStep(
    orgId: string,
    sequenceId: string,
    stepId: string,
    dto: UpdateStepDto,
  ) {
    await this.getSequenceOrThrow(orgId, sequenceId);
    if (dto.type !== undefined && !VALID_STEP_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Invalid step type: ${dto.type}`);
    }
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.sequenceStep.findFirst({
        where: { id: stepId, sequenceId, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Step not found');
      const data: any = {};
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.delayMinutes !== undefined) data.delayMinutes = dto.delayMinutes;
      if (dto.emailSubject !== undefined) data.emailSubject = dto.emailSubject;
      if (dto.emailBody !== undefined) data.emailBody = dto.emailBody;
      if (dto.taskTitle !== undefined) data.taskTitle = dto.taskTitle;
      if (dto.taskDescription !== undefined)
        data.taskDescription = dto.taskDescription;
      if (dto.position !== undefined) data.position = dto.position;
      return tx.sequenceStep.update({ where: { id: stepId }, data });
    });
  }

  async removeStep(orgId: string, sequenceId: string, stepId: string) {
    await this.getSequenceOrThrow(orgId, sequenceId);
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.sequenceStep.findFirst({
        where: { id: stepId, sequenceId, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Step not found');
      await tx.sequenceStep.delete({ where: { id: stepId } });
    });
    return { deleted: true };
  }

  async reorderSteps(
    orgId: string,
    sequenceId: string,
    orderedStepIds: string[],
  ) {
    await this.getSequenceOrThrow(orgId, sequenceId);
    if (!Array.isArray(orderedStepIds) || orderedStepIds.length === 0) {
      throw new BadRequestException('orderedStepIds must be a non-empty array');
    }
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const steps = await tx.sequenceStep.findMany({
        where: { sequenceId, organizationId: orgId },
        select: { id: true },
      });
      const known = new Set(steps.map((s: any) => s.id));
      if (
        orderedStepIds.length !== steps.length ||
        !orderedStepIds.every((id) => known.has(id))
      ) {
        throw new BadRequestException(
          'orderedStepIds must contain exactly the sequence step ids',
        );
      }
      // Two-pass to dodge the @@unique(sequenceId, position) constraint: first
      // park every step at a high temporary position, then write the final
      // 0-based ordering. Otherwise an intermediate write could collide.
      const offset = steps.length + 1000;
      for (let i = 0; i < orderedStepIds.length; i++) {
        await tx.sequenceStep.update({
          where: { id: orderedStepIds[i] },
          data: { position: offset + i },
        });
      }
      for (let i = 0; i < orderedStepIds.length; i++) {
        await tx.sequenceStep.update({
          where: { id: orderedStepIds[i] },
          data: { position: i },
        });
      }
      return tx.sequenceStep.findMany({
        where: { sequenceId, organizationId: orgId },
        orderBy: { position: 'asc' },
      });
    });
  }

  // ─── Enrollment ────────────────────────────────────────────────────────

  /**
   * Enroll leads/clients into an ACTIVE sequence. Resolves each recipient's
   * email + name (clients use their first active contact's email, like
   * campaigns). Recipients with no email are skipped. Duplicates are skipped
   * via the @@unique(sequenceId, recipientType, recipientId) constraint.
   * currentStepIndex starts at 0 and nextStepAt = now + step0.delayMinutes.
   */
  async enroll(
    orgId: string,
    sequenceId: string,
    recipients: EnrollDto['recipients'],
    userId?: string,
  ) {
    const seq = await this.getSequenceOrThrow(orgId, sequenceId);
    if (seq.status !== 'active') {
      throw new ConflictException(
        'Recipients can only be enrolled into an active sequence',
      );
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new BadRequestException('No recipients provided');
    }

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const step0 = await tx.sequenceStep.findFirst({
        where: { sequenceId, organizationId: orgId, position: 0 },
      });
      if (!step0) {
        throw new BadRequestException('Sequence has no first step');
      }
      const nextStepAt = new Date(Date.now() + (step0.delayMinutes ?? 0) * 60_000);

      let enrolled = 0;
      let skipped = 0;
      const skippedReasons: Array<{ id: string; reason: string }> = [];

      for (const r of recipients) {
        const resolved = await this.resolveRecipient(tx, orgId, r.type, r.id);
        if (!resolved) {
          skipped++;
          skippedReasons.push({ id: r.id, reason: 'no_email' });
          continue;
        }
        try {
          await tx.sequenceEnrollment.create({
            data: {
              organizationId: orgId,
              sequenceId,
              recipientType: r.type,
              recipientId: r.id,
              recipientEmail: resolved.email,
              recipientName: resolved.name,
              status: 'active',
              currentStepIndex: 0,
              nextStepAt,
              enrolledById: userId ?? null,
            },
          });
          enrolled++;
        } catch (err: any) {
          if (err?.code === 'P2002') {
            skipped++;
            skippedReasons.push({ id: r.id, reason: 'already_enrolled' });
          } else {
            throw err;
          }
        }
      }
      return { enrolled, skipped, skippedReasons };
    });
  }

  async listEnrollments(orgId: string, sequenceId: string) {
    await this.getSequenceOrThrow(orgId, sequenceId);
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequenceEnrollment.findMany({
        where: { organizationId: orgId, sequenceId },
        orderBy: { enrolledAt: 'desc' },
      }),
    );
  }

  async unenroll(orgId: string, enrollmentId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.sequenceEnrollment.findFirst({
        where: { id: enrollmentId, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Enrollment not found');
      return tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', nextStepAt: null },
      });
    });
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  async stats(orgId: string, id: string) {
    await this.getSequenceOrThrow(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const grouped = await tx.sequenceEnrollment.groupBy({
        by: ['status'],
        where: { organizationId: orgId, sequenceId: id },
        _count: { _all: true },
      });
      const counts: Record<string, number> = {};
      let totalEnrolled = 0;
      for (const g of grouped) {
        counts[g.status] = g._count._all;
        totalEnrolled += g._count._all;
      }
      const emailsSent = await tx.sequenceStepExecution.count({
        where: {
          organizationId: orgId,
          type: 'email',
          status: 'sent',
          enrollment: { sequenceId: id },
        },
      });
      return {
        totalEnrolled,
        active: counts['active'] ?? 0,
        completed: counts['completed'] ?? 0,
        emailsSent,
      };
    });
  }

  // ─── Step engine ───────────────────────────────────────────────────────

  /**
   * Execute the step at `stepIndex` for an enrollment, then advance.
   *
   * IDEMPOTENCY: a stale/duplicate job (enrollment.currentStepIndex !==
   * stepIndex) is a no-op — returns { skipped: true }. The enrollment must
   * also be status 'active'. Email steps honor the unsubscribe suppression
   * list. After executing, currentStepIndex is incremented: if a next step
   * exists, nextStepAt = now + nextStep.delayMinutes; else the enrollment is
   * marked 'completed'. All DB work runs inside withOrganization.
   */
  async executeStep(orgId: string, enrollmentId: string, stepIndex: number) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const enrollment = await tx.sequenceEnrollment.findFirst({
        where: { id: enrollmentId, organizationId: orgId },
      });
      if (!enrollment) {
        this.logger.warn(`executeStep: enrollment ${enrollmentId} not found`);
        return { skipped: true, reason: 'not_found' };
      }
      if (enrollment.status !== 'active') {
        return { skipped: true, reason: `status_${enrollment.status}` };
      }
      if (enrollment.currentStepIndex !== stepIndex) {
        // Stale or duplicate job — the enrollment has already moved on.
        return { skipped: true, reason: 'stale_step' };
      }

      // FIX 2(a): Don't run steps for a sequence that's paused/archived/gone.
      // Skip WITHOUT advancing and WITHOUT clearing nextStepAt, so a resumed
      // sequence picks up exactly where it left off.
      const sequence = await tx.sequence.findFirst({
        where: { id: enrollment.sequenceId, organizationId: orgId },
      });
      if (!sequence || sequence.status !== 'active') {
        return { skipped: true, reason: 'sequence_not_active' };
      }

      // FIX 1: Idempotency guard against duplicate side effects on retry. If an
      // execution row already exists for this (enrollment, stepIndex), the side
      // effect already happened on a previous attempt that crashed before the
      // advance committed. Recover by ONLY advancing — never re-run the side
      // effect. The currentStepIndex === stepIndex guard above guarantees we
      // haven't already advanced, so this just resumes the interrupted advance.
      const existingExecution = await tx.sequenceStepExecution.findFirst({
        where: { enrollmentId, stepIndex, organizationId: orgId },
      });
      if (existingExecution) {
        await this.advance(tx, orgId, enrollment.sequenceId, enrollmentId, stepIndex);
        return { skipped: true, reason: 'already_executed' };
      }

      const step = await tx.sequenceStep.findFirst({
        where: {
          sequenceId: enrollment.sequenceId,
          organizationId: orgId,
          position: stepIndex,
        },
      });
      if (!step) {
        // FIX 3: The CURRENT step we were asked to run is gone (deleted under a
        // running enrollment). This is NOT a normal end-of-sequence completion
        // (that happens in advance() when the NEXT step is absent) — fail it.
        this.logger.warn(
          `executeStep: step at position ${stepIndex} for enrollment ${enrollmentId} not found — marking failed`,
        );
        // Record the failure reason on an execution row (the SequenceEnrollment
        // model has no `error` column; SequenceStepExecution does).
        await tx.sequenceStepExecution.create({
          data: {
            organizationId: orgId,
            enrollmentId,
            stepId: null,
            stepIndex,
            type: 'unknown',
            status: 'failed',
            error: 'step_not_found',
          },
        });
        await tx.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            nextStepAt: null,
          },
        });
        return { failed: true, reason: 'step_not_found' };
      }

      let execStatus: 'sent' | 'created' | 'skipped' | 'failed' | 'completed' =
        'skipped';
      let outboundMessageId: string | null = null;
      let error: string | null = null;

      try {
        if (step.type === 'email') {
          const suppressed = await this.isSuppressed(
            tx,
            orgId,
            enrollment.recipientEmail,
          );
          if (suppressed) {
            execStatus = 'skipped';
          } else {
            const { outboundMessageId: omId } = await this.emails.queue({
              orgId,
              to: enrollment.recipientEmail,
              subject: step.emailSubject ?? '',
              html: step.emailBody ?? '',
              tracking: { routedTo: 'sequence', routedToId: enrollment.id },
            });
            outboundMessageId = omId ?? null;
            execStatus = 'sent';
          }
        } else if (step.type === 'task') {
          await tx.task.create({
            data: {
              organizationId: orgId,
              name: step.taskTitle?.trim() || 'Sequence follow-up',
              description: step.taskDescription ?? null,
              // Link the task to the enrolled recipient via the generic
              // relType/relId pointer the Task model uses.
              relType: enrollment.recipientType,
              relId: enrollment.recipientId,
              createdBy: enrollment.enrolledById ?? null,
            },
          });
          execStatus = 'created';
        } else {
          // 'wait' — no side effect, just a delay marker. FIX 4: the wait step
          // "executed" successfully, so record 'completed' (not 'skipped',
          // which is reserved for suppressed emails).
          execStatus = 'completed';
        }
      } catch (err) {
        execStatus = 'failed';
        error = (err as Error).message?.slice(0, 500) ?? 'unknown';
        this.logger.warn(
          `Sequence step ${stepIndex} for enrollment ${enrollmentId} failed: ${error}`,
        );
      }

      await tx.sequenceStepExecution.create({
        data: {
          organizationId: orgId,
          enrollmentId,
          stepId: step.id,
          stepIndex,
          type: step.type,
          status: execStatus,
          outboundMessageId,
          error,
        },
      });

      // ── Advance ──────────────────────────────────────────────────────
      await this.advance(tx, orgId, enrollment.sequenceId, enrollmentId, stepIndex);

      return { executed: true, type: step.type, status: execStatus };
    });
  }

  /**
   * Advance an enrollment past the step at `stepIndex`. If a next step exists,
   * move currentStepIndex forward and schedule nextStepAt; otherwise mark the
   * enrollment 'completed'. Idempotent-safe: only advances when the enrollment
   * is still parked at `stepIndex` (callers guarantee this). Shared by the
   * normal execution path and the FIX 1 idempotency-recovery path.
   */
  private async advance(
    tx: any,
    orgId: string,
    sequenceId: string,
    enrollmentId: string,
    stepIndex: number,
  ) {
    const nextIndex = stepIndex + 1;
    const nextStep = await tx.sequenceStep.findFirst({
      where: {
        sequenceId,
        organizationId: orgId,
        position: nextIndex,
      },
    });

    if (nextStep) {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          currentStepIndex: nextIndex,
          nextStepAt: new Date(
            Date.now() + (nextStep.delayMinutes ?? 0) * 60_000,
          ),
        },
      });
    } else {
      // Normal end-of-sequence completion: no step at the next position.
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          currentStepIndex: nextIndex,
          status: 'completed',
          completedAt: new Date(),
          nextStepAt: null,
        },
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async getSequenceOrThrow(orgId: string, id: string) {
    const seq = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.sequence.findFirst({ where: { id, organizationId: orgId } }),
    );
    if (!seq) throw new NotFoundException('Sequence not found');
    return seq;
  }

  /**
   * Resolve a lead/client to { email, name }. Clients have no email column —
   * we use their first active contact's email (same approach as campaigns).
   * Returns null when no usable email is found.
   */
  private async resolveRecipient(
    tx: any,
    orgId: string,
    type: 'lead' | 'client',
    id: string,
  ): Promise<{ email: string; name: string | null } | null> {
    if (type === 'lead') {
      const lead = await tx.lead.findFirst({
        where: { id, organizationId: orgId },
        select: { name: true, email: true },
      });
      if (!lead?.email?.trim()) return null;
      return { email: lead.email.trim(), name: lead.name ?? null };
    }
    const client = await tx.client.findFirst({
      where: { id, organizationId: orgId },
      select: {
        company: true,
        contacts: {
          where: { type: 'contact', active: true },
          select: { email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!client) return null;
    const contact = client.contacts.find((c: any) => c.email?.trim());
    if (!contact) return null;
    const name =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
      client.company ||
      null;
    return { email: contact.email.trim(), name };
  }

  /** True when the email is on this org's unsubscribe suppression list. */
  private async isSuppressed(
    tx: any,
    orgId: string,
    email: string,
  ): Promise<boolean> {
    const row = await tx.emailUnsubscribe.findFirst({
      where: { organizationId: orgId, email: email.trim().toLowerCase() },
      select: { id: true },
    });
    return !!row;
  }
}
