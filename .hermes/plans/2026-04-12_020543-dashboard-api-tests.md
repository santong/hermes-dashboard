# Dashboard API test plan

## Goal
Add reliable automated tests for the dashboard's Next.js App Router API endpoints.

## Current context
- Repo: `hermes-dashboard`
- Stack: Next.js `16.2.3`, React `19.2.4`, TypeScript
- API routes live under `src/app/api/**/route.ts`
- There is currently no test runner, no `test` script, and no visible test config in the repo
- Existing API routes are thin handlers around `@/lib/hermes-sessions`, `@/lib/hermes-memory`, and `@/lib/hermes-skills`
- Based on the bundled Next docs in `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`, Vitest is the recommended unit-test setup for this kind of synchronous route-handler testing
- Route handlers use Web `Request`/`Response` APIs, which makes them good candidates for direct unit tests with mocked library dependencies

## Proposed approach
1. Set up Vitest in a minimal way for this repo.
2. Test route handlers directly instead of booting the full Next dev server.
3. Mock the underlying library functions so tests stay deterministic and do not touch Hermes state, sqlite, subprocesses, or user data.
4. Cover the important success, validation, not-found, and internal-error branches for each route.
5. Validate with `npm run test -- --run` plus `npm run lint`.

## Files likely to change
- `package.json`
- `vitest.config.ts` or `vitest.config.mts`
- optional: `test/setup.ts`
- new test files under one of:
  - `src/app/api/**/route.test.ts`
  - or `__tests__/api/**.test.ts`

## Route coverage plan

### 1) Chat route
File: `src/app/api/chat/route.ts`
Cases:
- `POST` returns `400` when `prompt` is missing/blank
- `POST` returns successful JSON when `runChat()` resolves
- `POST` returns `500` with message when `runChat()` throws
- Optional: verify `sessionId` is trimmed before being passed through

### 2) Sessions list route
File: `src/app/api/sessions/route.ts`
Cases:
- `GET` returns `{ sessions }` on success
- `GET` returns `500` when `listSessions()` throws

### 3) Session detail / delete route
File: `src/app/api/sessions/[id]/route.ts`
Cases:
- `GET` returns `{ session }` when found
- `GET` returns `404` when `getSession()` returns null
- `GET` returns `500` on thrown error
- `DELETE` returns delete payload when `deletedIds.length > 0`
- `DELETE` returns `404` when nothing was deleted
- `DELETE` returns `500` on thrown error

### 4) Memory collection route
File: `src/app/api/memory/route.ts`
Cases:
- `GET` returns `{ memories }`
- `GET` returns `500` on thrown error
- `POST` returns `400` for invalid scope
- `POST` returns `400` for missing/blank content
- `POST` returns `{ item }` on success
- `POST` returns `500` on thrown error

### 5) Memory item route
File: `src/app/api/memory/[scope]/[index]/route.ts`
Cases:
- `PUT` returns `400` for invalid scope
- `PUT` returns `400` for invalid index
- `PUT` returns `400` when `content` is missing
- `PUT` returns `404` when `updateMemory()` returns null
- `PUT` returns `{ item }` on success
- `PUT` returns `500` on thrown error
- `DELETE` returns `400` for invalid scope
- `DELETE` returns `400` for invalid index
- `DELETE` returns `404` when `deleteMemory()` returns false
- `DELETE` returns `{ ok: true }` on success
- `DELETE` returns `500` on thrown error

### 6) Skills collection route
File: `src/app/api/skills/route.ts`
Cases:
- `GET` returns `{ skills }`
- `GET` returns `500` on thrown error

### 7) Skill update route
File: `src/app/api/skills/[...skillPath]/route.ts`
Cases:
- `PUT` returns `400` when `content` is missing
- `PUT` returns `404` when `updateSkill()` returns null
- `PUT` returns `{ skill }` on success
- `PUT` returns `500` on thrown error

## Test implementation notes
- Use `vi.mock()` on:
  - `@/lib/hermes-sessions`
  - `@/lib/hermes-memory`
  - `@/lib/hermes-skills`
- Call exported route functions directly with `new Request(...)`
- For dynamic routes, pass the expected async `params` shape, for example:
  - `{ params: Promise.resolve({ id: 'abc' }) }`
  - `{ params: Promise.resolve({ scope: 'memory', index: '0' }) }`
- Add a small helper in tests to parse `await response.json()` and assert `response.status`
- Prefer colocated tests near the route files unless you want all API tests centralized under `__tests__/api`

## Validation
- `npm run test -- --run`
- `npm run lint`
- Optional follow-up: `npm run build` if we want stronger integration confidence after the unit tests are green

## Risks / tradeoffs
- Vitest + jsdom is the standard documented Next setup, but for route-only tests a node environment may be enough; decide whether to keep one global environment or override per test file
- If path aliases (`@/`) are not resolved by default, add `vite-tsconfig-paths`
- If any route starts depending on Next runtime helpers beyond plain `Request`/`NextResponse`, tests may need extra mocking

## Open questions
- Should scope include only API route tests, or also dashboard UI tests for the components that call these endpoints?
- Do you want the smallest possible route-test setup, or a broader testing foundation for future component tests too?
- If you want only one high-value target first, the most impactful starting set is likely: `chat`, `sessions`, and `memory`
