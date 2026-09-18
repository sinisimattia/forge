/**
 * What an implementation could tell about the client an attempt came from.
 *
 * Both fields are nullable because neither is guaranteed: an implementation may
 * be unable to see an address at all, and a label is only ever a courtesy. The
 * domain never interprets either one — they exist so that the person who owns a
 * session can recognize it in a list and end the one they do not recognize.
 *
 * Named for what the two values *mean* rather than for wherever an
 * implementation happens to read them from. The domain does not know what a
 * request looks like, and a field named after the place its value is carried
 * would make it know.
 */
export interface ClientContext {
  /** The network address the implementation saw, or `null` if it saw none. */
  address: string | null;
  /** A short, opaque description of the client, or `null` if none was offered. */
  label: string | null;
}
