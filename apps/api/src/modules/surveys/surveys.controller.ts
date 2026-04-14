import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SurveysService } from './surveys.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Surveys')
@Controller({ version: '1', path: 'surveys' })
@UseGuards(JwtAuthGuard)
export class SurveysController {
  constructor(private service: SurveysService) {}
}
