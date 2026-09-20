import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a user who already has a membership in an organization is added
 * to it again. A person is a member of an organization at most once — a second
 * membership would give the same person two roles in the same organization,
 * with no rule for which one governs.
 */
export class AlreadyAMemberError extends DomainError {
  /**
   * @param organizationId - the organization the user already belongs to
   * @param userId - the user who already holds a membership there
   */
  public constructor(organizationId: string, userId: string) {
    super(`User "${userId}" is already a member of organization "${organizationId}".`);
  }
}
