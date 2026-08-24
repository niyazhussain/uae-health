import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class WorkforceDirectoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Organization to inspect. Defaults to the first manageable organization.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
