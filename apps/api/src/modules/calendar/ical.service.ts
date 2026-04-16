import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';

function formatIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcal(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

@Injectable()
export class IcalService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /**
   * Generate a long-lived token for the calendar feed URL.
   */
  generateFeedToken(orgId: string, userId: string): string {
    return this.jwt.sign(
      { sub: userId, orgId, purpose: 'ical-feed' },
      { expiresIn: '30d' },
    );
  }

  /**
   * Verify a feed token and return the orgId + userId.
   */
  verifyFeedToken(token: string): { orgId: string; userId: string } | null {
    try {
      const payload = this.jwt.verify(token);
      if (payload.purpose !== 'ical-feed') return null;
      return { orgId: payload.orgId, userId: payload.sub };
    } catch {
      return null;
    }
  }

  /**
   * Generate a full iCalendar feed for an organization (optionally filtered by user).
   */
  async generateCalendarFeed(
    orgId: string,
    userId?: string,
  ): Promise<string> {
    const [events, appointments] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          organizationId: orgId,
          ...(userId ? { userId } : {}),
        },
        orderBy: { startDate: 'desc' },
        take: 200,
      }),
      this.prisma.appointment
        .findMany({
          where: {
            organizationId: orgId,
            ...(userId ? { staffId: userId } : {}),
          },
          take: 200,
        })
        .catch(() => []),
    ]);

    let ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AppoinlyCRM//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:AppoinlyCRM',
    ].join('\r\n');

    for (const event of events) {
      const start = formatIcalDate(new Date(event.startDate));
      const end = event.endDate
        ? formatIcalDate(new Date(event.endDate))
        : start;
      ical += `\r\nBEGIN:VEVENT\r\nUID:event-${event.id}@appoinlycrm\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${escapeIcal(event.title)}\r\nDESCRIPTION:${escapeIcal(event.description || '')}\r\nEND:VEVENT`;
    }

    for (const apt of appointments as any[]) {
      const start = formatIcalDate(new Date(apt.startTime));
      const end = formatIcalDate(new Date(apt.endTime));
      ical += `\r\nBEGIN:VEVENT\r\nUID:apt-${apt.id}@appoinlycrm\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${escapeIcal(apt.title)}\r\nDESCRIPTION:${escapeIcal(apt.description || '')}\r\nLOCATION:${escapeIcal(apt.location || '')}\r\nEND:VEVENT`;
    }

    ical += '\r\nEND:VCALENDAR';
    return ical;
  }
}
