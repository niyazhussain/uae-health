import { HEADERS_METADATA } from '@nestjs/common/constants';
import { PatientAppointmentsController } from './patient-appointments.controller.js';

describe('PatientAppointmentsController command contract', () => {
  it.each([
    'createAppointment',
    'cancelAppointment',
    'rescheduleAppointment',
  ] as const)('marks successful %s responses as non-cacheable', (method) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      PatientAppointmentsController.prototype,
      method,
    );
    if (typeof descriptor?.value !== 'function') {
      throw new Error(`Expected the ${method} route handler.`);
    }
    const handler = descriptor.value as object;
    const metadata = Reflect.getMetadata(HEADERS_METADATA, handler) as unknown;

    expect(metadata).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );
  });
});
