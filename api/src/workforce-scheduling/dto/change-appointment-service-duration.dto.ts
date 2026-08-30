import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsUUID, Max, Min } from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

export class ChangeAppointmentServiceDurationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ minimum: 1, maximum: 1440 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
