import type { Brand } from '../../shared/types/Brand';

/**
 * What kind of record a grant is about — `'document'`, `'project'`, whatever
 * the deployment's records are called.
 *
 * A branded string and not a union, which is the one place this domain declines
 * to enumerate. {@link Permission} is a union because the rules are written here
 * and a typo in one is a rule nobody wrote; resource types are the *deployment's*
 * own nouns, so a union here would mean core had to be edited before an
 * application could grant anything on a record it had just invented. The brand
 * is what still stops a resource id being passed where a type is expected.
 *
 * Because nothing validates the string, two spellings of the same noun are two
 * types that never match each other. A deployment is expected to declare its
 * own constants once rather than write the literal at each call site.
 */
export type ResourceType = Brand<string, 'ResourceType'>;
