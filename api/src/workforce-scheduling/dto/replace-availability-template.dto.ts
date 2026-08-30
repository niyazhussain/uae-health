import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601 } from 'class-validator';
import { CreateAvailabilityTemplateDto } from './create-availability-template.dto.js';

export class ReplaceAvailabilityTemplateDto extends CreateAvailabilityTemplateDto {
  @ApiProperty({ enum: ['active', 'inactive'] })
  @IsIn(['active', 'inactive'])
  declare status: 'active' | 'inactive';

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
