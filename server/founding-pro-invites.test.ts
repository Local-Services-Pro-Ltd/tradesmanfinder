/**
 * FOUNDING PRO INVITES — storage-layer unit tests.
 *
 * Exercises the real DatabaseStorage methods against an in-memory fake `db`
 * (no Postgres required). Locks in the branching logic the routes rely on:
 *
 *  getFoundingProInviteByRef
 *   1. returns the row for a known ref
 *   2. returns null for an unknown ref
 *
 *  markFoundingProInviteViewed (idempotent — only stamps the first view)
 *   3. invited → viewed, stamps viewed_at
 *   4. already viewed → no-op (viewed_at unchanged)
 *
 *  claimFoundingProInvite (idempotent)
 *   5. invited → claimed, links tradesman id, stamps claimed_at
 *   6. already claimed → returns the existing row untouched (no re-link)
 *   7. unknown ref → throws
 *
 * The fake db understands just the query shapes these three methods build:
 * select().from().where(), update().set().where()[.returning()]. Predicates
 * are the descriptor objects our mocked eq()/and() emit below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://fake';
});

// ── Mock drizzle operators to emit inspectable predicate descriptors ─────────
vi.mock('drizzle-orm', () => ({
  eq: (col: any, value: any) => ({ kind: 'eq', col, value }),
  and: (...conds: any[]) => ({ kind: 'and', conds }),
  desc: (col: any) => ({ kind: 'desc', col }),
  isNull: (col: any) => ({ kind: 'isNull', col }),
  gt: (col: any, value: any) => ({ kind: 'gt', col, value }),
  lt: (col: any, value: any) => ({ kind: 'lt', col, value }),
  gte: (col: any, value: any) => ({ kind: 'gte', col, value }),
  lte: (col: any, value: any) => ({ kind: 'lte', col, value }),
  sql: () => ({ kind: 'sql' }),
}));

// Columns are referenced as `foundingProInvites.ref` etc. Our mocked schema
// makes each column a string token so predicates carry a readable `col`.
vi.mock('@shared/schema', () => {
  const col = (name: string) => name;
  const foundingProInvites = new Proxy({} as Record<string, string>, {
    get: (_t, prop: string) => col(prop),
  });
  return { foundingProInvites };
});

// In-memory store, reset per test.
let TABLE: any[] = [];

function rowMatches(row: any, pred: any): boolean {
  if (!pred) return true;
  if (pred.kind === 'eq') return row[pred.col] === pred.value;
  if (pred.kind === 'and') return pred.conds.every((c: any) => rowMatches(row, c));
  return true;
}

// Minimal query-builder fake. Each method returns a thenable so `await`ing a
// select resolves to the filtered rows.
function makeFakeDb() {
  return {
    select() {
      const builder: any = {
        _pred: null,
        from() { return builder; },
        where(pred: any) { builder._pred = pred; return builder; },
        orderBy() { return builder; },
        limit() { return builder; },
        then(resolve: any, reject: any) {
          try { resolve(TABLE.filter((r) => rowMatches(r, builder._pred))); }
          catch (e) { reject(e); }
        },
      };
      return builder;
    },
    update() {
      const builder: any = {
        _set: null,
        _pred: null,
        _returning: false,
        set(patch: any) { builder._set = patch; return builder; },
        where(pred: any) { builder._pred = pred; return builder; },
        returning() { builder._returning = true; return builder; },
        then(resolve: any, reject: any) {
          try {
            const updated: any[] = [];
            for (const r of TABLE) {
              if (rowMatches(r, builder._pred)) {
                Object.assign(r, builder._set);
                updated.push(r);
              }
            }
            resolve(builder._returning ? updated : undefined);
          } catch (e) { reject(e); }
        },
      };
      return builder;
    },
  };
}

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => makeFakeDb(),
}));
vi.mock('postgres', () => ({ default: () => ({}) }));

import { DatabaseStorage } from './storage';

const storage = new DatabaseStorage();

const SEED = {
  id: 1,
  ref: 'wandsworth-plumber-1',
  recipientEmail: 'Info@instagasworks.com',
  recipientName: 'Chris',
  companyName: 'Instagasworks Plumbing And Heating',
  companiesHouseNumber: null,
  trade: 'plumber',
  area: 'Wandsworth',
  postcodes: ['SW8', 'SW11'],
  campaign: 'founding-pro-pilot-01',
  status: 'invited',
  claimedTradesmanId: null,
  viewedAt: null,
  claimedAt: null,
  createdAt: 1,
};

beforeEach(() => {
  TABLE = [{ ...SEED }];
});

describe('getFoundingProInviteByRef', () => {
  it('returns the row for a known ref', async () => {
    const row = await storage.getFoundingProInviteByRef('wandsworth-plumber-1');
    expect(row?.companyName).toBe('Instagasworks Plumbing And Heating');
  });
  it('returns null for an unknown ref', async () => {
    const row = await storage.getFoundingProInviteByRef('does-not-exist');
    expect(row).toBeNull();
  });
});

describe('markFoundingProInviteViewed (idempotent)', () => {
  it('stamps viewed_at and flips status invited → viewed', async () => {
    await storage.markFoundingProInviteViewed('wandsworth-plumber-1');
    expect(TABLE[0].status).toBe('viewed');
    expect(typeof TABLE[0].viewedAt).toBe('number');
  });

  it('is a no-op once already viewed — does not overwrite the first viewed_at', async () => {
    TABLE[0].status = 'viewed';
    TABLE[0].viewedAt = 111;
    await storage.markFoundingProInviteViewed('wandsworth-plumber-1');
    expect(TABLE[0].viewedAt).toBe(111);
  });

  it('does not touch a claimed invite', async () => {
    TABLE[0].status = 'claimed';
    TABLE[0].claimedTradesmanId = 7;
    await storage.markFoundingProInviteViewed('wandsworth-plumber-1');
    expect(TABLE[0].status).toBe('claimed');
  });
});

describe('claimFoundingProInvite (idempotent)', () => {
  it('links the tradesman, flips status to claimed, stamps claimed_at', async () => {
    const row = await storage.claimFoundingProInvite('wandsworth-plumber-1', 42);
    expect(row.status).toBe('claimed');
    expect(row.claimedTradesmanId).toBe(42);
    expect(typeof row.claimedAt).toBe('number');
  });

  it('returns the existing row untouched when already claimed (no re-link)', async () => {
    TABLE[0].status = 'claimed';
    TABLE[0].claimedTradesmanId = 7;
    TABLE[0].claimedAt = 999;
    const row = await storage.claimFoundingProInvite('wandsworth-plumber-1', 42);
    expect(row.claimedTradesmanId).toBe(7); // not re-linked to 42
    expect(row.claimedAt).toBe(999);
  });

  it('throws for an unknown ref', async () => {
    await expect(storage.claimFoundingProInvite('nope', 42)).rejects.toThrow();
  });
});
