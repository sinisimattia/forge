/** How a caller asks for one page of accounts. */
export interface UserQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
  /**
   * Free-text filter over the fields an administrator can see.
   *
   * Its semantics are deliberately not pinned yet: the conformance suite
   * asserts nothing about it, so two implementations may legitimately disagree
   * about which fields it matches and how. Anything relying on a particular
   * behaviour must first make that behaviour an assertion in
   * `runIUserServiceContract`, not assume it.
   */
  search?: string;
}
