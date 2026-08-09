export function truncateText(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  if (limit === 1) return '…';
  return `${text.slice(0, limit - 1)}…`;
}
