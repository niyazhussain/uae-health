import { HEADERS_METADATA } from '@nestjs/common/constants';
import { PatientAppointmentsController } from './patient-appointments.controller.js';

describe('PatientAppointmentsController booking contract', () => {
  it('marks successful booking responses as non-cacheable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      PatientAppointmentsController.prototype,
      'createAppointment',
    );
    if (typeof descriptor?.value !== 'function') {
      throw new Error('Expected the booking route handler.');
    }
    const handler = descriptor.value as object;
    const metadata = Reflect.getMetadata(HEADERS_METADATA, handler) as unknown;

    expect(metadata).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );
  });
});
