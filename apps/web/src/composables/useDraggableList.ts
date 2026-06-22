import { reactive, ref, type Ref } from 'vue';

/**
 * Drag-and-drop reorder helper shared by UpstreamKeys / PublicModels /
 * ModelGroups. Each of those pages previously inlined the same handlers
 * with hardcoded greys; this composable centralises the logic and the
 * classes it emits (`.drag-dragging`, `.drag-drop-before`, `.drag-drop-after`)
 * are styled in `App.vue` against Naive UI CSS variables, so dark mode and
 * theme colour follow automatically.
 *
 * Usage:
 *   const items = ref<T[]>([...]);
 *   const drag = useDraggableList(items, (next) => api.saveOrder(next));
 *   // in template:
 *   // <tr v-for="(row, i) in items" v-bind="drag.rowProps(i)"
 *   //     :class="{ 'drag-dragging': drag.draggingIndex === i, ... }">
 */
export interface DragState {
  draggingIndex: number | null;
  dragOverIndex: number | null;
  dragOverPosition: 'before' | 'after';
  /**
   * True while a previously-triggered `onReorder` is still awaiting the
   * consumer's promise. Consumers may use this to render a disabled state
   * or to skip additional user input until persistence settles.
   *
   * Exposed as a `Ref<boolean>` so consumers stay reactive in templates
   * (Vue auto-unwraps refs at the template boundary). Inside `setup()`,
   * read `drag.inFlight.value` to observe changes.
   */
  inFlight: Ref<boolean>;
  /**
   * Mark the given row as the drag source. Call this from the drag handle's
   * `onDragstart` handler. Mutating the returned object's `draggingIndex`
   * property directly does NOT work, because `...state` in the return shape
   * spreads a plain-object snapshot that loses the reactive link to the
   * composable's internal `state` proxy. Always go through this method.
   */
  startDrag: (idx: number) => void;
  rowProps: (idx: number) => Record<string, unknown>;
  clear: () => void;
}

export function useDraggableList<T>(
  items: Ref<T[]>,
  onReorder: (next: T[], previous: T[]) => void | Promise<void>,
  opts: { prefix?: string } = {},
): DragState {
  const prefix = opts.prefix ?? 'drag';
  // reactive object so consumers can read `drag.draggingIndex` directly in
  // templates without unwrapping `.value`.
  const state = reactive<{
    draggingIndex: number | null;
    dragOverIndex: number | null;
    dragOverPosition: 'before' | 'after';
  }>({
    draggingIndex: null,
    dragOverIndex: null,
    dragOverPosition: 'before',
  });

  /**
   * Guard against stacking reorder requests. Instead of dropping subsequent
   * drops while a save is in flight (which made the table feel "locked"), we
   * remember the latest pending commit and replay it as soon as the in-flight
   * one settles. If the user drags several times in a row, the intermediate
   * orderings are subsumed by the latest one — only the final commit is sent.
   * This keeps the UI snappy without the dropped-commit footgun (a dropped
   * commit leaves the table out of sync with the server until the next
   * reload).
   */
  const inFlight = ref(false);
  let pendingCommit: { copy: T[]; previous: T[] } | null = null;

  function clear(): void {
    state.draggingIndex = null;
    state.dragOverIndex = null;
    state.dragOverPosition = 'before';
  }

  function startDrag(idx: number): void {
    state.draggingIndex = idx;
  }

  function dispatchCommit(): void {
    if (inFlight.value || !pendingCommit) return;
    const next = pendingCommit;
    pendingCommit = null;
    inFlight.value = true;
    void Promise.resolve(onReorder(next.copy, next.previous))
      .catch(() => {
        // If the consumer's onReorder rejected after already mutating
        // `items` itself, nothing to do. If it didn't, the consumer is
        // expected to roll back; we still leave `items` as the optimistic
        // value so the UI stays consistent with the caller's intent.
      })
      .finally(() => {
        inFlight.value = false;
        // Drain any drop that arrived while we were saving so the table
        // doesn't drift away from the server's authoritative state.
        if (pendingCommit) dispatchCommit();
      });
  }

  function commit(from: number, to: number, pos: 'before' | 'after'): void {
    if (from === to) {
      clear();
      return;
    }
    // Capture the snapshot BEFORE mutating `items` so consumers can roll
    // back to the exact pre-commit state on failure. The snapshot is the
    // *current* `items` value, which already reflects any earlier in-flight
    // optimistic update — that's fine because rollback only matters relative
    // to what the user is seeing right now.
    const previous = items.value.slice();
    const copy = [...items.value];
    const [moved] = copy.splice(from, 1);
    if (moved === undefined) {
      clear();
      return;
    }
    // Adjust insertion index when moving down — the removed slot shifts later targets.
    let insertAt = to + (pos === 'after' ? 1 : 0);
    if (from < insertAt) insertAt -= 1;
    insertAt = Math.max(0, Math.min(copy.length, insertAt));
    copy.splice(insertAt, 0, moved);
    items.value = copy;
    // Overwrite any earlier queued commit so consecutive drags collapse to
    // the latest order rather than replaying stale intermediate ones.
    pendingCommit = { copy, previous };
    dispatchCommit();
    clear();
  }

  function rowProps(idx: number): Record<string, unknown> {
    const classes: string[] = [];
    if (state.draggingIndex === idx) classes.push(`${prefix}-dragging`);
    if (state.dragOverIndex === idx) classes.push(`${prefix}-drop-${state.dragOverPosition}`);
    return {
      // Note: we intentionally do NOT set `draggable: true` on the row itself —
      // a dedicated handle element (see <DragHandle />) owns the dragstart.
      // The row only receives over/drop to support the visual indicator and
      // commit the reorder.
      class: classes,
      onDragover: (e: DragEvent) => {
        if (state.draggingIndex === null) return;
        // Skip the source row itself — drawing the drop indicator over the
        // row the user is dragging from makes the target ambiguous and
        // creates the illusion of the row being pushed by the indicator.
        if (state.draggingIndex === idx) {
          state.dragOverIndex = null;
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const target = e.currentTarget as HTMLElement | null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        state.dragOverIndex = idx;
        state.dragOverPosition =
          e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (state.draggingIndex === null) return;
        commit(state.draggingIndex, idx, state.dragOverPosition);
      },
      onDragend: clear,
    };
  }

  return {
    ...state,
    inFlight,
    startDrag,
    rowProps,
    clear,
  };
}
