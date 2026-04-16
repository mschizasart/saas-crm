import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiComposerService, DraftReplyContext } from './ai-composer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Ai')
@Controller({ version: '1', path: 'ai' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiController {
  constructor(
    private service: AiService,
    private composer: AiComposerService,
  ) {}

  @Post('draft-reply')
  @ApiOperation({ summary: 'Draft an AI-generated reply based on conversation context' })
  async draftReply(@Body() body: DraftReplyContext) {
    const text = await this.composer.draftReply(body);
    return { draft: text };
  }
}
