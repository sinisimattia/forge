import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MfaModule } from '../../mfa.module';
import { WEBAUTHN_CONFIG } from '../webauthn.config';

/**
 * The refusal is only worth having if the application actually reaches it while
 * booting. This takes the provider `MfaModule` really ships (from its own module
 * metadata, not a copy written here) and compiles it alone, so the test exercises
 * the wiring rather than restating it.
 */
function shippedProvider(): unknown {
  const providers: Array<{ provide?: unknown }> = Reflect.getMetadata('providers', MfaModule);
  const found = providers.find((p) => p.provide === WEBAUTHN_CONFIG);
  if (!found) throw new Error('MfaModule no longer provides WEBAUTHN_CONFIG');
  return found;
}

async function boot(env: Record<string, string>) {
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({
      ignoreEnvFile: true, ignoreEnvVars: true, load: [() => env],
    })],
    providers: [shippedProvider() as never],
  }).compile();
}

describe('MfaModule WebAuthn wiring', () => {
  it('boots with WebAuthn absent when nothing is configured', async () => {
    const app = await boot({});
    expect(app.get(WEBAUTHN_CONFIG)).toBeNull();
  });

  // The provider maps its keys by hand; a mistyped key would make a correctly
  // configured deployment refuse to boot, which only a fully configured case sees.
  it('boots with the relying party it was given when fully configured', async () => {
    const app = await boot({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_RP_ID: 'app.example',
      MFA_WEBAUTHN_ORIGIN: 'https://app.example',
    });
    expect(app.get(WEBAUTHN_CONFIG)).toMatchObject({
      rpId: 'app.example',
      origin: 'https://app.example',
    });
  });

  it('refuses to boot when enabled without an RP ID', async () => {
    await expect(boot({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_ORIGIN: 'https://app.example',
    })).rejects.toThrow(/MFA_WEBAUTHN_RP_ID/);
  });
});
