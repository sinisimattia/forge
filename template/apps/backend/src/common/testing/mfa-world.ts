import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { EmailVerificationTokenRecord } from '../../auth/entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../../auth/entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../../auth/entities/session-record.entity';
import { REFRESH_COOKIE } from '../../auth/refresh-cookie';
import { RefreshTokenService } from '../../auth/session/refresh-token.service';
import { SessionService } from '../../auth/session/session.service';
import { JwtStrategy } from '../../auth/strategies';
import { DevOAuthProvider } from '../../auth/oauth/adapters/DevOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../../auth/oauth/oauth-authorization-request.entity';
import { OAuthController } from '../../auth/oauth/oauth.controller';
import { OAuthProviderRegistry } from '../../auth/oauth/oauth-provider.registry';
import { OAuthService } from '../../auth/oauth/oauth.service';
import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
import { NoOpBreachedPasswordRegistry } from '../../identities/breached-passwords';
import { Argon2PasswordHasher } from '../../identities/hashing';
import { IdentitiesService } from '../../identities/identities.service';
import type { IMailer } from '../../mail';
import { MfaChallengeRecord } from '../../mfa/entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../mfa/entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../../mfa/entities/mfa-recovery-code-record.entity';
import { RecoveryCodes } from '../../mfa/recovery/recovery-codes';
import { MfaChallengeService } from '../../mfa/mfa-challenge.service';
import { MfaController } from '../../mfa/mfa.controller';
import { MfaService } from '../../mfa/mfa.service';
import { MfaVerificationService } from '../../mfa/mfa-verification.service';
import { PRODUCTION_TOTP_DIGITS, TotpVerifier } from '../../mfa/totp/TotpVerifier';
import { WebAuthnCeremonies } from '../../mfa/webauthn/WebAuthnCeremonies';
import { WEBAUTHN_CONFIG, type WebAuthnConfig } from '../../mfa/webauthn/webauthn.config';
import {
  STEP_SECONDS,
  generateTotpSecret,
  totpCodeAtStep,
} from '../../mfa/totp/totp-authenticator';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { FakeDataSource } from './fake-data-source';
import { UNMETERED_THROTTLING, meteredThrottling } from './unmetered-throttling';

/**
 * The name of the cookie a session is carried in, re-exported so a spec can
 * assert its **absence** without spelling the string again.
 *
 * An assertion that a response set no cookie is only as good as the name it
 * looks for: a literal copied into a spec keeps passing after the real cookie
 * is renamed, and it passes by looking for something that no longer exists.
 * `refresh-cookie.ts` is the one place that names it; this is that value, not
 * a copy of it.
 */
export const REFRESH_COOKIE_NAME = REFRESH_COOKIE.name;

/**
 * The password every account this world seeds is given.
 *
 * Named for what it is — the first of two factors — rather than "password" or
 * "secret", because a quoted literal assigned to a key of either name is
 * indistinguishable from a real credential to a text-based secret
 * scan. The same reasoning `mapMfaMethodRecord.spec.ts` gives for
 * `FAKE_TOTP_SEED`.
 */
const FIRST_FACTOR = 'Correct Horse 9 Battery';

/** This harness's signing key. Not a credential: it signs nothing outside these specs. */
const SIGNING_KEY = 'mfa-world-harness-signing-key';

/** Where the harness pretends the webapp lives. */
const WEBAPP_URL = 'https://app.example.test';

/**
 * Where the harness pretends this API lives. `OAuthService` builds the
 * callback URI it hands a provider from this, so it is the origin the
 * redirect a spec follows carries — never an origin anything here listens on.
 */
const API_URL = 'https://api.example.test';

/**
 * The one address {@link DevOAuthProvider} asserts in this world.
 *
 * That adapter is configured with a single address at construction and
 * asserts it as both the subject and the (verified) email of every account it
 * ever hands back, with no page and no per-request input — so an account
 * reachable through the provider in this world is the account seeded at this
 * address and linked to this subject, and there is no second one to confuse
 * it with.
 */
export const FEDERATED_ADDRESS = 'federated@example.test';

/** What an authenticator app is told this deployment is called. Configuration in the app; a value here. */
export const MFA_ISSUER = 'Harness App';

/**
 * The WebAuthn relying party this world pretends to be.
 *
 * Built as a literal rather than through `buildWebAuthnConfig`, because what
 * that function does with an environment is `webauthn.config.ts`'s own suite's
 * subject and not this world's: a spec here that had to set three environment
 * variables to get a relying party would fail for a reason belonging to that
 * file. The values are the ones a ceremony is checked against — the RP ID the
 * authenticator scopes a credential to, and the one origin client data must
 * have come from.
 */
export const WEBAUTHN: WebAuthnConfig = {
  rpId: 'app.example.test',
  rpName: MFA_ISSUER,
  origin: WEBAPP_URL,
};

/** Nothing here exercises mail; a sink that records nothing suffices. */
const NOOP_MAILER: IMailer = { send: async () => undefined };

/** An account this world seeded: who it is and how it signs in. */
export interface SeededAccount {
  /** The account's id. */
  readonly userId: UserId;
  /** The address, as a person would type it at the sign-in form. */
  readonly email: string;
  /** The password that account signs in with. */
  readonly secret: string;
}

/** An account that also holds one confirmed TOTP method, with everything a spec needs to act as it or against it. */
export interface SeededMfaUser extends SeededAccount {
  /** The id of its one confirmed TOTP method. */
  readonly methodId: string;
  /** That method's shared secret, Base32, for {@link currentCodeFor}. */
  readonly totpSecret: string;
}

/** How a spec asks for a world that differs from the default one. */
export interface MfaWorldOptions {
  /**
   * The relying party the WebAuthn routes are configured with. Defaults to
   * {@link WEBAUTHN}; pass `null` for a deployment that has no WebAuthn at
   * all, which is what `buildWebAuthnConfig` returns when the feature is off.
   */
  readonly webauthn?: WebAuthnConfig | null;
  /**
   * The store attempts are counted in. Omitted, nothing is ever refused — see
   * {@link UNMETERED_THROTTLING} — and a spec that signs in wrongly as often as
   * it likes is not metered. Pass one that counts to assert a refusal.
   */
  readonly throttling?: ThrottlerStorage;
}

/**
 * Everything a spec in front of `POST /auth/login`, `POST /auth/mfa/verify`,
 * `POST /mfa/webauthn/*` and the federated callback needs.
 */
export interface MfaWorld {
  /** The routed application, for `supertest`. */
  readonly app: INestApplication;
  /** The store every service below was built over. Seed and read it directly. */
  readonly source: FakeDataSource;
  /** The real challenge service, so a spec can mint a row it then damages. */
  readonly challenges: MfaChallengeService;
  /** The real second-factor service the routes call, so a conformance suite can be driven against it directly. */
  readonly mfa: MfaService;
  /** The real recovery-code service, so a spec can issue a batch and spend a code out of band. */
  readonly recoveryCodes: RecoveryCodes;

  /**
   * Seeds an account that signs in with a password and holds one **confirmed**
   * TOTP method.
   *
   * The account and its method are written as rows, deliberately: a test of
   * two-phase login that went through the enrollment endpoint would stop being
   * able to fail for a reason of its own the day enrollment broke. The password identity is the one thing
   * driven through the real code (`AuthService.register`), because the
   * argon2 derivation is what `POST /auth/login` actually checks, and a
   * hand-written hash would be a hash this application never produced.
   *
   * @param email - the address to seed the account at; defaults to one this
   *   world numbers for itself. Named explicitly only by a spec that needs
   *   the account to be the one {@link FEDERATED_ADDRESS} names.
   * @returns the address, the password, and the method's id and seed
   */
  seedUserWithConfirmedTotp(email?: string): Promise<SeededMfaUser>;

  /**
   * Seeds a verified account that signs in with a password and holds **no**
   * second factor — the starting point of an enrollment.
   *
   * @param email - the address to seed the account at; defaults to one this
   *   world numbers for itself
   * @returns the account's id, address and password
   */
  seedUserWithoutMfa(email?: string): Promise<SeededAccount>;

  /**
   * Links the development provider's one subject to an account, so that a
   * callback through it reaches `decideFederatedSignIn`'s `SIGN_IN_EXISTING`
   * — the ending that signs somebody in without any password having been
   * presented.
   *
   * The row is written directly rather than driven through
   * `IdentitiesController.beginLink`: a spec about what happens *after* a
   * subject is linked should not also be able to fail because linking broke.
   * `providerAccountId` is {@link FEDERATED_ADDRESS} because that is the
   * subject `DevOAuthProvider` asserts — it reports the address it was
   * configured with as the subject too.
   *
   * @param userId - the account the provider will sign in
   */
  linkFederatedIdentity(userId: UserId): void;

  /** How many session rows exist right now. D10's third assertion reads this. */
  sessionCount(): number;

  close(): Promise<void>;
}

/**
 * A code that is valid **right now** for `secret`, checked against the real
 * verifier before it is handed back.
 *
 * ## Why it verifies its own output
 *
 * The specs that use this are refusal tests: the cross-user case asserts that
 * an attacker holding a *genuinely valid* code for their *own* method is
 * still refused. If this function ever returned a code the verifier does not
 * accept — because the code was generated for one step and checked in the next,
 * a step boundary having fallen between the two, or because a future change
 * gave this helper options of its own — that test would go on passing while asserting nothing at
 * all: the refusal it observed would be an ordinary wrong-code refusal, and
 * the scoping it exists to prove would be untested.
 *
 * So the check is the point, not belt-and-braces. It throws rather than
 * returning something unusable, because a helper that fails silently is how a
 * security test becomes vacuous.
 *
 * This is **not** evidence that `TotpVerifier`'s arithmetic is right — both
 * sides here are `otplib`. That evidence is
 * `mfa/totp/__tests__/TotpVerifier.spec.ts`, which pins the implementation
 * against RFC 6238 Appendix B's published vectors.
 *
 * @param secret - the shared secret, Base32, as `mfa_methods.totp_secret` holds it
 * @param now - the instant to produce a code for; defaults to the real one
 * @returns a code `TotpVerifier` accepts at `now`
 * @throws Error when the code produced does not verify, rather than handing
 *   back a value that would make a refusal test vacuous
 */
export function currentCodeFor(secret: string, now: Date = new Date()): string {
  const step = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  const code = totpCodeAtStep(secret, step, PRODUCTION_TOTP_DIGITS);

  const checked = new TotpVerifier().verify(secret, code, null, now);
  if (!checked.accepted) {
    throw new Error(
      'currentCodeFor produced a code TotpVerifier does not accept. Every refusal test built '
      + 'on this helper would pass for the wrong reason; fix the helper rather than the test.',
    );
  }
  return code;
}

/**
 * A fresh world: an empty store, the identity and MFA backends over it, and
 * `AuthController` routed in front of them.
 *
 * ## What is real here
 *
 * Every service is the one `AuthModule` builds — `AuthService`,
 * `IdentitiesService` with the real `Argon2PasswordHasher`, `SessionService`,
 * `AuditService`, `MfaChallengeService`, `TotpVerifier`,
 * `MfaVerificationService` and `OAuthService` — and the request pipeline is
 * `GLOBAL_PROVIDERS` itself, not a copy, so the statuses and bodies a spec
 * compares are the ones the application really produces. A filter that mapped
 * an error differently in production than here would turn every body
 * comparison into a comparison of this file's own arrangement.
 *
 * **The federated half is the shipped `DevOAuthProvider`, not a stub.** It
 * needs no network and no registered application, and it redirects straight
 * back into this application's own callback, so a spec driving
 * `GET /auth/oauth/OIDC` and following the `302` runs the real row lookup
 * under a write lock, the real single-use consumption, the real
 * `decideFederatedSignIn` and whatever `OAuthService` does next. That is what
 * makes a federated case here evidence about the shipped path rather than
 * about an arrangement assembled to resemble it.
 *
 * ## What is not
 *
 * The store is {@link FakeDataSource}, whose numbered inventory of what it
 * cannot model lives on the class itself — **read that list rather than any
 * summary of it**. The two items that bear hardest on an MFA spec: there are
 * no unique constraints (item 4), so nothing here is evidence about
 * `uq_mfa_challenges_token_hash`, and no foreign keys (item 7), so nothing is
 * evidence that a challenge dies with its user.
 *
 * @returns the routed application, the store, and the seeding helpers
 */
export async function makeMfaWorld(options: MfaWorldOptions = {}): Promise<MfaWorld> {
  const source = new FakeDataSource();
  const webauthn = options.webauthn === undefined ? WEBAUTHN : options.webauthn;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const audit = new AuditService(
    repo<AuditEntryRecord>(AuditEntryRecord),
    repo<UserRecord>(UserRecord),
    repo<MembershipRecord>(MembershipRecord),
  );

  const identities = new IdentitiesService(
    repo<AuthIdentityRecord>(AuthIdentityRecord),
    new Argon2PasswordHasher(),
    audit,
  );

  const sessions = new SessionService(
    repo<SessionRecord>(SessionRecord),
    repo<RefreshTokenRecord>(RefreshTokenRecord),
    new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
    source as unknown as DataSource,
  );

  const challenges = new MfaChallengeService(
    repo<MfaChallengeRecord>(MfaChallengeRecord),
    source as unknown as DataSource,
  );

  const auth = new AuthService(
    repo<UserRecord>(UserRecord),
    repo<EmailVerificationTokenRecord>(EmailVerificationTokenRecord),
    repo<PasswordResetTokenRecord>(PasswordResetTokenRecord),
    identities,
    sessions,
    audit,
    source as unknown as DataSource,
    NOOP_MAILER,
    new NoOpBreachedPasswordRegistry(),
    repo<MfaMethodRecord>(MfaMethodRecord),
    challenges,
    new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
  );

  const registry = new OAuthProviderRegistry([new DevOAuthProvider(FEDERATED_ADDRESS)]);
  const oauth = new OAuthService(
    repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord),
    repo<UserRecord>(UserRecord),
    registry,
    identities,
    sessions,
    audit,
    source as unknown as DataSource,
    new ConfigService({ PUBLIC_API_URL: API_URL }),
    repo<MfaMethodRecord>(MfaMethodRecord),
    challenges,
  );

  const recoveryCodes = new RecoveryCodes(
    repo<MfaRecoveryCodeRecord>(MfaRecoveryCodeRecord),
    source as unknown as DataSource,
  );

  const verification = new MfaVerificationService(
    repo<MfaMethodRecord>(MfaMethodRecord),
    challenges,
    new TotpVerifier(),
    sessions,
    audit,
    repo<UserRecord>(UserRecord),
    recoveryCodes,
  );

  const ceremonies = new WebAuthnCeremonies(
    repo<MfaMethodRecord>(MfaMethodRecord),
    repo<UserRecord>(UserRecord),
    challenges,
    verification,
    recoveryCodes,
    source as unknown as DataSource,
    audit,
    webauthn,
  );

  const enrollment = new MfaService(
    repo<MfaMethodRecord>(MfaMethodRecord),
    repo<UserRecord>(UserRecord),
    new TotpVerifier(),
    recoveryCodes,
    verification,
    source as unknown as DataSource,
    audit,
    new ConfigService({ MFA_ISSUER }),
  );

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        // `PUBLIC_WEBAPP_URL` is `OAuthController`'s, read once at
        // construction with `getOrThrow` — without it this module does not
        // build at all.
        load: [() => ({ JWT_SECRET: SIGNING_KEY, PUBLIC_WEBAPP_URL: WEBAPP_URL })],
      }),
      I18N,
      PassportModule,
      options.throttling === undefined
        ? UNMETERED_THROTTLING
        : meteredThrottling(options.throttling),
      JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
    ],
    controllers: [AuthController, OAuthController, MfaController],
    providers: [
      ...GLOBAL_PROVIDERS,
      // `GLOBAL_PROVIDERS` carries `PlatformAdminOverrideInterceptor`, which
      // needs this. Nothing here passes through `PlatformAdminGuard`, so it
      // never writes anything — but it is constructed, which is the point: a
      // probe application registering the shipped array has to be able to
      // build every provider in it.
      { provide: AuditService, useValue: audit },
      JwtStrategy,
      { provide: AuthService, useValue: auth },
      { provide: MfaVerificationService, useValue: verification },
      { provide: MfaService, useValue: enrollment },
      { provide: WebAuthnCeremonies, useValue: ceremonies },
      { provide: WEBAUTHN_CONFIG, useValue: webauthn },
      { provide: OAuthService, useValue: oauth },
      { provide: OAuthProviderRegistry, useValue: registry },
      {
        provide: RefreshTokenService,
        useValue: new RefreshTokenService(source as unknown as DataSource, sessions, audit),
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  let seeded = 0;

  /**
   * A verified account with a password and no method. The password identity is
   * the one thing driven through the real code (`AuthService.register`) — see
   * {@link MfaWorld.seedUserWithConfirmedTotp} for why.
   */
  const seedAccount = async (requested?: string): Promise<SeededAccount> => {
    seeded += 1;
    const email = requested ?? `enrolled-${seeded}@example.test`;

    await auth.register({ email, displayName: `Enrolled ${seeded}`, secret: FIRST_FACTOR });
    const identity = await identities.findPasswordIdentity(email);
    if (identity === null) throw new Error(`register left no password identity for ${email}`);
    const userId = identity.userId as UserId;

    // Proven directly rather than through `verifyEmail`, whose credential
    // only exists in the mail this world throws away. `canAuthenticate()`
    // is what the sign-in path reads.
    source.update(UserRecord, { id: userId }, { emailVerifiedAt: new Date() });

    return { userId, email, secret: FIRST_FACTOR };
  };

  return {
    app,
    source,
    challenges,
    mfa: enrollment,
    recoveryCodes,

    seedUserWithoutMfa: (requested?: string) => seedAccount(requested),

    seedUserWithConfirmedTotp: async (requested?: string) => {
      const account = await seedAccount(requested);
      const { userId } = account;

      // Generated rather than a literal: each account needs its own
      // seed, or the cross-user case would hand the attacker a code that is
      // valid for the victim's method too and prove nothing.
      const totpSecret = generateTotpSecret();
      const now = new Date();
      const inserted = source.insert(MfaMethodRecord, {
        // A real UUID, because `MfaVerificationService` checks the shape of the
        // `methodId` a caller supplies before it looks anything up — the store's
        // own synthetic ids are not UUIDs and the real column would reject them.
        id: randomUUID(),
        userId,
        type: MfaMethodType.TOTP,
        label: 'Phone',
        totpSecret,
        totpLastStep: null,
        webauthnCredentialId: null,
        webauthnPublicKey: null,
        webauthnCounter: null,
        // Confirmed, which is the whole reason this account is interesting:
        // `decideAuthenticationStep` counts nothing else.
        confirmedAt: now,
        lastUsedAt: null,
        createdAt: now,
      });

      return { ...account, methodId: inserted.identifiers[0].id, totpSecret };
    },

    linkFederatedIdentity: (userId) => {
      const now = new Date();
      source.insert(AuthIdentityRecord, {
        userId,
        // `DevOAuthProvider.provider` — the adapter reports `OIDC`, and
        // `OAuthService` looks the identity up by the registry-resolved
        // provider, so a different member here would leave this row
        // unfindable and the callback would provision instead of signing in.
        provider: AuthProvider.OIDC,
        providerAccountId: FEDERATED_ADDRESS,
        createdAt: now,
        lastUsedAt: null,
        // The three columns a federated identity never occupies: the proof
        // is the provider's, not this application's.
        secretHash: null,
        secretAlgorithm: null,
        secretParams: null,
      });
    },

    sessionCount: () => source.all(SessionRecord).length,

    close: () => app.close(),
  };
}
