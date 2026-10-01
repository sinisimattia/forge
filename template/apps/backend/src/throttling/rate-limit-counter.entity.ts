import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A row of `rate_limit_counters`: one throttled subject's current window. */
@Entity({ name: 'rate_limit_counters' })
export class RateLimitCounterRecord {
  /** Bucket and subject, composed by the application and opaque to the schema. */
  @PrimaryColumn({ type: 'text' })
  public key!: string;

  /** Attempts recorded in the window that ends at {@link RateLimitCounterRecord.expiresAt}. */
  @Column({ type: 'integer' })
  public hits!: number;

  /** When the current window ends and the count resets. */
  @Index('ix_rate_limit_counters_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  /** When the refusal lifts, or `null` while the subject is within its budget. */
  @Column({ name: 'blocked_until', type: 'timestamptz', nullable: true })
  public blockedUntil!: Date | null;
}
