import { DynamicModule, Global, Module } from '@nestjs/common';

import { CONFIG, type Config } from './config';

/** Provides the validated config, loaded once before the app is created. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    const provider = { provide: CONFIG, useValue: config };

    return { module: ConfigModule, providers: [provider], exports: [CONFIG] };
  }
}
