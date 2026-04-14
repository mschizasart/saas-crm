import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GoalsService } from './goals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Goals')
@Controller({ version: '1', path: 'goals' })
@UseGuards(JwtAuthGuard)
export class GoalsController {
  constructor(private service: GoalsService) {}
}
