import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SelectPatientPortalAppointmentContextDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A patient-owned pending appointment relationship for one bookable practice.',
  })
  @IsUUID()
  appointmentRelationshipId!: string;
}
