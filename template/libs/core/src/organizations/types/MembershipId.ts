import type { Brand } from '../../shared/types/Brand';

/** A membership's identifier. Branded so it cannot be passed where another id is expected. */
export type MembershipId = Brand<string, 'MembershipId'>;
