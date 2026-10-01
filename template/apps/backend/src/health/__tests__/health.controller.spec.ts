import { Test } from '@nestjs/testing';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';

/** A ping that resolves, standing in for a reachable database. */
const up = { database: { status: 'up' as const } };

async function controllerWith(ping: () => unknown): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
  })
    .overrideProvider(TypeOrmHealthIndicator)
    .useValue({ pingCheck: () => ping() })
    .compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('liveness answers without consulting anything', async () => {
    const controller = await controllerWith(() => {
      throw new Error('liveness must not touch the database');
    });
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('readiness reports up when the database answers', async () => {
    const controller = await controllerWith(() => Promise.resolve(up));
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok' });
  });

  it('readiness fails when the database does not answer', async () => {
    const controller = await controllerWith(() =>
      Promise.reject(new Error('connection terminated')),
    );
    await expect(controller.ready()).rejects.toBeDefined();
  });
});
