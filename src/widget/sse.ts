export interface SseFrame {
  id?: string;
  event: string;
  data: string;
}

/** Incremental parser for `text/event-stream` (comments and `retry:` are dropped, `onRetry` reports it). */
export class SseParser {
  private buffer = '';
  private id: string | undefined;
  private event = '';
  private data: string[] = [];

  constructor(private onRetry?: (ms: number) => void) {}

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let nl: number;
    while ((nl = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
      const line = this.buffer.slice(0, nl);
      const sep = this.buffer.startsWith('\r\n', nl) ? 2 : 1;
      // A lone \r at the very end may be the first half of \r\n; wait for more data.
      if (this.buffer[nl] === '\r' && nl + 1 === this.buffer.length) break;
      this.buffer = this.buffer.slice(nl + sep);
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return null;
      }
      const frame: SseFrame = { id: this.id, event: this.event || 'message', data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return frame;
    }
    if (line.startsWith(':')) return null;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id') this.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.onRetry?.(Number(value));
    return null;
  }
}
