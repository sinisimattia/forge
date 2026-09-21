/**
 * A message ready to hand to a delivery mechanism.
 *
 * Plain text, not HTML: the two templates that build one today (`verify-email`,
 * `reset-password`) each carry exactly one link, and plain text is the smaller
 * surface — no markup to escape, no client-rendering quirk to account for. A
 * richer format is a decision for whichever real provider is bound behind
 * {@link IMailer}, not a shape this port has to anticipate.
 */
export type OutboundMessage = {
  /** The recipient's address, exactly as stored — no display-name wrapping. */
  to: string;
  subject: string;
  body: string;
};

/**
 * The port through which the backend hands off a message to whatever actually
 * delivers it.
 *
 * It lives here rather than in `__FORGE_SCOPE__/core` for the same reason
 * `IPasswordHasher` does (see `identities/hashing/IPasswordHasher.ts`): core has
 * no notion of a message, an address or a delivery mechanism, and giving it one
 * would drag a deployment's own transport concerns into a package that must stay
 * free of them. That is ADR-0008's own rule — "Where a port lives, and the test
 * for deciding": a port belongs to the layer whose vocabulary the capability is
 * stated in, which is `core` when a domain rule has to name the capability
 * (`IBreachedPasswordRegistry` is that case) and the app when only the app's
 * plumbing does. A mailer is the second case. Everything else the ADR requires —
 * no vendor in the contract, a development adapter behind it, no shipped
 * credential — applies here unchanged.
 *
 * The one adapter this template ships, {@link FileMailer}, binds no account and
 * sends nothing anywhere — see its own comment and ADR-0008's consequences.
 */
export interface IMailer {
  /**
   * Hands `message` to this adapter's delivery mechanism.
   *
   * @param message - the recipient, subject and body to deliver
   */
  send(message: OutboundMessage): Promise<void>;
}

/**
 * The DI token `IMailer` is bound under.
 *
 * A `Symbol`, not a string: `IMailer` is an interface and therefore has no
 * runtime value Nest could use as a token on its own (the same reason
 * `Argon2PasswordHasher` carries no `@Injectable()` — see its own comment). A
 * symbol cannot collide with a token some other module picks by coincidence of
 * spelling the way a string like `'MAILER'` could.
 */
export const MAILER = Symbol('MAILER');
