#!/usr/bin/env node
/**
 * session-init.cjs — Context bootstrapper
 *
 * Fires on session start. Detects project stack, git info, outputs context.
 * Self-contained: no external lib dependencies.
 */
(() => {
  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    function exec(cmd) {
      try { return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim(); } catch { return ''; }
    }

    // --- Git Detection ---
    const gitBranch = exec('git rev-parse --abbrev-ref HEAD');
    const gitRoot = exec('git rev-parse --show-toplevel');
    const gitRemote = exec('git remote get-url origin');

    // --- Runtime Detection ---
    const nodeVersion = exec('node --version');
    const pythonVersion = exec('python3 --version 2>/dev/null') || exec('python --version 2>/dev/null');

    // --- Package Manager Detection ---
    function detectPM() {
      const cwd = process.cwd();
      if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) return 'bun';
      if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
      if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
      if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';
      if (fs.existsSync(path.join(cwd, 'Pipfile'))) return 'pipenv';
      if (fs.existsSync(path.join(cwd, 'poetry.lock'))) return 'poetry';
      if (fs.existsSync(path.join(cwd, 'requirements.txt'))) return 'pip';
      if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go';
      if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'cargo';
      return 'unknown';
    }

    // --- Framework Detection ---
    function detectFramework() {
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps['next']) return 'Next.js';
          if (deps['nuxt']) return 'Nuxt';
          if (deps['@angular/core']) return 'Angular';
          if (deps['svelte'] || deps['@sveltejs/kit']) return 'Svelte';
          if (deps['vue']) return 'Vue';
          if (deps['react']) return 'React';
          if (deps['express']) return 'Express';
          if (deps['fastify']) return 'Fastify';
          if (deps['hono']) return 'Hono';
          if (deps['vite']) return 'Vite';
        } catch {}
      }
      if (fs.existsSync(path.join(cwd, 'manage.py'))) return 'Django';
      if (fs.existsSync(path.join(cwd, 'app.py')) || fs.existsSync(path.join(cwd, 'wsgi.py'))) return 'Flask';
      if (fs.existsSync(path.join(cwd, 'main.go'))) return 'Go';
      if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'Rust';
      return 'unknown';
    }

    const pm = detectPM();
    const framework = detectFramework();

    // --- Output ---
    const lines = [
      '## Session Context (auto-injected)',
      '',
    ];
    if (gitBranch) lines.push(`- **Git Branch:** ${gitBranch}`);
    if (gitRemote) lines.push(`- **Git Remote:** ${gitRemote}`);
    if (gitRoot) lines.push(`- **Git Root:** ${gitRoot}`);
    if (nodeVersion) lines.push(`- **Node:** ${nodeVersion}`);
    if (pythonVersion) lines.push(`- **Python:** ${pythonVersion}`);
    if (pm !== 'unknown') lines.push(`- **Package Manager:** ${pm}`);
    if (framework !== 'unknown') lines.push(`- **Framework:** ${framework}`);
    lines.push(`- **CWD:** ${process.cwd()}`);
    lines.push('');

    console.log(JSON.stringify({ additionalContext: lines.join('\n') }));
    process.exit(0);
  } catch (e) {
    // Fail-open
    process.exit(0);
  }
})();
