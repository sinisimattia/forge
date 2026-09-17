import { CallHandler, ExecutionContext } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { lastValueFrom, of } from 'rxjs';
import { I18nResponseInterceptor } from '../i18n-response.interceptor';

describe('I18nResponseInterceptor', () => {
  let interceptor: I18nResponseInterceptor;
  const context = {} as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  const run = (value: unknown) =>
    lastValueFrom(interceptor.intercept(context, handlerReturning(value)));

  beforeEach(() => {
    interceptor = new I18nResponseInterceptor();
    jest.spyOn(I18nContext, 'current').mockReturnValue({
      translate: (key: string, opts?: { args?: Record<string, unknown> }) =>
        opts?.args ? `${key}|${JSON.stringify(opts.args)}` : `t:${key}`,
    } as unknown as I18nContext<Record<string, unknown>>);
  });

  afterEach(() => jest.restoreAllMocks());

  it('translates messageKey into a message field and strips the key fields', async () => {
    const result = await run({ valid: true, messageKey: 'messages.articles.published' });

    expect(result).toEqual({ valid: true, message: 't:messages.articles.published' });
  });

  it('passes messageArgs to the translation', async () => {
    const result = await run({
      valid: false,
      messageKey: 'messages.comments.rate_limited',
      messageArgs: { retryAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(result).toEqual({
      valid: false,
      message: 'messages.comments.rate_limited|{"retryAt":"2026-01-01T00:00:00.000Z"}',
    });
  });

  it('leaves objects without a messageKey unchanged', async () => {
    const payload = { data: [1, 2, 3], meta: { total: 3 } };

    expect(await run(payload)).toBe(payload);
  });

  it('passes through null and primitives', async () => {
    expect(await run(null)).toBeNull();
    expect(await run('plain')).toBe('plain');
  });

  it('falls back to the raw key when no i18n context is available', async () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue(undefined);

    const result = await run({ valid: true, messageKey: 'messages.articles.published' });

    expect(result).toEqual({ valid: true, message: 'messages.articles.published' });
  });
});
