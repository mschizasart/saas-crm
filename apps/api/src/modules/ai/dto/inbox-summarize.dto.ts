import { IsString, IsUUID } from 'class-validator';

export class InboxSummarizeDto {
  @IsString()
  @IsUUID()
  messageId!: string;
}
