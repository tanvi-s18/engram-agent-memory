const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    label: "credential assignment",
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i,
  },
];

export function findLikelySecret(value: string): string | null {
  return SECRET_PATTERNS.find(({ pattern }) => pattern.test(value))?.label ?? null;
}

export function assertSafeMemory(value: string): void {
  const detected = findLikelySecret(value);
  if (detected) {
    throw new Error(`Memory rejected because it appears to contain a ${detected}.`);
  }
}
