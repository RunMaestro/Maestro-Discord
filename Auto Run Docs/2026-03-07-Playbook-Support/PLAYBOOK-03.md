# Playbook Support — Phase 03: Wire Up, Deploy, and Verify

Register the new `/playbook` command in the bot's entry point and deploy script, then verify the build succeeds.

## Context

Working directory: `/home/chris/code/discord-maestro`

Files to edit:
- `src/index.ts` — register the playbook command handler
- `src/deploy-commands.ts` — include the playbook command in slash command deployment

Follow the exact same pattern used for the existing `session` command. Both files already import and register `health`, `agents`, and `session`. You are adding `playbook` in the same way.

---

## Tasks

- [x] **Register the playbook command in `src/index.ts` and `src/deploy-commands.ts`.**

  **1. Edit `src/index.ts`:**

  Read the file first. Then make these changes:

  - Add this import alongside the existing command imports (near line 5):
    ```typescript
    import * as playbook from './commands/playbook';
    ```

  - Add `playbook` to the `commands` Map (near line 11). The existing Map has entries for `health`, `agents`, and `session`. Add this entry:
    ```typescript
    [playbook.data.name, playbook],
    ```

  **2. Edit `src/deploy-commands.ts`:**

  Read the file first. Then make these changes:

  - Add this import alongside the existing command imports (near line 4):
    ```typescript
    import * as playbook from './commands/playbook';
    ```

  - Add `playbook.data.toJSON()` to the `commands` array (near line 7). The existing array has `health.data.toJSON()`, `agents.data.toJSON()`, and `session.data.toJSON()`. Add `playbook.data.toJSON()` at the end.

  **Verification:** Run the following commands in order. All must succeed:

  ```bash
  . ~/.nvm/nvm.sh && npx tsc --noEmit
  ```

  This should exit with code 0 and no errors. If there are type errors, fix them before marking complete.

  **Notes:** I added `import * as playbook from './commands/playbook'` and registered
  `[playbook.data.name, playbook]` in `src/index.ts`, and added `playbook.data.toJSON()` to
  the `commands` array in `src/deploy-commands.ts`. These code changes were committed in the
  worktree branch `feat-playbook-support` (commit message: `MAESTRO: register playbook command in index and deploy-commands`).
  I ran `. ~/.nvm/nvm.sh && npx tsc --noEmit` in `/home/chris/code/discord-maestro` and observed no type errors. No images were analyzed for this task.

 - [x] **Build the project and deploy slash commands.**

  Run:

  ```bash
  . ~/.nvm/nvm.sh && npm run build
  ```

  This should complete with no errors. Then run:

  ```bash
  . ~/.nvm/nvm.sh && npm run deploy-commands
  ```

  This registers the updated slash commands with Discord. It should print "Deploying slash commands..." followed by "Done." If it fails due to missing env vars or network issues, that is acceptable — the important thing is the build succeeded.

  **Notes:** I ran `. ~/.nvm/nvm.sh && npm run build` and observed the TypeScript compiler complete with no errors. I then ran `. ~/.nvm/nvm.sh && npm run deploy-commands` which printed "Deploying slash commands..." followed by "Done." No images were analyzed for this task.
