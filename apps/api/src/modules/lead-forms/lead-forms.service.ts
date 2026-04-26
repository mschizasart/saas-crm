import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import {
  CreateLeadFormDto,
  UpdateLeadFormDto,
  LeadFormFieldDto,
  FIELD_TYPES,
} from './dto/lead-form.dto';

type StoredField = {
  key: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required?: boolean;
  options?: string[];
};

/**
 * Very small in-memory rate limiter for the public submit endpoint.
 * Keyed by `<orgSlug>:<formSlug>:<ip>`; allows one hit per window.
 * Good enough for v1 honeypot+burst protection; replace with Redis/ThrottlerGuard
 * if we ever scale to multiple API nodes.
 */
const SUBMIT_WINDOW_MS = 10_000;
const submitLog = new Map<string, number>();

@Injectable()
export class LeadFormsService {
  private readonly logger = new Logger(LeadFormsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    @Optional() private emails?: EmailsService,
  ) {}

  // ─── Admin CRUD ─────────────────────────────────────────────

  async list(orgId: string) {
    return this.prisma.leadForm.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const form = await this.prisma.leadForm.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!form) throw new NotFoundException('Lead form not found');
    return form;
  }

  async create(orgId: string, dto: CreateLeadFormDto) {
    const fields = this.validateAndNormalizeFields(dto.fields);

    const existing = await this.prisma.leadForm.findFirst({
      where: { organizationId: orgId, slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `A form with slug "${dto.slug}" already exists for this organization`,
      );
    }

    return this.prisma.leadForm.create({
      data: {
        organizationId: orgId,
        slug: dto.slug,
        name: dto.name,
        title: dto.title,
        description: dto.description ?? null,
        fields: fields as any,
        redirectUrl: dto.redirectUrl ?? null,
        captchaEnabled: dto.captchaEnabled ?? true,
        notifyEmail: dto.notifyEmail ?? null,
        assignToUserId: dto.assignToUserId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(orgId: string, id: string, dto: UpdateLeadFormDto) {
    await this.findOne(orgId, id);

    if (dto.slug) {
      const clash = await this.prisma.leadForm.findFirst({
        where: { organizationId: orgId, slug: dto.slug, NOT: { id } },
      });
      if (clash) {
        throw new ConflictException(
          `A form with slug "${dto.slug}" already exists for this organization`,
        );
      }
    }

    const data: Record<string, any> = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.fields !== undefined) {
      data.fields = this.validateAndNormalizeFields(dto.fields) as any;
    }
    if (dto.redirectUrl !== undefined) data.redirectUrl = dto.redirectUrl;
    if (dto.captchaEnabled !== undefined) data.captchaEnabled = dto.captchaEnabled;
    if (dto.notifyEmail !== undefined) data.notifyEmail = dto.notifyEmail;
    if (dto.assignToUserId !== undefined) data.assignToUserId = dto.assignToUserId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.leadForm.update({ where: { id }, data });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.leadForm.delete({ where: { id } });
  }

  // ─── Public ─────────────────────────────────────────────────

  /**
   * Returns the subset of fields safe to expose on the public form page.
   * Hides `notifyEmail`, `assignToUserId`, counts, etc.
   */
  async getPublic(orgSlug: string, formSlug: string) {
    const { form } = await this.resolvePublicForm(orgSlug, formSlug);

    return {
      name: form.name,
      title: form.title,
      description: form.description,
      fields: form.fields,
      captchaEnabled: form.captchaEnabled,
      redirectUrl: form.redirectUrl, // included so client can follow client-side
    };
  }

  async submit(
    orgSlug: string,
    formSlug: string,
    payload: Record<string, unknown>,
    ip: string | null,
  ) {
    // Rate limit: 1 submission per form+ip per window
    const key = `${orgSlug}:${formSlug}:${ip ?? 'unknown'}`;
    const now = Date.now();
    const last = submitLog.get(key);
    if (last && now - last < SUBMIT_WINDOW_MS) {
      throw new BadRequestException(
        'Too many submissions. Please wait a moment and try again.',
      );
    }
    submitLog.set(key, now);
    // Best-effort cleanup to keep the map from growing unbounded.
    if (submitLog.size > 10_000) {
      for (const [k, t] of submitLog) {
        if (now - t > SUBMIT_WINDOW_MS * 10) submitLog.delete(k);
      }
    }

    const { form, organization } = await this.resolvePublicForm(
      orgSlug,
      formSlug,
    );

    // Honeypot: if bot filled the hidden `website` field, silently accept.
    if (typeof payload.website === 'string' && payload.website.trim() !== '') {
      this.logger.warn(
        `Lead form honeypot triggered for ${orgSlug}/${formSlug}`,
      );
      return { ok: true };
    }

    const fields = (form.fields as unknown as StoredField[]) ?? [];

    // Validate required fields and collect known values.
    const values: Record<string, string> = {};
    for (const f of fields) {
      const raw = payload[f.key];
      const str = typeof raw === 'string' ? raw.trim() : '';
      if (f.required && !str) {
        throw new BadRequestException(`Field "${f.label}" is required`);
      }
      if (!str) continue;

      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        throw new BadRequestException(`Field "${f.label}" must be a valid email`);
      }
      if (f.type === 'select' && f.options?.length && !f.options.includes(str)) {
        throw new BadRequestException(
          `Field "${f.label}" must be one of: ${f.options.join(', ')}`,
        );
      }

      values[f.key] = str.slice(0, 5000); // hard cap per field
    }

    // Map common field keys → Lead columns; everything else goes to description.
    const name =
      values.name ||
      [values.firstName, values.lastName].filter(Boolean).join(' ') ||
      values.fullName ||
      values.email ||
      'Web form lead';

    // Build a description block that includes any extra unmapped fields
    const mapped = new Set([
      'name',
      'firstName',
      'lastName',
      'fullName',
      'email',
      'phone',
      'company',
      'website',
      'message',
    ]);
    const extras: string[] = [];
    for (const f of fields) {
      if (mapped.has(f.key)) continue;
      if (values[f.key]) extras.push(`${f.label}: ${values[f.key]}`);
    }
    const descriptionParts = [values.message, ...extras].filter(Boolean);
    const description = descriptionParts.length
      ? descriptionParts.join('\n\n')
      : null;

    // Resolve default lead status + source for this org
    const [defaultStatus, source] = await Promise.all([
      this.prisma.leadStatus.findFirst({
        where: { organizationId: organization.id },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      }),
      this.ensureSource(organization.id, `Web form: ${form.name}`),
    ]);

    const lead = await this.prisma.lead.create({
      data: {
        organizationId: organization.id,
        name: name.slice(0, 200),
        email: values.email ?? null,
        phone: values.phone ?? null,
        company: values.company ?? null,
        website: values.website ?? null,
        description,
        statusId: defaultStatus?.id ?? null,
        sourceId: source?.id ?? null,
        assignedTo: form.assignToUserId ?? null,
      },
    });

    await this.prisma.leadForm.update({
      where: { id: form.id },
      data: { submissionCount: { increment: 1 } },
    });

    // Fire the same domain event existing code listens to, so downstream
    // automations (notifications, email confirmations, etc.) still run.
    this.events.emit('lead.created', {
      lead,
      orgId: organization.id,
      createdBy: 'web_form',
      source: 'lead_form',
      formId: form.id,
    });

    // Direct notification email if the form has a notifyEmail configured.
    if (form.notifyEmail && this.emails) {
      const summary = Object.entries(values)
        .map(([k, v]) => `<tr><td style="padding:4px 8px"><b>${escapeHtml(
          labelFor(fields, k),
        )}</b></td><td style="padding:4px 8px">${escapeHtml(v)}</td></tr>`)
        .join('');
      try {
        await this.emails.queue({
          to: form.notifyEmail,
          subject: `New lead from "${form.name}" — ${name}`,
          html: `
            <p>You have a new lead from the <b>${escapeHtml(form.name)}</b> web form.</p>
            <table style="border-collapse:collapse;border:1px solid #e5e7eb">
              ${summary}
            </table>
            <p style="margin-top:16px">
              <a href="${process.env.APP_URL ?? ''}/leads/${lead.id}">Open lead in CRM</a>
            </p>
          `,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to queue notify email for form ${form.id}: ${(e as Error).message}`,
        );
      }
    }

    return {
      ok: true,
      redirectUrl: form.redirectUrl ?? undefined,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  private validateAndNormalizeFields(
    input: LeadFormFieldDto[] | undefined,
  ): StoredField[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestException('At least one field is required');
    }
    const seen = new Set<string>();
    const out: StoredField[] = [];
    for (const f of input) {
      if (seen.has(f.key)) {
        throw new BadRequestException(`Duplicate field key: "${f.key}"`);
      }
      seen.add(f.key);
      if (f.type === 'select' && (!f.options || f.options.length === 0)) {
        throw new BadRequestException(
          `Select field "${f.label}" must have at least one option`,
        );
      }
      out.push({
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        options: f.type === 'select' ? f.options : undefined,
      });
    }
    return out;
  }

  private async resolvePublicForm(orgSlug: string, formSlug: string) {
    if (!orgSlug || !formSlug) {
      throw new NotFoundException('Form not found');
    }

    // orgSlug may be either the `slug` column or the org UUID (fallback when
    // tenants haven't configured a human-readable slug).
    const organization = await this.prisma.organization.findFirst({
      where: {
        OR: [{ slug: orgSlug }, { id: orgSlug }],
      },
      select: { id: true, slug: true, name: true },
    });
    if (!organization) throw new NotFoundException('Form not found');

    const form = await this.prisma.leadForm.findFirst({
      where: {
        organizationId: organization.id,
        slug: formSlug,
        isActive: true,
      },
    });
    if (!form) throw new NotFoundException('Form not found');

    return { form, organization };
  }

  private async ensureSource(orgId: string, name: string) {
    const existing = await this.prisma.leadSource.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: name, mode: 'insensitive' },
      },
    });
    if (existing) return existing;
    return this.prisma.leadSource.create({
      data: { organizationId: orgId, name },
    });
  }
}

// ─── tiny helpers ──────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFor(fields: StoredField[], key: string): string {
  return fields.find((f) => f.key === key)?.label ?? key;
}
