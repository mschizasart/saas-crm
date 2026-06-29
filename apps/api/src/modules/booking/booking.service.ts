import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  GoneException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import {
  getTimeZoneOffsetMs,
  isValidTimeZone,
  parseHhMm,
  wallTimeToUtc,
  weekdayKeyInTz,
} from './timezone.util';
import { CreateBookingPageDto, UpdateBookingPageDto } from './dto/booking-page.dto';
import { PublicBookDto } from './dto/public-book.dto';

export interface Slot {
  start: string; // UTC ISO instant
  end: string; // UTC ISO instant
}

interface WorkingWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

/**
 * In-memory, multi-dimensional rate limiter for the public book endpoint.
 * Several independent limits run together so abuse can't be sidestepped by
 * rotating just one of email/IP, and a per-page daily cap bounds email-relay
 * spam from a single page. In-memory is acceptable: prod is single-node (no
 * Redis dependency). Each key maps to the list of attempt timestamps (ms) that
 * are still within that key's window; we prune as we go to bound growth.
 */
type RateLimit = { windowMs: number; max: number };
const RL_IP: RateLimit = { windowMs: 60_000, max: 5 }; // per-IP: 5 / 60s
const RL_EMAIL_SHORT: RateLimit = { windowMs: 60_000, max: 3 }; // per-email: 3 / 60s
const RL_EMAIL_DAY: RateLimit = { windowMs: 86_400_000, max: 10 }; // per-email: 10 / 24h
const RL_PAGE_DAY: RateLimit = { windowMs: 86_400_000, max: 100 }; // per-page: 100 / 24h

/** key -> attempt timestamps (ms) currently inside the relevant window. */
const bookHits = new Map<string, number[]>();

/** Lifetime of an email double-opt-in confirm link (30 minutes). */
const VERIFICATION_TTL_MS = 30 * 60_000;

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private emails?: EmailsService,
  ) {}

  /**
   * Record one attempt against `key` and return true if it stays within
   * `limit` (max attempts per rolling window). Prunes expired timestamps for
   * the key on every call; opportunistically evicts other empty keys to keep
   * the map from growing unbounded.
   */
  private checkRateLimit(key: string, limit: RateLimit, now: number): boolean {
    const cutoff = now - limit.windowMs;
    const hits = (bookHits.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limit.max) {
      bookHits.set(key, hits); // persist the pruned list even on reject
      return false;
    }
    hits.push(now);
    bookHits.set(key, hits);

    // Light global pruning to bound memory: drop keys whose newest hit is older
    // than a day (longest window we track).
    if (bookHits.size > 10_000) {
      const dayAgo = now - 86_400_000;
      for (const [k, ts] of bookHits) {
        if (ts.length === 0 || ts[ts.length - 1] <= dayAgo) bookHits.delete(k);
      }
    }
    return true;
  }

  // ════════════════════════════════════════════════════════════
  //  Admin CRUD (org-scoped)
  // ════════════════════════════════════════════════════════════

  async list(orgId: string) {
    const pages = await this.prisma.bookingPage.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return pages.map((p) => this.withPublicUrl(p));
  }

  async findOne(orgId: string, id: string) {
    const page = await this.prisma.bookingPage.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!page) throw new NotFoundException('Booking page not found');
    return this.withPublicUrl(page);
  }

  async create(orgId: string, dto: CreateBookingPageDto) {
    const slug = this.normalizeSlug(dto.slug);
    this.validateConfig(dto);

    const existing = await this.prisma.bookingPage.findFirst({
      where: { organizationId: orgId, slug },
    });
    if (existing) {
      throw new ConflictException(
        `A booking page with slug "${slug}" already exists for this organization`,
      );
    }

    // Verify staffId is an active staff member of this org (not a contact or
    // a deactivated user) — prevents binding a public page to a non-staff row.
    const staff = await this.prisma.user.findFirst({
      where: {
        id: dto.staffId,
        organizationId: orgId,
        type: 'staff',
        active: true,
      },
      select: { id: true, timezone: true },
    });
    if (!staff) {
      throw new BadRequestException(
        'staffId must be an active staff member in this organization',
      );
    }

    // Default the page timezone to the staff member's tz when not supplied.
    const timezone = dto.timezone ?? staff.timezone ?? 'UTC';
    if (!isValidTimeZone(timezone)) {
      throw new BadRequestException(`Invalid timezone: ${timezone}`);
    }

    const page = await this.prisma.bookingPage.create({
      data: {
        organizationId: orgId,
        slug,
        title: dto.title,
        description: dto.description ?? null,
        staffId: dto.staffId,
        durationMinutes: dto.durationMinutes ?? 30,
        bufferMinutes: dto.bufferMinutes ?? 0,
        minLeadTimeHours: dto.minLeadTimeHours ?? 0,
        maxAdvanceDays: dto.maxAdvanceDays ?? 30,
        timezone,
        workingHours: (dto.workingHours ?? {}) as any,
        meetingLocation: dto.meetingLocation ?? null,
        active: dto.active ?? true,
      },
    });
    return this.withPublicUrl(page);
  }

  async update(orgId: string, id: string, dto: UpdateBookingPageDto) {
    await this.findOne(orgId, id);
    this.validateConfig(dto);

    const data: Record<string, any> = {};
    if (dto.slug !== undefined) {
      const slug = this.normalizeSlug(dto.slug);
      const clash = await this.prisma.bookingPage.findFirst({
        where: { organizationId: orgId, slug, NOT: { id } },
      });
      if (clash) {
        throw new ConflictException(
          `A booking page with slug "${slug}" already exists for this organization`,
        );
      }
      data.slug = slug;
    }
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.staffId !== undefined) {
      // Re-binding the page: staffId must be an active staff member of this org.
      const staff = await this.prisma.user.findFirst({
        where: {
          id: dto.staffId,
          organizationId: orgId,
          type: 'staff',
          active: true,
        },
        select: { id: true },
      });
      if (!staff) {
        throw new BadRequestException(
          'staffId must be an active staff member in this organization',
        );
      }
      data.staffId = dto.staffId;
    }
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.bufferMinutes !== undefined) data.bufferMinutes = dto.bufferMinutes;
    if (dto.minLeadTimeHours !== undefined) data.minLeadTimeHours = dto.minLeadTimeHours;
    if (dto.maxAdvanceDays !== undefined) data.maxAdvanceDays = dto.maxAdvanceDays;
    if (dto.timezone !== undefined) {
      if (!isValidTimeZone(dto.timezone)) {
        throw new BadRequestException(`Invalid timezone: ${dto.timezone}`);
      }
      data.timezone = dto.timezone;
    }
    if (dto.workingHours !== undefined) data.workingHours = dto.workingHours as any;
    if (dto.meetingLocation !== undefined) data.meetingLocation = dto.meetingLocation;
    if (dto.active !== undefined) data.active = dto.active;

    const page = await this.prisma.bookingPage.update({ where: { id }, data });
    return this.withPublicUrl(page);
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.bookingPage.delete({ where: { id } });
  }

  // ════════════════════════════════════════════════════════════
  //  Public endpoints (org resolved by slug-or-id)
  // ════════════════════════════════════════════════════════════

  /** Safe, public-facing view of an active booking page. 404 if not found/inactive. */
  async getPublicPage(orgSlug: string, pageSlug: string) {
    const { page, organization } = await this.resolvePublicPage(
      orgSlug,
      pageSlug,
    );

    const staff = await this.prisma.user.findFirst({
      where: { id: page.staffId, organizationId: organization.id },
      select: { firstName: true, lastName: true, avatar: true, jobTitle: true },
    });

    const org = await this.prisma.organization.findUnique({
      where: { id: organization.id },
      select: { name: true, logo: true },
    });

    return {
      org: { name: org?.name ?? organization.name, logo: org?.logo ?? null },
      page: {
        slug: page.slug,
        title: page.title,
        description: page.description,
        durationMinutes: page.durationMinutes,
        timezone: page.timezone,
        meetingLocation: page.meetingLocation,
        staff: staff
          ? {
              name: `${staff.firstName} ${staff.lastName}`.trim(),
              avatar: staff.avatar ?? null,
              jobTitle: staff.jobTitle ?? null,
            }
          : null,
      },
    };
  }

  /** Public availability for a single date (YYYY-MM-DD in the page timezone). */
  async getPublicSlots(orgSlug: string, pageSlug: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    const { page, organization } = await this.resolvePublicPage(
      orgSlug,
      pageSlug,
    );

    const slots = await this.computeSlots(organization.id, page as any, date);
    return { date, timezone: page.timezone, slots };
  }

  /**
   * Public booking — anti-double-book: the slot is RE-VALIDATED and the
   * conflict check + insert run inside ONE transaction so two concurrent
   * visitors can't both grab the same slot (the second sees the first's row
   * and throws 409).
   */
  async book(
    orgSlug: string,
    pageSlug: string,
    dto: PublicBookDto,
    ip: string | null,
  ) {
    const { page, organization } = await this.resolvePublicPage(
      orgSlug,
      pageSlug,
    );

    // ── Abuse guard: several independent in-memory limits (single-node prod).
    //    Each must pass; any breach -> 429-ish. Rotating one of IP/email does
    //    not bypass the others, and the per-page daily cap bounds relay spam. ──
    const now = Date.now();
    const email = (dto.email ?? '').toLowerCase();
    const ipKey = `ip:${ip ?? 'unknown'}`; // per-IP burst
    const emKey = `em:${email}`; // per-email burst
    const emdKey = `emd:${email}`; // per-email daily
    const pgKey = `pg:${orgSlug}:${pageSlug}`; // per-page daily cap
    if (
      !this.checkRateLimit(ipKey, RL_IP, now) || // 5 / 60s per IP
      !this.checkRateLimit(emKey, RL_EMAIL_SHORT, now) || // 3 / 60s per email
      !this.checkRateLimit(emdKey, RL_EMAIL_DAY, now) || // 10 / 24h per email
      !this.checkRateLimit(pgKey, RL_PAGE_DAY, now) // 100 / 24h per page
    ) {
      throw new BadRequestException(
        'Too many booking attempts. Please try again later.',
      );
    }

    const start = new Date(dto.startTime);
    if (isNaN(start.getTime())) {
      throw new BadRequestException('startTime must be a valid ISO date');
    }
    const end = new Date(start.getTime() + page.durationMinutes * 60_000);

    // ── Window validation (lead time / max advance) ──
    const nowMs = Date.now();
    const minStart = nowMs + page.minLeadTimeHours * 3_600_000;
    const maxStart = nowMs + page.maxAdvanceDays * 86_400_000;
    if (start.getTime() < minStart) {
      throw new BadRequestException('This time is no longer bookable (too soon).');
    }
    if (start.getTime() > maxStart) {
      throw new BadRequestException('This time is too far in the future.');
    }

    // ── Working-hours validation: the start instant must fall inside a
    //    configured window for its weekday in the page timezone. ──
    if (!this.startWithinWorkingHours(page as any, start)) {
      throw new BadRequestException('This time is outside available hours.');
    }

    // ── Slot binding: the requested start must EXACTLY match one of the slots
    //    the availability engine would generate for that date+page. This blocks
    //    "off-grid" times (e.g. between the step intervals) that pass the loose
    //    window/working-hours checks above. computeSlots already drops slots
    //    that conflict with existing appointments, but we still re-check the
    //    conflict inside the tx below to close the read-committed race. ──
    const ymd = this.utcToYmdInTz(start, page.timezone);
    const availableSlots = await this.computeSlots(
      organization.id,
      page as any,
      ymd,
    );
    const startIso = start.toISOString();
    if (!availableSlots.some((s) => s.start === startIso)) {
      throw new BadRequestException(
        'Selected time is not available. Please pick an available slot.',
      );
    }

    // ── Double-opt-in: a single-use verification secret embedded in the
    //    confirm link emailed to the visitor. The pending row carries it until
    //    verify() flips the booking to 'scheduled' and clears it. ──
    const token = randomBytes(32).toString('hex');

    // ── Atomic conflict-check + insert (as PENDING) ──
    const appt = await this.prisma.withOrganization(
      organization.id,
      async (tx: any) => {
        // Buffer extends the conflict window on both sides.
        const bufMs = page.bufferMinutes * 60_000;
        const windowStart = new Date(start.getTime() - bufMs);
        const windowEnd = new Date(end.getTime() + bufMs);

        // Only CONFIRMED ('scheduled') bookings hold a slot. 'pending'
        // (unverified double-opt-in) rows are excluded so they can't be used to
        // DoS availability with unverified spam bookings.
        const conflict = await tx.appointment.findFirst({
          where: {
            organizationId: organization.id,
            staffId: page.staffId,
            status: 'scheduled',
            // overlap: existing.start < windowEnd AND existing.end > windowStart
            startTime: { lt: windowEnd },
            endTime: { gt: windowStart },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException('That slot is no longer available.');
        }

        // Create as PENDING — does NOT hold the slot (excluded from conflict
        // checks above) and is NOT guarded by the unique index (which is now
        // scoped to status='scheduled'). The slot is only claimed when the
        // visitor verifies their email via verify().
        return await tx.appointment.create({
          data: {
            organizationId: organization.id,
            staffId: page.staffId,
            title: page.title,
            description: dto.notes ? dto.notes.slice(0, 5000) : null,
            location: page.meetingLocation ?? null,
            startTime: start,
            endTime: end,
            status: 'pending',
            source: 'booking-page',
            bookingPageId: page.id,
            attendeeName: dto.name.slice(0, 200),
            attendeeEmail: dto.email.slice(0, 320),
            verificationToken: token,
            verificationExpiresAt: new Date(now + VERIFICATION_TTL_MS),
          },
        });
      },
    );

    // ── Verification email ONLY (best-effort). Double-opt-in: the visitor must
    //    click the emailed link to confirm. Staff are NOT notified and no
    //    confirmation/.ics is sent until the booking is verified (see verify()).
    //    This closes the email-relay gap: an unverified third-party email never
    //    receives a "confirmed" message and never holds the slot. ──
    await this.sendVerificationEmail(organization.id, page as any, appt, token);

    return {
      status: 'pending' as const,
      message: 'Please check your email to confirm your booking.',
    };
  }

  /**
   * Public email double-opt-in: the visitor opens the link emailed by book()
   * which carries `token`. Re-validates the slot is still bookable and free
   * (only 'scheduled' bookings count as busy), then atomically flips the
   * pending appointment to 'scheduled' — first verifier wins; a later verify
   * for a now-taken slot gets a clean 409. On success, the confirmation +
   * staff emails + .ics are sent (the work book() used to do inline).
   */
  async verify(token: string, ip: string | null) {
    // Light per-IP burst limit — the token is itself a single-use secret, so
    // this just blunts brute-force scanning of the token space.
    if (!this.checkRateLimit(`vip:${ip ?? 'unknown'}`, RL_IP, Date.now())) {
      throw new BadRequestException(
        'Too many attempts. Please try again later.',
      );
    }

    const t = String(token ?? '').trim();
    if (!t) throw new BadRequestException('Invalid or expired link');

    const appt = await this.prisma.appointment.findFirst({
      where: { verificationToken: t },
    });
    if (!appt) {
      throw new NotFoundException('Invalid or expired link');
    }

    // Idempotent: a second click on an already-confirmed booking succeeds.
    if (appt.status === 'scheduled') {
      return {
        status: 'scheduled' as const,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        meetingLocation: appt.location ?? null,
      };
    }
    if (appt.status !== 'pending') {
      throw new BadRequestException('Invalid or expired link');
    }
    if (
      appt.verificationExpiresAt &&
      appt.verificationExpiresAt.getTime() < Date.now()
    ) {
      throw new GoneException(
        'This confirmation link has expired. Please book again.',
      );
    }

    // Re-load the page config to re-validate the window/working-hours and to
    // build the confirmation emails (location/title/buffer come from here).
    const page = await this.prisma.bookingPage.findFirst({
      where: { id: appt.bookingPageId ?? '', organizationId: appt.organizationId },
    });
    if (!page) {
      // Page was deleted/unbound since the pending booking was made.
      throw new BadRequestException('Invalid or expired link');
    }

    const start = appt.startTime;
    const end = appt.endTime;

    // ── Re-validate the booking window (lead time / max advance) at confirm. ──
    const nowMs = Date.now();
    const minStart = nowMs + page.minLeadTimeHours * 3_600_000;
    const maxStart = nowMs + page.maxAdvanceDays * 86_400_000;
    if (start.getTime() < minStart) {
      throw new BadRequestException('This time is no longer bookable (too soon).');
    }
    if (start.getTime() > maxStart) {
      throw new BadRequestException('This time is too far in the future.');
    }
    if (!this.startWithinWorkingHours(page as any, start)) {
      throw new BadRequestException('This time is outside available hours.');
    }

    const confirmed = await this.prisma.withOrganization(
      appt.organizationId,
      async (tx: any) => {
        // Buffer-aware conflict re-check — only confirmed bookings count.
        const bufMs = page.bufferMinutes * 60_000;
        const windowStart = new Date(start.getTime() - bufMs);
        const windowEnd = new Date(end.getTime() + bufMs);

        const conflict = await tx.appointment.findFirst({
          where: {
            organizationId: appt.organizationId,
            staffId: page.staffId,
            status: 'scheduled',
            id: { not: appt.id },
            startTime: { lt: windowEnd },
            endTime: { gt: windowStart },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(
            'That slot was just taken. Please book another time.',
          );
        }

        try {
          return await tx.appointment.update({
            where: { id: appt.id },
            data: {
              status: 'scheduled',
              verifiedAt: new Date(),
              verificationToken: null,
            },
          });
        } catch (e: any) {
          // The partial unique index (scoped to status='scheduled') firing means
          // another visitor confirmed this exact slot first — clean 409.
          // Prisma reports P2002; raw Postgres is 23505.
          const isUniqueViolation =
            e?.code === 'P2002' ||
            e?.code === '23505' ||
            e?.meta?.code === '23505' ||
            /unique constraint|23505/i.test(String(e?.message ?? ''));
          if (isUniqueViolation) {
            throw new ConflictException(
              'That slot was just taken. Please book another time.',
            );
          }
          throw e;
        }
      },
    );

    // ── Now (and only now) send confirmation + staff notification + .ics. ──
    await this.sendBookingEmails(appt.organizationId, page as any, confirmed);

    return {
      status: 'scheduled' as const,
      startTime: confirmed.startTime.toISOString(),
      endTime: confirmed.endTime.toISOString(),
      meetingLocation: page.meetingLocation ?? null,
    };
  }

  // ════════════════════════════════════════════════════════════
  //  Availability engine
  // ════════════════════════════════════════════════════════════

  /**
   * Compute bookable UTC slots for `page` on the wall-clock day `ymd`
   * (interpreted in `page.timezone`):
   *   1. Read the weekday's working-hours windows (in page tz).
   *   2. Step `durationMinutes` (+ bufferMinutes) across each window.
   *   3. Convert each wall-clock slot to a UTC instant (DST-correct).
   *   4. Drop slots in the past / before lead time / beyond max-advance /
   *      overlapping a non-cancelled appointment (buffer-aware).
   */
  private async computeSlots(
    orgId: string,
    page: {
      staffId: string;
      timezone: string;
      durationMinutes: number;
      bufferMinutes: number;
      minLeadTimeHours: number;
      maxAdvanceDays: number;
      workingHours: any;
    },
    ymd: string,
  ): Promise<Slot[]> {
    const tz = page.timezone;
    const windows = this.windowsForDay(page.workingHours, ymd, tz);
    if (windows.length === 0) return [];

    const nowMs = Date.now();
    const minStart = nowMs + page.minLeadTimeHours * 3_600_000;
    const maxStart = nowMs + page.maxAdvanceDays * 86_400_000;
    const stepMs = (page.durationMinutes + page.bufferMinutes) * 60_000;
    const durMs = page.durationMinutes * 60_000;
    const bufMs = page.bufferMinutes * 60_000;

    // Candidate UTC slots from the working-hours windows.
    const candidates: { start: Date; end: Date }[] = [];
    for (const w of windows) {
      const wStart = parseHhMm(w.start);
      const wEnd = parseHhMm(w.end);
      if (wStart == null || wEnd == null || wEnd <= wStart) continue;

      const windowStartUtc = wallTimeToUtc(
        ymd,
        Math.floor(wStart / 60),
        wStart % 60,
        tz,
      );
      const windowEndUtc = wallTimeToUtc(
        ymd,
        Math.floor(wEnd / 60),
        wEnd % 60,
        tz,
      );

      let cursor = windowStartUtc.getTime();
      // A slot fits only if start + duration <= window end.
      while (cursor + durMs <= windowEndUtc.getTime()) {
        candidates.push({
          start: new Date(cursor),
          end: new Date(cursor + durMs),
        });
        cursor += stepMs;
      }
    }
    if (candidates.length === 0) return [];

    // Fetch existing CONFIRMED appointments overlapping this day window
    // (widened by buffer) for the staff member, once. Only 'scheduled' bookings
    // hold a slot — 'pending' (unverified double-opt-in) and 'cancelled' rows are
    // excluded so unverified spam bookings can't DoS availability.
    const dayLo = candidates[0].start.getTime() - bufMs;
    const dayHi = candidates[candidates.length - 1].end.getTime() + bufMs;
    const existing = await this.prisma.appointment.findMany({
      where: {
        organizationId: orgId,
        staffId: page.staffId,
        status: 'scheduled',
        startTime: { lt: new Date(dayHi) },
        endTime: { gt: new Date(dayLo) },
      },
      select: { startTime: true, endTime: true },
    });

    const out: Slot[] = [];
    for (const c of candidates) {
      if (c.start.getTime() < minStart) continue; // past / lead-time
      if (c.start.getTime() > maxStart) continue; // beyond max advance
      // Buffer-aware overlap against existing appointments.
      const cLo = c.start.getTime() - bufMs;
      const cHi = c.end.getTime() + bufMs;
      const conflict = existing.some(
        (e) => e.startTime.getTime() < cHi && e.endTime.getTime() > cLo,
      );
      if (conflict) continue;
      out.push({ start: c.start.toISOString(), end: c.end.toISOString() });
    }
    return out;
  }

  /** True if `start` (UTC) lands inside a working-hours window for its tz weekday. */
  private startWithinWorkingHours(
    page: { timezone: string; workingHours: any },
    start: Date,
  ): boolean {
    const tz = page.timezone;
    // The wall-clock date for this instant, in the page tz.
    const ymd = this.utcToYmdInTz(start, tz);
    const windows = this.windowsForDay(page.workingHours, ymd, tz);
    for (const w of windows) {
      const wStart = parseHhMm(w.start);
      const wEnd = parseHhMm(w.end);
      if (wStart == null || wEnd == null) continue;
      const lo = wallTimeToUtc(ymd, Math.floor(wStart / 60), wStart % 60, tz);
      const hi = wallTimeToUtc(ymd, Math.floor(wEnd / 60), wEnd % 60, tz);
      if (start.getTime() >= lo.getTime() && start.getTime() < hi.getTime()) {
        return true;
      }
    }
    return false;
  }

  /** Working-hours windows for the weekday of `ymd` (in tz). [] when closed. */
  private windowsForDay(
    workingHours: any,
    ymd: string,
    tz: string,
  ): WorkingWindow[] {
    if (!workingHours || typeof workingHours !== 'object') return [];
    const key = weekdayKeyInTz(ymd, tz);
    const raw = workingHours[key];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (w: any) =>
        w && typeof w.start === 'string' && typeof w.end === 'string',
    );
  }

  /** "YYYY-MM-DD" of `date` as observed in `tz`. */
  private utcToYmdInTz(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  }

  // ════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════

  private async resolvePublicPage(orgSlug: string, pageSlug: string) {
    if (!orgSlug || !pageSlug) {
      throw new NotFoundException('Booking page not found');
    }
    // orgSlug may be the org `slug` OR the org UUID (mirrors lead-forms).
    const organization = await this.prisma.organization.findFirst({
      where: { OR: [{ slug: orgSlug }, { id: orgSlug }] },
      select: { id: true, slug: true, name: true },
    });
    if (!organization) throw new NotFoundException('Booking page not found');

    const page = await this.prisma.bookingPage.findFirst({
      where: {
        organizationId: organization.id,
        slug: pageSlug.toLowerCase(),
        active: true,
      },
    });
    if (!page) throw new NotFoundException('Booking page not found');

    return { page, organization };
  }

  private withPublicUrl<T extends { slug: string; organizationId: string }>(
    page: T,
  ): T & { publicUrl: string } {
    // We don't have the org slug on the page row; build a stable URL using the
    // org id (the public resolver accepts slug-or-id). Front-end can swap in the
    // human slug if it has it. APP_URL is the marketing/app origin.
    const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
    return {
      ...page,
      publicUrl: `${base}/book/${page.organizationId}/${page.slug}`,
    };
  }

  private normalizeSlug(slug: string): string {
    const s = String(slug ?? '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
      throw new BadRequestException(
        'slug must be lowercase letters/numbers separated by single hyphens',
      );
    }
    return s;
  }

  private validateConfig(
    dto: Partial<CreateBookingPageDto & UpdateBookingPageDto>,
  ) {
    if (dto.durationMinutes !== undefined && dto.durationMinutes <= 0) {
      throw new BadRequestException('durationMinutes must be positive');
    }
    if (dto.bufferMinutes !== undefined && dto.bufferMinutes < 0) {
      throw new BadRequestException('bufferMinutes cannot be negative');
    }
    if (dto.minLeadTimeHours !== undefined && dto.minLeadTimeHours < 0) {
      throw new BadRequestException('minLeadTimeHours cannot be negative');
    }
    if (
      dto.maxAdvanceDays !== undefined &&
      (dto.maxAdvanceDays <= 0 || dto.maxAdvanceDays > 365)
    ) {
      throw new BadRequestException('maxAdvanceDays must be between 1 and 365');
    }
    if (dto.workingHours !== undefined && dto.workingHours !== null) {
      if (typeof dto.workingHours !== 'object' || Array.isArray(dto.workingHours)) {
        throw new BadRequestException(
          'workingHours must be an object keyed by weekday',
        );
      }
      for (const [day, windows] of Object.entries(dto.workingHours)) {
        if (!Array.isArray(windows)) {
          throw new BadRequestException(`workingHours.${day} must be an array`);
        }
        for (const w of windows as any[]) {
          if (parseHhMm(w?.start) == null || parseHhMm(w?.end) == null) {
            throw new BadRequestException(
              `workingHours.${day} entries need valid HH:MM start/end`,
            );
          }
        }
      }
    }
  }

  /**
   * Double-opt-in: email the visitor a single-use confirm link. This is the
   * ONLY message sent at book() time — staff are not notified and no .ics goes
   * out until the booking is verified. Best-effort (logged, non-fatal).
   */
  private async sendVerificationEmail(
    orgId: string,
    page: { title: string; meetingLocation: string | null },
    appt: { id: string; startTime: Date; attendeeName: string | null; attendeeEmail: string | null },
    token: string,
  ) {
    if (!this.emails) return;
    if (!appt.attendeeEmail) return;

    const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
    const link = `${base}/book/verify/${token}`;
    const when = appt.startTime.toUTCString();

    try {
      await this.emails.queue({
        orgId,
        to: appt.attendeeEmail,
        subject: `Confirm your booking: ${page.title}`,
        html: `<p>Hi ${escapeHtml(appt.attendeeName ?? '')},</p>
<p>Please confirm your booking for <strong>${escapeHtml(page.title)}</strong> by clicking the link below.</p>
<p><strong>When:</strong> ${escapeHtml(when)} (UTC)</p>
${page.meetingLocation ? `<p><strong>Where:</strong> ${escapeHtml(page.meetingLocation)}</p>` : ''}
<p><a href="${link}">Confirm my booking</a></p>
<p>This link expires in 30 minutes. If you didn't request this, you can ignore this email — nothing is booked until you confirm.</p>`,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to queue verification email for ${appt.id}: ${(e as Error).message}`,
      );
    }
  }

  /** Confirmation to the visitor + notification to the staff member. */
  private async sendBookingEmails(
    orgId: string,
    page: { staffId: string; title: string; meetingLocation: string | null },
    appt: {
      id: string;
      startTime: Date;
      endTime: Date;
      attendeeName: string | null;
      attendeeEmail: string | null;
    },
  ) {
    if (!this.emails) return;

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const staff = await this.prisma.user.findFirst({
      where: { id: page.staffId, organizationId: orgId },
      select: { email: true, firstName: true, lastName: true },
    });

    const when = appt.startTime.toUTCString();
    const ics = this.buildIcs({
      uid: `apt-${appt.id}@appoinlycrm`,
      start: appt.startTime,
      end: appt.endTime,
      summary: page.title,
      description: `Booking with ${org?.name ?? ''}`,
      location: page.meetingLocation ?? '',
    });
    const attachments = [
      {
        filename: 'invite.ics',
        content: ics,
        contentType: 'text/calendar; method=PUBLISH; charset=UTF-8',
      },
    ];

    // Visitor confirmation.
    if (appt.attendeeEmail) {
      try {
        await this.emails.queue({
          orgId,
          to: appt.attendeeEmail,
          subject: `Booking confirmed: ${page.title}`,
          html: `<p>Hi ${escapeHtml(appt.attendeeName ?? '')},</p>
<p>Your booking for <strong>${escapeHtml(page.title)}</strong> is confirmed.</p>
<p><strong>When:</strong> ${escapeHtml(when)} (UTC)</p>
${page.meetingLocation ? `<p><strong>Where:</strong> ${escapeHtml(page.meetingLocation)}</p>` : ''}
<p>We look forward to seeing you.</p>`,
          attachments,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to queue visitor confirmation for ${appt.id}: ${(e as Error).message}`,
        );
      }
    }

    // Staff notification.
    if (staff?.email) {
      try {
        await this.emails.queue({
          orgId,
          to: staff.email,
          subject: `New booking: ${page.title} — ${appt.attendeeName ?? ''}`.trim(),
          html: `<p>Hi ${escapeHtml(staff.firstName ?? '')},</p>
<p>You have a new booking via your public page.</p>
<p><strong>What:</strong> ${escapeHtml(page.title)}<br/>
<strong>When:</strong> ${escapeHtml(when)} (UTC)<br/>
<strong>Attendee:</strong> ${escapeHtml(appt.attendeeName ?? '')} (${escapeHtml(appt.attendeeEmail ?? '')})</p>
<p><a href="${(process.env.APP_URL ?? '').replace(/\/$/, '')}/appointments">View in CRM</a></p>`,
          attachments,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to queue staff notification for ${appt.id}: ${(e as Error).message}`,
        );
      }
    }
  }

  /** Minimal RFC5545 VCALENDAR for the booked appointment. */
  private buildIcs(opts: {
    uid: string;
    start: Date;
    end: Date;
    summary: string;
    description: string;
    location: string;
  }): string {
    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) =>
      String(s)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AppoinlyCRM//Booking//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${opts.uid}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(opts.start)}`,
      `DTEND:${fmt(opts.end)}`,
      `SUMMARY:${esc(opts.summary)}`,
      `DESCRIPTION:${esc(opts.description)}`,
      `LOCATION:${esc(opts.location)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
