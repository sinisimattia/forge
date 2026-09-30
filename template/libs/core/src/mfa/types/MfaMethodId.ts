import type { Brand } from '../../shared/types/Brand';

/** A method's identifier. Branded so it cannot be passed where another id is expected. */
export type MfaMethodId = Brand<string, 'MfaMethodId'>;
