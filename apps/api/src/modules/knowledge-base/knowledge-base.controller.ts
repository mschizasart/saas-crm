import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('KnowledgeBase')
@Controller({ version: '1', path: 'knowledge-base' })
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(private service: KnowledgeBaseService) {}
}
