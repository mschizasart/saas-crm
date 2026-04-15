import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService, BackupSchedulerService, PrismaService],
  exports: [BackupsService],
})
export class BackupsModule {}
