import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Subject } from 'rxjs';

import { BrokerStatus } from '../../src/messaging/broker-status';

void test('broker status follows the RMQ server status stream', () => {
  const status = new BrokerStatus();
  const events = new Subject<string>();

  status.track(events);
  assert.equal(status.isConnected(), false, 'not ready before the first connect');
  events.next('connected');
  assert.equal(status.isConnected(), true);
  events.next('blocked'); // publishing is paused, consuming still works
  assert.equal(status.isConnected(), true);
  events.next('disconnected');
  assert.equal(status.isConnected(), false);
  status.onApplicationShutdown();
  events.next('connected');
  assert.equal(status.isConnected(), false, 'ignored after shutdown');
});
