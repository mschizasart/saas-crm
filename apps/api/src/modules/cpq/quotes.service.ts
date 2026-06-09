import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateQuoteDto,
  UpdateQuoteDto,
  SendQuoteDto,
  QuoteLineItemDto,
} from './cpq.dto';

// ─── Status state machine ────────────────────────────────────────
// Quote lifecycle: draft → sent → accepted | rejected.
// `expired` is a terminal state set by a future cron when validUntil passes.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: [],
};

// Discount above this threshold trips the Wave E1 approval hook (TODO F2.1).
const DISCOUNT_APPROVAL_THRESHOLD = 20;

/**
 * Quote (CPQ) CRUD + lifecycle.
 *
 * - Totals (subtotal, line totals, grand total) are ALWAYS computed
 *   server-side. The client cannot supply a `total` field. This was a
 *   reviewer flag in Wave E and the same exposure applies here.
 * - Status transitions go through dedicated endpoints (send, mark-accepted,
 *   mark-rejected, convert-to-invoice). The generic `update` refuses any
 *   change once status leaves 'draft'.
 * - Every FK from user input — clientId, opportunityId, productId, bundleId —
 *   is cross-tenant validated before the write transaction so the failure
 *   mode is a clean 400 rather than an opaque FK miss.
 * - Defense-in-depth: every `update` / `delete` has `organizationId` in the
 *   `where` clause.
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Coerce a Prisma `Decimal` (or string/number) to a JS number. Prisma
   * returns `Decimal` objects for `@db.Decimal` columns; arithmetic on
   * those silently coerces to NaN in modern V8. Use this everywhere.
   */
  private toNum(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    const asObj = v as { toNumber?: () => number };
    if (typeof asObj.toNumber === 'function') return asObj.toNumber();
    return 0;
  }

  /** Round to 2 decimals — money should never carry float drift. */
  private money(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Validate every FK accepted from user input is in the caller's org.
   * Done in BULK queries (one per kind of id) — never an N+1 loop.
   */
  private async assertTenantFks(
    orgId: string,
    args: {
      clientId?: string;
      opportunityId?: string | null;
      lineItems?: QuoteLineItemDto[];
    },
  ): Promise<{
    productMap: Map<string, { id: string; name: string; unitPrice: any }>;
    bundleMap: Map<string, { id: string; name: string; items: any[] }>;
  }> {
    const { clientId, opportunityId, lineItems } = args;

    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, organizationId: orgId },
        select: { id: true },
      });
      if (!client) {
        throw new BadRequestException('Client not found for this organization');
      }
    }
    if (opportunityId) {
      const opp = await this.prisma.opportunity.findFirst({
        where: { id: opportunityId, organizationId: orgId },
        select: { id: true },
      });
      if (!opp) {
        throw new BadRequestException(
          'Opportunity not found for this organization',
        );
      }
    }

    const productMap = new Map<string, any>();
    const bundleMap = new Map<string, any>();

    if (lineItems && lineItems.length > 0) {
      // Hard XOR check at service layer — also enforced via DB CHECK and
      // class-validator @ValidateIf, but defense in depth.
      for (const li of lineItems) {
        const hasProduct = !!li.productId;
        const hasBundle = !!li.bundleId;
        if (hasProduct === hasBundle) {
          throw new BadRequestException(
            'Each line item must reference exactly one of productId or bundleId',
          );
        }
      }

      const productIds = Array.from(
        new Set(
          lineItems
            .map((l) => l.productId)
            .filter((v): v is string => !!v),
        ),
      );
      const bundleIds = Array.from(
        new Set(
          lineItems
            .map((l) => l.bundleId)
            .filter((v): v is string => !!v),
        ),
      );

      if (productIds.length > 0) {
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds }, organizationId: orgId },
          select: { id: true, name: true, unitPrice: true },
        });
        if (products.length !== productIds.length) {
          throw new BadRequestException(
            'One or more products do not belong to your organization',
          );
        }
        for (const p of products) productMap.set(p.id, p);
      }

      if (bundleIds.length > 0) {
        const bundles = await this.prisma.productBundle.findMany({
          where: { id: { in: bundleIds }, organizationId: orgId },
          select: {
            id: true,
            name: true,
            items: {
              include: {
                product: { select: { id: true, unitPrice: true } },
              },
            },
          },
        });
        if (bundles.length !== bundleIds.length) {
          throw new BadRequestException(
            'One or more bundles do not belong to your organization',
          );
        }
        for (const b of bundles) bundleMap.set(b.id, b);
      }
    }

    return { productMap, bundleMap };
  }

  /**
   * Compute the per-bundle effective unit price by summing each item's
   * (qty * unitPrice * (1 - itemDiscount/100)).
   *
   * Returns the price the BUNDLE LINE on a quote should use for `unitPrice`
   * (per quantity = 1 of the bundle).
   */
  private bundleEffectivePrice(bundle: any): number {
    let sum = 0;
    for (const it of bundle.items ?? []) {
      const qty = this.toNum(it.quantity);
      const unit = this.toNum(it.product?.unitPrice);
      const disc = this.toNum(it.discountPercent);
      sum += qty * unit * (1 - disc / 100);
    }
    return this.money(sum);
  }

  /**
   * Build the persisted row data for each line + accumulate the subtotal.
   * The math lives ONLY here — totals are NEVER trusted from the client.
   */
  private buildLineRows(
    orgId: string,
    quoteId: string,
    dto: QuoteLineItemDto[],
    productMap: Map<string, any>,
    bundleMap: Map<string, any>,
  ): { rows: any[]; subtotal: number } {
    let subtotal = 0;
    const rows: any[] = [];

    dto.forEach((li, idx) => {
      let unitPrice: number;
      let description: string;

      if (li.productId) {
        const p = productMap.get(li.productId);
        if (!p) {
          throw new BadRequestException(
            'Product not found while building line items',
          );
        }
        unitPrice =
          li.unitPrice !== undefined && li.unitPrice !== null
            ? this.toNum(li.unitPrice)
            : this.toNum(p.unitPrice);
        description =
          li.description && li.description.trim().length > 0
            ? li.description
            : p.name;
      } else if (li.bundleId) {
        const b = bundleMap.get(li.bundleId);
        if (!b) {
          throw new BadRequestException(
            'Bundle not found while building line items',
          );
        }
        unitPrice =
          li.unitPrice !== undefined && li.unitPrice !== null
            ? this.toNum(li.unitPrice)
            : this.bundleEffectivePrice(b);
        description =
          li.description && li.description.trim().length > 0
            ? li.description
            : b.name;
      } else {
        // Should have been caught by assertTenantFks; defense in depth.
        throw new BadRequestException(
          'Each line item must reference exactly one of productId or bundleId',
        );
      }

      const qty = li.quantity;
      const disc = this.toNum(li.discountPercent ?? 0);
      const lineTotal = this.money(qty * unitPrice * (1 - disc / 100));
      subtotal += lineTotal;

      rows.push({
        organizationId: orgId,
        quoteId,
        productId: li.productId ?? null,
        bundleId: li.bundleId ?? null,
        description,
        quantity: qty,
        unitPrice: this.money(unitPrice),
        discountPercent: disc,
        lineTotal,
        order: li.order ?? idx,
      });
    });

    return { rows, subtotal: this.money(subtotal) };
  }

  /**
   * Per-org Quote number sequence — `Q-YYYY-NNNN`.
   *
   * Mirrors the simple `count + 1` pattern used by Invoice / Estimate
   * (see invoices.service.ts:generateInvoiceNumber). Not strictly
   * collision-safe under high concurrency — but the @@unique constraint
   * on (organizationId, number) means a concurrent collision throws a
   * P2002 the caller can retry. Good enough for the human-paced sales
   * workflow this powers; revisit with a Postgres sequence if needed.
   */
  private async generateQuoteNumber(orgId: string, tx: any): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.quote.count({ where: { organizationId: orgId } });
    return `Q-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ─── List ─────────────────────────────────────────────────────

  async list(
    orgId: string,
    query: {
      status?: string;
      clientId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { status, clientId, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (clientId) where.clientId = clientId;
      if (search) {
        where.OR = [
          { number: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.quote.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            _count: { select: { lineItems: true } },
          },
        }),
        tx.quote.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  // ─── Find one ─────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          opportunity: { select: { id: true, name: true } },
          convertedInvoice: { select: { id: true, number: true } },
          lineItems: {
            orderBy: { order: 'asc' },
            include: {
              product: { select: { id: true, name: true, sku: true } },
              bundle: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!quote) throw new NotFoundException('Quote not found');
      return quote;
    });
  }

  // ─── Create ───────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreateQuoteDto) {
    const { productMap, bundleMap } = await this.assertTenantFks(orgId, {
      clientId: dto.clientId,
      opportunityId: dto.opportunityId ?? null,
      lineItems: dto.lineItems,
    });

    return this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateQuoteNumber(orgId, tx);
      // Stub id so we can build the line rows before the parent insert.
      // We use a Prisma `create` with nested writes instead so the parent
      // id is generated atomically with its children.
      const discountPercent = this.toNum(dto.discountPercent ?? 0);

      // Build rows with a placeholder quoteId — we'll inline them in the
      // nested `lineItems.create` so Prisma stamps the FK for us.
      const built = this.buildLineRows(
        orgId,
        '__placeholder__',
        dto.lineItems,
        productMap,
        bundleMap,
      );
      const total = this.money(built.subtotal * (1 - discountPercent / 100));

      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number,
          clientId: dto.clientId,
          opportunityId: dto.opportunityId ?? null,
          status: 'draft',
          validUntil: new Date(dto.validUntil),
          subtotal: built.subtotal,
          discountPercent,
          total,
          currency: dto.currency ?? 'USD',
          notes: dto.notes ?? null,
          createdById: userId,
          lineItems: {
            create: built.rows.map(({ quoteId: _q, ...rest }) => rest),
          },
        },
        include: {
          lineItems: { orderBy: { order: 'asc' } },
        },
      });

      this.events.emit('quote.created', { quote, orgId, userId });
      return quote;
    });
  }

  // ─── Update (drafts only) ────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateQuoteDto) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        `Cannot edit a quote in '${existing.status}' status — only drafts are editable`,
      );
    }

    // Cross-tenant FK guards on anything supplied.
    const { productMap, bundleMap } = await this.assertTenantFks(orgId, {
      clientId: dto.clientId,
      opportunityId: dto.opportunityId === null ? null : dto.opportunityId,
      lineItems: dto.lineItems,
    });

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Re-fetch the live row inside the tx so the recalc is consistent
      // even if the caller didn't pass lineItems.
      const live = await tx.quote.findFirst({
        where: { id, organizationId: orgId },
        include: { lineItems: { orderBy: { order: 'asc' } } },
      });
      if (!live) throw new NotFoundException('Quote not found');

      let subtotal = this.toNum(live.subtotal);

      if (dto.lineItems) {
        // Replace line items wholesale inside the same tx.
        await tx.quoteLineItem.deleteMany({
          where: { quoteId: id, organizationId: orgId },
        });
        const built = this.buildLineRows(
          orgId,
          id,
          dto.lineItems,
          productMap,
          bundleMap,
        );
        await tx.quoteLineItem.createMany({ data: built.rows });
        subtotal = built.subtotal;
      }

      const discountPercent =
        dto.discountPercent !== undefined
          ? this.toNum(dto.discountPercent)
          : this.toNum(live.discountPercent);
      const total = this.money(subtotal * (1 - discountPercent / 100));

      // Defense-in-depth: organizationId in `where`.
      const updated = await tx.quote.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.opportunityId !== undefined && {
            opportunityId: dto.opportunityId,
          }),
          ...(dto.validUntil !== undefined && {
            validUntil: new Date(dto.validUntil),
          }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          subtotal,
          discountPercent,
          total,
        },
        include: {
          lineItems: { orderBy: { order: 'asc' } },
        },
      });

      return updated;
    });
  }

  // ─── Remove (drafts only — audit hygiene) ────────────────────

  async remove(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        `Cannot delete a quote in '${existing.status}' status — only drafts can be deleted`,
      );
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.quote.delete({ where: { id, organizationId: orgId } });
    });
  }

  // ─── Send (draft → sent) ─────────────────────────────────────

  async send(orgId: string, id: string, dto: SendQuoteDto) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('sent')) {
      throw new BadRequestException(
        `Quote in '${existing.status}' status cannot be sent`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      // Defense-in-depth: organizationId in `where`.
      await tx.quote.update({
        where: { id, organizationId: orgId },
        data: { status: 'sent', sentAt: new Date() },
      });
      // Do NOT include client.contacts here — the result is emitted on
      // `quote.sent` and any listener (including future webhook dispatchers)
      // would see the contact list. Listeners that need contacts can resolve
      // them lazily by orgId + clientId.
      return tx.quote.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: { select: { id: true, company: true } },
          lineItems: { orderBy: { order: 'asc' } },
        },
      });
    });

    // Approval hook (Wave F2.1 — not auto-creating today). High-discount
    // quotes should route through Wave E1's approval workflow before they
    // can be sent; we surface the hook here so the cron/event handler can
    // pick it up without us tightly coupling to ApprovalsService.
    const discountPercent = this.toNum(updated?.discountPercent);
    if (discountPercent > DISCOUNT_APPROVAL_THRESHOLD) {
      this.logger.log(
        `TODO Wave F2.1: trigger ApprovalRequest for quote ${id} (org ${orgId}) — discount ${discountPercent}% exceeds ${DISCOUNT_APPROVAL_THRESHOLD}% threshold`,
      );
    }

    // Email side-effect. Emit an event the EmailsService listener (or a
    // future quote.send.processor) can act on without us holding a hard
    // dependency on EmailsService here. The Invoices module follows the
    // same pattern via `invoice.sent`.
    //
    // TODO Wave F2.1: wire a dedicated `QuoteEmailsService.queue()` path
    // that renders the quote PDF + recipient resolution (defaults to the
    // client's primary contact if dto.recipientEmail is missing).
    // Event payload is intentionally narrow: only ids + the recipient hint.
    // The full client (with PII contacts) is NOT included — listeners that
    // need it should resolve lazily from orgId + clientId.
    this.events.emit('quote.sent', {
      orgId,
      quote: updated,
      quoteId: id,
      clientId: updated?.clientId,
      recipientEmail: dto.recipientEmail,
    });

    return updated;
  }

  // ─── markAccepted (sent → accepted) ──────────────────────────

  async markAccepted(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('accepted')) {
      throw new BadRequestException(
        `Quote in '${existing.status}' status cannot be marked accepted`,
      );
    }
    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.quote.update({
        where: { id, organizationId: orgId },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
    });
    this.events.emit('quote.accepted', { orgId, quoteId: id });
    return updated;
  }

  // ─── markRejected (sent → rejected) ──────────────────────────

  async markRejected(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('rejected')) {
      throw new BadRequestException(
        `Quote in '${existing.status}' status cannot be marked rejected`,
      );
    }
    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.quote.update({
        where: { id, organizationId: orgId },
        data: { status: 'rejected' },
      });
    });
    this.events.emit('quote.rejected', { orgId, quoteId: id });
    return updated;
  }

  // ─── Duplicate ───────────────────────────────────────────────

  async duplicate(orgId: string, userId: string, id: string) {
    const source = await this.findOne(orgId, id);

    // Re-validate FKs AND collect current product/bundle prices so the
    // duplicate reflects today's prices, not the frozen prices from when
    // the source was created. (The source's quote-level discountPercent
    // is intentionally preserved.)
    const sourceLineDtos: QuoteLineItemDto[] = source.lineItems.map(
      (li: any) => ({
        productId: li.productId ?? undefined,
        bundleId: li.bundleId ?? undefined,
        description: li.description ?? undefined,
        quantity: Number(li.quantity),
        // Do NOT pass unitPrice — letting buildLineRows fall back to the
        // current product/bundle price is the whole point of the recompute.
        discountPercent: this.toNum(li.discountPercent),
        order: li.order ?? undefined,
      }),
    );
    const { productMap, bundleMap } = await this.assertTenantFks(orgId, {
      lineItems: sourceLineDtos,
    });

    return this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateQuoteNumber(orgId, tx);
      const discountPercent = this.toNum(source.discountPercent);
      const built = this.buildLineRows(
        orgId,
        '__placeholder__',
        sourceLineDtos,
        productMap,
        bundleMap,
      );
      const total = this.money(built.subtotal * (1 - discountPercent / 100));

      const duplicated = await tx.quote.create({
        data: {
          organizationId: orgId,
          number,
          clientId: source.clientId,
          opportunityId: source.opportunityId,
          status: 'draft',
          validUntil: null, // reset — caller picks a new validity window
          subtotal: built.subtotal,
          discountPercent,
          total,
          currency: source.currency,
          notes: source.notes,
          createdById: userId,
          // sentAt / acceptedAt / convertedInvoiceId stay null on purpose.
          lineItems: {
            create: built.rows.map(({ quoteId: _q, ...rest }) => rest),
          },
        },
        include: { lineItems: { orderBy: { order: 'asc' } } },
      });
      return duplicated;
    });
  }

  // ─── Convert to Invoice ──────────────────────────────────────

  /**
   * Convert an ACCEPTED quote to an Invoice.
   *
   * Path chosen: DIRECT PRISMA WRITE against the existing `invoices` /
   * `invoice_items` tables (no InvoicesService injection).
   *
   * Rationale: InvoicesService.create depends on TaxConfigService +
   * EventEmitter and runs the tax-automation pre-hook, which would
   * unexpectedly recompute tax on quote line items that already carry
   * their own discount math. Inserting the rows ourselves keeps the
   * conversion deterministic and lets the user open the resulting invoice
   * in draft state to apply tax / payment terms on review.
   *
   * Idempotent: refuses if convertedInvoiceId is already set. The
   * `quote.convertedInvoiceId` is set inside the same tx as the invoice
   * insert so a partial failure can't leave the quote half-converted.
   */
  async convertToInvoice(orgId: string, userId: string, id: string) {
    const source = await this.findOne(orgId, id);
    if (source.status !== 'accepted') {
      throw new BadRequestException(
        `Only accepted quotes can be converted to an invoice (status='${source.status}')`,
      );
    }
    if (source.convertedInvoiceId) {
      // Idempotency: if already converted, surface that as a conflict so
      // the UI can navigate to the existing invoice rather than create a
      // duplicate.
      throw new ConflictException({
        message: 'Quote has already been converted to an invoice',
        invoiceId: source.convertedInvoiceId,
        quoteId: source.id,
      });
    }

    const result = await this.prisma.withOrganization(orgId, async (tx) => {
      // Invoice number — share the same "INV-NNNN per org" generator the
      // existing InvoicesService uses, inlined here so we don't take a hard
      // dep on that service.
      const count = await tx.invoice.count({
        where: { organizationId: orgId },
      });
      const invoiceNumber = `INV-${String(count + 1).padStart(4, '0')}`;

      const invoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          clientId: source.clientId,
          number: invoiceNumber,
          date: new Date(),
          dueDate: null,
          status: 'draft',
          subTotal: source.subtotal,
          // CONVENTION: when discountType='percent', InvoicesService.calculateTotals
          // computes discountAmount = subtotal * discount / 100 — i.e. a stored
          // discount value of `15` means "15% off", NOT a fraction. So we pass
          // the raw discountPercent through unchanged. See
          // invoices.service.ts:255-256.
          discount: this.toNum(source.discountPercent),
          discountType: 'percent',
          total: source.total,
          totalTax: 0,
          clientNote: source.notes ?? null,
          adminNote: `Converted from quote ${source.number}`,
          terms: null,
          allowedPaymentModes: [],
          isRecurring: false,
          items: {
            createMany: {
              data: source.lineItems.map((li: any, idx: number) => ({
                productId: li.productId ?? null,
                description:
                  li.description ??
                  (li as any).product?.name ??
                  (li as any).bundle?.name ??
                  'Quote line',
                qty: li.quantity,
                rate: this.toNum(li.unitPrice),
                tax1: null,
                tax2: null,
                unit: null,
                order: li.order ?? idx,
              })),
            },
          },
        },
      });

      // Stamp the back-pointer atomically so a downstream crash can't
      // leave us with a "converted" quote and no invoice id.
      await tx.quote.update({
        where: { id, organizationId: orgId },
        data: { convertedInvoiceId: invoice.id },
      });

      return { quoteId: id, invoiceId: invoice.id, invoice };
    });

    // After the transaction has committed (NOT inside the tx — events fired
    // inside a tx that later rolls back would be ghost notifications),
    // emit `invoice.created` so the existing infrastructure (SearchIndexer
    // for Cmd-K, ActivityLog, any future webhook dispatchers) reacts the
    // same way it does for a directly-created invoice. We mirror the
    // canonical signature used in InvoicesService.create:
    //   { invoice, orgId, createdBy }
    // (see apps/api/src/modules/invoices/invoices.service.ts:576).
    this.events.emit('invoice.created', {
      invoice: result.invoice,
      orgId,
      createdBy: userId,
    });

    this.events.emit('quote.converted_to_invoice', {
      orgId,
      userId,
      quoteId: result.quoteId,
      invoiceId: result.invoiceId,
    });
    return { quoteId: result.quoteId, invoiceId: result.invoiceId };
  }
}
