# PDF Composer Copilot Instructions

PDF Composer is a local Node.js ESM CLI. The main code is in `cli.js`, with metadata in `package.json` and user documentation in `README.md`.

- Keep processing local and preserve existing commands, interactive mode, and default output filenames.
- All output paths use `--output <file>`; when present, it must be the final command-line parameter.
- Keep parser behavior, CLI help, README usage, and examples synchronized.
- Prefer focused edits and existing dependencies.
- Do not add generated PDFs, `node_modules`, logs, environment files, or build artifacts to source control.
- Validate CLI edits with `node --check cli.js` and `npm start`; validate documentation with `git diff --check`.

AI can assist with CLI design, PDF workflow implementation, argument validation, error handling, documentation, tests, install scripts, dependency maintenance, and reliability or security reviews. Make changes directly in the workspace and report validation results.

## Development skill descriptions

- **CLI design and architecture:** Plan commands, options, defaults, aliases, and interactive flows.
- **Argument parsing and validation:** Validate inputs and enforce the final-parameter `--output` rule.
- **PDF workflow development:** Add PDF merging, filtering, compression, booklet creation, rendering, and image conversion.
- **Documentation and help:** Keep the README and CLI help synchronized with implementation behavior.
- **Testing and verification:** Test parser behavior, PDF outputs, installation, syntax, formatting, and regressions.
- **Node.js maintenance:** Manage dependencies, package metadata, npm scripts, linking, installers, and ignore rules.
- **Reliability and security:** Improve error handling, validate file paths, keep processing local, and review dependencies.
