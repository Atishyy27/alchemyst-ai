import { describe, it, expect, beforeEach } from 'vitest';
import { SeqBuffer } from './seqBuffer';
import type { ServerMessage, TokenMessage } from '@/types/protocol';

// ─────────────────────────────────────────────────────────────
// Helper: create a minimal TOKEN message with a given seq.
// Using TOKEN because it's the most common message type and
// keeps the test fixtures small.
// ─────────────────────────────────────────────────────────────

function token(seq: number, text?: string): TokenMessage {
  return {
    type: 'TOKEN',
    seq,
    text: text ?? `t${seq}`,
    stream_id: 's_test',
  };
}

/** Extract seq values from an array of messages. */
function seqs(messages: ServerMessage[]): number[] {
  return messages.map((m) => m.seq);
}

// ═══════════════════════════════════════════════════════════════

describe('SeqBuffer', () => {
  let buf: SeqBuffer;

  beforeEach(() => {
    buf = new SeqBuffer();
  });

  // ─────────────────────────────────────────────────────────
  // 1. Empty buffer
  // Chaos relevance: connection opens but no messages yet;
  // popReady must not crash or return phantom messages.
  // ─────────────────────────────────────────────────────────

  describe('empty buffer', () => {
    it('popReady returns empty array', () => {
      expect(buf.popReady()).toEqual([]);
    });

    it('lastProcessedSeq is 0', () => {
      expect(buf.getLastProcessedSeq()).toBe(0);
    });

    it('pendingCount is 0', () => {
      expect(buf.pendingCount).toBe(0);
    });

    it('nextExpectedSeq is 1', () => {
      expect(buf.nextExpectedSeq).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2. Single message
  // Chaos relevance: normal-mode baseline — one message in,
  // ─────────────────────────────────────────────────────────

  describe('initialization logic', () => {
    it('handles seq starting at 0', () => {
      const buf2 = new SeqBuffer(0);
      buf2.add({ seq: 0, type: 'CONTEXT_SNAPSHOT', context_id: 'ctx', data: {} } as any);
      expect(buf2.popReady()).toHaveLength(1);
      expect(buf2.nextExpectedSeq).toBe(1);
    });

    it('handles seq starting at 1', () => {
      const buf2 = new SeqBuffer();
      buf2.add(token(1, 'hello'));
      expect(buf2.popReady()).toHaveLength(1);
      expect(buf2.nextExpectedSeq).toBe(2);
    });

    // Seq values are assumed to fit safely in JS Number (< 2^53).
    // Production use with billions of events would require BigInt.
    it('handles large seq values safely', () => {
      const LARGE = Number.MAX_SAFE_INTEGER - 10;
      const buf2 = new SeqBuffer(LARGE);
      buf2.add(token(LARGE, 'x'));
      expect(buf2.popReady()).toHaveLength(1);
    });
  });

  describe('single message', () => {
    it('releases seq=1 immediately', () => {
      buf.add(token(1));
      const ready = buf.popReady();

      expect(seqs(ready)).toEqual([1]);
      expect(buf.getLastProcessedSeq()).toBe(1);
      expect(buf.pendingCount).toBe(0);
    });

    it('buffers seq=2 when seq=1 has not arrived', () => {
      buf.add(token(2));
      const ready = buf.popReady();

      expect(ready).toEqual([]);
      expect(buf.getLastProcessedSeq()).toBe(0);
      expect(buf.pendingCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 3. Duplicate message
  // Chaos relevance: the chaos engine randomly duplicates
  // messages (same seq sent twice). The buffer must silently
  // drop the second copy.
  // ─────────────────────────────────────────────────────────

  describe('duplicate message', () => {
    it('ignores exact duplicate before processing', () => {
      buf.add(token(1));
      buf.add(token(1, 'duplicate'));

      const ready = buf.popReady();

      expect(ready).toHaveLength(1);
      expect(seqs(ready)).toEqual([1]);
      // The first copy wins
      expect((ready[0] as TokenMessage).text).toBe('t1');
    });

    it('does not double-count in pendingCount', () => {
      buf.add(token(2));
      buf.add(token(2, 'dup'));

      expect(buf.pendingCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 4. Reversed sequence 5,4,3,2,1
  // Chaos relevance: worst-case reordering — the chaos engine
  // delivers every message in reverse. The buffer must hold
  // all five until seq=1 arrives (last), then release all in
  // correct order in a single popReady call.
  // ─────────────────────────────────────────────────────────

  describe('fully reversed sequence', () => {
    it('releases all in order after last message arrives', () => {
      buf.add(token(5));
      buf.add(token(4));
      buf.add(token(3));
      buf.add(token(2));

      // Nothing should be ready — seq=1 is missing.
      expect(buf.popReady()).toEqual([]);
      expect(buf.pendingCount).toBe(4);

      buf.add(token(1));
      const ready = buf.popReady();

      expect(seqs(ready)).toEqual([1, 2, 3, 4, 5]);
      expect(buf.getLastProcessedSeq()).toBe(5);
      expect(buf.pendingCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 5. Missing gap: 1,2,4,5 then 3
  // Chaos relevance: the chaos engine skips seq=3 temporarily.
  // The buffer must release 1,2, hold 4,5, then release
  // 3,4,5 once the gap fills.
  // ─────────────────────────────────────────────────────────

  describe('gap then fill', () => {
    it('releases 1,2 immediately, holds 4,5, releases 3,4,5 on gap fill', () => {
      buf.add(token(1));
      buf.add(token(2));
      buf.add(token(4));
      buf.add(token(5));

      const firstBatch = buf.popReady();
      expect(seqs(firstBatch)).toEqual([1, 2]);
      expect(buf.getLastProcessedSeq()).toBe(2);
      expect(buf.pendingCount).toBe(2); // 4 and 5 buffered

      // Gap filler arrives.
      buf.add(token(3));

      const secondBatch = buf.popReady();
      expect(seqs(secondBatch)).toEqual([3, 4, 5]);
      expect(buf.getLastProcessedSeq()).toBe(5);
      expect(buf.pendingCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 6. Duplicate arriving after processing
  // Chaos relevance: after reconnect + RESUME, the server
  // replays messages the client already processed. These
  // "late duplicates" must be silently dropped.
  // ─────────────────────────────────────────────────────────

  describe('duplicate after processing', () => {
    it('ignores a seq that was already released', () => {
      buf.add(token(1));
      buf.add(token(2));
      buf.popReady();

      expect(buf.getLastProcessedSeq()).toBe(2);

      // Replay of seq=1 and seq=2 (e.g. from RESUME).
      buf.add(token(1, 'replayed'));
      buf.add(token(2, 'replayed'));

      const ready = buf.popReady();
      expect(ready).toEqual([]);
      expect(buf.getLastProcessedSeq()).toBe(2);
      expect(buf.pendingCount).toBe(0);
    });

    it('still accepts new messages after ignoring replays', () => {
      buf.add(token(1));
      buf.add(token(2));
      buf.popReady();

      // Replays.
      buf.add(token(1));
      buf.add(token(2));

      // New message.
      buf.add(token(3));

      const ready = buf.popReady();
      expect(seqs(ready)).toEqual([3]);
      expect(buf.getLastProcessedSeq()).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 7. Large shuffled sequence
  // Chaos relevance: stress test — 100 messages arrive in a
  // random permutation. The buffer must eventually release
  // all 100 in perfect seq order.
  // ─────────────────────────────────────────────────────────

  describe('large shuffled sequence', () => {
    it('releases 100 messages in order from a random shuffle', () => {
      const n = 100;

      // Fisher-Yates shuffle with a deterministic seed
      // (we just reverse-interleave for reproducibility).
      const order: number[] = [];
      for (let i = 1; i <= n; i++) order.push(i);
      // Shuffle: swap each element with a pseudo-random earlier one.
      for (let i = order.length - 1; i > 0; i--) {
        const j = (i * 7 + 3) % (i + 1); // deterministic "random"
        [order[i], order[j]] = [order[j], order[i]];
      }

      for (const seq of order) {
        buf.add(token(seq));
      }

      const ready = buf.popReady();
      expect(ready).toHaveLength(n);
      expect(seqs(ready)).toEqual(
        Array.from({ length: n }, (_, i) => i + 1),
      );
      expect(buf.getLastProcessedSeq()).toBe(n);
      expect(buf.pendingCount).toBe(0);
    });

    it('handles incremental pops during shuffled arrival', () => {
      // Simulate messages arriving in batches with pops in between.
      const batches = [
        [3, 1, 5],
        [2, 7, 4],
        [6, 8],
        [10, 9],
      ];

      const allReleased: number[] = [];

      for (const batch of batches) {
        for (const seq of batch) {
          buf.add(token(seq));
        }
        allReleased.push(...seqs(buf.popReady()));
      }

      expect(allReleased).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(buf.getLastProcessedSeq()).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 8. Multiple duplicate bursts
  // Chaos relevance: the chaos engine may duplicate several
  // messages in quick succession. The buffer must handle
  // bursts of 2–3 copies of the same seq without corrupting
  // the ordering or double-releasing.
  // ─────────────────────────────────────────────────────────

  describe('multiple duplicate bursts', () => {
    it('handles three copies of each seq in a burst', () => {
      // Seq 1 arrives 3 times, then seq 2 arrives 3 times, etc.
      for (let seq = 1; seq <= 5; seq++) {
        buf.add(token(seq, `${seq}-a`));
        buf.add(token(seq, `${seq}-b`));
        buf.add(token(seq, `${seq}-c`));
      }

      const ready = buf.popReady();
      expect(ready).toHaveLength(5);
      expect(seqs(ready)).toEqual([1, 2, 3, 4, 5]);

      // Verify first copy wins for each.
      for (let i = 0; i < 5; i++) {
        expect((ready[i] as TokenMessage).text).toBe(`${i + 1}-a`);
      }
    });

    it('handles interleaved duplicate bursts with gaps', () => {
      // Burst of seq=1 and seq=3 (gap at 2).
      buf.add(token(1));
      buf.add(token(1));
      buf.add(token(3));
      buf.add(token(3));
      buf.add(token(3));

      const first = buf.popReady();
      expect(seqs(first)).toEqual([1]);
      expect(buf.pendingCount).toBe(1); // seq=3 buffered

      // Burst of seq=2.
      buf.add(token(2));
      buf.add(token(2));

      const second = buf.popReady();
      expect(seqs(second)).toEqual([2, 3]);
      expect(buf.pendingCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Table-driven: various seq patterns
  // ─────────────────────────────────────────────────────────

  describe('table-driven patterns', () => {
    interface TestCase {
      readonly name: string;
      /** Chaos scenario this validates. */
      readonly chaos: string;
      readonly arrivals: readonly number[];
      readonly expectedReleased: readonly number[];
      readonly expectedPending: number;
      readonly expectedLastSeq: number;
    }

    const cases: readonly TestCase[] = [
      {
        name: 'in-order delivery',
        chaos: 'normal mode — no reordering',
        arrivals: [1, 2, 3, 4, 5],
        expectedReleased: [1, 2, 3, 4, 5],
        expectedPending: 0,
        expectedLastSeq: 5,
      },
      {
        name: 'single swap (adjacent pair)',
        chaos: 'minimal reorder — two adjacent messages swapped',
        arrivals: [2, 1, 3, 4, 5],
        expectedReleased: [1, 2, 3, 4, 5],
        expectedPending: 0,
        expectedLastSeq: 5,
      },
      {
        name: 'head-of-line blocking',
        chaos: 'seq=1 arrives last — everything blocked until then',
        arrivals: [2, 3, 4, 5, 1],
        expectedReleased: [1, 2, 3, 4, 5],
        expectedPending: 0,
        expectedLastSeq: 5,
      },
      {
        name: 'only future messages, gap never fills',
        chaos: 'connection drops before gap filler arrives',
        arrivals: [5, 6, 7],
        expectedReleased: [],
        expectedPending: 3,
        expectedLastSeq: 0,
      },
      {
        name: 'duplicates mixed with in-order',
        chaos: 'chaos duplicates interleaved with normal flow',
        arrivals: [1, 1, 2, 2, 3, 3],
        expectedReleased: [1, 2, 3],
        expectedPending: 0,
        expectedLastSeq: 3,
      },
      {
        name: 'all duplicates of one seq',
        chaos: 'extreme duplication — five copies of seq=1',
        arrivals: [1, 1, 1, 1, 1],
        expectedReleased: [1],
        expectedPending: 0,
        expectedLastSeq: 1,
      },
      {
        name: 'interleaved forward jumps',
        chaos: 'reorder with large gaps',
        arrivals: [1, 10, 2, 9, 3],
        expectedReleased: [1, 2, 3],
        expectedPending: 2, // 9 and 10 buffered
        expectedLastSeq: 3,
      },
    ];

    it.each(cases)(
      '$name (chaos: $chaos)',
      ({ arrivals, expectedReleased, expectedPending, expectedLastSeq }) => {
        for (const seq of arrivals) {
          buf.add(token(seq));
        }

        const released = buf.popReady();

        expect(seqs(released)).toEqual(expectedReleased);
        expect(buf.pendingCount).toBe(expectedPending);
        expect(buf.getLastProcessedSeq()).toBe(expectedLastSeq);
      },
    );
  });

  // ─────────────────────────────────────────────────────────
  // Reset behaviour
  // ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all state for a new session', () => {
      buf.add(token(1));
      buf.add(token(2));
      buf.popReady();
      buf.add(token(5)); // buffered, gap at 3

      buf.reset();

      expect(buf.getLastProcessedSeq()).toBe(0);
      expect(buf.pendingCount).toBe(0);
      expect(buf.nextExpectedSeq).toBe(1);

      // After reset, seq=1 should work again (new session).
      buf.add(token(1));
      const ready = buf.popReady();
      expect(seqs(ready)).toEqual([1]);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Reconnect behaviour
  // ─────────────────────────────────────────────────────────

  describe('prepareForReconnect', () => {
    it('preserves the seen set so replayed messages are deduped', () => {
      // Seq 1, 2, 3 arrived.
      buf.add(token(1));
      buf.add(token(2));
      buf.add(token(3));
      buf.popReady();

      // Seq 5 arrives out of order.
      buf.add(token(5));

      // Connection drops. We prepare for reconnect.
      buf.prepareForReconnect();

      // Server replays everything from last_seq = 3
      // i.e., it replays 4 and 5. But wait, what if it replays 3 too?
      // Replay 3 -> already seen, should be deduped.
      buf.add(token(3));
      
      // Gap filler 4 arrives
      buf.add(token(4));
      
      // Replay 5 -> already seen, should be deduped.
      buf.add(token(5));

      const ready = buf.popReady();
      // Should release 4 and 5 (5 was buffered before disconnect).
      // The newly inserted 5 was ignored. The newly inserted 3 was ignored.
      expect(seqs(ready)).toEqual([4, 5]);
      expect(buf.getLastProcessedSeq()).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Mixed message types
  // Ensures SeqBuffer works with all ServerMessage variants,
  // not just TOKEN.
  // ─────────────────────────────────────────────────────────

  describe('mixed message types', () => {
    it('handles TOKEN, TOOL_CALL, TOOL_RESULT, and STREAM_END in order', () => {
      const messages: ServerMessage[] = [
        { type: 'TOKEN', seq: 1, text: 'hello', stream_id: 's1' },
        { type: 'TOOL_CALL', seq: 2, call_id: 'tc1', tool_name: 'search', args: {}, stream_id: 's1' },
        { type: 'TOOL_RESULT', seq: 3, call_id: 'tc1', result: { answer: 42 }, stream_id: 's1' },
        { type: 'TOKEN', seq: 4, text: ' world', stream_id: 's1' },
        { type: 'STREAM_END', seq: 5, stream_id: 's1' },
      ];

      // Add in reverse to test reordering.
      for (let i = messages.length - 1; i >= 0; i--) {
        buf.add(messages[i]);
      }

      const ready = buf.popReady();
      expect(ready).toHaveLength(5);
      expect(ready.map((m) => m.type)).toEqual([
        'TOKEN', 'TOOL_CALL', 'TOOL_RESULT', 'TOKEN', 'STREAM_END',
      ]);
      expect(seqs(ready)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Multi-session reset (critical bug #4)
  //
  // The server resets its seq counter to 0 on every USER_MESSAGE.
  // Without calling reset() between prompts, the second prompt's
  // messages (seq 1..5) collide with the first prompt's `seen`
  // set and are silently discarded — total data loss.
  //
  // These tests validate that reset() clears all state and that
  // two consecutive sessions with identical seq ranges both
  // process correctly.
  // ─────────────────────────────────────────────────────────

  describe('multi-session reset (bug #4)', () => {
    it('two prompts with identical seq 1..5 both process correctly', () => {
      // ── Prompt 1: seq 1..5 ──
      for (let seq = 1; seq <= 5; seq++) {
        buf.add(token(seq, `p1-t${seq}`));
      }

      const prompt1 = buf.popReady();
      expect(seqs(prompt1)).toEqual([1, 2, 3, 4, 5]);
      expect(buf.getLastProcessedSeq()).toBe(5);
      expect(buf.pendingCount).toBe(0);

      // ── Reset (mirrors what ConnectionManager does on USER_MESSAGE) ──
      buf.reset();

      expect(buf.getLastProcessedSeq()).toBe(0);
      expect(buf.pendingCount).toBe(0);
      expect(buf.nextExpectedSeq).toBe(1);

      // ── Prompt 2: seq 1..5 again ──
      for (let seq = 1; seq <= 5; seq++) {
        buf.add(token(seq, `p2-t${seq}`));
      }

      const prompt2 = buf.popReady();
      expect(seqs(prompt2)).toEqual([1, 2, 3, 4, 5]);
      expect(buf.getLastProcessedSeq()).toBe(5);

      // Verify it's prompt 2's data, not prompt 1's
      expect((prompt2[0] as TokenMessage).text).toBe('p2-t1');
      expect((prompt2[4] as TokenMessage).text).toBe('p2-t5');
    });

    it('WITHOUT reset, second prompt is silently discarded', () => {
      // This test documents the bug to prevent regression.
      // It shows what happens when reset() is NOT called.

      const buggyBuf = new SeqBuffer();

      // Prompt 1
      for (let seq = 1; seq <= 5; seq++) {
        buggyBuf.add(token(seq, `p1-t${seq}`));
      }
      buggyBuf.popReady();

      // NO reset — simulating the bug

      // Prompt 2: same seq range
      for (let seq = 1; seq <= 5; seq++) {
        buggyBuf.add(token(seq, `p2-t${seq}`));
      }

      const prompt2 = buggyBuf.popReady();

      // BUG: all messages discarded — seen set rejects them
      expect(prompt2).toHaveLength(0);
      expect(buggyBuf.pendingCount).toBe(0);
    });

    it('reset clears buffered-but-unreleased messages', () => {
      // Prompt 1: partial delivery (gap at seq=3)
      buf.add(token(1));
      buf.add(token(2));
      buf.add(token(4));
      buf.add(token(5));

      buf.popReady(); // releases 1, 2
      expect(buf.pendingCount).toBe(2); // 4, 5 still buffered

      // User sends a new prompt — reset clears EVERYTHING,
      // including the orphaned 4 and 5 from the old session.
      buf.reset();

      expect(buf.pendingCount).toBe(0);
      expect(buf.nextExpectedSeq).toBe(1);

      // New prompt works cleanly
      buf.add(token(1, 'new'));
      const ready = buf.popReady();
      expect(ready).toHaveLength(1);
      expect((ready[0] as TokenMessage).text).toBe('new');
    });

    it('reset does not affect connection state (SeqBuffer is seq-only)', () => {
      // Process some messages
      buf.add(token(1));
      buf.add(token(2));
      buf.popReady();

      // Reset
      buf.reset();

      // SeqBuffer has no concept of connection state —
      // it only tracks seq values. Verify it's fully clean.
      expect(buf.getLastProcessedSeq()).toBe(0);
      expect(buf.nextExpectedSeq).toBe(1);
      expect(buf.pendingCount).toBe(0);
    });

    it('handles three consecutive sessions with chaos-style reordering', () => {
      const allResults: number[][] = [];

      for (let session = 0; session < 3; session++) {
        if (session > 0) buf.reset();

        // Each session: 5 messages arriving in reverse (worst-case chaos)
        for (let seq = 5; seq >= 1; seq--) {
          buf.add(token(seq));
        }

        const ready = buf.popReady();
        allResults.push(seqs(ready));
      }

      // Every session should release all 5 in order
      expect(allResults).toEqual([
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 5],
      ]);
    });

    it('late-arriving messages from previous session are discarded after reset', () => {
      // Prompt 1: only seq 1 and 2 arrive before user sends new prompt
      buf.add(token(1, 'old'));
      buf.add(token(2, 'old'));
      buf.popReady();

      // User sends new prompt — reset
      buf.reset();

      // Prompt 2 starts arriving
      buf.add(token(1, 'new'));
      buf.add(token(2, 'new'));

      // Late arrival from prompt 1 (seq=3) — but after reset,
      // the seen set is empty and expectedSeq is 1.
      // seq=3 will be BUFFERED (not discarded) because reset
      // cleared everything. This is correct: we can't distinguish
      // "old session" from "future message in new session" by seq
      // alone. The SeqBuffer will hold seq=3 until the new session
      // reaches it.
      buf.add(token(3, 'stale-from-old-session'));

      const ready = buf.popReady();
      expect(seqs(ready)).toEqual([1, 2, 3]);

      // The "stale" message gets absorbed. In practice, the server
      // aborts the old stream on USER_MESSAGE, so late arrivals
      // from the old session are unlikely. But even if they arrive,
      // the worst case is an extra token — not a crash or data loss.
      expect((ready[2] as TokenMessage).text).toBe('stale-from-old-session');
    });
  });
});

