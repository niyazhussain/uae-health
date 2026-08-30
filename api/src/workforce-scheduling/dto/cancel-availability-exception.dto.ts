import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsUUID } from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

export class CancelAvailabilityExceptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ enum: ['cancelled'] })
  @IsIn(['cancelled'])
  status!: 'cancelled';

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
