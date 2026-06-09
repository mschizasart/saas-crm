import { Module } from '@nestjs/common';
import { ProductBundlesController } from './product-bundles.controller';
import { ProductBundlesService } from './product-bundles.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

/**
 * CPQ — Configure, Price, Quote (Wave F2 — migration 034).
 *
 * - ProductBundlesService: admin-curated kits of products that drop onto
 *   a quote as a single line. Bundle pricing rolls up sums of its items'
 *   (qty * unitPrice * (1 - discount/100)) — computed at quote-build time
 *   so subsequent product price edits are reflected on NEW quotes only.
 * - QuotesService: CRUD + status lifecycle
 *   (draft → sent → accepted | rejected). `convertToInvoice` produces an
 *   Invoice row directly (no InvoicesService injection — see service
 *   docblock for why) and is idempotent via `Quote.convertedInvoiceId`.
 *
 * PrismaService comes from the global DatabaseModule — no explicit import
 * needed (same pattern as OpportunitiesModule / DunningModule).
 */
@Module({
  controllers: [ProductBundlesController, QuotesController],
  providers: [ProductBundlesService, QuotesService],
  exports: [ProductBundlesService, QuotesService],
})
export class CpqModule {}
