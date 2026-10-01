import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { hashOpaqueToken } from '../../common/crypto';
import { MfaRecoveryCodeRecord } from '../entities/mfa-recovery-code-record.entity';

/** How many codes a batch holds. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Bytes of entropy per code: 128 bits.
 *
 * **Deliberately not `generateOpaqueToken`.** That helper draws 32 bytes and
 * takes no length, and its output is a much longer string than this one. A
 * recovery code is the one credential this system expects a person to copy by
 * hand from paper, on the worst day they have had with their phone, ten to a
 * sheet. 128 bits is already far past anything an attacker can search, so the
 * second 128 bits buys nothing and costs legibility. Do not tidy this back to
 * the helper.
 */
const CODE_BYTES = 16;

/**
 * Crockford's base32 alphabet: the digits and the letters, less `I`, `L`, `O`
 * and `U`.
 *
 * The first three are dropped because a person reads them as `1`, `1` and `0`,
 * and the last so that a code cannot spell a word by accident. Every symbol
 * left stands for exactly one value, which is what lets {@link normalise} fold
 * the dropped letters onto the symbols they are mistaken for without any code
 * becoming ambiguous.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters per group in the form a person keeps. Presentation only: see {@link RecoveryCodes.consume}. */
const GROUP_SIZE = 4;

/**
 * The one form a code takes before it is hashed: no whitespace, upper case, and
 * the letters a person mistakes for digits written as those digits.
 *
 * **Both {@link RecoveryCodes.generate} and {@link RecoveryCodes.consume} take
 * their digest from this function's output**, so a code is stored as the digest
 * of what a person's typing normalises to, whatever way it was typed. The two
 * cannot disagree about what a code is, because neither has an opinion of its
 * own. A fold written only in `consume` would work until somebody changed what
 * `generate` stores.
 *
 * `I` and `L` read as `1` and `O` as `0`, which is Crockford's own rule for
 * decoding. `U` is folded onto nothing: it is outside the alphabet and no digit
 * is mistaken for it, so a code containing one matches no stored code.
 */
function normalise(typed: string): string {
  return typed
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Crockford base32, unpadded, of `bytes`, in the alphabet above. */
function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  // The bits that did not fill a symbol are padded on the right with zeros, so
  // no input bit is dropped.
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * Recovery codes: the way back in when the device holding a second factor is
 * gone.
 *
 * ## Digests, not argon2
 *
 * A code is stored through {@link hashOpaqueToken} — the same plain SHA-256
 * `refresh_tokens`, `email_verification_tokens` and `password_reset_tokens`
 * use. A password derivation defends a secret a person chose, where the search
 * space is small enough to walk. A recovery code is drawn from a CSPRNG at full
 * entropy (see `CODE_BYTES`), so a work factor buys nothing, and it
 * would cost three things: a salted derivation cannot be looked up, so
 * verifying would mean argon2-checking every unconsumed code the user holds;
 * ten of those per attempt is a self-inflicted denial of service on a route
 * reachable before a session exists; and `uq_mfa_recovery_codes_code_hash`
 * could never fire, because no two salted digests of one code ever match.
 *
 * ## Single use is one statement
 *
 * {@link RecoveryCodes.consume} is a single
 * `UPDATE ... WHERE code_hash = $1 AND user_id = $2 AND consumed_at IS NULL`
 * whose affected-row count decides the outcome. There is no read before it, so
 * there is no window between "is it unused" and "mark it used" for a second
 * presentation to slip through, and no lock to take: the database decides which
 * of two simultaneous statements matches the row first, and the other matches
 * nothing. The one read that follows a miss only says *why* it missed.
 */
@Injectable()
export class RecoveryCodes {
  public constructor(
    @InjectRepository(MfaRecoveryCodeRecord)
    private readonly codes: Repository<MfaRecoveryCodeRecord>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Issues a fresh batch of {@link RECOVERY_CODE_COUNT} codes and retires every
   * code the account held before.
   *
   * The retirement and the insertion are one transaction, so a crash between
   * the delete and the inserts rolls back to the old batch rather than leaving
   * the account with no codes at all. **That is the whole of the guarantee.** It
   * does not stop two overlapping calls for one account: under READ COMMITTED
   * each can delete, and each can insert, leaving twenty live codes. **Every
   * caller holds a write lock on the account's `users` row across this call**,
   * so the calls for one account take turns. Nothing here enforces that — a
   * caller that dropped the lock would buy the twenty-live-codes case back and
   * report success — so anything reaching this method owes that lock, or a
   * partial unique constraint in its place.
   *
   * Retired rows are deleted rather than marked consumed, so a code from a
   * superseded batch reads as *never issued* — {@link RecoveryCodes.consume}
   * throws `MfaVerificationFailedError` for it, not
   * `RecoveryCodeAlreadyConsumedError`. That is intended. A superseded code is
   * not evidence of anything: its holder was told to discard it. A code from the
   * live batch presented twice is evidence, of a copied or photographed sheet,
   * and only that case is worth the distinct error.
   *
   * ## Joining a caller's transaction
   *
   * With a `manager`, the delete and the inserts run on it and this method opens
   * no transaction of its own: the batch commits or rolls back with whatever the
   * caller is doing. Confirming an account's *first* second factor needs exactly
   * that, whichever kind of factor it is — a method confirmed with no codes
   * issued is an account with a second factor and no way back in, so the
   * confirmation and the batch must be one unit. Without a `manager`, this
   * behaves as it always did.
   *
   * @param userId - whose codes these are
   * @param manager - a transaction to join, or omitted to use a transaction of
   *   this method's own
   * @returns the plaintext codes, grouped for legibility. This is the only
   *   time they exist in the clear; the table holds digests
   */
  public async generate(userId: UserId, manager?: EntityManager): Promise<readonly string[]> {
    const now = new Date();
    const issued = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const token = encodeBase32(randomBytes(CODE_BYTES));
      return { token, hash: hashOpaqueToken(normalise(token)) };
    });

    const write = async (through: EntityManager): Promise<void> => {
      await through.delete(MfaRecoveryCodeRecord, { userId });
      for (const { hash } of issued) {
        await through.insert(MfaRecoveryCodeRecord, {
          userId,
          codeHash: hash,
          consumedAt: null,
          createdAt: now,
        });
      }
    };
    if (manager === undefined) await this.dataSource.transaction(write);
    else await write(manager);

    return issued.map(({ token }) => RecoveryCodes.group(token));
  }

  /**
   * Spends a code belonging to `userId`, or says why it could not.
   *
   * The code is put through {@link normalise} before the digest is taken: the
   * grouping {@link RecoveryCodes.generate} applied for the person's benefit is
   * undone, case is ignored, and the letters a person reads as digits are
   * read as digits. That is the whole of the normalisation, and it is not a
   * decision about what kind of proof this is — which field a value arrived in
   * decides that, upstream of here.
   *
   * **This tells two refusals apart, and its caller must not.** A code that
   * never existed and a code that was already spent are different facts: the
   * second is what a photographed or stolen backup sheet looks like, and the
   * audit trail wants it. The route collapses both onto its one `401`, exactly
   * as it does for the challenge errors.
   *
   * The spend is the single `UPDATE` described on the class. Only when it
   * matched nothing is the row read, to say which refusal applied; that read is
   * scoped by `userId` as the update is, so another account's spent code is
   * indistinguishable from one nobody was issued. It is a diagnosis after the
   * fact and never a check before it: the outcome was decided by the `UPDATE`.
   *
   * @param userId - whose code it must be; a code issued to anybody else does not match
   * @param code - the code as the person typed it
   * @throws RecoveryCodeAlreadyConsumedError when the code is this account's and
   *   has been spent — before this call, or by a concurrent one that won it
   * @throws MfaVerificationFailedError when no such code was issued to this account
   */
  public async consume(userId: UserId, code: string): Promise<void> {
    const codeHash = hashOpaqueToken(normalise(code));
    const result = await this.codes.update(
      { codeHash, userId, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (result.affected === 1) return;

    const spent = await this.codes.findOne({ where: { codeHash, userId } });
    if (spent !== null) throw new RecoveryCodeAlreadyConsumedError();
    throw new MfaVerificationFailedError();
  }

  /**
   * How many of `userId`'s codes have not been spent.
   *
   * A count of the rows `consumedAt IS NULL` — the same predicate
   * {@link RecoveryCodes.consume} spends against, so a code is counted exactly
   * when it could still be used. An account that holds no codes at all answers
   * `0`, not `null`: "none left" is the number a person most needs to be told,
   * and a caller that cannot tell it from an absent value will not show it.
   *
   * Read-only, and not a check before anything: nothing may decide whether to
   * spend a code on this, because the answer can be stale by the time it is used.
   *
   * @param userId - whose codes to count
   */
  public async remaining(userId: UserId): Promise<number> {
    return this.codes.count({ where: { userId, consumedAt: IsNull() } });
  }

  /** `ABCDEFGH` → `ABCD EFGH`. */
  private static group(token: string): string {
    return token.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g'))!.join(' ');
  }
}
