import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Reports')
@Controller({ version: '1', path: 'reports' })
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private service: ReportsService) {}
}
