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

export class WorkforceAvailabilitySlotListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  facilityId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  appointmentServiceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  practitionerId?: string;

  @ApiPropertyOptional({ enum: ['available', 'withdrawn'] })
  @IsOptional()
  @IsIn(['available', 'withdrawn'])
  status?: 'available' | 'withdrawn';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}
