import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class WorkforceRoleCatalogueQueryDto {
  @ApiPropertyOptional({
    description:
      'Practice to inspect. Defaults to the first practice where the caller can manage roles.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
