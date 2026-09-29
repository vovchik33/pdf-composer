# Claude Code Project Instructions

Read and follow `AGENTS.md` for the shared PDF Composer development rules.

This is a Node.js ESM project with a local CLI and an optional PDF/image web server. Keep CLI processing local, preserve existing command behavior and default filenames, and keep `cli.js`, `README.md`, and help output consistent.

All CLI output paths use `--output <file>`. If used, `--output` must be the final parameter. Validate this rule in parser changes and document every new command with a working example.

Treat the repository `.npmrc` as the project npm configuration. Run npm commands from the project root or use `--location=project`; verify it with `npm config list --location=project`. Never expose or commit authentication tokens or user-level npm settings.

Validate files, numeric values, page ranges, and unsupported formats with actionable errors. Keep parser behavior, CLI help, README usage, and examples synchronized. Preserve existing command names, aliases, interactive mode, and default output filenames unless explicitly requested otherwise.

For the web server, enforce upload size and type limits, use per-job temporary storage with expiry cleanup, require `WEB_AUTH_TOKEN` in production, and never place credentials in URLs, source control, or browser-visible markup. Keep the web server additive so CLI behavior remains unchanged.

Before finishing code changes, run the narrowest relevant checks. At minimum, use `node --check cli.js` and `npm start` for CLI edits, `node --check web-server.js` for web edits, test accepted and rejected argument forms for parser changes, verify generated files for PDF workflow changes, and use `git diff --check` for documentation or rule edits.

## Available development skills

- **CLI design:** Create clear commands, options, defaults, aliases, and interactive workflows.
- **Argument validation:** Validate inputs, enforce `--output` ordering, and improve error messages.
- **PDF workflows:** Implement merge, filter, compress, booklet, reorder, rendering, and image conversion features.
- **Documentation:** Synchronize `README.md`, help output, examples, and command behavior.
- **Testing:** Verify valid and invalid arguments, generated files, installation, syntax, and regressions.
- **Project maintenance:** Maintain Node.js dependencies, package metadata, npm scripts, installers, and Git configuration.
- **Reliability and security:** Handle filesystem failures safely, keep processing local, validate paths, and review dependencies.
