import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreatePatientAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  slotId!: string;
}
