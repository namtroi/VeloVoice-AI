#!/usr/bin/env node
/**
 * scout-gate.cjs — Block access to bloated directories (node_modules, dist, etc.)
 *
 * Reads patterns from .agenticignore. Allows build commands.
 * Self-contained: no external lib dependencies.
 */
(() => {
  try {
    const fs = require('fs');
    const path = require('path');

    // --- Config ---
    const BUILD_COMMANDS = [
      'npm', 'npx', 'yarn', 'pnpm', 'bun',
      'go build', 'cargo build', 'make', 'mvn', 'gradle',
      'docker', 'kubectl', 'terraform', 'pip', 'poetry',
    ];
    const claudeDir = path.dirname(__dirname);

    // --- Load ignore patterns ---
    function loadPatterns() {
      const ignorePath = path.join(claudeDir, '.agenticignore');
      try {
        return fs.readFileSync(ignorePath, 'utf-8')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
      } catch { return ['node_modules', 'dist', 'build', '.git', '__pycache__', '.venv']; }
    }

    function isBlocked(filePath, patterns) {
      const normalized = filePath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      return patterns.some(p => parts.some(part => part === p));
    }

    function isBuildCommand(cmd) {
      if (typeof cmd !== 'string') return false;
      const trimmed = cmd.trim().toLowerCase();
      return BUILD_COMMANDS.some(bc => trimmed.startsWith(bc));
    }

    function extractPaths(toolInput) {
      const paths = [];
      for (const key of ['file_path', 'path', 'pattern', 'directory']) {
        if (toolInput[key]) paths.push(toolInput[key]);
      }
      if (toolInput.command) paths.push(toolInput.command);
      return paths;
    }

    // --- Main ---
    const input = fs.readFileSync(0, 'utf-8');
    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const { tool_name: toolName, tool_input: toolInput } = data;
    if (!toolInput) process.exit(0);

    // Allow build commands
    if (toolName === 'Bash' && toolInput.command && isBuildCommand(toolInput.command)) {
      process.exit(0);
    }

    const patterns = loadPatterns();
    const paths = extractPaths(toolInput);

    for (const p of paths) {
      if (isBlocked(p, patterns)) {
        console.error(`\x1b[31mBLOCKED\x1b[0m: Access to "${p}" denied (matches .agenticignore pattern)`);
        console.error(`Edit .claude/.agenticignore to customize blocked directories.`);
        process.exit(2);
      }
    }

    process.exit(0);
  } catch (e) {
    // Fail-open
    process.exit(0);
  }
})();
