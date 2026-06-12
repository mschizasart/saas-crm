import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ActivityCaptureService } from './activity-capture.service';
import { BackfillQueryDto } from './activity-capture.dto';

/**
 * Admin-triggered sweep over the last N days of OutboundMessage /
 * InboxMessage / SmsMessage rows (Wave H2). Used after enabling
 * capture on an existing org so the timeline isn't empty.
 *
 * Hard-capped at 10 000 rows per source-type inside the service —
 * larger backfills should be a paged BullMQ job.
 */
@ApiTags('Activity Capture')
@Controller({ version: '1', path: 'activity-capture' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ActivityCaptureBackfillController {
  constructor(private service: ActivityCaptureService) {}

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Run a one-shot backfill over the last N days' })
  backfill(@CurrentOrg() org: any, @Query() query: BackfillQueryDto) {
    return this.service.backfill(org.id, query.sinceDays ?? 30);
  }
}
