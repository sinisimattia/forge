import { ROLE_PERMISSIONS } from '__FORGE_SCOPE__/core/authorization/policies';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';

describe('ROLE_PERMISSIONS', () => {
  // Every role has an entry. `Record<OrgRole, …>` already makes a missing one a
  // compile error, so what this catches is different: a role added to the enum
  // and given an empty array to satisfy the compiler. An empty array is the
  // shape of "somebody made this compile".
  it.each(Object.values(OrgRole))('gives %s a non-empty entry', (role) => {
    expect(ROLE_PERMISSIONS[role]).toBeDefined();
    expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
  });

  // The roles are ordered in the enum most to least powerful, and nothing reads
  // that order — but this test does, once, as the statement that the map agrees
  // with the names it uses. A VIEWER that can do more than a MEMBER is a typo no
  // type can catch.
  //
  // The violations are collected rather than asserted one at a time, so a
  // failure names every pair that disagrees instead of only the first. The
  // matcher takes one argument here: this suite runs under a runner whose
  // `expect` has no second message parameter, so the message has to be inside
  // the value being compared.
  it('never gives a less powerful role a permission a more powerful one lacks', () => {
    const order = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER];
    const violations: string[] = [];
    for (let i = 1; i < order.length; i += 1) {
      const stronger = new Set(ROLE_PERMISSIONS[order[i - 1]]);
      for (const permission of ROLE_PERMISSIONS[order[i]]) {
        if (!stronger.has(permission)) {
          violations.push(`${order[i]} has ${permission} and ${order[i - 1]} does not`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // `platform:administer` is not an organization permission and no role may
  // grant it. Layer one is the only route to it, which is the whole reason every
  // pass through layer one is audit-logged.
  it.each(Object.values(OrgRole))('does not give %s platform administration', (role) => {
    expect(ROLE_PERMISSIONS[role].includes('platform:administer')).toBe(false);
  });
});
