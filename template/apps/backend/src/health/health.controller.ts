import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Public } from '../auth/decorators';

/**
 * Whether this process is alive, and whether it is ready to serve.
 *
 * Both are `@Public()`. The global `JwtAuthGuard` closes every route by
 * default, and a `401` here is worse than it looks: a `401` is a response, so
 * the healthcheck's `fetch` resolves, `r.ok` is false, the container is
 * reported unhealthy for ever, and everything waiting on `service_healthy`
 * never starts. That is the whole stack failing to boot on account of a
 * decorator nobody thought was part of liveness.
 *
 * ## Why these are two endpoints
 *
 * They answer different questions and the wrong answer to each costs something
 * different. Liveness asks whether the process should be killed and replaced;
 * it consults nothing, because a process that restarts itself every time the
 * database blips turns a brief outage into a restart loop. Readiness asks
 * whether this instance should be sent traffic, and that question genuinely
 * depends on the database: an instance that cannot reach it answers `500` to
 * everything, and saying so is the entire point. Readiness says so by answering
 * `503`.
 */
@Controller('health')
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
  ) {}

  /** Liveness. Consults nothing, deliberately — see the class documentation. */
  @Public()
  @Get()
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance actually serve a request?
   *
   * The timeout is shorter than the healthcheck's own `timeout:`, so a hung
   * database is reported as a failed check rather than leaving the probe
   * hanging until the orchestrator gives up on it. A failed check answers `503`.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  public async ready(): Promise<ReturnType<HealthCheckService['check']>> {
    return this.health.check([() => this.database.pingCheck('database', { timeout: 3000 })]);
  }
}
