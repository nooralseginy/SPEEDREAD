// RSVP engine: schedules word ticks, holds play/pause + WPM state,
// and emits change events the UI can render against.

import { orpIndex, findSentenceBoundary } from './tokenizer.js';

const MIN_WPM = 100;
const MAX_WPM = 1000;
const WPM_STEP = 25;

export class RsvpReader {
  constructor(tokens, { wpm = 300, startIndex = 0, onChange } = {}) {
    this.tokens = tokens;
    this.wpm = clamp(wpm, MIN_WPM, MAX_WPM);
    this.index = clamp(startIndex, 0, Math.max(0, tokens.length - 1));
    this.playing = false;
    this.onChange = onChange || (() => {});
    this._timer = null;
  }

  baseDelayMs() {
    return 60000 / this.wpm;
  }

  emit() {
    const token = this.tokens[this.index] || { word: '', delayMul: 1 };
    this.onChange({
      word: token.word,
      orp: orpIndex(token.word),
      index: this.index,
      total: this.tokens.length,
      wpm: this.wpm,
      playing: this.playing,
    });
  }

  play() {
    if (this.playing || this.tokens.length === 0) return;
    if (this.index >= this.tokens.length - 1) this.index = 0;
    this.playing = true;
    this.emit();
    this._scheduleNext();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    this.emit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  _scheduleNext() {
    const token = this.tokens[this.index];
    const mul = token?.delayMul ?? 1;
    this._timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.index >= this.tokens.length - 1) {
        this.pause();
        return;
      }
      this.index++;
      this.emit();
      this._scheduleNext();
    }, this.baseDelayMs() * mul);
  }

  stepWord(delta) {
    this._reschedule(() => {
      this.index = clamp(this.index + delta, 0, this.tokens.length - 1);
    });
  }

  stepSentence(direction) {
    this._reschedule(() => {
      this.index = findSentenceBoundary(this.tokens, this.index, direction);
    });
  }

  seek(index) {
    this._reschedule(() => {
      this.index = clamp(index, 0, this.tokens.length - 1);
    });
  }

  setWpm(wpm) {
    this.wpm = clamp(Math.round(wpm), MIN_WPM, MAX_WPM);
    this.emit();
    // Next scheduled tick uses the fresh wpm because baseDelayMs() reads it live.
  }

  bumpWpm(deltaSteps) {
    this.setWpm(this.wpm + deltaSteps * WPM_STEP);
  }

  _reschedule(mutate) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    mutate();
    this.emit();
    if (wasPlaying) {
      this.playing = true;
      this._scheduleNext();
    }
  }

  destroy() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export const READER_LIMITS = { MIN_WPM, MAX_WPM, WPM_STEP };
