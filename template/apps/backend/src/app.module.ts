import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, I18nValidationPipe, QueryResolver } from 'nestjs-i18n';
import { join } from 'node:path';
import { HttpExceptionFilter } from './common/filters';
import { I18nResponseInterceptor } from './common/interceptors';
import { AuditEntryRecord } from './audit/audit-entry-record.entity';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, PlatformAdminOverrideInterceptor } from './auth/guards';
import { EmailVerificationTokenRecord } from './auth/entities/email-verification-token-record.entity';
import { RefreshTokenRecord } from './auth/entities/refresh-token-record.entity';
import { SessionRecord } from './auth/entities/session-record.entity';
import { PasswordResetTokenRecord } from './auth/entities/password-reset-token-record.entity';
import { OAuthAuthorizationRequestRecord } from './auth/oauth/oauth-authorization-request.entity';
import { ResourceGrantRecord } from './authorization/resource-grant-record.entity';
import { HealthModule } from './health/health.module';
import { AuthIdentityRecord } from './identities/auth-identity-record.entity';
import { IdentitiesModule } from './identities/identities.module';
import { MailModule } from './mail';
import { MfaChallengeRecord } from './mfa/entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from './mfa/entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from './mfa/entities/mfa-recovery-code-record.entity';
import { MfaModule } from './mfa/mfa.module';
import { InvitationRecord } from './organizations/invitation-record.entity';
import { MembershipRecord } from './organizations/membership-record.entity';
import { OrganizationRecord } from './organizations/organization-record.entity';
import { OrganizationsModule } from './organizations/organizations.module';
import { UserRecord } from './users/user-record.entity';
import { UsersModule } from './users/users.module';

/**
 * The database connection this application runs on.
 *
 * A named, exported function rather than an inline `useFactory`, so a spec can
 * call it. An entity dropped from the list below is a repository Nest cannot
 * resolve and a table this process cannot read — and with the factory inline it
 * was unreachable from any test: a review deleted `RefreshTokenRecord` and all
 * 165 tests stayed green.
 *
 * Entities are listed rather than globbed. A glob would have to be right in two
 * different directory layouts — the source tree and the production image — and a
 * glob that matches nothing produces a connection with no entities and no
 * complaint. This list is checked by the compiler and, now, by
 * `__tests__/composition-root.spec.ts`.
 *
 * No `migrations` entry. There was one (`['dist/db/migrations/*.js']`) and it was
 * dead: with `rootDir` pinned to the workspace root the backend emits to
 * `dist/apps/backend/src/`, so that path resolved to a directory that never
 * exists — and nothing read it either way, since `synchronize` is false and
 * `migrationsRun` was never set. Migrations are applied by the CLI, through the
 * owner's data source, by the `migrate` service in both compose files.
 *
 * @param config - the configuration this deployment was started with
 * @returns the options `TypeOrmModule.forRootAsync` is given
 */
export function typeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres' as const,
    // The RESTRICTED role, not the schema owner the migrations run as
    // (`db/data-source.ts`). That is what makes `audit_entries` append-only to
    // this process in a way no code here can undo; see
    // `db/migrations/1758000002000-AuditAppendOnly.ts`. `getOrThrow`, so a
    // deployment with no `DATABASE_URL` fails to boot rather than starting and
    // failing on the first request.
    url: config.getOrThrow<string>('DATABASE_URL'),
    entities: [
      UserRecord,
      AuthIdentityRecord,
      SessionRecord,
      RefreshTokenRecord,
      EmailVerificationTokenRecord,
      PasswordResetTokenRecord,
      OAuthAuthorizationRequestRecord,
      AuditEntryRecord,
      OrganizationRecord,
      MembershipRecord,
      InvitationRecord,
      ResourceGrantRecord,
      // All three at once, and not one per feature as each is first read. The
      // schema-drift probe in `tests/integration/docker.test.mjs` asserts the
      // exact SET of tables TypeORM maps, so a partial registration turns it
      // red just as surely as an unregistered table does — three tasks each
      // adding one entity would be three red probes and three edits to the
      // same expected list. `mfa_recovery_codes` therefore appears here before
      // anything reads it: the row it maps exists in the migration, and the
      // cost of mapping a table nothing queries is nothing at all.
      MfaMethodRecord,
      MfaChallengeRecord,
      MfaRecoveryCodeRecord,
    ],
    synchronize: false,
  };
}

/**
 * Translation, registered rather than left scaffolded.
 *
 * Every `messageKey` this application produces resolves to the key itself until
 * this module exists — `HttpExceptionFilter` falls back to
 * `i18n ? translate(key) : key` — so a refused sign-in answered
 * `{"message":"errors.auth.invalid_credentials"}` while the English for it sat
 * unread in `i18n/en/errors.json`. The plumbing shipped a phase before anything
 * produced a message; the identity endpoints are the first routes that do.
 *
 * Exported as a value for the reason {@link GLOBAL_PROVIDERS} is: a spec
 * registers this same dynamic module in a probe application and asserts that a
 * response carries prose rather than a key, which is only an assertion about the
 * application because it is this object and not a copy.
 *
 * The loader path is resolved against this file so it works in both layouts —
 * the source tree, and `dist/apps/backend/src/` where `nest-cli.json`'s `assets`
 * entry copies `i18n/`.
 */
export const I18N = I18nModule.forRoot({
  fallbackLanguage: 'en',
  loaderOptions: { path: join(__dirname, 'i18n'), watch: false },
  // Order matters: an explicit `?lang=` wins, then an explicit header, then
  // whatever the browser asked for. `AcceptLanguageResolver` last, because it is
  // the only one the caller did not choose deliberately.
  resolvers: [
    { use: QueryResolver, options: ['lang'] },
    new HeaderResolver(['x-lang']),
    AcceptLanguageResolver,
  ],
});

/**
 * Everything that applies to every request, declared rather than done.
 *
 * **Exported as one array so that a spec can register the same array** — not a
 * copy of it — in a probe application and assert what each entry actually does.
 * That is the only arrangement under which deleting one of them turns a test
 * red: a review deleted the global validation pipe and the global exception
 * filter from the old imperative `main.ts` and the whole suite stayed green,
 * because every spec assembled its own testing module and none of them could see
 * that file.
 *
 * `AppModule` passes this array by reference, and
 * `__tests__/composition-root.spec.ts` asserts that it is this array, so the two
 * halves cannot drift: one test proves the module uses it, the others prove what
 * being in it means.
 *
 * Why these are `APP_*` providers rather than `app.useGlobalPipes(...)` and
 * friends: a provider is module metadata, which is inspectable and injectable,
 * where an imperative call in `main.ts` is neither. What genuinely cannot be
 * expressed this way — middleware and CORS — lives in `app.setup.ts`, which a
 * spec calls directly for the same reason.
 */
export const GLOBAL_PROVIDERS: Provider[] = [
  // One line, and with it every route this application serves — including every
  // route anybody adds from now on — requires a proven identity unless it is
  // marked `@Public()`. Deleting it breaks no type and fails no lint rule.
  { provide: APP_GUARD, useClass: JwtAuthGuard },

  // `whitelist` + `forbidNonWhitelisted` are the only things rejecting a field a
  // DTO does not declare. Without this provider every DTO in the application
  // validates nothing at all.
  {
    provide: APP_PIPE,
    useValue: new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  },

  // Without this, every `DomainError` from `__FORGE_SCOPE__/core` answers `500`:
  // a spent verification link, a lapsed renewal credential and a weak password
  // all reported as "an unexpected error occurred". See the filter's own
  // `DOMAIN_ERRORS` table.
  { provide: APP_FILTER, useClass: HttpExceptionFilter },

  // Turns a `messageKey` on a success payload into translated `message` text.
  { provide: APP_INTERCEPTOR, useClass: I18nResponseInterceptor },

  // Writes the `PLATFORM_ADMIN_OVERRIDE` entry a platform-administrative pass
  // owes, AFTER the handler. Global rather than per-controller because it must
  // apply wherever `PlatformAdminGuard` does and nowhere else — it does nothing
  // at all unless that guard marked the request — and pairing it with the guard
  // by hand on each controller is a pairing somebody eventually forgets, which
  // would silently stop recording passes on one route. Spec §9.5.
  { provide: APP_INTERCEPTOR, useClass: PlatformAdminOverrideInterceptor },
];

/**
 * The composition root: the one place that says which modules exist, what the
 * database connection is, and what applies to every request.
 *
 * **Nothing in here is covered by any spec that assembles its own testing
 * module**, which is every behavioural spec in this backend. That is not a
 * failing of those specs — a testing module is the right tool for a controller —
 * it is a statement about this file, and it was measured: a review deleted
 * `AuthModule` from the imports below, dropped `RefreshTokenRecord` from the
 * entity list, and removed the `APP_GUARD` provider, and the suite stayed green
 * at 165 tests each time.
 *
 * Everything this file decides is therefore reachable from a spec by name:
 * {@link typeOrmOptions} and {@link GLOBAL_PROVIDERS} are exported and used here
 * by reference, the module list is read back off this decorator's own metadata,
 * and `__tests__/composition-root.spec.ts` is the file that does it. Adding a
 * module or a provider here without adding it there leaves it untested; the
 * spec's own table says which fault each assertion catches.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: typeOrmOptions }),
    I18N,
    HealthModule,
    MailModule,
    AuditModule,
    IdentitiesModule,
    AuthModule,
    MfaModule,
    UsersModule,
    OrganizationsModule,
  ],
  providers: GLOBAL_PROVIDERS,
})
export class AppModule {}
