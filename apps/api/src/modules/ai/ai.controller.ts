import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Ai')
@Controller({ version: '1', path: 'ai' })
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private service: AiService) {}
}
