# PDF Composer Agent Guide

## Project

PDF Composer is a Node.js ESM project with a local CLI and an optional web server for PDF and image workflows. The CLI implementation is in `cli.js`; the web server is in `web-server.js`; shared web processing is in `lib/pdf-processing.js`; package metadata and scripts are defined in `package.json`.

## Development conventions

- Keep processing local and avoid adding network-dependent behavior.
- Keep the existing CLI behavior unchanged when adding web functionality. The web server may be deployed remotely only with upload limits, temporary-job cleanup, authentication, and TLS provided by configuration or the hosting platform.
- Preserve the existing command names, default output filenames, and interactive workflow unless the task explicitly changes them.
- Use `--output <file>` for output paths. When `--output` is provided, it must be the final command-line parameter.
- Keep CLI help text, README examples, and parser behavior synchronized.
- Prefer the existing dependencies and small focused changes over new abstractions.
- Do not commit generated PDFs, `node_modules`, logs, environment files, or build artifacts.
- Do not commit `.web-data` or uploaded documents. Never expose `WEB_AUTH_TOKEN` in source, logs, URLs, or client-side code.
- Treat the repository `.npmrc` as the project npm configuration. Run npm commands from the project root or use `--location=project`; verify it with `npm config list --location=project`. Never expose or commit authentication tokens or user-level npm settings.
- Validate files, numeric values, page ranges, and unsupported formats with actionable errors.

## Useful commands

```bash
./install.sh
npm start
node --check cli.js
git diff --check
```

Run `npm start` after CLI or help-text changes. For CLI edits, also run `node --check cli.js`. For parser changes, test both accepted and rejected argument forms, including `--output` ordering. For PDF behavior changes, use small representative input files and verify the generated output. For documentation or rule changes, run `git diff --check`.
For web edits, run `node --check web-server.js`, check the browser assets, and exercise health, upload, reorder, export, authentication, and cleanup paths.

## AI-assisted development skills

- **CLI Design and Architecture:** Design command structures, subcommands, options, defaults, aliases, and interactive workflows.
- **Argument Parsing and Validation:** Validate files and values, enforce option ordering, and provide actionable errors.
- **PDF Workflow Development:** Add merging, filtering, compression, booklet creation, page reordering, rendering, and image conversion.
- **Documentation and Help Text:** Keep CLI help, README syntax, examples, defaults, and option descriptions synchronized.
- **Testing and Verification:** Test accepted and rejected arguments, generated PDFs, installation, syntax, formatting, and regressions.
- **Node.js Project Maintenance:** Maintain dependencies, package metadata, npm scripts, executable linking, installers, and Git configuration.
- **Error Handling and Reliability:** Handle missing files, invalid arguments, unsupported formats, malformed PDFs, and filesystem errors clearly.
- **Security and Privacy Review:** Keep processing local, validate paths, avoid unsafe shell execution, and review dependencies and generated files.

Changes should be implemented in the repository and validated with focused executable checks.
