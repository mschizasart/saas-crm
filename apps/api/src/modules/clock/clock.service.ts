import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ClockService {
  constructor(private prisma: PrismaService) {}

  async clockIn(orgId: string, userId: string, note?: string) {
    // Check if already clocked in
    const existing = await this.prisma.clockEntry.findFirst({
      where: { organizationId: orgId, userId, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });

    if (existing) {
      throw new BadRequestException('Already clocked in. Please clock out first.');
    }

    return this.prisma.clockEntry.create({
      data: {
        organizationId: orgId,
        userId,
        clockIn: new Date(),
        note: note ?? null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async clockOut(orgId: string, userId: string) {
    const entry = await this.prisma.clockEntry.findFirst({
      where: { organizationId: orgId, userId, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });

    if (!entry) {
      throw new NotFoundException('No active clock-in found.');
    }

    const now = new Date();
    const totalMinutes = Math.round(
      (now.getTime() - entry.clockIn.getTime()) / 60000,
    );

    return this.prisma.clockEntry.update({
      where: { id: entry.id },
      data: {
        clockOut: now,
        totalMinutes,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async getStatus(orgId: string, userId: string) {
    const entry = await this.prisma.clockEntry.findFirst({
      where: { organizationId: orgId, userId, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });

    return entry ?? null;
  }

  async getEntries(
    orgId: string,
    query: { userId?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    const { userId, from, to, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (userId) where.userId = userId;
    if (from || to) {
      where.clockIn = {};
      if (from) where.clockIn.gte = new Date(from);
      if (to) where.clockIn.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.clockEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { clockIn: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.clockEntry.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTodayReport(orgId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Get all staff in org
    const staff = await this.prisma.user.findMany({
      where: { organizationId: orgId, type: 'staff', active: true },
      select: { id: true, firstName: true, lastName: true },
    });

    // Get today's clock entries
    const entries = await this.prisma.clockEntry.findMany({
      where: {
        organizationId: orgId,
        clockIn: { gte: startOfDay },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { clockIn: 'desc' },
    });

    // Currently clocked in (no clockOut)
    const activeEntries = await this.prisma.clockEntry.findMany({
      where: { organizationId: orgId, clockOut: null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const clockedInIds = new Set(activeEntries.map((e) => e.userId));

    const staffStatus = staff.map((s) => ({
      userId: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      clockedIn: clockedInIds.has(s.id),
      activeEntry: activeEntries.find((e) => e.userId === s.id) ?? null,
    }));

    return {
      staff: staffStatus,
      todayEntries: entries,
      clockedInCount: clockedInIds.size,
      totalStaff: staff.length,
    };
  }
}
