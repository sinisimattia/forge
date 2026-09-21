import { AppModule } from '../app.module';
import { PermissionsGuard } from '../authorization/permissions.guard';

/**
 * Every module whose controllers name a guard can actually construct it.
 *
 * ## The defect this was written after, and why nothing else saw it
 *
 * `OrganizationAuditController` carries `@UseGuards(PermissionsGuard)` and lives
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
 * ## What this asserts, and why it is derived rather than listed
 *
 * The guard's requirements come from Nest's own `self:paramtypes` metadata — the
 * tokens `@InjectRepository` recorded — and the modules come from walking
 * `AppModule`'s `imports`. So a fourth controller that starts using this guard,
 * or a fourth dependency added to the guard's constructor, is covered without
 * anybody remembering this file exists. A hand-written list of "modules that
 * need `OrganizationRecord`" would have been three names that were already
 * right, and would have stayed right while the fourth was wrong.
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

/** Whether any route of `controller`, or the controller itself, names `guard`. */
const usesGuard = (controller: Ctor, guard: Ctor): boolean => {
  const declared: unknown[] = [...((Reflect.getMetadata(GUARDS, controller) as unknown[]) ?? [])];
  const prototype = controller.prototype as unknown as Record<string, unknown>;

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    declared.push(...((Reflect.getMetadata(GUARDS, handler) as unknown[]) ?? []));
  }

  return declared.includes(guard);
};

describe('a module whose controllers name PermissionsGuard can construct it', () => {
  const modules = moduleGraph(AppModule as unknown as Ctor);

  /** Every `[module, controller]` pair where the controller names the guard. */
  const hosts = modules.flatMap((module) => (
    ((Reflect.getMetadata(CONTROLLERS, module) as Ctor[] | undefined) ?? [])
      .filter((controller) => usesGuard(controller, PermissionsGuard as unknown as Ctor))
      .map((controller) => [module, controller] as const)
  ));

  // The guard on the guard. If the walk finds nothing — a renamed metadata key,
  // a module that stopped being imported, a controller list read the wrong way —
  // every assertion below passes by having nothing to check, which is the exact
  // shape of green this whole tier exists to refuse.
  it('finds the controllers that name it, rather than passing by finding none', () => {
    expect(hosts.length).toBeGreaterThan(1);
    expect(injectedTokens(PermissionsGuard as unknown as Ctor)).toContain(
      'OrganizationRecordRepository',
    );
  });

  it.each(hosts.map(([module, controller]) => [module.name, controller.name, module] as const))(
    '%s can resolve every dependency of the guard %s names',
    (_moduleName, _controllerName, module) => {
      const available = resolvableFrom(module);
      const missing = injectedTokens(PermissionsGuard as unknown as Ctor)
        .filter((token) => !available.has(token));

      // `Nest can't resolve dependencies of the PermissionsGuard (…, ?)` at
      // boot, if this is ever non-empty. A guard named in `@UseGuards` is
      // instantiated in the module context of the controller that names it, so
      // importing the module that EXPORTS the guard is not enough — its
      // dependencies have to be reachable here too.
      expect(missing).toEqual([]);
    },
  );
});
