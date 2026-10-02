import { readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMailer } from '../FileMailer';
import type { OutboundMessage } from '../IMailer';

const MESSAGE: OutboundMessage = {
  to: 'ada@example.com',
  subject: 'Verify your email',
  body: 'Open this link: https://example.com/verify?token=abc',
};

describe('FileMailer', () => {
  // A fresh, never-created directory per test — nothing here is shared with the
  // repo's own `.mail-outbox/` (see `.gitignore`), and each test's outbox is
  // unique so tests cannot see each other's files.
  let outboxDir: string;

  beforeEach(() => {
    outboxDir = join(tmpdir(), `file-mailer-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await rm(outboxDir, { recursive: true, force: true });
  });

  it('writes exactly one file, whose parsed contents carry the recipient, subject and body', async () => {
    await new FileMailer(outboxDir).send(MESSAGE);

    const files = await readdir(outboxDir);
    expect(files).toHaveLength(1);

    const written = JSON.parse(await readFile(join(outboxDir, files[0]), 'utf8'));
    expect(written).toMatchObject({
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      body: MESSAGE.body,
    });
  });

  it('creates the outbox directory if it is absent', async () => {
    // The directory is asserted absent BEFORE send() runs — the fixture never
    // creates it — so this fails if `send` ever starts assuming a directory
    // that already exists.
    await expect(readdir(outboxDir)).rejects.toMatchObject({ code: 'ENOENT' });

    await new FileMailer(outboxDir).send(MESSAGE);

    await expect(readdir(outboxDir)).resolves.toHaveLength(1);
  });

  it('gives two sends in the same millisecond two files, not one', async () => {
    // `Date.now()` is pinned so both sends fall in the SAME millisecond on
    // purpose — that collision is exactly the case a filename built from the
    // timestamp alone would lose a file to. Fault-injection for this assertion
    // removed the random suffix from the filename and watched this fail with
    // exactly one file before restoring it.
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const mailer = new FileMailer(outboxDir);
      await mailer.send(MESSAGE);
      await mailer.send(MESSAGE);
    } finally {
      now.mockRestore();
    }

    const files = await readdir(outboxDir);
    expect(files).toHaveLength(2);
    expect(new Set(files).size).toBe(2);
  });

  it('logs, at info level, the path it wrote and the address it wrote it for', async () => {
    const mailer = new FileMailer(outboxDir);
    // `logger` is an instance field (a plain `Logger`, not a decorated
    // provider), so the spy has to target this instance rather than the class.
    const logSpy = jest.spyOn(
      (mailer as unknown as { logger: { log: (message: string) => void } }).logger,
      'log',
    );

    await mailer.send(MESSAGE);

    const files = await readdir(outboxDir);
    const writtenPath = join(outboxDir, files[0]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(writtenPath));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(MESSAGE.to));
  });
});
