// Strip secrets before anything is sent to the LLM or shown in logs.
const SECRET_KEY = /(pass(word)?|secret|token|key|auth|credential|private|dsn|url)/i;

export function redactEnvs<T extends { key: string; value: string }>(envs: T[]): T[] {
  return envs.map((e) => (SECRET_KEY.test(e.key) ? { ...e, value: "***" } : e));
}

export function redactText(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[JWT]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s"',;&]+/gi, "$1[REDACTED]")
    .replace(/(\w+:\/\/[^:\s/]+:)[^@\s]+@/g, "$1[REDACTED]@");
}
