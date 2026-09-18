import type { Brand } from '../../shared/types/Brand';

/** A user's identifier. Branded so it cannot be passed where another id is expected. */
export type UserId = Brand<string, 'UserId'>;
