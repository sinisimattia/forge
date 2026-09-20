import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { ConsumedTokenError, ExpiredTokenError, SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import { InvalidCredentialsError } from '__FORGE_SCOPE__/core/auth/errors';
import {
  DOMAIN_ERROR_CODES,
  HttpExceptionFilter,
  UNAUTHORIZED_DOMAIN_ERROR_CODES,
} from '../http-exception.filter';

/**
 * Every member of `PasswordPolicyViolation`, kept honest by the compiler.
 *
 * A union is a type and has no runtime value to iterate. Declaring the list as a
 * `Record` over the union rather than a plain array means a member added to core
 * without being added here is a build failure rather than a member this suite
 * quietly stops covering.
 */
const EVERY_VIOLATION = Object.keys({
  TOO_SHORT: true,
  TOO_LONG: true,
  NEEDS_MIXED_CASE: true,
  NEEDS_DIGIT: true,
  BREACHED: true,
} satisfies Record<PasswordPolicyViolation, true>) as PasswordPolicyViolation[];

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status: statusMock }) }),
    } as unknown as ArgumentsHost;

    // Fake request-scoped context: echoes the key so assertions can see what was translated.
    jest.spyOn(I18nContext, 'current').mockReturnValue({
      translate: (key: string, opts?: { args?: Record<string, unknown> }) =>
        opts?.args ? `${key}|${JSON.stringify(opts.args)}` : `t:${key}`,
    } as unknown as I18nContext<Record<string, unknown>>);
  });

  afterEach(() => jest.restoreAllMocks());

  const body = () => jsonMock.mock.calls[0][0];

  it('translates a messageKey payload and uses the HTTP reason phrase as error', () => {
    filter.catch(new NotFoundException({ messageKey: 'errors.articles.not_found' }), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(body()).toEqual({ error: 'Not Found', message: 't:errors.articles.not_found' });
  });

  it('passes interpolation args to the translation', () => {
    filter.catch(
      new BadRequestException({
        messageKey: 'errors.tags.not_found',
        args: { tagId: 'abc' },
      }),
      host,
    );

    expect(body().message).toBe('errors.tags.not_found|{"tagId":"abc"}');
  });

  it('translates per-field details carried on the payload', () => {
    filter.catch(
      new BadRequestException({
        messageKey: 'errors.common.validation_failed',
        details: [{ field: 'title', messageKey: 'errors.articles.title_required' }],
      }),
      host,
    );

    expect(body().message).toBe('t:errors.common.validation_failed');
    expect(body().details).toEqual([
      { field: 'title', message: 't:errors.articles.title_required' },
    ]);
  });

  it('formats an I18nValidationException (already-translated) into details', () => {
    const exception = new I18nValidationException([
      {
        property: 'email',
        constraints: { isEmail: 'email must be a valid email address' },
      },
    ]);

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body().message).toBe('t:errors.common.validation_failed');
    expect(body().details).toEqual([
      { field: 'email', message: 'email must be a valid email address' },
    ]);
  });

  it('maps a framework HttpException without our payload to a generic localized message', () => {
    filter.catch(new NotFoundException('Cannot GET /unknown'), host);

    expect(body()).toEqual({ error: 'Not Found', message: 't:errors.http.not_found' });
  });

  it('maps an unknown (non-HTTP) error to a 500 internal message', () => {
    filter.catch(new Error('boom'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body()).toEqual({ error: 'Internal Server Error', message: 't:errors.common.internal' });
  });

  describe('a refusal the domain expressed', () => {
    // Without the DOMAIN_ERRORS table in the filter, every one of these is a 500
    // and reads to whoever is watching as the server being broken. Each is an
    // ordinary thing for a person to do.
    // The title's "distinguishably" used to rest on `message` alone, which is
    // translated prose: the two bodies differed in the reader's language and in
    // nothing a program could switch on. A caller obliged to honour
    // `IAuthService.verifyEmail` — which names both errors — therefore could not,
    // and the webapp's conformance run is where that surfaced. `code` is what
    // makes the word in this title true.
    it('maps a spent single-use credential to 410, distinguishably from an expired one', () => {
      filter.catch(new ConsumedTokenError(), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.GONE);
      expect(body()).toEqual({
        error: 'Gone',
        message: 't:errors.auth.token_consumed',
        code: 'TOKEN_CONSUMED',
      });
    });

    it('maps an expired or unknown single-use credential to 410', () => {
      filter.catch(new ExpiredTokenError(), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.GONE);
      expect(body()).toEqual({
        error: 'Gone',
        message: 't:errors.auth.token_expired',
        code: 'TOKEN_EXPIRED',
      });
    });

    // The property the two tests above are each half of, asserted as one claim
    // rather than left to be inferred from two literals that happen to differ.
    // The statuses match on purpose — only somebody who held a real credential
    // reaches either — so `code` is the whole of what tells them apart.
    it('gives the two 410s different codes, which is the only thing that does', () => {
      filter.catch(new ConsumedTokenError(), host);
      filter.catch(new ExpiredTokenError(), host);
      // Both calls, read by index. `body()` is the *first* one, so reading it
      // twice would compare the consumed answer with itself and pass whatever
      // the second call did — the shape of tautology this project keeps finding.
      const consumed = jsonMock.mock.calls[0][0] as { code: string; error: string };
      const expired = jsonMock.mock.calls[1][0] as { code: string; error: string };

      expect(consumed.error).toBe(expired.error);
      expect(consumed.code).not.toBe(expired.code);
    });

    it('maps a secret that breaks the policy to 422', () => {
      filter.catch(new WeakPasswordError(['TOO_SHORT']), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('tells the caller every way the password fell short, in code and in prose', () => {
      // Core builds this list on purpose — `WeakPasswordError` carries all of
      // them rather than the first, because the list is what a caller shows the
      // person. For a phase this filter dropped it, so a person was told only
      // that something was wrong with a password they could not see.
      filter.catch(new WeakPasswordError(['TOO_SHORT', 'NEEDS_DIGIT']), host);

      expect(body().violations).toEqual([
        // The code is core's own union member, so a client can switch on it
        // exhaustively; the message is the same reason rendered.
        { code: 'TOO_SHORT', message: 'errors.auth.password.TOO_SHORT|{"minLength":12,"maxLength":200}' },
        { code: 'NEEDS_DIGIT', message: 'errors.auth.password.NEEDS_DIGIT|{"minLength":12,"maxLength":200}' },
      ]);
    });

    it('interpolates the policy the judgement was actually made against', () => {
      // The numbers come from `DEFAULT_PASSWORD_POLICY`, the same constant
      // `AuthService` evaluates against. A literal here would be a second copy
      // of a number, and the failure would be a message telling somebody to use
      // twelve characters when the rule now says sixteen.
      filter.catch(new WeakPasswordError(['TOO_SHORT']), host);

      expect(body().violations[0].message).toContain(
        `"minLength":${DEFAULT_PASSWORD_POLICY.minLength}`,
      );
    });

    it('has real prose for every way a password can be refused', () => {
      // The compiler pins that every union member has a KEY
      // (`PASSWORD_VIOLATION_KEYS` is a `Record` over the union and does not
      // compile without one). Nothing pins that the key resolves, and a key that
      // resolves to nothing is emitted verbatim as the message a person reads.
      // The fifth member was added two rounds ago, so this is live.
      //
      // Read out of the shipped translation file rather than asserted against
      // literals: the file is what `I18nModule` loads.
      const english = JSON.parse(
        readFileSync(join(__dirname, '..', '..', '..', 'i18n', 'en', 'errors.json'), 'utf8'),
      ) as { auth: { password: Record<string, string> } };

      for (const violation of EVERY_VIOLATION) {
        const prose = english.auth.password[violation];
        expect(typeof prose).toBe('string');
        expect(prose).not.toBe('');
      }
    });

    it('lists every member of the union it claims to cover', () => {
      // `EVERY_VIOLATION` is derived from a `Record` keyed by the union, so the
      // compiler refuses a missing member. The count is a second, cheaper guard
      // against somebody widening the type and the record together while
      // forgetting the English.
      expect(EVERY_VIOLATION).toHaveLength(5);
      expect(new Set(EVERY_VIOLATION).size).toBe(EVERY_VIOLATION.length);
    });

    it('promotes the one reason to the message when there is only one', () => {
      // A rule rather than a special case: a single-reason refusal is the common
      // one, and its own sentence is a better answer than "does not meet this
      // deployment's requirements" whatever the reason happens to be.
      filter.catch(new WeakPasswordError(['BREACHED']), host);

      expect(body().message).toBe(
        'errors.auth.password.BREACHED|{"minLength":12,"maxLength":200}',
      );
    });

    it('keeps the summary as the message when there are several', () => {
      // Nothing to promote — there is no one sentence — so the summary stays and
      // `violations` carries them all.
      filter.catch(new WeakPasswordError(['TOO_SHORT', 'NEEDS_DIGIT']), host);

      expect(body().message).toBe('t:errors.auth.weak_password');
    });

    it('carries no violations for an error that is not about a password', () => {
      // The key is absent, not empty: a caller branching on its presence must
      // not have to tell `[]` from "not applicable".
      filter.catch(new ExpiredTokenError(), host);

      expect(body()).not.toHaveProperty('violations');
    });

    it('never puts the domain error’s own message in the response', () => {
      // A domain message is written for a developer reading a log and can name
      // identifiers — `No session with id "..."`. None of it may reach a caller.
      filter.catch(new SessionNotFoundError('a-real-session-id'), host);

      expect(JSON.stringify(body())).not.toContain('a-real-session-id');
      expect(statusMock).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('maps a domain error the table does not name to 422, never to 500', () => {
      // The point of the fallback: a core error added in a later phase must not
      // silently become an internal-server-error until somebody notices.
      class FutureRuleError extends DomainError {
        public constructor() {
          super('some rule this phase has never heard of');
        }
      }

      filter.catch(new FutureRuleError(), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(body().message).toBe('t:errors.http.unprocessable');
      // And **no** `code`, which is the truthful answer rather than a gap: there
      // is no stable name to give a refusal the table has never heard of, and
      // inventing one would have a caller switching on a value that means
      // nothing. A caller sees a refusal it does not understand, which is what
      // this is.
      expect(body()).not.toHaveProperty('code');
    });
  });

  /**
   * The other half of a cross-check, and the only thing that can see the webapp's
   * copy of this vocabulary drift away from it.
   *
   * `apps/webapp/app/types/__tests__/api-error-code.spec.ts` pins the same eleven
   * names against the webapp's own list. The two apps share no package a wire
   * error code could live in — it is transport vocabulary, so `libs/core` may not
   * hold it (ADR-0008) — so the vocabulary is written twice, and a literal on
   * each side is what sends whoever renames one to the other.
   *
   * Measured before this existed: renaming `TOKEN_CONSUMED` in all three webapp
   * files that named it left the whole webapp suite green while this backend went
   * on emitting `TOKEN_CONSUMED`, so `verifyEmail` would have stopped raising
   * `ConsumedTokenError` in production with nothing to say so.
   */
  describe('the wire vocabulary this API emits', () => {
    // Written out rather than computed from the table: a computed expectation
    // would move with the value it is checking and could never fail.
    it('is exactly the list the webapp expects', () => {
      expect(DOMAIN_ERROR_CODES).toEqual([
        'DISPLAY_NAME_REQUIRED',
        'EMAIL_ALREADY_REGISTERED',
        'IDENTITY_ALREADY_LINKED',
        'IDENTITY_NOT_FOUND',
        'INVALID_CREDENTIALS',
        'INVALID_ORGANIZATION_SLUG',
        'LAST_IDENTITY_REMOVAL',
        'ORGANIZATION_NAME_REQUIRED',
        'ORGANIZATION_NOT_FOUND',
        'SESSION_NOT_FOUND',
        'TOKEN_CONSUMED',
        'TOKEN_EXPIRED',
        'USER_NOT_FOUND',
        'WEAK_PASSWORD',
      ]);
    });

    // A code named twice would let two different refusals answer alike, which is
    // the one thing `code` exists to stop.
    it('names each code once', () => {
      expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
    });

    /**
     * The two invariants the webapp's transport rests on.
     *
     * `createAuthFetch` renews a session on a `401` and must not renew for a
     * `401` that answers the request. It tells them apart by whether the
     * envelope carries a `code` at all — which is right only while a framework
     * refusal carries none and the domain names exactly one 401. Both were
     * greppable and neither was asserted; a rule resting on an unasserted
     * invariant is the same defect one level down.
     */
    it('carries no domain code on a framework refusal, whatever its status', () => {
      // Every status the webapp's transport reacts to, raised the way the
      // framework raises it — a guard, a pipe, Nest's own 404. None of them is a
      // `DomainError`, so none of them reaches the table above, so none carries
      // a code. The 401 is the load-bearing one: it is what the JWT guard throws
      // for a lapsed credential and what sign-in throws for a refusal.
      for (const exception of [
        new UnauthorizedException(),
        new ForbiddenException(),
        new NotFoundException(),
        new ConflictException(),
        new BadRequestException(),
      ]) {
        jsonMock.mockClear();
        filter.catch(exception, host);
        expect(body().code).toBeUndefined();
      }
    });

    it('names exactly one 401 in the domain, and it is the wrong-secret one', () => {
      // Written out rather than computed, for the reason the list above gives.
      // A second 401 added to the table makes this red, which is the point: it
      // is the moment somebody has to look at what the webapp does with it.
      expect(UNAUTHORIZED_DOMAIN_ERROR_CODES).toEqual(['INVALID_CREDENTIALS']);
    });

    it('really does emit that one, with that status and that code', () => {
      // Without this the assertion above could pass against a table entry that
      // never reaches a response — it would be a claim about a constant rather
      // than about what this API answers.
      filter.catch(new InvalidCredentialsError(), host);
      expect(statusMock).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(body().code).toBe('INVALID_CREDENTIALS');
    });
  });

  it('falls back to the raw key when no i18n context is available', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue(undefined);

    filter.catch(new NotFoundException({ messageKey: 'errors.articles.not_found' }), host);

    expect(body().message).toBe('errors.articles.not_found');
  });
});
