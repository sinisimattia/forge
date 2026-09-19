import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { ConsumedTokenError, ExpiredTokenError, SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import { HttpExceptionFilter } from '../http-exception.filter';

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
    it('maps a spent single-use credential to 410, distinguishably from an expired one', () => {
      filter.catch(new ConsumedTokenError(), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.GONE);
      expect(body()).toEqual({ error: 'Gone', message: 't:errors.auth.token_consumed' });
    });

    it('maps an expired or unknown single-use credential to 410', () => {
      filter.catch(new ExpiredTokenError(), host);

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.GONE);
      expect(body()).toEqual({ error: 'Gone', message: 't:errors.auth.token_expired' });
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
    });
  });

  it('falls back to the raw key when no i18n context is available', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue(undefined);

    filter.catch(new NotFoundException({ messageKey: 'errors.articles.not_found' }), host);

    expect(body().message).toBe('errors.articles.not_found');
  });
});
