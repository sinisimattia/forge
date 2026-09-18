import {
  DEFAULT_PASSWORD_POLICY,
  evaluatePassword,
} from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicy } from '__FORGE_SCOPE__/core/identities/types';

function policyWith(overrides: Partial<PasswordPolicy> = {}): PasswordPolicy {
  return { ...DEFAULT_PASSWORD_POLICY, ...overrides };
}

/** Twelve characters, lowercase only, no digit — acceptable under the default. */
const ACCEPTABLE = 'correcthorse';

describe('DEFAULT_PASSWORD_POLICY', () => {
  it('asks for twelve characters', () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(12);
  });

  it('caps the length, so a derivation cannot be asked to do unbounded work', () => {
    expect(DEFAULT_PASSWORD_POLICY.maxLength).toBe(200);
  });

  it('leaves both composition rules switched off', () => {
    expect(DEFAULT_PASSWORD_POLICY.requireMixedCase).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.requireDigit).toBe(false);
  });
});

describe('evaluatePassword', () => {
  describe('length', () => {
    it('accepts a phrase that is exactly the minimum length', () => {
      expect(ACCEPTABLE).toHaveLength(DEFAULT_PASSWORD_POLICY.minLength);
      expect(evaluatePassword(ACCEPTABLE, DEFAULT_PASSWORD_POLICY)).toEqual([]);
    });

    it('reports TOO_SHORT one character below the minimum', () => {
      expect(evaluatePassword('correcthors', DEFAULT_PASSWORD_POLICY)).toEqual(['TOO_SHORT']);
    });

    it('accepts a phrase that is exactly the maximum length', () => {
      const atTheLimit = 'a'.repeat(DEFAULT_PASSWORD_POLICY.maxLength);
      expect(evaluatePassword(atTheLimit, DEFAULT_PASSWORD_POLICY)).toEqual([]);
    });

    it('reports TOO_LONG one character above the maximum', () => {
      const overTheLimit = 'a'.repeat(DEFAULT_PASSWORD_POLICY.maxLength + 1);
      expect(evaluatePassword(overTheLimit, DEFAULT_PASSWORD_POLICY)).toEqual(['TOO_LONG']);
    });
  });

  describe('mixed case', () => {
    it('ignores case entirely when the rule is off', () => {
      expect(evaluatePassword(ACCEPTABLE, policyWith({ requireMixedCase: false }))).toEqual([]);
    });

    it('reports NEEDS_MIXED_CASE for an all-lowercase phrase when the rule is on', () => {
      expect(evaluatePassword(ACCEPTABLE, policyWith({ requireMixedCase: true })))
        .toEqual(['NEEDS_MIXED_CASE']);
    });

    it('reports NEEDS_MIXED_CASE for an all-uppercase phrase when the rule is on', () => {
      expect(evaluatePassword('CORRECTHORSE', policyWith({ requireMixedCase: true })))
        .toEqual(['NEEDS_MIXED_CASE']);
    });

    it('accepts a phrase carrying both cases when the rule is on', () => {
      expect(evaluatePassword('CorrectHorse', policyWith({ requireMixedCase: true }))).toEqual([]);
    });
  });

  describe('digits', () => {
    it('ignores digits entirely when the rule is off', () => {
      expect(evaluatePassword(ACCEPTABLE, policyWith({ requireDigit: false }))).toEqual([]);
    });

    it('reports NEEDS_DIGIT for a phrase with no digit when the rule is on', () => {
      expect(evaluatePassword(ACCEPTABLE, policyWith({ requireDigit: true })))
        .toEqual(['NEEDS_DIGIT']);
    });

    it('accepts a phrase carrying a digit when the rule is on', () => {
      expect(evaluatePassword('correcthors3', policyWith({ requireDigit: true }))).toEqual([]);
    });
  });

  // The point of returning a list: a person is told everything that is wrong
  // at once, rather than discovering it one rejection at a time.
  it('reports every violation at once, in a stable order', () => {
    const strict = policyWith({ minLength: 12, requireMixedCase: true, requireDigit: true });
    expect(evaluatePassword('short', strict)).toEqual([
      'TOO_SHORT',
      'NEEDS_MIXED_CASE',
      'NEEDS_DIGIT',
    ]);
  });

  it('can report being both too long and badly composed', () => {
    const strict = policyWith({ maxLength: 4, requireMixedCase: true, minLength: 1 });
    expect(evaluatePassword('abcde', strict)).toEqual(['TOO_LONG', 'NEEDS_MIXED_CASE']);
  });
});
