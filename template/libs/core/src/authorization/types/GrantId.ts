import type { Brand } from '../../shared/types/Brand';

/** A resource grant's identifier. Branded so it cannot be passed where another id is expected. */
export type GrantId = Brand<string, 'GrantId'>;
