import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const normalizeCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateWorkforceAppointmentServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  facilityId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  specialtyId!: string;

  @ApiProperty({ minLength: 2, maxLength: 64 })
  @Transform(normalizeCode)
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,63}$/)
  code!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  patientFacingName!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @ApiProperty()
  @IsBoolean()
  allowsAnyPractitioner!: boolean;

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
