import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { Observable, Subscription } from 'rxjs';

import { BROKER_CONNECTED, BROKER_DISCONNECTED } from './messaging.constants';

/** Tracks whether the RMQ consumer has a live broker connection, for readiness. */
@Injectable()
export class BrokerStatus implements OnApplicationShutdown {
  private connected = false;
  private subscription?: Subscription;

  /** Follows the status stream of the Nest RMQ server. */
  track(status: Observable<unknown>): void {
    this.subscription = status.subscribe((value) => {
      if (value === BROKER_CONNECTED) this.connected = true;

      if (value === BROKER_DISCONNECTED) this.connected = false;
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  onApplicationShutdown(): void {
    this.connected = false;
    this.subscription?.unsubscribe();
  }
}
