import { Module } from '@nestjs/common';
import { SignaturesService } from './signatures.service';
import {
  PublicSignaturesController,
  TrackViewController,
  AdminSignaturesController,
} from './signatures.controller';
import { StorageModule } from '../storage/storage.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [StorageModule, PdfModule],
  controllers: [
    PublicSignaturesController,
    TrackViewController,
    AdminSignaturesController,
  ],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
