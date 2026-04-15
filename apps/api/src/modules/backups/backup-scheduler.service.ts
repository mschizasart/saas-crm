import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BackupsService } from './backups.service';

@Injectable()
export class BackupSchedulerService {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(private backups: BackupsService) {}

  // Every night at 3:00 AM server time
  @Cron('0 3 * * *')
  async handleNightlyBackup() {
    this.logger.log('Running nightly scheduled backup');
    try {
      await this.backups.scheduledBackup();
    } catch (err: any) {
      this.logger.error(`Nightly backup failed: ${err.message}`);
    }
  }
}
