import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Dispatch read-side helpers for the field-service module.
 *
 * The dispatcher's UI surfaces three views:
 *
 *  1. The "board" — a date-range table of every WO across every
 *     technician in the org. Used to eyeball the day/week and
 *     drag WOs onto technicians.
 *  2. A single technician's calendar — the same shape but filtered.
 *  3. Availability — given a desired duration + window, surface the
 *     free time-slots on each technician's calendar.
 *
 * All endpoints are tenant-scoped via explicit `organizationId`
 * filters (we don't open `withOrganization` since these are pure
 * reads — same pattern the existing reports endpoints follow).
 */
@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService) {}

  /** Validate that `to` is strictly after `from`. */
  private parseRange(from: string, to: string): { fromDate: Date; toDate: Date } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid `from` or `to` date');
    }
    if (toDate <= fromDate) {
      throw new BadRequestException('`to` must be after `from`');
    }
    if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > 366) {
      throw new BadRequestException('Date range cannot exceed 366 days');
    }
    return { fromDate, toDate };
  }

  /**
   * Load every active technician in the org. Used by the board to render
   * the columns even for techs who have no scheduled WOs in the window.
   */
  private async loadTechnicians(orgId: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId: orgId,
        isTechnician: true,
        active: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  // ─── Board ──────────────────────────────────────────────────

  /**
   * Return technicians + every scheduled / in-progress / completed WO
   * with a `scheduledStart` inside the window. The web UI buckets these
   * into time-rows.
   */
  async getDispatchBoard(
    orgId: string,
    query: { from: string; to: string; technicianId?: string },
  ) {
    const { fromDate, toDate } = this.parseRange(query.from, query.to);

    const technicians = await this.loadTechnicians(orgId);

    const where: any = {
      organizationId: orgId,
      // Cancelled WOs clutter the board — exclude them. Drafts that have
      // a scheduled start show up so the dispatcher sees provisional work.
      status: { in: ['draft', 'scheduled', 'in_progress', 'completed'] },
      scheduledStart: { gte: fromDate, lte: toDate },
    };
    if (query.technicianId) where.technicianId = query.technicianId;

    const workOrders = await this.prisma.workOrder.findMany({
      where,
      orderBy: [{ scheduledStart: 'asc' }],
      include: {
        client: { select: { id: true, company: true } },
      },
    });

    return { technicians, workOrders };
  }

  // ─── Single technician schedule ────────────────────────────

  async getTechnicianSchedule(
    orgId: string,
    technicianId: string,
    query: { from: string; to: string },
  ) {
    const { fromDate, toDate } = this.parseRange(query.from, query.to);

    // Cross-tenant guard — and confirm the user is actually a technician.
    const tech = await this.prisma.user.findFirst({
      where: { id: technicianId, organizationId: orgId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isTechnician: true,
      },
    });
    if (!tech) {
      throw new BadRequestException(
        'Technician not found for this organization',
      );
    }
    if (!tech.isTechnician) {
      throw new BadRequestException('User is not a technician');
    }

    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        organizationId: orgId,
        technicianId,
        status: { in: ['draft', 'scheduled', 'in_progress', 'completed'] },
        scheduledStart: { gte: fromDate, lte: toDate },
      },
      orderBy: { scheduledStart: 'asc' },
      include: {
        client: { select: { id: true, company: true } },
      },
    });

    return { technician: tech, workOrders };
  }

  // ─── Availability ──────────────────────────────────────────

  /**
   * For each active technician in the org, compute the gaps between
   * scheduled / in-progress WOs within `[from, to]` and return any gap
   * with duration >= `durationMinutes`.
   *
   * v1 simplification: we don't model working-hours or PTO — the gaps
   * span the whole window. A later iteration can subtract a per-tech
   * "working hours" calendar. For now the dispatcher uses this as a
   * "where could I fit a 2h appointment tomorrow?" rough cut.
   */
  async findAvailability(
    orgId: string,
    query: { from: string; to: string; durationMinutes: number },
  ) {
    const { fromDate, toDate } = this.parseRange(query.from, query.to);
    if (query.durationMinutes <= 0) {
      throw new BadRequestException('durationMinutes must be positive');
    }
    const durationMs = query.durationMinutes * 60 * 1000;

    const technicians = await this.loadTechnicians(orgId);
    if (technicians.length === 0) {
      return { slots: [] as Array<any> };
    }

    // ONE bulk query for every booking that overlaps the window across all
    // techs — no N+1.
    const bookings = await this.prisma.workOrder.findMany({
      where: {
        organizationId: orgId,
        technicianId: { in: technicians.map((t) => t.id) },
        status: { in: ['scheduled', 'in_progress'] },
        scheduledStart: { lt: toDate },
        scheduledEnd: { gt: fromDate },
      },
      select: {
        id: true,
        technicianId: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
      orderBy: { scheduledStart: 'asc' },
    });

    const slots: Array<{
      technicianId: string;
      technicianName: string;
      slotStart: Date;
      slotEnd: Date;
      minutes: number;
    }> = [];

    for (const tech of technicians) {
      const techBookings = bookings
        .filter((b) => b.technicianId === tech.id)
        .map((b) => ({
          start: b.scheduledStart!,
          end: b.scheduledEnd!,
        }))
        .filter((b) => !!b.start && !!b.end)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      let cursor = fromDate.getTime();
      const windowEnd = toDate.getTime();

      const techName = `${tech.firstName ?? ''} ${tech.lastName ?? ''}`.trim();

      for (const booking of techBookings) {
        const bookingStart = Math.max(booking.start.getTime(), fromDate.getTime());
        const bookingEnd = Math.min(booking.end.getTime(), windowEnd);
        if (bookingStart > cursor) {
          const gapMs = bookingStart - cursor;
          if (gapMs >= durationMs) {
            slots.push({
              technicianId: tech.id,
              technicianName: techName,
              slotStart: new Date(cursor),
              slotEnd: new Date(bookingStart),
              minutes: Math.floor(gapMs / 60000),
            });
          }
        }
        cursor = Math.max(cursor, bookingEnd);
      }
      if (windowEnd > cursor) {
        const gapMs = windowEnd - cursor;
        if (gapMs >= durationMs) {
          slots.push({
            technicianId: tech.id,
            technicianName: techName,
            slotStart: new Date(cursor),
            slotEnd: new Date(windowEnd),
            minutes: Math.floor(gapMs / 60000),
          });
        }
      }
    }

    return { slots };
  }
}
