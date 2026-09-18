import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC } from '../decorators/public.decorator';

/**
 * The guard registered as `APP_GUARD`, so it runs ahead of every route this
 * application has — including every route anybody adds later.
 *
 * That registration is the security property, not this class: a guard applied
 * per-controller protects the controllers somebody remembered to decorate, and
 * a new endpoint added in a hurry is exactly the one that gets forgotten. It is
 * asserted by `__tests__/global-guard.spec.ts` (D6) against a controller defined
 * inside that spec carrying no decorators at all, which is the only way to prove
 * the default reaches code the guard's author never saw.
 *
 * Deleting the `APP_GUARD` provider from `app.module.ts` does not break a single
 * type, does not fail lint, and opens every endpoint in the application. D6 is
 * the one thing that turns red.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  public constructor(private readonly reflector: Reflector) {
    super();
  }

  public canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // `getAllAndOverride` over the handler and then the class, in that order, so
    // a method may open a route on an otherwise-closed controller. The reverse
    // order would let a controller-level decorator be overridden by the absence
    // of a method-level one, which is not a thing anybody means to write.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    return super.canActivate(context);
  }
}
