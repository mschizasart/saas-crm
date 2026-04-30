import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IMPROVE_TONES, ImproveTone } from '../ai-improve.service';

export class ImproveTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(12_000)
  text!: string;

  @IsIn(IMPROVE_TONES)
  tone!: ImproveTone;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5_000)
  maxLength?: number;
}
