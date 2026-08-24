import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length } from 'class-validator';

export class ChangeWorkforceMembershipStatusDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ enum: ['active', 'suspended'] })
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  reason!: string;
}
