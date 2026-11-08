import { Global, Module } from '@nestjs/common';

import { BrokerStatus } from './broker-status';

@Global()
@Module({
  providers: [BrokerStatus],
  exports: [BrokerStatus],
})
export class MessagingModule {}
