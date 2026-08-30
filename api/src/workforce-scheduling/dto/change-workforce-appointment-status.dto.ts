import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import {
  workforceAppointmentDecisionReasonCodes,
  type WorkforceAppointmentDecisionReasonCode,
} from '../workforce-appointment-decision-reasons.js';

export class ChangeWorkforceAppointmentStatusDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  facilityId!: string;

  @ApiProperty({ enum: ['confirmed', 'declined'] })
  @IsIn(['confirmed', 'declined'])
  status!: 'confirmed' | 'declined';

  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ enum: workforceAppointmentDecisionReasonCodes })
  @IsIn(workforceAppointmentDecisionReasonCodes)
  reasonCode!: WorkforceAppointmentDecisionReasonCode;
}
