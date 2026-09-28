# Claude Code Project Instructions

Read and follow `AGENTS.md` for the shared PDF Composer development rules.

This is a local Node.js ESM CLI. Keep PDF processing local, preserve existing command behavior and default filenames, and keep `cli.js`, `README.md`, and help output consistent.

All CLI output paths use `--output <file>`. If used, `--output` must be the final parameter. Validate this rule in parser changes and document every new command with a working example.

Before finishing code changes, run the narrowest relevant checks. At minimum, use `node --check cli.js` for CLI edits and `npm start` for help or command syntax changes. Use `git diff --check` for documentation edits.

## Available development skills

- **CLI design:** Create clear commands, options, defaults, aliases, and interactive workflows.
- **Argument validation:** Validate inputs, enforce `--output` ordering, and improve error messages.
- **PDF workflows:** Implement merge, filter, compress, booklet, reorder, rendering, and image conversion features.
- **Documentation:** Synchronize `README.md`, help output, examples, and command behavior.
- **Testing:** Verify valid and invalid arguments, generated files, installation, syntax, and regressions.
- **Project maintenance:** Maintain Node.js dependencies, package metadata, npm scripts, installers, and Git configuration.
- **Reliability and security:** Handle filesystem failures safely, keep processing local, validate paths, and review dependencies.
