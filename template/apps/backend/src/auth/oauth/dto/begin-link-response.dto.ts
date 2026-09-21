/**
 * What `POST /users/me/identities/:provider` answers.
 *
 * A URL, never a redirect: the caller is an authenticated `fetch` from the
 * webapp, not a top-level browser navigation, and a `fetch` cannot carry the
 * in-memory access credential through a `302` the way a normal navigation
 * would follow one blindly. The client reads this URL and navigates the
 * browser to it itself, which is why this route exists at all rather than
 * reusing `GET /auth/oauth/:provider` for linking too.
 */
export class BeginLinkResponseDto {
  authorizationUrl!: string;
}
