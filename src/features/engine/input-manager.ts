import readline from 'node:readline';

export type NormalizedKey =
  | { kind: 'char'; value: string }
  | {
      kind: 'control';
      name: 'return' | 'backspace' | 'interrupt' | 'eof';
    };

export type KeyHandler = (key: NormalizedKey) => void;

function normalizeKeypress(_chunk: string | undefined, key: readline.Key | undefined): NormalizedKey | null {
  if (!key) return null;

  if (key.ctrl && key.name === 'c') {
    return { kind: 'control', name: 'interrupt' };
  }
  if (key.ctrl && key.name === 'd') {
    return { kind: 'control', name: 'eof' };
  }
  if (key.name === 'return') {
    return { kind: 'control', name: 'return' };
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    return { kind: 'control', name: 'backspace' };
  }

  if (key.meta) return null;

  const seq = key.sequence;
  if (!seq || seq.length !== 1) return null;
  if (key.ctrl) return null;

  const ch = seq;
  if (ch === '\r' || ch === '\n') return { kind: 'control', name: 'return' };
  return { kind: 'char', value: ch };
}

/**
 * Raw TTY keypress listener. Caller must not stack multiple starts without stop.
 */
export function startKeypress(handler: KeyHandler): () => void {
  if (!process.stdin.isTTY) {
    throw new Error('stdin must be a TTY');
  }

  readline.emitKeypressEvents(process.stdin);

  const onKeypress = (chunk: string | undefined, key: readline.Key | undefined) => {
    const normalized = normalizeKeypress(chunk, key);
    if (normalized) handler(normalized);
  };

  process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKeypress);
  process.stdin.resume();

  return () => {
    process.stdin.off('keypress', onKeypress);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };
}
