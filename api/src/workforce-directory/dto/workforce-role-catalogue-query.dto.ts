import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { WorkforceRoleCatalogueSource } from '../workforce-directory.types.js';

export class WorkforceRoleCatalogueQueryDto {
  @ApiPropertyOptional({
    description:
      'Practice to inspect. Defaults to the first practice where the caller can manage roles.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'One-indexed result page. Defaults to 1.',
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: 'Bounded number of role summaries per page. Defaults to 25.',
    default: 25,
    minimum: 10,
    maximum: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(50)
  pageSize = 25;

  @ApiPropertyOptional({
    enum: ['all', 'global', 'tenant-local'],
    default: 'all',
    description: 'Limit the catalogue to system templates or practice roles.',
  })
  @IsIn(['all', 'global', 'tenant-local'])
  source: WorkforceRoleCatalogueSource = 'all';

  @ApiPropertyOptional({
    description: 'Optional role or permission search text.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}
