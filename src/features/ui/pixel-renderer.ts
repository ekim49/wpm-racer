import ansiEscapes from 'ansi-escapes';
import chalk from 'chalk';

export const METER_WIDTH = 30;

/** Fixed layout rows (0-based). */
export const ROW_HUD = 0;
export const ROW_METER = 1;
export const ROW_PROMPT = 2;
export const ROW_INPUT = 3;

/** Slow → warm red; mid → blue; fast → green. */
function meterColor(wpmForBar: number) {
  if (wpmForBar < 40) return chalk.red;
  if (wpmForBar <= 80) return chalk.blue;
  return chalk.green;
}

export function formatMeterLine(wpm: number | null): string {
  const barValue = wpm === null ? 0 : Math.min(Math.max(wpm, 0), 120);
  const filled = Math.floor((barValue / 120) * METER_WIDTH);
  const empty = METER_WIDTH - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const label = wpm === null ? chalk.gray('—') : chalk.bold(String(Math.round(wpm)));
  const colorize = meterColor(barValue);
  return `${chalk.bold('WPM')} ${label}  ${colorize(bar)}`;
}

export function drawHudLine(mode: 'prose' | 'code', progress: string): string {
  return `${chalk.cyan.bold('wpm-racer')}  ${chalk.dim(`mode: ${mode}`)}  ${progress}`;
}

export function formatPromptLine(visibleSlice: string, sliceOffset: number, totalLen: number): string {
  const prefix = sliceOffset > 0 ? chalk.dim('…') : '';
  const suffix = sliceOffset + visibleSlice.length < totalLen ? chalk.dim('…') : '';
  return `${chalk.dim('type:')} ${prefix}${visibleSlice}${suffix}`;
}

/**
 * Renders what the user typed vs target in a horizontal window.
 * Committed cells: green when match, red when typo. Next key: expected char on yellow.
 * Remaining target: dim preview.
 */
export function formatTypedProgressLine(
  target: string,
  typed: string,
  sliceStart: number,
  slice: string,
): { line: string; caretCol: number } {
  let line = '';
  const end = sliceStart + slice.length;
  for (let j = sliceStart; j < end; j++) {
    const expected = target[j] ?? '';
    if (j < typed.length) {
      const ch = typed[j] ?? '';
      const cell = ch === ' ' ? ' ' : ch;
      line += ch === expected ? chalk.green(cell) : chalk.red(cell);
    } else if (j === typed.length && typed.length < target.length) {
      const cell = expected === ' ' ? ' ' : expected;
      line += chalk.bgYellow.black(cell);
    } else {
      const cell = expected === ' ' ? ' ' : expected;
      line += chalk.dim(cell);
    }
  }
  const caretCol = Math.min(Math.max(0, typed.length - sliceStart), slice.length);
  return { line, caretCol };
}

export type SessionView = {
  mode: 'prose' | 'code';
  progress: string;
  wpm: number | null;
  promptLine: string;
  typingLine: string;
  /** Visual column on ROW_INPUT (0-based). */
  caretCol: number;
};

/** Full HUD redraw without clearing the screen (no full-screen flash). */
export function renderFullFrame(v: SessionView): void {
  const chunks = [
    ansiEscapes.cursorTo(0, ROW_HUD) + ansiEscapes.eraseLine + drawHudLine(v.mode, v.progress),
    ansiEscapes.cursorTo(0, ROW_METER) + ansiEscapes.eraseLine + formatMeterLine(v.wpm),
    ansiEscapes.cursorTo(0, ROW_PROMPT) + ansiEscapes.eraseLine + v.promptLine,
    ansiEscapes.cursorTo(0, ROW_INPUT) + ansiEscapes.eraseLine + v.typingLine,
    ansiEscapes.cursorTo(v.caretCol, ROW_INPUT),
  ];
  process.stdout.write(chunks.join(''));
}
