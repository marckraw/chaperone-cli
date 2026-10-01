/**
 * How the rules that report what they found (comment-integrity, unique-capture, repeated-literal,
 * duplicate-code) word a result: the rule's own `message` with the finding in parentheses, or the
 * finding alone. Every place a finding involves goes in `context.locations`.
 */
export function findingMessage(custom: string | undefined, finding: string): string {
  if (custom) return `${custom} (${finding})`;
  return finding.charAt(0).toUpperCase() + finding.slice(1);
}
