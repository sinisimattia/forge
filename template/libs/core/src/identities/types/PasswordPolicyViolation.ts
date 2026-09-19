/**
 * One way a proposed password falls short of a {@link PasswordPolicy}.
 *
 * A string union rather than an enum because `types/` holds no runtime values:
 * these are names a caller matches on and shows a person, not a table anything
 * is stored against, so nothing is gained by giving them a runtime object.
 *
 * ## `BREACHED` is not like the other four
 *
 * The first four are judgements `evaluatePassword` makes from the secret and
 * the policy alone — pure, synchronous, and answerable by anyone holding both.
 * `BREACHED` is not: it is the answer an {@link IBreachedPasswordRegistry}
 * gives, which is a lookup, may be slow, and may be unavailable. It is a member
 * of this union anyway, and the alternative was worse.
 *
 * The alternative was a second refusal type for the same event, which is what
 * existed: registration answered a public password with a transport-level
 * refusal of its own while the other four came back as a `WeakPasswordError`
 * carrying a list. That made "this password is not acceptable" two different
 * shapes depending on *why*, so every caller wanting to show a person what to
 * fix had to handle both — and the two paths that did not handle the second one
 * simply never asked the question. Naming it here makes one error type carry
 * every reason a password was refused, which is the shape a caller can actually
 * render.
 *
 * What it does **not** mean: that `evaluatePassword` answers it.
 * `evaluatePassword` stays pure and never returns this member — it cannot, it
 * has no registry. A caller asks the registry itself and adds this member to the
 * list it raises. See `IAuthService`'s registration, recovery and change
 * methods, all three of which do exactly that.
 */
export type PasswordPolicyViolation
  = 'TOO_SHORT'
    | 'TOO_LONG'
    | 'NEEDS_MIXED_CASE'
    | 'NEEDS_DIGIT'
    | 'BREACHED';
