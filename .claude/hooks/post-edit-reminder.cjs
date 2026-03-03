#!/usr/bin/env node
/**
 * post-edit-reminder.cjs — Lifecycle hook
 *
 * After Edit/Write/MultiEdit:
 * - Tracks edit count, reminds after 8 edits
 * - Detects code-only edits (no tests/docs) — flags pillar violations
 */
(() => {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const TRACK_FILE = path.join(os.tmpdir(), 'agentic-edit-count.json');
    const THRESHOLD = 8;

    // File type classifiers
    const TEST_PATTERNS = [/\.test\./, /\.spec\./, /__tests__\//, /tests?\//];
    const DOC_PATTERNS = [/\.md$/i, /docs?\//, /readme/i, /changelog/i];
    const CODE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.dart', '.swift', '.kt'];

    function isTestFile(f) { return TEST_PATTERNS.some(p => p.test(f)); }
    function isDocFile(f) { return DOC_PATTERNS.some(p => p.test(f)); }
    function isCodeFile(f) { return CODE_EXTENSIONS.some(ext => f.endsWith(ext)); }

    function loadState() {
      try {
        const data = JSON.parse(fs.readFileSync(TRACK_FILE, 'utf-8'));
        if (Date.now() - data.ts > 7200000) return fresh();
        return data;
      } catch { return fresh(); }
    }

    function fresh() {
      return { ts: Date.now(), count: 0, reminded: false, codeFiles: [], hasTest: false, hasDoc: false };
    }

    const input = fs.readFileSync(0, 'utf-8');
    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const toolName = data.tool_name || '';
    if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    const filePath = (data.tool_input || {}).file_path || (data.tool_input || {}).path || '';
    const state = loadState();
    state.count++;

    // Track file types
    if (filePath) {
      if (isTestFile(filePath)) state.hasTest = true;
      else if (isDocFile(filePath)) state.hasDoc = true;
      else if (isCodeFile(filePath) && !state.codeFiles.includes(filePath)) {
        state.codeFiles.push(filePath);
      }
    }

    const result = { continue: true };
    const warnings = [];

    // Pillar violation detection after threshold
    if (state.count >= THRESHOLD) {
      if (state.codeFiles.length > 0 && !state.hasTest) {
        warnings.push('⚠️ TDD: code files modified but no test files — write tests first');
      }
      if (state.codeFiles.length > 0 && !state.hasDoc) {
        warnings.push('⚠️ DDD: code files modified but no docs updated');
      }
      if (!state.reminded) {
        warnings.push(`📝 ${state.count} files modified. Review for quality, logging, and error handling.`);
        state.reminded = true;
      }
    }

    // Reset cycle after threshold + 16
    if (state.count >= THRESHOLD + 16) {
      state.count = 0;
      state.reminded = false;
      state.codeFiles = [];
      state.hasTest = false;
      state.hasDoc = false;
    }

    if (warnings.length) {
      result.additionalContext = '\n' + warnings.join('\n');
    }

    try { fs.writeFileSync(TRACK_FILE, JSON.stringify(state)); } catch {}
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
})();
