import { decodeStoredAppointmentCommandView } from './patient-appointment-command-response.js';

const legacySnapshot = {
  appointmentId: '11111111-1111-4111-8111-111111111111',
  status: 'requested',
  startsAt: '2026-09-15T08:00:00.000Z',
  endsAt: '2026-09-15T08:30:00.000Z',
  version: 1,
  canCancel: true,
  canReschedule: true,
} as const;

const providerAwareSnapshot = {
  ...legacySnapshot,
  slotId: '22222222-2222-4222-8222-222222222222',
  service: {
    appointmentServiceId: '33333333-3333-4333-8333-333333333333',
    patientFacingName: 'Synthetic family consultation',
    durationMinutes: 30,
    allowsAnyPractitioner: true,
    specialty: {
      specialtyId: '44444444-4444-4444-8444-444444444444',
      name: 'Synthetic family medicine',
    },
    facility: {
      facilityId: '55555555-5555-4555-8555-555555555555',
      name: 'Synthetic booking clinic',
      timezone: 'Asia/Dubai',
    },
  },
  practitionerOption: {
    practitionerOptionId: '66666666-6666-4666-8666-666666666666',
    displayName: 'Dr Synthetic Booking',
    professionalTitle: 'Synthetic physician',
  },
} as const;

describe('patient appointment command response decoder', () => {
  it('preserves an exact legacy command result through the public allowlist', () => {
    expect(
      decodeStoredAppointmentCommandView({
        ...legacySnapshot,
        privateProviderLogin: 'must-not-replay',
      }),
    ).toEqual(legacySnapshot);
  });

  it('replays the complete provider-aware booking summary without private extras', () => {
    expect(
      decodeStoredAppointmentCommandView({
        ...providerAwareSnapshot,
        practitionerId: 'must-not-replay',
        service: {
          ...providerAwareSnapshot.service,
          internalCode: 'PRIVATE-SERVICE-CODE',
        },
        practitionerOption: {
          ...providerAwareSnapshot.practitionerOption,
          email: 'private-doctor@example.invalid',
        },
      }),
    ).toEqual(providerAwareSnapshot);
  });

  it.each([
    { ...providerAwareSnapshot, slotId: undefined },
    { ...providerAwareSnapshot, service: undefined },
    { ...providerAwareSnapshot, practitionerOption: undefined },
    {
      ...providerAwareSnapshot,
      service: { ...providerAwareSnapshot.service, durationMinutes: 0 },
    },
  ])('fails closed for a partial or invalid provider bundle', (snapshot) => {
    expect(decodeStoredAppointmentCommandView(snapshot)).toBeNull();
  });
});
