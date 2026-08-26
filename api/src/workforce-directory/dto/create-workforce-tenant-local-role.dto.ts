import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateWorkforceTenantLocalRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiProperty({ minLength: 3, maxLength: 1_000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 1_000)
  description!: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds!: string[];

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  reason!: string;
}
