import type { Brand } from '../../shared/types/Brand';

/** A session's identifier. Branded so it cannot be passed where another id is expected. */
export type SessionId = Brand<string, 'SessionId'>;
