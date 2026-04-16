import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateAppointmentDto {
  clientId?: string;
  contactId?: string;
  staffId?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  status?: string;
}

export interface BookPublicDto {
  orgSlug: string;
  staffId?: string;
  title: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientEmail: string;
}

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    orgId: string,
    query: { from?: string; to?: string; staffId?: string },
  ) {
    const where: any = { organizationId: orgId };
    if (query.staffId) where.staffId = query.staffId;
    if (query.from || query.to) {
      where.startTime = {};
      if (query.from) where.startTime.gte = new Date(query.from);
      if (query.to) where.startTime.lte = new Date(query.to);
    }

    return this.prisma.appointment.findMany({
      where,
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  async create(orgId: string, dto: CreateAppointmentDto) {
    return this.prisma.appointment.create({
      data: {
        organizationId: orgId,
        clientId: dto.clientId ?? null,
        contactId: dto.contactId ?? null,
        staffId: dto.staffId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        location: dto.location ?? null,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        status: dto.status ?? 'scheduled',
      },
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateAppointmentDto>) {
    await this.findOne(orgId, id);
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.startTime !== undefined) data.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) data.endTime = new Date(dto.endTime);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.clientId !== undefined) data.clientId = dto.clientId;
    if (dto.contactId !== undefined) data.contactId = dto.contactId;
    if (dto.staffId !== undefined) data.staffId = dto.staffId;

    return this.prisma.appointment.update({ where: { id }, data });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.appointment.delete({ where: { id } });
  }

  async cancel(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.appointment.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async getAvailableSlots(orgId: string, staffId: string, date: string) {
    const dayStart = new Date(date);
    dayStart.setHours(9, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(17, 0, 0, 0);

    const existing = await this.prisma.appointment.findMany({
      where: {
        organizationId: orgId,
        staffId,
        status: { notIn: ['cancelled'] },
        startTime: { gte: dayStart, lt: dayEnd },
      },
      select: { startTime: true, endTime: true },
    });

    const slots: { start: string; end: string }[] = [];
    const slotMinutes = 30;
    const current = new Date(dayStart);

    while (current.getTime() + slotMinutes * 60000 <= dayEnd.getTime()) {
      const slotEnd = new Date(current.getTime() + slotMinutes * 60000);
      const conflict = existing.some(
        (e) => current < e.endTime && slotEnd > e.startTime,
      );
      if (!conflict) {
        slots.push({
          start: current.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
      current.setMinutes(current.getMinutes() + slotMinutes);
    }

    return slots;
  }

  async bookFromPublic(dto: BookPublicDto) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: dto.orgSlug },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.appointment.create({
      data: {
        organizationId: org.id,
        staffId: dto.staffId ?? null,
        title: dto.title,
        description: `Booked by: ${dto.clientName} (${dto.clientEmail})`,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        status: 'scheduled',
      },
    });
  }
}
