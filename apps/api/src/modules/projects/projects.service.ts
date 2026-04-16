import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateProjectDto {
  name: string;
  clientId?: string;
  description?: string;
  status?: string;
  billingType?: string;
  fixedRate?: number;
  hourlyRate?: number;
  startDate?: string;
  deadline?: string;
  estimatedHours?: number;
  memberIds?: string[];
}

export interface LogTimeDto {
  taskId?: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  note?: string;
  billable?: boolean;
}

export interface CreateMilestoneDto {
  name: string;
  description?: string;
  dueDate?: string;
  color?: string;
  order?: number;
}

export interface CreateDiscussionDto {
  subject: string;
  description?: string;
}

export interface CreateDiscussionCommentDto {
  content: string;
}

export interface CreateProjectFileDto {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── List / Find ────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, clientId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (status) where.status = status;
      if (clientId) where.clientId = clientId;

      const [data, total] = await Promise.all([
        tx.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            _count: { select: { tasks: true, members: true, timeEntries: true } },
          },
        }),
        tx.project.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const project = await (tx as any).project.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: { select: { id: true, company: true } },
          members: true,
          milestones: true,
          _count: { select: { tasks: true, timeEntries: true } },
        },
      });
      if (!project) throw new NotFoundException('Project not found');
      return project;
    });
  }

  // ─── Create / Update / Delete ───────────────────────────────

  async create(orgId: string, dto: CreateProjectDto, createdBy: string) {
    const { memberIds, ...rest } = dto;

    const project = await this.prisma.withOrganization(orgId, async (tx) => {
      const created = await tx.project.create({
        data: {
          organizationId: orgId,
          name: rest.name,
          clientId: rest.clientId ?? null,
          description: rest.description ?? null,
          status: rest.status ?? 'not_started',
          billingType: rest.billingType ?? 'not_billable',
          fixedRate: rest.fixedRate ?? null,
          hourlyRate: rest.hourlyRate ?? null,
          startDate: rest.startDate ? new Date(rest.startDate) : null,
          deadline: rest.deadline ? new Date(rest.deadline) : null,
          estimatedHours: rest.estimatedHours ?? null,
          budgetNotify: false,
          progressManual: false,
          progress: 0,
        },
      });

      if (memberIds && memberIds.length > 0) {
        await (tx as any).projectMember.createMany({
          data: memberIds.map((userId) => ({
            projectId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    this.events.emit('project.created', { project, orgId, createdBy });
    return project;
  }

  async update(orgId: string, id: string, dto: Partial<CreateProjectDto>) {
    const existing = await this.findOne(orgId, id);

    const { memberIds, ...rest } = dto;

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.project.update({
        where: { id },
        data: {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.clientId !== undefined && { clientId: rest.clientId }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.status !== undefined && { status: rest.status }),
          ...(rest.billingType !== undefined && { billingType: rest.billingType }),
          ...(rest.fixedRate !== undefined && { fixedRate: rest.fixedRate }),
          ...(rest.hourlyRate !== undefined && { hourlyRate: rest.hourlyRate }),
          ...(rest.startDate !== undefined && {
            startDate: rest.startDate ? new Date(rest.startDate) : null,
          }),
          ...(rest.deadline !== undefined && {
            deadline: rest.deadline ? new Date(rest.deadline) : null,
          }),
          ...(rest.estimatedHours !== undefined && { estimatedHours: rest.estimatedHours }),
        },
      });
    });

    if (dto.status && dto.status !== existing.status) {
      this.events.emit('project.status_changed', {
        project: updated,
        orgId,
        previousStatus: existing.status,
        newStatus: dto.status,
      });
    }

    return updated;
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.project.delete({ where: { id } });
    });
  }

  // ─── Clone ──────────────────────────────────────────────────

  async clone(orgId: string, id: string, createdBy: string) {
    const source = await this.findOne(orgId, id);

    const cloned = await this.prisma.withOrganization(orgId, async (tx) => {
      // Create the new project
      const newProject = await tx.project.create({
        data: {
          organizationId: orgId,
          clientId: source.clientId ?? null,
          name: `${source.name} (Copy)`,
          description: source.description ?? null,
          status: 'not_started',
          billingType: source.billingType ?? 'not_billable',
          fixedRate: source.fixedRate ?? null,
          hourlyRate: source.hourlyRate ?? null,
          startDate: null,
          deadline: null,
          estimatedHours: source.estimatedHours ?? null,
          budgetNotify: false,
          progressManual: false,
          progress: 0,
        },
      });

      // Clone members
      if (source.members && source.members.length > 0) {
        await (tx as any).projectMember.createMany({
          data: source.members.map((m: any) => ({
            projectId: newProject.id,
            userId: m.userId,
            hourlyRate: m.hourlyRate ?? null,
          })),
          skipDuplicates: true,
        });
      }

      // Clone milestones and build a mapping for tasks
      const milestoneMap = new Map<string, string>();
      if (source.milestones && source.milestones.length > 0) {
        for (const ms of source.milestones as any[]) {
          const newMs = await tx.milestone.create({
            data: {
              organizationId: orgId,
              projectId: newProject.id,
              name: ms.name,
              description: ms.description ?? null,
              dueDate: ms.dueDate ?? null,
              completed: false,
              completedAt: null,
              color: ms.color ?? '#6b7280',
              order: ms.order ?? 0,
            },
          });
          milestoneMap.set(ms.id, newMs.id);
        }
      }

      // Clone tasks
      const tasks = await tx.task.findMany({
        where: { projectId: id, organizationId: orgId },
        include: { assignments: true },
      });

      for (const task of tasks) {
        const newTask = await tx.task.create({
          data: {
            organizationId: orgId,
            projectId: newProject.id,
            milestoneId: task.milestoneId ? milestoneMap.get(task.milestoneId) ?? null : null,
            name: task.name,
            description: task.description ?? null,
            status: 'not_started',
            priority: task.priority ?? 'medium',
            startDate: null,
            dueDate: null,
            hourlyRate: task.hourlyRate ?? null,
            billingType: task.billingType ?? 'task_hours',
            estimatedHours: task.estimatedHours ?? null,
            order: task.order ?? 0,
            isPublic: task.isPublic,
            billable: task.billable,
            createdBy,
            completedAt: null,
          },
        });

        // Clone task assignments
        if (task.assignments && task.assignments.length > 0) {
          await (tx as any).taskAssignment.createMany({
            data: task.assignments.map((a: any) => ({
              taskId: newTask.id,
              userId: a.userId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.project.findFirst({
        where: { id: newProject.id },
        include: {
          client: { select: { id: true, company: true } },
          members: true,
          milestones: true,
          _count: { select: { tasks: true, timeEntries: true } },
        },
      });
    });

    this.events.emit('project.created', { project: cloned, orgId, createdBy, clonedFrom: id });
    return cloned;
  }

  // ─── Progress ────────────────────────────────────────────────

  async updateProgress(orgId: string, id: string, progress: number) {
    if (progress < 0 || progress > 100) {
      throw new BadRequestException('Progress must be between 0 and 100');
    }
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.project.update({ where: { id }, data: { progress, progressManual: true } });
    });
  }

  // ─── Members ─────────────────────────────────────────────────

  async getMembers(orgId: string, projectId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectMember.findMany({
        where: { projectId },
      });
    });
  }

  async addMember(orgId: string, projectId: string, userId: string, role?: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId },
        update: {},
      });
    });
  }

  async removeMember(orgId: string, projectId: string, userId: string) {
    await this.findOne(orgId, projectId);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId, userId } },
      });
    });
  }

  // ─── Stats ───────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [total, not_started, in_progress, on_hold, finished, cancelled] =
        await Promise.all([
          tx.project.count({ where: { organizationId: orgId } }),
          tx.project.count({ where: { organizationId: orgId, status: 'not_started' } }),
          tx.project.count({ where: { organizationId: orgId, status: 'in_progress' } }),
          tx.project.count({ where: { organizationId: orgId, status: 'on_hold' } }),
          tx.project.count({ where: { organizationId: orgId, status: 'finished' } }),
          tx.project.count({ where: { organizationId: orgId, status: 'cancelled' } }),
        ]);

      return {
        total,
        byStatus: { not_started, in_progress, on_hold, finished, cancelled },
      };
    });
  }

  // ─── Time Entries ────────────────────────────────────────────

  async logTime(
    orgId: string,
    projectId: string,
    dto: LogTimeDto,
    userId: string,
  ) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).timeEntry.create({
        data: {
          organizationId: orgId,
          projectId,
          taskId: dto.taskId ?? null,
          userId,
          startTime: new Date(dto.startTime),
          endTime: dto.endTime ? new Date(dto.endTime) : null,
          seconds: dto.duration ?? 0,
          note: dto.note ?? null,
          billable: dto.billable ?? false,
        },
      });
    });
  }

  async getTimeEntries(
    orgId: string,
    projectId: string,
    query: { userId?: string; page?: number; limit?: number },
  ) {
    const { userId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    await this.findOne(orgId, projectId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { projectId, organizationId: orgId };
      if (userId) where.userId = userId;

      const [data, total] = await Promise.all([
        tx.timeEntry.findMany({
          where,
          skip,
          take: limit,
          orderBy: { startTime: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            task: { select: { id: true, name: true } },
          },
        }),
        tx.timeEntry.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── Milestones ─────────────────────────────────────────────

  async getMilestones(orgId: string, projectId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.milestone.findMany({
        where: { projectId, organizationId: orgId },
        orderBy: { order: 'asc' },
        include: {
          tasks: {
            select: {
              id: true,
              name: true,
              status: true,
              dueDate: true,
              priority: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      });
    });
  }

  async createMilestone(orgId: string, projectId: string, dto: CreateMilestoneDto) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Get next order value
      const maxOrder = await tx.milestone.findFirst({
        where: { projectId, organizationId: orgId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      return tx.milestone.create({
        data: {
          organizationId: orgId,
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          color: dto.color ?? '#6b7280',
          order: dto.order ?? (maxOrder ? maxOrder.order + 1 : 0),
        },
      });
    });
  }

  async updateMilestone(
    orgId: string,
    projectId: string,
    milestoneId: string,
    dto: Partial<CreateMilestoneDto> & { completed?: boolean },
  ) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.milestone.findFirst({
        where: { id: milestoneId, projectId, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Milestone not found');

      return tx.milestone.update({
        where: { id: milestoneId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.completed !== undefined && {
            completed: dto.completed,
            completedAt: dto.completed ? new Date() : null,
          }),
        },
      });
    });
  }

  async deleteMilestone(orgId: string, projectId: string, milestoneId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.milestone.findFirst({
        where: { id: milestoneId, projectId, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Milestone not found');
      await tx.milestone.delete({ where: { id: milestoneId } });
    });
  }

  // ─── Project Files ──────────────────────────────────────────

  async getFiles(orgId: string, projectId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectFile.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async createFile(orgId: string, projectId: string, dto: CreateProjectFileDto, userId?: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectFile.create({
        data: {
          projectId,
          userId: userId ?? null,
          fileName: dto.fileName,
          fileUrl: dto.fileUrl,
          fileSize: dto.fileSize ?? null,
          mimeType: dto.mimeType ?? null,
        },
      });
    });
  }

  async deleteFile(orgId: string, projectId: string, fileId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const file = await (tx as any).projectFile.findFirst({
        where: { id: fileId, projectId },
      });
      if (!file) throw new NotFoundException('File not found');
      await (tx as any).projectFile.delete({ where: { id: fileId } });
      return file;
    });
  }

  // ─── Project Discussions ────────────────────────────────────

  async getDiscussions(orgId: string, projectId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectDiscussion.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { comments: true } },
        },
      });
    });
  }

  async getDiscussion(orgId: string, projectId: string, discussionId: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const discussion = await (tx as any).projectDiscussion.findFirst({
        where: { id: discussionId, projectId },
        include: {
          comments: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!discussion) throw new NotFoundException('Discussion not found');
      return discussion;
    });
  }

  async createDiscussion(orgId: string, projectId: string, dto: CreateDiscussionDto, userId?: string) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).projectDiscussion.create({
        data: {
          projectId,
          userId: userId ?? null,
          subject: dto.subject,
          description: dto.description ?? null,
        },
        include: {
          _count: { select: { comments: true } },
        },
      });
    });
  }

  async addDiscussionComment(
    orgId: string,
    projectId: string,
    discussionId: string,
    dto: CreateDiscussionCommentDto,
    userId?: string,
  ) {
    await this.findOne(orgId, projectId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const discussion = await (tx as any).projectDiscussion.findFirst({
        where: { id: discussionId, projectId },
      });
      if (!discussion) throw new NotFoundException('Discussion not found');

      return (tx as any).projectDiscussionComment.create({
        data: {
          discussionId,
          userId: userId ?? null,
          content: dto.content,
        },
      });
    });
  }
}
