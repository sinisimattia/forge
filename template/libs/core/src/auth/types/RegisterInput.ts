/**
 * Everything a person supplies to bring an account into being.
 *
 * The account that results is unverified: registering claims an address,
 * proving it is a separate step, and until that step happens the account cannot
 * be authenticated. That is what stops one person claiming another's address.
 */
export interface RegisterInput {
  /** The address as the person typed it; the domain stores its normal form. */
  email: string;
  /** The name shown to other people. */
  displayName: string;
  /** The secret the person chooses. It is judged against the deployment's policy. */
  secret: string;
}
