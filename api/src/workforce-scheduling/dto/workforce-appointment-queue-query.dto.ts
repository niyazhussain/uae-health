import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const appointmentStatuses = [
  'requested',
  'confirmed',
  'declined',
  'cancelled',
] as const;

export class WorkforceAppointmentQueueQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  facilityId!: string;

  @ApiPropertyOptional({ enum: appointmentStatuses })
  @IsOptional()
  @IsIn(appointmentStatuses)
  status?: (typeof appointmentStatuses)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  practitionerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  appointmentServiceId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
