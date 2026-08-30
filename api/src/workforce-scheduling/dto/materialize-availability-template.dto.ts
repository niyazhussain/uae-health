import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsUUID } from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

export class MaterializeAvailabilityTemplateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
