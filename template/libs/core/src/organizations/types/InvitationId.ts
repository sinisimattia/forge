import type { Brand } from '../../shared/types/Brand';

/** An invitation's identifier. Branded so it cannot be passed where another id is expected. */
export type InvitationId = Brand<string, 'InvitationId'>;
