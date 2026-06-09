# Contributing to TradesmanFinder

This is a small-team / solo-maintainer codebase. The conventions below exist to keep velocity high and surprises low.

## Branch naming

- `feat/<short-slug>` — new feature
- `fix/<short-slug>` — bug fix
- `chore/<short-slug>` — refactor, deps, infra, mini-site registry
- `docs/<short-slug>` — documentation only
- `revert/<sha-or-pr>` — revert a previous merge

Short slugs are kebab-case, ≤4 words. Examples: `feat/stripe-lead-packs`, `fix/scroll-to-top`, `chore/microsite-batch-b9`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) shape:

```
<type>(<scope>): <imperative summary>

<optional body — wrap at 72 cols>

<optional footers (Closes #N, BREAKING CHANGE: …)>
```

- `<type>` ∈ `feat | fix | chore | docs | refactor | test | perf | revert`.
- `<scope>` is usually a top-level directory or feature area: `microsites`, `stripe`, `seo`, `partners`, `spa`, `dns`.
- The body should answer **why** for any non-trivial architectural decision.

Example:

```
feat(stripe): wire lead-pack Checkout sessions

Adds /api/stripe/checkout for the three lead-pack price IDs. Server
side only — client UI to follow in a separate PR.

Why: keeps the webhook + Checkout work surface-area small enough to
review in one sitting; UI wiring is independent and can land later.

Refs #18
```

## Bot commit identity

Automated commits made on behalf of the project use a per-project identity. For TradesmanFinder:

- `user.email` = `bot@tradesmanfinder.com`
- `user.name` = `TradesmanFinder Bot`

Use `git -c user.email=… -c user.name=… commit` to scope these settings to one commit without touching global config.

## PR sizing

Default to **smaller surgical PRs**. Rough heuristics:

- ≤ 300 net lines touched (excluding generated migrations + lockfiles).
- One concern per PR. Refactors and behaviour changes ship separately.
- Each PR description includes: **what**, **why**, **how to verify**, and **follow-up** sections.

A large feature should be broken into a tracking issue (see #22 for the shape) and shipped as 4–10 small PRs.

## Tests

Every PR that changes behaviour must add or update tests in the topic-local `*.test.ts` file. Run locally before pushing:

```bash
npm test
```

Schema changes (`shared/schema.ts`) must keep `shared/microsites.test.ts` (mini-site registry invariants) green.

The known `npm run check` failure at `server/routes.ts:657` (review schema `status` field) is a pre-existing issue — not a blocker, but don't add to it.

## Code review

- All non-trivial PRs need at least one review before merge.
- **Docs-only** (touching only `**/*.md`), **test-only**, and **revert** PRs may be merged without review by the author.
- Avoid auto-merge — merges happen after a final human check (and after CI is green if it's been set up; see issue for CI install status).

## Mini-site registry changes

Mini-site domain additions/removals follow a specific checklist:

1. Edit `shared/microsites.ts`. Keep alphabetical order. Update `MICROSITE_COUNT`.
2. Update the per-kind count in `shared/microsites.test.ts`.
3. Update `docs/microsites.md` count + kind table.
4. Open the PR. Ship the registry change *before* attaching/detaching at Vercel or flipping DNS — the registry is the source of truth.
5. After merge, attach the domain at Vercel and flip DNS at IONOS. See `docs/DEPLOY.md → "Custom domains"`.

## Stripe work (issue #18)

- **Test mode first, every time.** No production secret keys in dev or preview environments.
- New webhook handlers must include idempotency. The composite key is `event.id` for Stripe webhooks; do not credit twice on retry.
- Surface every payment event in `moderation_log` (or `payments_log` once that table exists) for an audit trail.

## Partner Programme work (issue #22)

Each sub-task (21.1 – 21.8) ships as its own PR. The schema PR (21.1) must merge before any code that reads/writes the partner tables. Wider context: `docs/partners.md`.

## Architectural decisions

When a PR commits to a non-obvious architectural choice — picking ISR over static export, choosing a specific Postgres column type for a future-proofed feature, swapping a library — add a one-line **why** in the commit body. The commit log is the cheapest decision record we have.

## Filing issues

Use one of the existing templates:

- **FEATURE: …** — net-new behaviour
- **FIX: …** — regression / bug
- **DOCS: …** — documentation gap
- **CHORE: …** — infra/cleanup
- **PR-Mxx — …** — mini-site migration PR (legacy series; new mini-site work uses CHORE)

Body sections to fill: **Goal**, **Scope** (with checkboxes), **Risk** (if user-visible), **Acceptance**.

## Help

If something in this doc blocks you, open a PR against it. Documentation is code.
