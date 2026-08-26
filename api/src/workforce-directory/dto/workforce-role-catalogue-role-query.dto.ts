import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class WorkforceRoleCatalogueRoleQueryDto {
  @ApiPropertyOptional({
    description:
      'Practice that scopes the authorized role-detail lookup. Defaults to the first manageable practice.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
