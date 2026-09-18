import type { ClientContext } from './ClientContext';

/**
 * One attempt to prove that an account belongs to whoever is asking.
 *
 * The secret is carried in and never carried back out: nothing the domain
 * returns from an attempt contains it, and no entity has a field it could be
 * stored in. It is a parameter, not a property.
 */
export interface AuthenticationAttempt {
  /** The address as the person typed it; the domain compares normal forms. */
  email: string;
  /** The secret the person offered. */
  secret: string;
  /** What the implementation could tell about where the attempt came from. */
  client: ClientContext;
}
