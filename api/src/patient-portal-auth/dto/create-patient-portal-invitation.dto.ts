import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';
import { PATIENT_PORTAL_INVITATION_REASON_CODES } from '../patient-portal-invitation-reasons.js';

export class CreatePatientPortalInvitationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({
    enum: PATIENT_PORTAL_INVITATION_REASON_CODES,
    description: 'Safe, non-clinical reason code for the invitation.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsIn(PATIENT_PORTAL_INVITATION_REASON_CODES)
  reason!: string;
}
