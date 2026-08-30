import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class AvailabilityExceptionListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  facilityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  practitionerFacilityAssignmentId?: string;

  @ApiPropertyOptional({
    enum: ['facility_closed', 'practitioner_unavailable'],
  })
  @IsOptional()
  @IsIn(['facility_closed', 'practitioner_unavailable'])
  kind?: 'facility_closed' | 'practitioner_unavailable';

  @ApiPropertyOptional({ enum: ['active', 'cancelled'] })
  @IsOptional()
  @IsIn(['active', 'cancelled'])
  status?: 'active' | 'cancelled';

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startsBefore?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAfter?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 25;
}
