import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  DRAFT_INTENTS,
  DRAFT_TONES,
  DraftIntent,
  DraftTone,
} from '../inbox-ai.service';

export class InboxDraftReplyDto {
  @IsString()
  @IsUUID()
  messageId!: string;

  @IsOptional()
  @IsIn(DRAFT_INTENTS)
  intent?: DraftIntent;

  @IsOptional()
  @IsIn(DRAFT_TONES)
  tone?: DraftTone;
}
