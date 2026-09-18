import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedActor } from '../strategies/jwt.strategy';

/**
 * The actor a request proved, as the guard's strategy established it.
 *
 * It reads what the strategy put on the request and nothing else. In
 * particular it does **not** fall back to a header, a query parameter or a body
 * field when the strategy put nothing there: a decorator that could produce an
 * actor on a route the guard let through unauthenticated would turn `@Public()`
 * into a way to claim any identity by naming it.
 *
 * Typed as {@link AuthenticatedActor} rather than as a `User`, because that is
 * what is actually known: the access credential carries two claims and nothing
 * is read from the database to serve a request. A handler that needs the
 * person's name or standing loads them, and pays for that deliberately.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor | undefined => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedActor }>();
    return request.user;
  },
);
