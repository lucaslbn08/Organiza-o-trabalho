import { useEffect, useState, type ReactNode } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners, DragOverlay, useDroppable,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../shared/types';

export interface Group { key: string; header: ReactNode; items: Task[] }

/** Contêineres ordenáveis com arrastar e soltar entre grupos (colunas Kanban ou categorias). */
export function DndGroups({ groups, layout, renderItem, onMove, disabled }: {
  groups: Group[]; layout: 'columns' | 'stack'; disabled?: boolean;
  renderItem: (t: Task) => ReactNode; onMove: (groupKey: string, orderedIds: number[]) => void;
}) {
  const [local, setLocal] = useState(groups);
  const [active, setActive] = useState<Task | null>(null);
  useEffect(() => { if (!active) setLocal(groups); }, [groups, active]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const findGroup = (id: string | number) => local.find((g) => g.key === id || g.items.some((t) => `t${t.id}` === id));

  const onStart = (e: DragStartEvent) => setActive(local.flatMap((g) => g.items).find((t) => `t${t.id}` === e.active.id) ?? null);
  const onOver = ({ active: a, over }: DragOverEvent) => {
    if (!over) return;
    const from = findGroup(a.id), to = findGroup(over.id);
    if (!from || !to || from === to) return;
    setLocal((gs) => gs.map((g) => {
      const item = from.items.find((t) => `t${t.id}` === a.id)!;
      if (g.key === from.key) return { ...g, items: g.items.filter((t) => t.id !== item.id) };
      if (g.key === to.key) {
        const idx = g.items.findIndex((t) => `t${t.id}` === over.id);
        const items = [...g.items]; items.splice(idx < 0 ? items.length : idx, 0, item);
        return { ...g, items };
      }
      return g;
    }));
  };
  const onEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    if (!over) { setLocal(groups); return; }
    const g = findGroup(a.id); if (!g) return;
    const oldI = g.items.findIndex((t) => `t${t.id}` === a.id);
    const newI = g.items.findIndex((t) => `t${t.id}` === over.id);
    const items = newI >= 0 && oldI !== newI ? arrayMove(g.items, oldI, newI) : g.items;
    setLocal((gs) => gs.map((x) => (x.key === g.key ? { ...x, items } : x)));
    onMove(g.key, items.map((t) => t.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setActive(null); setLocal(groups); }}>
      <div className={layout === 'columns' ? 'kanban' : 'groups'}>
        {local.map((g) => <Container key={g.key} g={g} renderItem={renderItem} disabled={disabled} cls={layout === 'columns' ? 'kcol' : 'group'} />)}
      </div>
      <DragOverlay>{active ? <div className="dragging">{renderItem(active)}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function Container({ g, renderItem, disabled, cls }: { g: Group; renderItem: (t: Task) => ReactNode; disabled?: boolean; cls: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: g.key });
  return (
    <section className={`${cls} ${isOver ? 'over' : ''}`}>
      {g.header}
      <SortableContext items={g.items.map((t) => `t${t.id}`)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="drop-area">
          {g.items.map((t) => <SortableItem key={t.id} id={`t${t.id}`} disabled={disabled}>{renderItem(t)}</SortableItem>)}
          {g.items.length === 0 && <div className="empty-drop">Solte aqui</div>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableItem({ id, children, disabled }: { id: string; children: ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }} {...attributes} {...listeners}>{children}</div>;
}
