import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IMailer, OutboundMessage } from './IMailer';

/**
 * {@link IMailer} that writes every message to disk instead of sending it.
 *
 * ADR-0008's first instance: the template binds no mail provider account and
 * carries no key, so this is what a generated project ships until somebody
 * writes a real adapter against {@link IMailer}. A verification or reset link
 * is real and functional here — it can be opened from the file it lands in —
 * it just is not delivered anywhere. See the ADR's "Negative" consequences for
 * what that costs and who has to know about it.
 *
 * One file per message rather than one growing log: a growing file a second
 * writer appends to needs its own concurrency handling (a lock, an append
 * offset), and a directory of small immutable files needs none — two
 * concurrent `send()` calls each own their own file and never contend.
 *
 * JSON rather than `.eml` or another mail-shaped format: the only reader that
 * matters today is a test (this suite, and the docker end-to-end suite), and a JSON file is
 * one `JSON.parse` away from an object a test can assert on. A format closer to
 * a real mail message would need a parser this project does not otherwise need.
 */
export class FileMailer implements IMailer {
  private readonly logger = new Logger(FileMailer.name);

  /**
   * @param outboxDir - the directory each message is written into, created if
   *   it does not already exist. Not `@Injectable()`-decorated for the same
   *   reason `Argon2PasswordHasher` is not: its one constructor parameter is a
   *   plain value with nothing for Nest to resolve on its own, and
   *   `mail.module.ts` provides it through an explicit factory instead — which
   *   is also where `MAIL_OUTBOX_DIR` is read.
   */
  public constructor(private readonly outboxDir: string) {}

  public async send(message: OutboundMessage): Promise<void> {
    await mkdir(this.outboxDir, { recursive: true });

    // `Date.now()` alone is not unique — two sends in the same process can and
    // do land in the same millisecond — so the name also carries a random
    // suffix. The suffix is what actually guarantees two files; the timestamp
    // is there so a developer scanning the directory can find the newest one
    // without opening anything.
    const filename = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
    const path = join(this.outboxDir, filename);

    await writeFile(
      path,
      JSON.stringify(
        {
          to: message.to,
          subject: message.subject,
          body: message.body,
          writtenAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    // Info, not debug: a developer whose verification link goes nowhere has to
    // find out from the console, because there is no inbox to check instead.
    this.logger.log(`Wrote message for ${message.to} to ${path}`);
  }
}
