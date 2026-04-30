import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiComposerService, DraftReplyContext } from './ai-composer.service';
import { AiImproveService } from './ai-improve.service';
import { ImproveTextDto } from './dto/improve-text.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Ai')
@Controller({ version: '1', path: 'ai' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiController {
  constructor(
    private service: AiService,
    private composer: AiComposerService,
    private improver: AiImproveService,
  ) {}

  @Post('draft-reply')
  @ApiOperation({ summary: 'Draft an AI-generated reply based on conversation context' })
  async draftReply(@Body() body: DraftReplyContext) {
    const text = await this.composer.draftReply(body);
    return { draft: text };
  }

  @Post('improve-text')
  @ApiOperation({
    summary: 'Rewrite long-form text in a chosen tone (friendly / professional / concise / persuasive / expand / shorten)',
  })
  async improveText(
    @Body() body: ImproveTextDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.improver.improve({
      userId: user.id,
      text: body.text,
      tone: body.tone,
      maxLength: body.maxLength,
    });
  }
}
