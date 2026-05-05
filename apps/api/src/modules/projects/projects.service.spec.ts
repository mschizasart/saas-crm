import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ProjectsService(prisma, events);
  });

  describe('create', () => {
    it('creates a not_started project with progress=0 by default', async () => {
      const created = { id: 'p1', name: 'Alpha', status: 'not_started' };
      (prisma.project.create as jest.Mock).mockResolvedValue(created);

      await service.create(ORG_ID, { name: 'Alpha' }, USER_ID);

      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Alpha',
            status: 'not_started',
            billingType: 'not_billable',
            progress: 0,
            progressManual: false,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'project.created',
        expect.objectContaining({ project: created }),
      );
    });

    it('attaches members via createMany when memberIds[] is given', async () => {
      const created = { id: 'p1' };
      (prisma.project.create as jest.Mock).mockResolvedValue(created);
      (prisma.projectMember.createMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      await service.create(
        ORG_ID,
        { name: 'X', memberIds: ['u1', 'u2'] },
        USER_ID,
      );

      expect(prisma.projectMember.createMany).toHaveBeenCalledWith({
        data: [
          { projectId: 'p1', userId: 'u1' },
          { projectId: 'p1', userId: 'u2' },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('update', () => {
    it('emits project.status_changed when status changes', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'not_started',
        members: [],
        milestones: [],
      });
      const updated = { id: 'p1', status: 'in_progress' };
      (prisma.project.update as jest.Mock).mockResolvedValue(updated);

      await service.update(ORG_ID, 'p1', { status: 'in_progress' });

      expect(events.emit).toHaveBeenCalledWith(
        'project.status_changed',
        expect.objectContaining({
          previousStatus: 'not_started',
          newStatus: 'in_progress',
        }),
      );
    });

    it('does not emit status_changed when only the name changes', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'in_progress',
        members: [],
        milestones: [],
      });
      (prisma.project.update as jest.Mock).mockResolvedValue({});

      await service.update(ORG_ID, 'p1', { name: 'Renamed' });
      expect(events.emit).not.toHaveBeenCalledWith(
        'project.status_changed',
        expect.anything(),
      );
    });
  });

  describe('updateProgress', () => {
    it('rejects values outside 0..100', async () => {
      await expect(service.updateProgress(ORG_ID, 'p1', -5)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateProgress(ORG_ID, 'p1', 150)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks progressManual=true on manual update', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.project.update as jest.Mock).mockResolvedValue({});
      await service.updateProgress(ORG_ID, 'p1', 60);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { progress: 60, progressManual: true },
      });
    });
  });

  describe('clone', () => {
    it('creates a new project named "<X> (Copy)" with reset state', async () => {
      const src = {
        id: 'src',
        name: 'Alpha',
        clientId: 'c1',
        billingType: 'fixed',
        fixedRate: 1000,
        hourlyRate: 50,
        members: [],
        milestones: [],
      };
      (prisma.project.findFirst as jest.Mock).mockResolvedValueOnce(src);
      const newProject = { id: 'p_new' };
      (prisma.project.create as jest.Mock).mockResolvedValue(newProject);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.project.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'p_new',
        name: 'Alpha (Copy)',
      });

      const r = await service.clone(ORG_ID, 'src', USER_ID);

      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Alpha (Copy)',
            status: 'not_started',
            progress: 0,
            startDate: null,
            deadline: null,
          }),
        }),
      );
      expect((r as any).name).toBe('Alpha (Copy)');
    });
  });

  describe('createMilestone', () => {
    it('falls back to legacy "completed-only" create when status column is missing', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.milestone.findFirst as jest.Mock).mockResolvedValue(null);

      const err: any = new Error('column "status" does not exist');
      err.code = 'P2022';
      const fallback = { id: 'm1', name: 'M1' };
      (prisma.milestone.create as jest.Mock)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(fallback);

      const r = await service.createMilestone(ORG_ID, 'p1', { name: 'M1' });
      expect(r).toBe(fallback);
      expect(prisma.milestone.create).toHaveBeenCalledTimes(2);
    });

    it('treats status="done" as completed=true on initial create', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.milestone.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.milestone.create as jest.Mock).mockResolvedValue({});

      await service.createMilestone(ORG_ID, 'p1', { name: 'M1', status: 'done' });

      const callData = (prisma.milestone.create as jest.Mock).mock.calls[0][0]
        .data;
      expect(callData.completed).toBe(true);
      expect(callData.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateMilestone', () => {
    it('keeps `completed` in sync with the new status', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.milestone.findFirst as jest.Mock).mockResolvedValue({
        id: 'm1',
      });
      (prisma.milestone.update as jest.Mock).mockResolvedValue({});

      await service.updateMilestone(ORG_ID, 'p1', 'm1', { status: 'done' });

      const data = (prisma.milestone.update as jest.Mock).mock.calls[0][0].data;
      expect(data.completed).toBe(true);
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.status).toBe('done');
    });

    it('throws NotFoundException when the milestone does not belong to the project', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.milestone.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateMilestone(ORG_ID, 'p1', 'm1', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMember', () => {
    it('upserts to keep idempotency on repeat calls', async () => {
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        members: [],
        milestones: [],
      });
      (prisma.projectMember.upsert as jest.Mock).mockResolvedValue({});

      await service.addMember(ORG_ID, 'p1', 'u_new');

      expect(prisma.projectMember.upsert).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 'p1', userId: 'u_new' } },
        create: { projectId: 'p1', userId: 'u_new' },
        update: {},
      });
    });
  });
});
