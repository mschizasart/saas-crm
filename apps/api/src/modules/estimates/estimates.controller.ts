import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstimatesService } from './estimates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Estimates')
@Controller({ version: '1', path: 'estimates' })
@UseGuards(JwtAuthGuard)
export class EstimatesController {
  constructor(private service: EstimatesService) {}
}
