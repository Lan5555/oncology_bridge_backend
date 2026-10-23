import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const SHIPMENT_TEMPERATURE_PROVIDER = Symbol(
  'SHIPMENT_TEMPERATURE_PROVIDER',
);
export interface ShipmentReading {
  eventId: string;
  deviceId: string;
  celsius: number;
  recordedAt: string;
}
export interface ShipmentProvider {
  configured(): boolean;
  // The adapter must authenticate the provider, bind its device identity, enforce
  // timeouts and normalize units to Celsius. Raw provider bodies never reach clients.
  readings(context: {
    provider: string;
    deviceId: string;
    since: string;
  }): Promise<ShipmentReading[]>;
}

@Injectable()
export class PendingShipmentProvider implements ShipmentProvider {
  configured() {
    return false;
  }
  readings(): Promise<ShipmentReading[]> {
    return Promise.reject(
      new ServiceUnavailableException(
        'Shipment temperature provider integration is pending.',
      ),
    );
  }
}
