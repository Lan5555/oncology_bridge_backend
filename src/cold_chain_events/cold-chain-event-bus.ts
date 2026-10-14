import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface ColdChainStreamEvent {
  id: string;
  type: 'reading' | 'breach' | 'resolved' | 'unit-status';
  unitId: string;
  facilityId: string;
  data: Record<string, unknown>;
}

@Injectable()
export class ColdChainEventBus {
  readonly events = new Subject<ColdChainStreamEvent>();
  publish(event: ColdChainStreamEvent) {
    this.events.next(event);
  }
}
