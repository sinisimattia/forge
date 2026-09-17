import { Controller, Get } from '@nestjs/common';

/** Liveness endpoint. The container healthcheck and the e2e smoke test poll this. */
@Controller('health')
export class HealthController {
  @Get()
  public check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
