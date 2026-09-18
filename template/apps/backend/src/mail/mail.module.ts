import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FileMailer } from './FileMailer';
import { MAILER } from './IMailer';

/**
 * Binds {@link MAILER} to {@link FileMailer}.
 *
 * `ConfigModule` is imported here even though `AppModule` already registers it
 * globally (`isGlobal: true`): a module that only works because of a global
 * some other module happened to register cannot be unit-tested or reused on
 * its own. Nest de-duplicates the module either way, so this costs nothing in
 * the running application.
 *
 * Swapping the dev adapter for a real provider — the whole point of ADR-0008 —
 * is changing the `useFactory` below to construct that provider's adapter
 * instead. No consumer of `MAILER` changes, because none of them import
 * `FileMailer` directly.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new FileMailer(config.get<string>('MAIL_OUTBOX_DIR', './.mail-outbox')),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
