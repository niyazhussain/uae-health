import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class PatientAppointmentPageQueryDto {
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

export class PatientAppointmentPractitionerOptionsQueryDto extends PatientAppointmentPageQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  appointmentServiceId!: string;
}

export class PatientAppointmentAvailabilityQueryDto extends PatientAppointmentPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  appointmentServiceId?: string;

  @ApiPropertyOptional({ enum: ['named', 'any'] })
  @IsOptional()
  @IsIn(['named', 'any'])
  selectionMode?: 'named' | 'any';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  practitionerOptionId?: string;
}
