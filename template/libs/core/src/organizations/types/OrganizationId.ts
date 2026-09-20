import type { Brand } from '../../shared/types/Brand';

/** An organization's identifier. Branded so it cannot be passed where another id is expected. */
export type OrganizationId = Brand<string, 'OrganizationId'>;
