import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

export interface CreateTaskDto {
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  assignedToId?: string;
  projectId?: string;
  dueDate?: string;
  startDate?: string;
  estimatedHours?: number;
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      assignedToId?: string;
      projectId?: string;
      dueBefore?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      search,
      status,
      assignedToId,
      projectId,
      dueBefore,
      page = 1,
      limit = 20,
    } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (projectId) where.projectId = projectId;
      if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (assignedToId) {
        where.assignments = { some: { userId: assignedToId } };
      }

      const [data, total] = await Promise.all([
        tx.task.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            project: { select: { id: true, name: true } },
            assignments: {
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true, avatar: true },
                },
              },
            },
            _count: { select: { checklists: true, comments: true } },
          },
        }),
        tx.task.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, organizationId: orgId },
        include: {
          project: { select: { id: true, name: true } },
          assignments: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, avatar: true },
              },
            },
          },
          checklists: { orderBy: { order: 'asc' } },
          comments: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!task) throw new NotFoundException('Task not found');
      return task;
    });
  }

  async create(orgId: string, dto: CreateTaskDto, createdBy: string) {
    const task = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.task.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          status: dto.status ?? 'not_started',
          priority: dto.priority ?? 'medium',
          projectId: dto.projectId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          estimatedHours: dto.estimatedHours ?? null,
          createdBy,
          ...(dto.assignedToId && {
            assignments: {
              create: { userId: dto.assignedToId },
            },
          }),
        },
        include: { assignments: true },
      });
    });

    this.events.emit('task.created', { task, orgId, createdBy });
    return task;
  }

  async update(orgId: string, id: string, dto: Partial<CreateTaskDto>) {
    const existing = await this.findOne(orgId, id);
    const statusChanged = dto.status && dto.status !== existing.status;
    const becameCompleted = statusChanged && dto.status === 'complete';

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.task.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.projectId !== undefined && { projectId: dto.projectId }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
          ...(dto.startDate !== undefined && {
            startDate: dto.startDate ? new Date(dto.startDate) : null,
          }),
          ...(dto.estimatedHours !== undefined && {
            estimatedHours: dto.estimatedHours,
          }),
          ...(becameCompleted && { completedAt: new Date() }),
        },
      });
    });

    if (statusChanged) {
      this.events.emit('task.status_changed', {
        task: updated,
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
      await tx.task.delete({ where: { id } });
    });
  }

  async assign(orgId: string, id: string, userId: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.taskAssignment.upsert({
        where: { taskId_userId: { taskId: id, userId } },
        create: { taskId: id, userId },
        update: {},
      });
    });

    this.events.emit('task.assigned', { taskId: id, userId, orgId });
    return this.findOne(orgId, id);
  }

  async addChecklistItem(orgId: string, taskId: string, text: string) {
    await this.findOne(orgId, taskId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      const count = await tx.taskChecklist.count({ where: { taskId } });
      return tx.taskChecklist.create({
        data: { taskId, description: text, order: count },
      });
    });
  }

  async toggleChecklistItem(orgId: string, itemId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const item = await tx.taskChecklist.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Checklist item not found');
      // verify org ownership via task
      const task = await tx.task.findFirst({
        where: { id: item.taskId, organizationId: orgId },
      });
      if (!task) throw new NotFoundException('Checklist item not found');

      return tx.taskChecklist.update({
        where: { id: itemId },
        data: {
          completed: !item.completed,
          completedAt: !item.completed ? new Date() : null,
        },
      });
    });
  }

  async addComment(
    orgId: string,
    taskId: string,
    content: string,
    userId: string,
  ) {
    await this.findOne(orgId, taskId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.taskComment.create({
        data: { taskId, userId, content },
      });
    });
  }

  async getMyTasks(orgId: string, userId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.task.findMany({
        where: {
          organizationId: orgId,
          assignments: { some: { userId } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        include: {
          project: { select: { id: true, name: true } },
        },
      });
    });
  }
}
