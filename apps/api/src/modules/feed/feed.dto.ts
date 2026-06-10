import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Polymorphic entity types this feed can attach to. Kept in sync with
// the CHECK constraint in `038-feed.sql` and the cross-tenant guard
// switch inside `FeedService.create()`.
export const FEED_ENTITY_TYPES = [
  'client',
  'lead',
  'opportunity',
  'ticket',
] as const;

export type FeedEntityType = (typeof FEED_ENTITY_TYPES)[number];

export class CreatePostDto {
  @IsIn(FEED_ENTITY_TYPES as unknown as string[])
  entityType!: FeedEntityType;

  @IsUUID()
  entityId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  // Threaded replies. The service refuses a parent that points at a
  // different entity, so a reply can't jump threads.
  @IsOptional()
  @IsUUID()
  parentPostId?: string;

  // Users to notify. Validated server-side — every id must belong to
  // the caller's org or the request 400s.
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  mentionedUserIds?: string[];
}

export class UpdatePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class ListPostsQueryDto {
  @IsIn(FEED_ENTITY_TYPES as unknown as string[])
  entityType!: FeedEntityType;

  @IsUUID()
  entityId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MyMentionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
