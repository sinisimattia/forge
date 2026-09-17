/**
 * Base class for every domain invariant violation.
 *
 * Callers catch broadly with `error instanceof DomainError` or narrowly with a
 * specific subclass. It is never thrown directly — always throw a subclass that
 * names the invariant that was violated.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
