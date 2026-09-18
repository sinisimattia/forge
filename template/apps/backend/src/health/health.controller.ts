import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';

/** Liveness endpoint. The container healthcheck and the e2e smoke test poll this. */
@Controller('health')
export class HealthController {
  /**
   * `@Public()` because the global `JwtAuthGuard` closes everything else.
   *
   * Without it this endpoint answers `401`, and the things that poll it have no
   * credential and no way to get one: the container healthcheck in both compose
   * files, and the e2e smoke test. A `401` is a response, so the healthcheck's
   * `fetch` resolves — and `r.ok` is false, so the container is reported
   * unhealthy for ever and everything that waits on `service_healthy` never
   * starts. That is the whole stack failing to boot on account of a decorator
   * nobody thought was part of liveness.
   */
  @Public()
  @Get()
  public check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
