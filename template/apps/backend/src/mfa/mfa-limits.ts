/**
 * The most second-factor methods one account may hold, confirmed or not.
 *
 * A person with a phone, a laptop, two security keys and a spare has five, so
 * eight is generous for a human and still a bound: without one, the rows an
 * account owns are limited only by how often a caller who holds nothing but a
 * session cares to ask for another.
 */
export const MAX_MFA_METHODS = 8;
