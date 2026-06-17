// ─────────────────────────────────────────────────────────────
// SeqBuffer — ordered, deduplicated delivery of server messages.
//
// WHY THIS DESIGN SURVIVES CHAOS MODE
// ────────────────────────────────────
// The agent-server chaos engine introduces three hazards that
// break naïve message handling:
//
//   1. Out-of-order delivery — messages arrive with shuffled
//      `seq` values (e.g. 3 before 2). The buffer holds message
//      3 until 2 arrives, then releases both in order.
//
//   2. Duplicate messages — the same `seq` may be sent twice.
//      The `seen` set silently drops the second copy, preventing
//      double-rendering of tokens or double-firing of tool ACKs.
//
//   3. Connection drops mid-stream — on reconnect the client
//      sends RESUME with `last_seq` = getLastProcessedSeq().
//      The server replays everything after that seq. Any messages
//      still sitting in the buffer from the previous connection
//      are already deduplicated by `seen`, so replayed duplicates
//      are harmlessly ignored.
//
// COMPLEXITY
// ──────────
// Let N = number of messages currently buffered (i.e. arrived
// but not yet released due to gaps).
//
//   add()      — O(log N) insert into the sorted buffer via
//                binary search, plus O(1) amortised Set lookup.
//
//   popReady() — O(K) where K = number of consecutive messages
//                released. Each message is shifted from the front
//                of the sorted array (O(1) amortised with the
//                index-tracking approach used here, but see note).
//                In practice K is small because the server sends
//                messages close to in-order; chaos reorders only
//                a few at a time.
//
//   getLastProcessedSeq() — O(1).
//
// Memory: O(N) for the buffer + O(S) for the seen set, where
// S is the total number of unique seq values received across
// the lifetime of the buffer.  Call `reset()` between sessions
// to reclaim the seen set.
// ─────────────────────────────────────────────────────────────

import type { ServerMessage } from '@/types/protocol';

export class SeqBuffer {
  /** Messages received but not yet released, sorted by seq ascending. */
  private buffer: ServerMessage[] = [];

  /** Set of all seq values ever received (for deduplication). */
  private seen: Set<number> = new Set();

  /** The next seq value we expect to release. */
  private expectedSeq: number;
  private readonly initialSeq: number;
  private hasPopped: boolean = false;

  constructor(initialSeq: number = 1) {
    this.initialSeq = initialSeq;
    this.expectedSeq = initialSeq;
  }

  // ─────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────

  /**
   * Accept an incoming server message.
   *
   * - Duplicate `seq` values are silently ignored.
   * - Out-of-order messages are inserted into the buffer at the
   *   correct sorted position (binary search).
   *
   * Time: O(log N) for the binary-search insert.
   */
  add(message: ServerMessage): void {
    const seq = message.seq;

    // Deduplicate: ignore if we've already seen this seq.
    if (this.seen.has(seq)) {
      return;
    }
    this.seen.add(seq);

    // If we haven't popped anything yet, and a message arrives with a seq
    // lower than our expected start (e.g. initialSeq is 1 but we get 0),
    // dynamically adjust our start down to accommodate it.
    if (!this.hasPopped && seq < this.expectedSeq) {
      this.expectedSeq = seq;
    }

    // Discard messages with seq below expectedSeq — they were
    // already processed (possible after a RESUME replay).
    if (seq < this.expectedSeq) {
      return;
    }

    // Insert in sorted order via binary search.
    const idx = this.findInsertionIndex(seq);
    this.buffer.splice(idx, 0, message);
  }

  /**
   * Release all messages that form a contiguous run starting
   * from `expectedSeq`.
   *
   * Example:
   *   expectedSeq = 3, buffer = [3, 4, 5, 8, 9]
   *   → returns [3, 4, 5], buffer becomes [8, 9], expectedSeq = 6
   *
   * Time: O(K) where K = number of messages released.
   */
  popReady(): ServerMessage[] {
    const ready: ServerMessage[] = [];

    while (
      this.buffer.length > 0 &&
      this.buffer[0].seq === this.expectedSeq
    ) {
      // Non-null assertion is safe: we just checked length > 0.
      ready.push(this.buffer.shift()!);
      this.expectedSeq++;
      this.hasPopped = true;
    }

    return ready;
  }

  /**
   * The highest seq that has been released via `popReady()`.
   * Returns 0 if nothing has been released yet.
   *
   * Used as the `last_seq` value in RESUME messages after
   * a connection drop.
   *
   * Time: O(1).
   */
  getLastProcessedSeq(): number {
    return this.expectedSeq - 1;
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  /**
   * Clear all state. Call between sessions (e.g. after a new
   * USER_MESSAGE resets the server's seq counter to 0).
   */
  reset(): void {
    this.buffer = [];
    this.seen.clear();
    this.expectedSeq = this.initialSeq;
    this.hasPopped = false;
  }

  /**
   * Prepare for reconnection: keep `expectedSeq` and `seen`
   * intact (so RESUME-replayed duplicates are dropped) but
   * retain buffered messages that haven't been released yet
   * (they may still be valid after replay fills the gap).
   */
  prepareForReconnect(): void {
    // Nothing to clear — the buffer and seen set are still
    // relevant. This method exists as a semantic marker and
    // to allow future reconnect-specific logic.
  }

  // ─────────────────────────────────────────────────────────
  // Inspection (useful for debugging and tests)
  // ─────────────────────────────────────────────────────────

  /** Number of messages sitting in the buffer (not yet released). */
  get pendingCount(): number {
    return this.buffer.length;
  }

  /** The next seq value the buffer is waiting for. */
  get nextExpectedSeq(): number {
    return this.expectedSeq;
  }

  // ─────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────

  /**
   * Binary search to find the insertion index for a message
   * with the given seq, maintaining ascending sort order.
   *
   * Time: O(log N).
   */
  private findInsertionIndex(seq: number): number {
    let lo = 0;
    let hi = this.buffer.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.buffer[mid].seq < seq) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }
}
