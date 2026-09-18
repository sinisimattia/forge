import type { Brand } from '../../shared/types/Brand';

/** An identity's identifier. Branded so it cannot be passed where another id is expected. */
export type AuthIdentityId = Brand<string, 'AuthIdentityId'>;
