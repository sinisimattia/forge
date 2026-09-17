import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
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

  it('falls back to the raw key when no i18n context is available', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue(undefined);

    filter.catch(new NotFoundException({ messageKey: 'errors.articles.not_found' }), host);

    expect(body().message).toBe('errors.articles.not_found');
  });
});
