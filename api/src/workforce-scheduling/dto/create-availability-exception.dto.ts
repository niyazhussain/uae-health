import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { workforceSchedulingReasonCodes } from '../workforce-scheduling-reasons.js';
import type { WorkforceSchedulingReasonCode } from '../workforce-scheduling-reasons.js';

const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/;

export class CreateAvailabilityExceptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  facilityId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  practitionerFacilityAssignmentId?: string;

  @ApiProperty({
    enum: ['facility_closed', 'practitioner_unavailable'],
  })
  @IsIn(['facility_closed', 'practitioner_unavailable'])
  kind!: 'facility_closed' | 'practitioner_unavailable';

  @ApiProperty()
  @IsBoolean()
  isAllDay!: boolean;

  @ApiProperty({ example: '2026-09-12T09:00:00' })
  @Matches(localDateTimePattern)
  localStartsAt!: string;

  @ApiProperty({ example: '2026-09-12T17:00:00' })
  @Matches(localDateTimePattern)
  localEndsAt!: string;

  @ApiProperty({ enum: workforceSchedulingReasonCodes })
  @IsIn(workforceSchedulingReasonCodes)
  reasonCode!: WorkforceSchedulingReasonCode;
}
