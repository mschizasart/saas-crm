import { Global, Module } from '@nestjs/common';
import { EinvoiceService } from './einvoice.service';

@Global()
@Module({
  providers: [EinvoiceService],
  exports: [EinvoiceService],
})
export class EinvoiceModule {}
