import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CronService } from './cron.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Cron')
@Controller({ version: '1', path: 'cron' })
@UseGuards(JwtAuthGuard)
export class CronController {
  constructor(private service: CronService) {}
}
