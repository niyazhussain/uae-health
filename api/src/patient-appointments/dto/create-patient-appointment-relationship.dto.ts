import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreatePatientAppointmentRelationshipDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bookablePracticeId!: string;
}
