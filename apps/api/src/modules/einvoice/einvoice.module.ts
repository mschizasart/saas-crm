import { Global, Module } from '@nestjs/common';
import { EinvoiceService } from './einvoice.service';
import { EinvoiceController } from './einvoice.controller';

@Global()
@Module({
  controllers: [EinvoiceController],
  providers: [EinvoiceService],
  exports: [EinvoiceService],
})
export class EinvoiceModule {}
