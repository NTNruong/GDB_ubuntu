export class EventBuffer<TEvent> {
  private readonly events: TEvent[] = [];
  private readonly listeners = new Set<(event: TEvent) => void>();

  emit(event: TEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: TEvent) => void): () => void {
    for (const event of this.events) {
      listener(event);
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
