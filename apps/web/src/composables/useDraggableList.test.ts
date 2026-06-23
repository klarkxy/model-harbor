import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useDraggableList } from './useDraggableList.js';

function dragEvent(type: string, init: Partial<DragEvent> = {}) {
  return {
    type,
    preventDefault: vi.fn(),
    dataTransfer: {},
    clientY: 0,
    currentTarget: {
      getBoundingClientRect: () => ({ top: 0, height: 20 }),
    },
    ...init,
  } as unknown as DragEvent;
}

describe('useDraggableList', () => {
  it('optimistically reorders items and reports previous and next snapshots', async () => {
    const items = ref(['a', 'b', 'c']);
    const onReorder = vi.fn();
    const drag = useDraggableList(items, onReorder);

    drag.startDrag(2);
    const targetProps = drag.rowProps(0);
    (targetProps.onDragover as (event: DragEvent) => void)(
      dragEvent('dragover', { clientY: 5 }),
    );
    (targetProps.onDrop as (event: DragEvent) => void)(dragEvent('drop'));
    await nextTick();

    expect(items.value).toEqual(['c', 'a', 'b']);
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'], ['a', 'b', 'c']);
    expect(drag.draggingIndex.value).toBeNull();
  });

  it('collapses drops during an in-flight save to the latest pending order', async () => {
    const items = ref(['a', 'b', 'c']);
    let resolveSave: (() => void) | undefined;
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const drag = useDraggableList(items, onReorder);

    drag.startDrag(2);
    (drag.rowProps(0).onDragover as (event: DragEvent) => void)(dragEvent('dragover'));
    (drag.rowProps(0).onDrop as (event: DragEvent) => void)(dragEvent('drop'));
    expect(items.value).toEqual(['c', 'a', 'b']);
    expect(onReorder).toHaveBeenCalledTimes(1);

    drag.startDrag(2);
    (drag.rowProps(0).onDragover as (event: DragEvent) => void)(dragEvent('dragover'));
    (drag.rowProps(0).onDrop as (event: DragEvent) => void)(dragEvent('drop'));
    expect(items.value).toEqual(['b', 'c', 'a']);
    expect(onReorder).toHaveBeenCalledTimes(1);

    resolveSave?.();
    await nextTick();
    await nextTick();

    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(onReorder).toHaveBeenLastCalledWith(['b', 'c', 'a'], ['c', 'a', 'b']);
  });
});
