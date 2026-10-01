import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import type { AuditService } from '../../audit/audit.service';
import { hashOpaqueToken } from '../../common/crypto';
import { auditThrottleBlock } from '../throttling.module';

/**
 * The entry a block earns: what it says, and what it must not say.
 */
describe('auditThrottleBlock', () => {
  const KEY = 'a'.repeat(64);

  const recorded = async (retryAfterSeconds: number) => {
    const entries: RecordAuditEntryInput[] = [];
    const audit = {
      record: (input: RecordAuditEntryInput) => {
        entries.push(input);
        return Promise.resolve();
      },
    } as unknown as AuditService;
    await auditThrottleBlock(audit)(KEY, retryAfterSeconds);
    return entries;
  };

  it('writes one THROTTLE_ENGAGED entry carrying the retry window', async () => {
    const entries = await recorded(120);

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe(AuditAction.THROTTLE_ENGAGED);
    expect(entries[0].metadata).toEqual({ retryAfterSeconds: 120 });
    // Nobody is established: the subject of a refused attempt is whoever held
    // the key, and naming an account here would be a guess.
    expect(entries[0].actorId).toBeNull();
  });

  it('records a digest of the subject and never the value it was given', async () => {
    const [entry] = await recorded(120);

    expect(entry.resourceId).toBe(hashOpaqueToken(KEY));
    expect(JSON.stringify(entry)).not.toContain(KEY);
  });
});
