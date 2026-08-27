import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsUUID, ValidateIf } from 'class-validator';

export class SelectPatientPortalContextDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'An explicitly linked portal profile, or null to return to restricted onboarding.',
  })
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  portalProfileId!: string | null;
}
