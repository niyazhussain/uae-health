import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAvailabilityTemplateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  practitionerServiceAssignmentId!: string;

  @ApiProperty({ minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  isoWeekday!: number;

  @ApiProperty({ minimum: 0, maximum: 1439 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1439)
  localStartMinute!: number;

  @ApiProperty({ minimum: 1, maximum: 1440 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  localEndMinute!: number;

  @ApiProperty({ example: '2026-08-30' })
  @Matches(localDatePattern)
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(localDatePattern)
  effectiveUntil?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'], default: 'inactive' })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
