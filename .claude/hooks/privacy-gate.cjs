#!/usr/bin/env node
/**
 * privacy-gate.cjs — Block access to sensitive files unless user-approved
 *
 * Flow: LLM reads ".env" → BLOCKED → asks user → approved → retries "APPROVED:.env" → ALLOWED
 * Self-contained: no external lib dependencies.
 */
(() => {
  try {
    const path = require('path');
    const fs = require('fs');

    // --- Config ---
    const SENSITIVE_PATTERNS = [
      /\.env($|\.)/i,
      /credentials/i,
      /secret/i,
      /\.pem$/i,
      /\.key$/i,
      /\.p12$/i,
      /\.pfx$/i,
      /id_rsa/i,
      /id_ed25519/i,
      /\.keystore$/i,
      /^\.?token$/i,
    ];
    const SAFE_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.log'];
    const APPROVAL_PREFIX = 'APPROVED:';

    // --- Helpers ---
    function isSensitive(filePath) {
      const base = path.basename(filePath);
      if (SAFE_EXTENSIONS.some(ext => base.endsWith(ext))) return false;
      return SENSITIVE_PATTERNS.some(p => p.test(base));
    }

    function hasApproval(filePath) {
      return typeof filePath === 'string' && filePath.startsWith(APPROVAL_PREFIX);
    }

    function stripApproval(filePath) {
      return filePath.replace(APPROVAL_PREFIX, '');
    }

    function extractPath(toolInput) {
      return toolInput.file_path || toolInput.path || toolInput.command || '';
    }

    function formatBlock(filePath) {
      const base = path.basename(filePath);
      const prompt = {
        type: 'PRIVACY_PROMPT',
        file: filePath,
        basename: base,
        question: {
          header: 'File Access',
          text: `I need to read "${base}" which may contain sensitive data. Do you approve?`,
          options: [
            { label: 'Yes, approve access', description: `Allow reading ${base} this time` },
            { label: 'No, skip this file', description: 'Continue without accessing this file' }
          ]
        }
      };
      return `
\x1b[33mPRIVACY BLOCK\x1b[0m: Sensitive file requires approval

  \x1b[33mFile:\x1b[0m ${filePath}

\x1b[90m@@PRIVACY_PROMPT_START@@\x1b[0m
${JSON.stringify(prompt, null, 2)}
\x1b[90m@@PRIVACY_PROMPT_END@@\x1b[0m

  \x1b[32mIf "Yes":\x1b[0m Use bash: cat "${filePath}"
  \x1b[31mIf "No":\x1b[0m Continue without this file.
`;
    }

    // --- Main ---
    const input = fs.readFileSync(0, 'utf-8');
    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const { tool_name: toolName, tool_input: toolInput } = data;
    if (!toolInput) process.exit(0);

    const filePath = extractPath(toolInput);
    if (!filePath) process.exit(0);

    // Bash commands: warn but don't block (allows "Yes → bash cat" flow)
    if (toolName === 'Bash') {
      if (isSensitive(filePath)) {
        console.error(`\x1b[33mWARN:\x1b[0m Bash accessing potentially sensitive path`);
      }
      process.exit(0);
    }

    // Check approval prefix
    if (hasApproval(filePath)) {
      console.error(`\x1b[32m✓\x1b[0m Approved: ${path.basename(stripApproval(filePath))}`);
      process.exit(0);
    }

    // Block sensitive files
    if (isSensitive(filePath)) {
      console.error(formatBlock(filePath));
      process.exit(2);
    }

    process.exit(0);
  } catch (e) {
    // Fail-open
    process.exit(0);
  }
})();
