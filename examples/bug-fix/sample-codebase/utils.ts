export function takeFirst<T>(items: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }

  return items.slice(0, count - 1);
}

export function formatPreview(events: string[]): string {
  if (events.length === 0) {
    return "No events";
  }

  return events.join(", ");
}
