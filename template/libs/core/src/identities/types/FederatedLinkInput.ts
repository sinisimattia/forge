import type { UserId } from '../../users/types/UserId';
import type { AuthIdentity } from '../entities/AuthIdentity';

/**
 * Everything {@link decideFederatedLink} needs, gathered by the caller from
 * whatever store it uses. The rule itself does no lookup of its own.
 */
export interface FederatedLinkInput {
  /**
   * Who is asking. A link request is made under an existing session, so the
   * actor's identity is already established by the time this rule runs; it is
   * never something this rule has to figure out.
   */
  readonly actorUserId: UserId;
  /**
   * The identity already linked to the provider subject being linked, if any —
   * looked up by the caller before this rule runs. Whether it belongs to the
   * actor or to somebody else is exactly the question this rule answers.
   */
  readonly linkedIdentity: AuthIdentity | null;
}
