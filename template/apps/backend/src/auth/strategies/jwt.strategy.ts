import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { AccessTokenClaims } from '../session/session.service';

/** Who a request proved itself to be, and through which session. */
export interface AuthenticatedActor {
  /** The account the presented credential proves. */
  userId: UserId;
  /** The session it belongs to. */
  sessionId: SessionId;
}

/**
 * Verifies the access credential on a request and turns it into an actor.
 *
 * **Nothing is read from the database here, and that is a decision with a
 * stated cost.** Verifying the signature is enough to establish that this
 * server minted the credential and that it has not expired; loading the user
 * would additionally establish that the account and the session are still in
 * good standing right now. The cost of not doing it is a window: a session
 * revoked at 12:00 keeps working until the credential minted before it runs out,
 * which is `ACCESS_TOKEN_TTL_SECONDS` and no longer. The cost of doing it is a
 * database round trip on every request the application serves, including the
 * ones that need nothing about the user but the id.
 *
 * The window is bounded, visible in one constant, and closed on renewal — a
 * revoked session cannot be renewed, so it dies at the first renewal after the
 * revocation. If a deployment needs it closed immediately, this is the method
 * that changes, and the change is to look the session up here.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  public constructor(config: ConfigService) {
    super({
      // The credential is read from the `Authorization` header and from nowhere
      // else. Accepting it from a query parameter as well — which this library
      // will happily do — puts a live credential into browser history, server
      // access logs and every `Referer` header the page goes on to send.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Never `ignoreExpiration: true`. With it, the bounded window described
      // above becomes unbounded and nothing else in this file changes.
      ignoreExpiration: false,
      // `getOrThrow`, with no default anywhere: a signing key with a fallback is
      // a signing key every deployment of this template shares, and anyone
      // holding it can mint a credential for any account.
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Turns verified claims into the actor the rest of the application sees.
   *
   * @param claims - the payload passport has already verified the signature of
   * @returns the actor, which passport puts on the request
   */
  public validate(claims: AccessTokenClaims): AuthenticatedActor {
    return { userId: claims.sub, sessionId: claims.sid };
  }
}
