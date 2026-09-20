/**
 * How a caller asks for one page of an organization's grants.
 *
 * Page and limit and nothing else. {@link MemberQuery} and
 * {@link InvitationQuery} each carry a filter because an assertion exercises
 * it; a filter here would be a claim about behavior that no suite could fail,
 * and hosts would have to implement it to conform without anything ever
 * checking that they had. One is added with the assertion that needs it.
 */
export interface GrantQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
}
