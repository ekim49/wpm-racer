import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKeypress, type NormalizedKey } from './features/engine/input-manager.js';
import { WpmCalculator } from './features/engine/wpm-calculator.js';
import { formatPromptLine, formatTypedProgressLine, renderFullFrame } from './features/ui/pixel-renderer.js';

type PromptItem = { id: string; text: string; language?: string };
type PromptsFile = {
  categories: {
    prose: PromptItem[];
    code: PromptItem[];
  };
};

function loadPrompts(): PromptsFile {
  const rootDir = dirname(fileURLToPath(import.meta.url));
  const path = join(rootDir, 'data', 'prompts.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PromptsFile;
  if (!Array.isArray(raw?.categories?.prose) || !Array.isArray(raw?.categories?.code)) {
    throw new Error('Invalid prompts.json: expected categories.prose and categories.code arrays');
  }
  for (const item of [...raw.categories.prose, ...raw.categories.code]) {
    if (!item?.id || typeof item.text !== 'string' || item.text.length === 0) {
      throw new Error(`Invalid prompt entry: ${JSON.stringify(item)}`);
    }
  }
  return raw;
}

function parseArgs(argv: string[]): { mode: 'prose' | 'code'; windowSize: number } {
  let mode: 'prose' | 'code' = 'prose';
  let windowSize = 12;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) {
      const m = argv[++i];
      if (m === 'prose' || m === 'code') mode = m;
    } else if (a === '--window' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n >= 2 && n <= 30) windowSize = Math.floor(n);
    }
  }
  return { mode, windowSize };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function visibleSlice(text: string, cursorIndex: number, width: number): { start: number; slice: string } {
  if (width <= 0) return { start: 0, slice: '' };
  if (text.length <= width) return { start: 0, slice: text };
  const half = Math.floor(width / 2);
  const start = Math.min(Math.max(0, cursorIndex - half), Math.max(0, text.length - width));
  return { start, slice: text.slice(start, start + width) };
}

/**
 * Keystroke accuracy: correctStrokes increments on a matching key; decrements only when
 * backspacing over a character that still matches the target. incorrectStrokes increments
 * on every typo and is never decremented so accuracy still reflects typos after correction.
 */
type RunStats = {
  cursorIndex: number;
  correctStrokes: number;
  incorrectStrokes: number;
  startedAt: number;
  finishedAt: number | null;
};

function netWpm(stats: RunStats): number {
  const elapsedMs = (stats.finishedAt ?? Date.now()) - stats.startedAt;
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return (stats.cursorIndex / 5) / minutes;
}

function accuracy(stats: RunStats): number {
  const d = stats.correctStrokes + stats.incorrectStrokes;
  if (d === 0) return 1;
  return stats.correctStrokes / d;
}

/** After a round: Enter = play again, q/quit/exit = leave. */
async function promptContinueOrExit(): Promise<'again' | 'quit'> {
  process.stdin.setRawMode(false);
  process.stdin.resume();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const line = await new Promise<string>((resolve) => {
    rl.question('[Enter] play again  ·  [q] + Enter to quit\n', (answer) => {
      rl.close();
      resolve(answer ?? '');
    });
  });
  const normalized = line.trim().toLowerCase();
  if (normalized === 'q' || normalized === 'quit' || normalized === 'exit') {
    return 'quit';
  }
  return 'again';
}

async function runTypingSession(options: {
  mode: 'prose' | 'code';
  windowSize: number;
  pool: PromptItem[];
}): Promise<'again' | 'quit'> {
  const { mode, windowSize, pool } = options;
  const target = pickRandom(pool).text;

  const calc = new WpmCalculator(windowSize);
  let typed = '';
  const stats: RunStats = {
    cursorIndex: 0,
    correctStrokes: 0,
    incorrectStrokes: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };

  const termWidth = () => Math.max(20, (process.stdout.columns ?? 80) - 1);

  function buildFrame() {
    const w = termWidth();
    const { start, slice } = visibleSlice(target, typed.length, w);

    const promptPlain = formatPromptLine(slice, start, target.length);
    const { line: typingLine, caretCol } = formatTypedProgressLine(target, typed, start, slice);

    const wpm = calc.getMeterWpm(120);
    const progress = `${typed.length}/${target.length}  typos ${stats.incorrectStrokes}`;

    return {
      mode,
      progress,
      wpm,
      promptLine: promptPlain,
      typingLine,
      caretCol,
    };
  }

  console.clear();
  renderFullFrame(buildFrame());

  return new Promise((resolve) => {
    let finished = false;
    let stop = () => {};

    const onSig = () => {
      void finishRun('interrupt');
    };

    async function finishRun(reason: 'complete' | 'interrupt'): Promise<void> {
      if (finished) return;
      finished = true;
      stats.finishedAt = Date.now();
      stop();
      process.off('SIGINT', onSig);

      const nw = netWpm(stats);
      const acc = accuracy(stats);
      const elapsedSec = ((stats.finishedAt ?? Date.now()) - stats.startedAt) / 1000;

      console.clear();
      const title = reason === 'complete' ? 'Finished' : 'Stopped';
      console.log(`\n${title}\n`);
      console.log(`Net WPM:     ${nw.toFixed(1)}`);
      console.log(`Accuracy:    ${(acc * 100).toFixed(1)}%`);
      console.log(`Time:        ${elapsedSec.toFixed(1)}s`);
      console.log(`Progress:    ${typed.length} / ${target.length} chars\n`);

      const next = await promptContinueOrExit();
      resolve(next);
    }

    process.once('SIGINT', onSig);

    stop = startKeypress((key: NormalizedKey) => {
      if (key.kind === 'control' && key.name === 'interrupt') {
        void finishRun('interrupt');
        return;
      }
      if (key.kind === 'control' && key.name === 'eof') {
        void finishRun('interrupt');
        return;
      }
      if (key.kind === 'control' && key.name === 'return') {
        return;
      }
      if (key.kind === 'control' && key.name === 'backspace') {
        if (typed.length > 0) {
          const lastIdx = typed.length - 1;
          const wasCorrect = typed[lastIdx] === target[lastIdx];
          typed = typed.slice(0, -1);
          stats.cursorIndex = typed.length;
          if (wasCorrect) {
            stats.correctStrokes -= 1;
            calc.undoLastCorrect();
          }
          renderFullFrame(buildFrame());
        }
        return;
      }
      if (key.kind !== 'char') return;

      if (typed.length >= target.length) return;

      const idx = typed.length;
      const expected = target[idx];
      if (expected === undefined) return;

      typed += key.value;
      stats.cursorIndex = typed.length;
      if (key.value === expected) {
        stats.correctStrokes += 1;
        calc.recordCorrect();
      } else {
        stats.incorrectStrokes += 1;
      }
      renderFullFrame(buildFrame());

      if (typed.length >= target.length) {
        void finishRun('complete');
      }
    });
  });
}

async function main(): Promise<void> {
  const { mode, windowSize } = parseArgs(process.argv.slice(2));
  const prompts = loadPrompts();
  const pool = mode === 'code' ? prompts.categories.code : prompts.categories.prose;
  if (pool.length === 0) {
    console.error('No prompts for mode:', mode);
    process.exitCode = 1;
    return;
  }

  for (;;) {
    const next = await runTypingSession({ mode, windowSize, pool });
    if (next === 'quit') {
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
