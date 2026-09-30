import { AppModule } from '../app.module';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { PermissionsGuard } from '../authorization/permissions.guard';

/**
 * Every module whose controllers name a guard can actually construct it.
 *
 * ## The defect this was written after, and why nothing else saw it
 *
 * `OrganizationAuditController` carried `@UseGuards(PermissionsGuard)` and lives
 * in `AuditModule`. `AuditModule` imported `AuthorizationModule`, which exports
 * `PermissionsGuard`, and that looks like enough. It is not: **a guard named in
 * `@UseGuards` is instantiated in the module context of the controller that
 * names it**, so every one of the guard's own constructor dependencies has to be
 * resolvable *there* — and `PermissionsGuard` injects
 * `Repository<OrganizationRecord>`, which `AuthorizationModule` registers for
 * itself and does not export.
 *
 * The result was that the whole application refused to start:
 *
 * ```
 * UnknownDependenciesException [Error]: Nest can't resolve dependencies of the
 * PermissionsGuard (Reflector, PrincipalService, ?). Please make sure that the
 * argument "OrganizationRecordRepository" at index [2] is available in the
 * AuditModule module.
 * ```
 *
 * **Nothing in the fast tiers could see it.** Every spec in this package builds
 * its own `Test.createTestingModule` with an explicit provider list, which is
 * what makes those specs fast and focused — and it means not one of them ever
 * asks Nest to resolve the real module graph. `composition-root.spec.ts` reads
 * `AppModule`'s decorator metadata and asserts what is *listed*, which was all
 * correct; the failure is in what is *reachable*. The only thing that booted the
 * real graph was the Docker e2e, which was PR-only, so a `main` that could not
 * start was reachable by pushing.
 *
 * ## What this asserts, and why all three inputs are derived rather than listed
 *
 * The **guards** come from the `@UseGuards` metadata of every controller in the
 * graph; the **modules** from walking `AppModule`'s `imports`; the
 * **requirements** from Nest's own `self:paramtypes` — the tokens
 * `@InjectRepository` recorded. So a fourth controller adopting a guard, a third
 * guard, or a fourth dependency on an existing one, is covered without anybody
 * remembering this file exists.
 *
 * All three being derived is a correction rather than an original virtue. This
 * file shipped naming `PermissionsGuard` in three places, and so caught **one
 * member** of the class of faults it was written for. `PlatformAdminGuard`
 * injects `Repository<UserRecord>` and is named by `audit.controller.ts`,
 * `organization-audit.controller.ts` and `users.controller.ts`; it works only
 * because both host modules happen to register that entity. A fourth controller
 * adopting it from a module that does not would fail to boot in exactly the way
 * this file exists to prevent, and this file would have been green — a hardcoded
 * list of "modules that need `OrganizationRecord`" would likewise have been
 * three names that were already right, and would have stayed right while the
 * fourth was wrong.
 *
 * It is a static check and not a boot: resolving the real graph for real needs a
 * database, which is what the Docker tier is for. This one runs in milliseconds
 * and catches the same class of fault, so both exist.
 */

/** Nest's own metadata keys. Spelled here because `@nestjs/core` does not export them. */
const IMPORTS = 'imports';
const CONTROLLERS = 'controllers';
const EXPORTS = 'exports';
const GUARDS = '__guards__';
/** What `@Inject`/`@InjectRepository` records: `{ index, param }` per decorated parameter. */
const SELF_PARAMTYPES = 'self:paramtypes';

type Ctor = new (...args: never[]) => unknown;
interface DynamicModule {
  module: Ctor;
  exports?: unknown[];
  imports?: unknown[];
}

const isDynamic = (value: unknown): value is DynamicModule =>
  typeof value === 'object' && value !== null && 'module' in value;

/** A provider token as a comparable string, whatever shape it was declared in. */
const tokenOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'function') return (value as { name: string }).name;
  if (typeof value === 'object' && value !== null && 'provide' in value) {
    return tokenOf((value as { provide: unknown }).provide);
  }
  return String(value);
};

/** Every static module class reachable from `root` through `imports`. */
const moduleGraph = (root: Ctor): Ctor[] => {
  const seen = new Set<Ctor>();
  const queue: Ctor[] = [root];

  while (queue.length > 0) {
    const current = queue.shift() as Ctor;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const entry of (Reflect.getMetadata(IMPORTS, current) as unknown[]) ?? []) {
      // A dynamic module's own class is followed too: `forFeature`'s host is
      // `TypeOrmModule`, and skipping it would be skipping the thing that
      // declares the repository providers.
      const next = isDynamic(entry) ? entry.module : entry;
      if (typeof next === 'function' && !seen.has(next as Ctor)) queue.push(next as Ctor);
    }
  }

  return [...seen];
};

/**
 * Every token a module can resolve from what it imports.
 *
 * A module's own providers are deliberately NOT included: this asks what an
 * *enhancer* instantiated in this context can reach, and the question that
 * matters is whether the imports supply it.
 *
 * **That makes this check stricter than Nest, on purpose — do not "fix" it.**
 * Nest would also resolve a token a module declares in its own `providers`, so a
 * module that both declared `OrganizationRecordRepository` itself and named the
 * guard would boot while failing here. That is a false RED, and it is the safe
 * direction: the cost is somebody adding an import they did not strictly need,
 * where the cost of modelling providers too generously is a false GREEN — this
 * file reporting that an application boots when it does not, which is the exact
 * failure it was written after. Every module in this application registers its
 * repositories through `TypeOrmModule.forFeature` in `imports`, so the stricter
 * model costs nothing today; if that ever stops being true, widen this with an
 * assertion that watches the widening, not by deleting the sentence.
 */
const resolvableFrom = (module: Ctor): Set<string> => {
  const tokens = new Set<string>();

  const absorb = (entry: unknown, depth: number): void => {
    if (depth > 4) return;

    if (isDynamic(entry)) {
      for (const exported of entry.exports ?? []) {
        tokens.add(tokenOf(exported));
        // A module may re-export another module wholesale.
        if (typeof exported === 'function' && Reflect.getMetadata(EXPORTS, exported) !== undefined) {
          absorb(exported, depth + 1);
        }
      }
      return;
    }

    if (typeof entry !== 'function') return;
    for (const exported of (Reflect.getMetadata(EXPORTS, entry) as unknown[]) ?? []) {
      tokens.add(tokenOf(exported));
      if (typeof exported === 'function' && Reflect.getMetadata(EXPORTS, exported) !== undefined) {
        absorb(exported, depth + 1);
      }
    }
  };

  for (const entry of (Reflect.getMetadata(IMPORTS, module) as unknown[]) ?? []) {
    absorb(entry, 0);
  }

  return tokens;
};

/** The tokens `@Inject`-decorated constructor parameters of `target` name. */
const injectedTokens = (target: Ctor): string[] =>
  ((Reflect.getMetadata(SELF_PARAMTYPES, target) as { param: unknown }[] | undefined) ?? [])
    .map((entry) => tokenOf(entry.param));

/** Every guard `controller` names, on the class or on any of its routes. */
const guardsNamedBy = (controller: Ctor): Ctor[] => {
  const declared: unknown[] = [...((Reflect.getMetadata(GUARDS, controller) as unknown[]) ?? [])];
  const prototype = controller.prototype as unknown as Record<string, unknown>;

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    declared.push(...((Reflect.getMetadata(GUARDS, handler) as unknown[]) ?? []));
  }

  // Classes only. `@UseGuards(new Thing())` and `@UseGuards('TOKEN')` are legal
  // Nest and neither is something this check can read a constructor off; they
  // are skipped rather than guessed at.
  return [...new Set(declared.filter((entry): entry is Ctor => typeof entry === 'function'))];
};

describe('every module whose controllers name a guard can construct it', () => {
  const modules = moduleGraph(AppModule as unknown as Ctor);

  /**
   * Every `[module, controller, guard]` the graph declares.
   *
   * **Discovered, not listed.** This file first hardcoded `PermissionsGuard`,
   * which meant it caught one member of the class of faults it was written for:
   * `PlatformAdminGuard` injects `Repository<UserRecord>` and is named by three
   * controllers, and worked only because both host modules happen to register
   * that entity. A fourth controller adopting it from a module that does not
   * would have failed to boot in exactly the way this file exists to prevent,
   * and this file would have been green. So the guards come from the same place
   * the modules and the requirements already came from — the decorators.
   */
  const declarations = modules.flatMap((module) => (
    ((Reflect.getMetadata(CONTROLLERS, module) as Ctor[] | undefined) ?? [])
      .flatMap((controller) => guardsNamedBy(controller)
        .map((guard) => [module, controller, guard] as const))
  ));

  const guards = [...new Set(declarations.map(([, , guard]) => guard))];
  /** The rows that can actually fail: a guard injecting nothing passes by having nothing to check. */
  const demanding = declarations.filter(([, , guard]) => injectedTokens(guard).length > 0);

  /**
   * The guard on the guard, and a list-driven walk has more ways to pass by
   * finding nothing than the single-class version did — an empty guard list, an
   * empty host list, or a `self:paramtypes` read that quietly returns nothing
   * would each make every assertion below vacuously true. All three are closed
   * here, and the guards are named rather than counted so that *losing* one
   * is red rather than merely a smaller number.
   *
   * `OptionalJwtAuthGuard` injects nothing, so it never reaches `demanding`
   * and the walk below cannot fail on it. It is named here anyway, because
   * this list is also what says which guards this application has: a route
   * quietly dropping the one that makes `POST /mfa/webauthn/*` check a
   * presented session would leave that list shorter, and a count would not
   * say so.
   */
  it('discovers every guard, its hosts and its requirements — rather than passing by finding none', () => {
    expect(modules.length).toBeGreaterThan(1);
    expect(declarations.length).toBeGreaterThan(1);

    expect(guards.map((guard) => guard.name).sort())
      .toEqual(['OptionalJwtAuthGuard', 'PermissionsGuard', 'PlatformAdminGuard']);

    // Requirements actually read, not merely an empty array per guard. These are
    // the two repositories the boot failure was about, one each.
    expect(injectedTokens(PermissionsGuard as unknown as Ctor))
      .toContain('OrganizationRecordRepository');
    expect(injectedTokens(PlatformAdminGuard as unknown as Ctor))
      .toContain('UserRecordRepository');

    // And the rows below are rows that can fail, not rows that cannot.
    expect(demanding.length).toBeGreaterThan(1);
  });

  it.each(declarations.map(([module, controller, guard]) => (
    [module.name, guard.name, controller.name, module, guard] as const
  )))(
    '%s can construct %s, which %s names',
    (_moduleName, _guardName, _controllerName, module, guard) => {
      const available = resolvableFrom(module);
      const missing = injectedTokens(guard).filter((token) => !available.has(token));

      // `Nest can't resolve dependencies of the <Guard> (…, ?)` at boot, if this
      // is ever non-empty. A guard named in `@UseGuards` is instantiated in the
      // module context of the controller that names it, so importing the module
      // that EXPORTS the guard — or providing the guard locally — is not enough:
      // its own dependencies have to be reachable here too.
      expect(missing).toEqual([]);
    },
  );
});
