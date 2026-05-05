import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TasksService } from './tasks.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('TasksService', () => {
  let service: TasksService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new TasksService(prisma, events);
  });

  describe('create', () => {
    it('creates a task and emits task.created with default not_started/medium', async () => {
      const created = {
        id: 't1',
        name: 'Do it',
        status: 'not_started',
        priority: 'medium',
      };
      (prisma.task.create as jest.Mock).mockResolvedValue(created);

      await service.create(ORG_ID, { name: 'Do it' }, USER_ID);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Do it',
            status: 'not_started',
            priority: 'medium',
            createdBy: USER_ID,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'task.created',
        expect.objectContaining({ task: created }),
      );
    });

    it('attaches a single assignee when assignedToId is provided', async () => {
      (prisma.task.create as jest.Mock).mockResolvedValue({});
      await service.create(
        ORG_ID,
        { name: 'X', assignedToId: 'user_55' },
        USER_ID,
      );
      const callData = (prisma.task.create as jest.Mock).mock.calls[0][0].data;
      expect(callData.assignments).toEqual({
        create: { userId: 'user_55' },
      });
    });
  });

  describe('update', () => {
    it('stamps completedAt and emits task.status_changed when status moves to complete', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'in_progress',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.task.update as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'complete',
      });

      await service.update(ORG_ID, 't1', { status: 'complete' });

      const updateCall = (prisma.task.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.status).toBe('complete');
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
      expect(events.emit).toHaveBeenCalledWith(
        'task.status_changed',
        expect.objectContaining({
          previousStatus: 'in_progress',
          newStatus: 'complete',
        }),
      );
    });

    it('does NOT emit status_changed when status is unchanged', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'in_progress',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.task.update as jest.Mock).mockResolvedValue({});

      await service.update(ORG_ID, 't1', { name: 'Renamed' });
      expect(events.emit).not.toHaveBeenCalledWith(
        'task.status_changed',
        expect.anything(),
      );
    });
  });

  describe('addDependency', () => {
    it('refuses self-reference', async () => {
      await expect(
        service.addDependency(ORG_ID, 't1', 't1'),
      ).rejects.toThrow(/cannot depend on itself/);
    });

    it('refuses to create a circular dependency (B depends on A; trying A depends on B)', async () => {
      // Both findOne calls succeed
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't',
        assignments: [],
        checklists: [],
        comments: [],
      });
      // Walking deps from B finds A → triggers circular
      (prisma.taskDependency.findMany as jest.Mock).mockResolvedValueOnce([
        { dependsOnId: 't_a' },
      ]);

      // checkCircular(orgId, fromTaskId='t_b', targetId='t_a')
      // — first call returns deps with t_a, which equals targetId → throws
      await expect(
        service.addDependency(ORG_ID, 't_a', 't_b'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the dependency when there is no cycle', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.taskDependency.findMany as jest.Mock).mockResolvedValue([]);
      const dep = { taskId: 't_a', dependsOnId: 't_b' };
      (prisma.taskDependency.upsert as jest.Mock).mockResolvedValue(dep);

      const r = await service.addDependency(ORG_ID, 't_a', 't_b');
      expect(r).toEqual(dep);
    });
  });

  describe('checkCanStart', () => {
    it('reports blockers when an upstream dep is not complete', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.taskDependency.findMany as jest.Mock).mockResolvedValue([
        { dependsOn: { id: 't_dep', name: 'Upstream', status: 'in_progress' } },
        { dependsOn: { id: 't_done', name: 'Done one', status: 'complete' } },
      ]);

      const r = await service.checkCanStart(ORG_ID, 't1');
      expect(r.canStart).toBe(false);
      expect(r.blockedBy).toEqual([
        { id: 't_dep', name: 'Upstream', status: 'in_progress' },
      ]);
    });

    it('reports canStart=true when all deps are complete', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.taskDependency.findMany as jest.Mock).mockResolvedValue([
        { dependsOn: { id: 't_done', name: 'Done', status: 'complete' } },
      ]);
      const r = await service.checkCanStart(ORG_ID, 't1');
      expect(r.canStart).toBe(true);
      expect(r.blockedBy).toEqual([]);
    });
  });

  describe('startTimer', () => {
    it('returns the existing running timer instead of starting a second one', async () => {
      const running = { id: 'te1', endTime: null };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.timeEntry.findFirst as jest.Mock).mockResolvedValue(running);

      const r = await service.startTimer(ORG_ID, 't1', USER_ID);
      expect(r).toBe(running);
      expect(prisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('creates a fresh timer when none is running', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.timeEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.timeEntry.create as jest.Mock).mockResolvedValue({ id: 'te2' });

      const r = await service.startTimer(ORG_ID, 't1', USER_ID);
      expect(r).toEqual({ id: 'te2' });
    });
  });

  describe('stopTimer', () => {
    it('throws NotFoundException if there is no running timer', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.timeEntry.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.stopTimer(ORG_ID, 't1', USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('records elapsed seconds when stopping', async () => {
      const startTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        assignments: [],
        checklists: [],
        comments: [],
      });
      (prisma.timeEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'te1',
        startTime,
        endTime: null,
      });
      (prisma.timeEntry.update as jest.Mock).mockResolvedValue({});

      await service.stopTimer(ORG_ID, 't1', USER_ID);

      const updateData = (prisma.timeEntry.update as jest.Mock).mock.calls[0][0]
        .data;
      // ~300 seconds, allow ±2 for clock fuzz
      expect(updateData.seconds).toBeGreaterThanOrEqual(298);
      expect(updateData.seconds).toBeLessThanOrEqual(302);
      expect(updateData.endTime).toBeInstanceOf(Date);
    });
  });

  describe('toggleChecklistItem', () => {
    it('refuses if the parent task is not in this org (cross-tenant guard)', async () => {
      (prisma.taskChecklist.findUnique as jest.Mock).mockResolvedValue({
        id: 'i1',
        taskId: 't_other_org',
        completed: false,
      });
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.toggleChecklistItem(ORG_ID, 'i1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('toggles completion and stamps completedAt', async () => {
      (prisma.taskChecklist.findUnique as jest.Mock).mockResolvedValue({
        id: 'i1',
        taskId: 't1',
        completed: false,
      });
      (prisma.task.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        organizationId: ORG_ID,
      });
      (prisma.taskChecklist.update as jest.Mock).mockResolvedValue({
        id: 'i1',
        completed: true,
      });

      await service.toggleChecklistItem(ORG_ID, 'i1');
      const updateData = (prisma.taskChecklist.update as jest.Mock).mock
        .calls[0][0].data;
      expect(updateData.completed).toBe(true);
      expect(updateData.completedAt).toBeInstanceOf(Date);
    });
  });
});
