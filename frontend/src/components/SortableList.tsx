import { type ReactNode, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Reusable drag-to-reorder wrapper built on @dnd-kit. Handles the long-list
 * pain points that native HTML5 drag doesn't: auto-scroll while dragging,
 * a clear drop position, and pointer + keyboard support.
 *
 * Dragging is started from an explicit handle (not the whole row) so inner
 * controls — set-thumbnail, caption inputs, action buttons — keep working
 * normally, including text selection inside caption fields. The caller places
 * the handle by spreading the `handle` props onto whatever element it wants to
 * be the grip.
 *
 * Generic over the item type; callers render each item and get a fresh ordered
 * array back on drop. Items must expose a stable numeric `id`.
 */

export interface SortableItem {
  id: number;
}

/** Props to spread onto the caller's drag-handle element. */
export type DragHandleProps = Record<string, unknown>;

interface RenderArgs {
  /** True only for the floating drag overlay clone. */
  dragging: boolean;
  /** Spread onto the element that should start the drag (a grip button). */
  handle: DragHandleProps;
}

interface SortableListProps<T extends SortableItem> {
  items: T[];
  onReorder: (next: T[]) => void;
  /** Grid (rect) vs. vertical list ordering strategy. */
  layout: "grid" | "list";
  className?: string;
  disabled?: boolean;
  children: (item: T, args: RenderArgs) => ReactNode;
}

export function SortableList<T extends SortableItem>({
  items,
  onReorder,
  layout,
  className,
  disabled,
  children,
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === Number(active.id));
    const to = items.findIndex((i) => i.id === Number(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(items, from, to));
  }

  const activeItem = activeId != null ? items.find((i) => i.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
        disabled={disabled}
      >
        <ul className={className}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id} disabled={disabled}>
              {(handle) => children(item, { dragging: false, handle })}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>

      {/* Overlay: the lifted item follows the cursor without disturbing layout. */}
      <DragOverlay>
        {activeItem ? (
          <div className={"sortable-overlay" + (layout === "grid" ? " sortable-overlay-grid" : "")}>
            {children(activeItem, { dragging: true, handle: {} })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableRowProps {
  id: number;
  disabled?: boolean;
  children: (handle: DragHandleProps) => ReactNode;
}

/** One sortable <li>. Only the handle (via the passed props) starts a drag. */
function SortableRow({ id, disabled, children }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Hide the original in place while its overlay clone is dragged.
    opacity: isDragging ? 0 : 1,
  };

  const handle: DragHandleProps = disabled ? {} : { ...attributes, ...listeners };

  return (
    <li ref={setNodeRef} style={style}>
      {children(handle)}
    </li>
  );
}
