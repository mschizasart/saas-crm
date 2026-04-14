import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProposalsService } from './proposals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Proposals')
@Controller({ version: '1', path: 'proposals' })
@UseGuards(JwtAuthGuard)
export class ProposalsController {
  constructor(private service: ProposalsService) {}
}
