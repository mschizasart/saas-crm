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
  CreateEstimateRequestFormDto,
  UpdateEstimateRequestFormDto,
  EstimateRequestFormFieldDto,
  FIELD_TYPES,
} from './dto/estimate-request-form.dto';

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
export class EstimateRequestFormsService {
  private readonly logger = new Logger(EstimateRequestFormsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    @Optional() private emails?: EmailsService,
  ) {}

  // ─── Admin CRUD ─────────────────────────────────────────────

  async list(orgId: string) {
    return this.prisma.estimateRequestForm.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const form = await this.prisma.estimateRequestForm.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!form) throw new NotFoundException('Estimate request form not found');
    return form;
  }

  async create(orgId: string, dto: CreateEstimateRequestFormDto) {
    const fields = this.validateAndNormalizeFields(dto.fields);

    const existing = await this.prisma.estimateRequestForm.findFirst({
      where: { organizationId: orgId, slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `A form with slug "${dto.slug}" already exists for this organization`,
      );
    }

    return this.prisma.estimateRequestForm.create({
      data: {
        organizationId: orgId,
        slug: dto.slug,
        name: dto.name,
        title: dto.title,
        description: dto.description ?? null,
        fields: fields as any,
        defaultClientId: dto.defaultClientId ?? null,
        defaultCurrencyId: dto.defaultCurrencyId ?? null,
        redirectUrl: dto.redirectUrl ?? null,
        captchaEnabled: dto.captchaEnabled ?? true,
        notifyEmail: dto.notifyEmail ?? null,
        assignToUserId: dto.assignToUserId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(orgId: string, id: string, dto: UpdateEstimateRequestFormDto) {
    await this.findOne(orgId, id);

    if (dto.slug) {
      const clash = await this.prisma.estimateRequestForm.findFirst({
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
    if (dto.defaultClientId !== undefined)
      data.defaultClientId = dto.defaultClientId || null;
    if (dto.defaultCurrencyId !== undefined)
      data.defaultCurrencyId = dto.defaultCurrencyId || null;
    if (dto.redirectUrl !== undefined) data.redirectUrl = dto.redirectUrl;
    if (dto.captchaEnabled !== undefined)
      data.captchaEnabled = dto.captchaEnabled;
    if (dto.notifyEmail !== undefined) data.notifyEmail = dto.notifyEmail;
    if (dto.assignToUserId !== undefined)
      data.assignToUserId = dto.assignToUserId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.estimateRequestForm.update({ where: { id }, data });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.estimateRequestForm.delete({ where: { id } });
  }

  // ─── Public ─────────────────────────────────────────────────

  /**
   * Returns the subset of fields safe to expose on the public form page.
   * Hides notifyEmail, assignToUserId, defaultClientId, counts, etc.
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
        `Estimate request form honeypot triggered for ${orgSlug}/${formSlug}`,
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
        throw new BadRequestException(
          `Field "${f.label}" must be a valid email`,
        );
      }
      if (f.type === 'select' && f.options?.length && !f.options.includes(str)) {
        throw new BadRequestException(
          `Field "${f.label}" must be one of: ${f.options.join(', ')}`,
        );
      }
      if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(str)) {
        throw new BadRequestException(`Field "${f.label}" must be a number`);
      }

      values[f.key] = str.slice(0, 5000); // hard cap per field
    }

    // Resolve the client to attach the estimate to. Wraps the lookup in the
    // tenant context so RLS-protected reads/writes (clients, users) succeed.
    const clientId = await this.prisma.withOrganization(
      organization.id,
      async (tx) => this.resolveClient(tx, organization.id, form, values),
    );

    // Resolve currency: form default → org default → null.
    const currencyId = await this.prisma.withOrganization(
      organization.id,
      async (tx) =>
        this.resolveCurrencyId(tx, organization.id, form.defaultCurrencyId ?? null),
    );

    // Build a notes block from the submission so the tenant sees everything
    // when they review the draft estimate. Includes the freeform message and
    // every other submitted field as label/value pairs.
    const messageText = values.message || values.details || values.notes || '';
    const submittedLines: string[] = [];
    submittedLines.push(`— Submitted via "${form.name}" web form —`);
    for (const f of fields) {
      if (!values[f.key]) continue;
      submittedLines.push(`${f.label}: ${values[f.key]}`);
    }
    if (form.assignToUserId) {
      submittedLines.push(`Suggested assignee: ${form.assignToUserId}`);
    }
    const adminNote = submittedLines.join('\n');
    const clientNote = messageText ? messageText.slice(0, 4000) : null;

    // Build the placeholder line item.
    // v1: no product picker on the form, so always one "See request" item with
    // qty=1, rate=0 — the tenant edits this when finalising.
    const itemDescription =
      values.items || values.scope || values.serviceType || 'See request';

    const issueDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Wrap the estimate insert in tenant context so RLS write checks succeed.
    const estimate = await this.prisma.withOrganization(
      organization.id,
      async (tx) => {
        const number = await this.generateEstimateNumber(organization.id, tx);
        return tx.estimate.create({
          data: {
            organizationId: organization.id,
            clientId: clientId ?? null,
            currencyId: currencyId ?? null,
            number,
            status: 'draft',
            date: issueDate,
            expiryDate,
            subTotal: 0,
            discount: 0,
            adjustment: 0,
            total: 0,
            totalTax: 0,
            clientNote,
            adminNote,
            items: {
              create: [
                {
                  description: String(itemDescription).slice(0, 500),
                  qty: 1,
                  rate: 0,
                  order: 0,
                },
              ],
            },
          },
          include: { items: true },
        });
      },
    );

    await this.prisma.estimateRequestForm.update({
      where: { id: form.id },
      data: { submissionCount: { increment: 1 } },
    });

    // Fire a domain event so any future listeners (notifications, slack hooks,
    // automations) can react. Naming mirrors `lead.created`.
    this.events.emit('estimate.requested', {
      estimate,
      orgId: organization.id,
      createdBy: 'web_form',
      source: 'estimate_request_form',
      formId: form.id,
    });

    // Direct notification email if the form has a notifyEmail configured.
    if (form.notifyEmail && this.emails) {
      const summary = Object.entries(values)
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 8px"><b>${escapeHtml(
              labelFor(fields, k),
            )}</b></td><td style="padding:4px 8px">${escapeHtml(v)}</td></tr>`,
        )
        .join('');
      try {
        await this.emails.queue({
          to: form.notifyEmail,
          subject: `New quote request from "${form.name}" — ${number}`,
          html: `
            <p>You have a new quote request from the <b>${escapeHtml(form.name)}</b> web form.</p>
            <p>A draft estimate <b>${escapeHtml(number)}</b> was created for your review.</p>
            <table style="border-collapse:collapse;border:1px solid #e5e7eb">
              ${summary}
            </table>
            <p style="margin-top:16px">
              <a href="${process.env.APP_URL ?? ''}/estimates/${estimate.id}">Open draft estimate in CRM</a>
            </p>
          `,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to queue notify email for estimate-request form ${form.id}: ${(e as Error).message}`,
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
    input: EstimateRequestFormFieldDto[] | undefined,
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

    const form = await this.prisma.estimateRequestForm.findFirst({
      where: {
        organizationId: organization.id,
        slug: formSlug,
        isActive: true,
      },
    });
    if (!form) throw new NotFoundException('Form not found');

    return { form, organization };
  }

  /**
   * Resolve the client to attach the resulting estimate to.
   *
   *  - If the form has `defaultClientId`, use it (verifying it still belongs
   *    to this org).
   *  - Otherwise look for an existing client in this org that matches the
   *    submitted email (via a contact User) or the submitted company name.
   *  - Finally, create a new lead-style Client placeholder with whatever
   *    company / email / phone we have.
   *
   * Returns null only if creating a placeholder client somehow fails — in
   * practice we always return a valid id.
   */
  private async resolveClient(
    tx: any,
    orgId: string,
    form: { defaultClientId: string | null },
    values: Record<string, string>,
  ): Promise<string | null> {
    if (form.defaultClientId) {
      const existing = await tx.client.findFirst({
        where: { id: form.defaultClientId, organizationId: orgId },
        select: { id: true },
      });
      if (existing) return existing.id;
      // Fall through to lookup/create if the configured default is gone.
    }

    const email = values.email?.toLowerCase();
    const company = values.company?.trim();

    // 1) Match by contact email
    if (email) {
      const contact = await tx.user.findFirst({
        where: {
          organizationId: orgId,
          type: 'contact',
          email: { equals: email, mode: 'insensitive' },
          clientId: { not: null },
        },
        select: { clientId: true },
      });
      if (contact?.clientId) return contact.clientId;
    }

    // 2) Match by company name
    if (company) {
      const byCompany = await tx.client.findFirst({
        where: {
          organizationId: orgId,
          company: { equals: company, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (byCompany) return byCompany.id;
    }

    // 3) Create a placeholder lead-style client
    const placeholderCompany =
      company ||
      values.name ||
      [values.firstName, values.lastName].filter(Boolean).join(' ') ||
      email ||
      'Web request';

    const created = await tx.client.create({
      data: {
        organizationId: orgId,
        company: placeholderCompany.slice(0, 200),
        phone: values.phone ?? null,
        website: values.website ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveCurrencyId(
    tx: any,
    orgId: string,
    preferred: string | null,
  ): Promise<string | null> {
    if (preferred) {
      const exists = await tx.currency.findFirst({
        where: { id: preferred, organizationId: orgId },
        select: { id: true },
      });
      if (exists) return exists.id;
    }
    const def = await tx.currency.findFirst({
      where: { organizationId: orgId, isDefault: true },
      select: { id: true },
    });
    return def?.id ?? null;
  }

  private async generateEstimateNumber(
    orgId: string,
    tx: any = this.prisma,
  ): Promise<string> {
    const count = await tx.estimate.count({
      where: { organizationId: orgId },
    });
    return `EST-${String(count + 1).padStart(4, '0')}`;
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
