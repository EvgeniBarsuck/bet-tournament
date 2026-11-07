import { DynamicModule, Global, Module } from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import { Database } from './database';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: CONFIG, useValue: config }, Database],
      exports: [CONFIG, Database],
    };
  }
}
