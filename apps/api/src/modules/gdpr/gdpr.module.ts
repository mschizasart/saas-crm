import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { GdprService } from './gdpr.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [GdprController],
  providers: [GdprService, PrismaService],
  exports: [GdprService],
})
export class GdprModule {}
