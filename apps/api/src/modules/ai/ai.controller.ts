import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiComposerService, DraftReplyContext } from './ai-composer.service';
import { AiImproveService } from './ai-improve.service';
import { InboxAiService } from './inbox-ai.service';
import { ImproveTextDto } from './dto/improve-text.dto';
import { InboxSummarizeDto } from './dto/inbox-summarize.dto';
import { InboxDraftReplyDto } from './dto/inbox-draft-reply.dto';
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
    private inboxAi: InboxAiService,
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
    @CurrentUser() user: { id: string; organizationId: string },
  ) {
    return this.improver.improve({
      userId: user.id,
      orgId: user.organizationId,
      text: body.text,
      tone: body.tone,
      maxLength: body.maxLength,
    });
  }

  @Post('inbox/summarize')
  @ApiOperation({
    summary: 'Summarize an inbox message thread into 3-5 bullet points',
  })
  async inboxSummarize(
    @Body() body: InboxSummarizeDto,
    @CurrentUser()
    user: { id: string; organizationId: string },
  ) {
    return this.inboxAi.summarizeThread({
      userId: user.id,
      orgId: user.organizationId,
      messageId: body.messageId,
    });
  }

  @Post('inbox/draft-reply')
  @ApiOperation({
    summary:
      'Draft a reply to an inbox message in a chosen intent and tone (returns body text only)',
  })
  async inboxDraftReply(
    @Body() body: InboxDraftReplyDto,
    @CurrentUser()
    user: {
      id: string;
      organizationId: string;
      firstName?: string;
      lastName?: string;
    },
  ) {
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;
    return this.inboxAi.draftReply({
      userId: user.id,
      orgId: user.organizationId,
      userDisplayName: displayName,
      messageId: body.messageId,
      intent: body.intent,
      tone: body.tone,
    });
  }
}
