import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CircuitData } from '../model/types';
import { branchEdge } from '../model/circuit';
import type { Point } from './geometry';
import { logicalJunctionPin } from './junction-connections';

export interface BranchDrag { edgeId: string; origin: Point; pointer: Point }
interface BranchGesture extends BranchDrag {
	clientOrigin: Point;
	pointerId: number;
	dragging: boolean;
}
const DRAG_THRESHOLD = 3;

export function useBranching(options: {
	circuit: CircuitData;
	editing: boolean;
	toPoint: (point: Point) => Point;
	commit: (circuit: CircuitData) => void;
	onDragStart: () => void;
	error: (message: string) => void;
}) {
	const latest = useRef(options);
	latest.current = options;
	const [branch, setBranch] = useState<BranchDrag | null>(null);
	const gesture = useRef<BranchGesture | null>(null);
	const cleanup = useRef<(() => void) | null>(null);
	const cancel = useCallback(() => {
		cleanup.current?.(); cleanup.current = null;
		gesture.current = null; setBranch(null);
	}, []);
	const start = useCallback((edgeId: string, point: Point, event: ReactPointerEvent) => {
		if (!latest.current.editing || event.button !== 0) return;
		event.preventDefault(); event.stopPropagation();
		cancel();
		const document = event.currentTarget.ownerDocument;
		const window = document.defaultView;
		if (!window) return;
		gesture.current = { edgeId, origin: point, pointer: point, clientOrigin: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId, dragging: false };
		const move = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || current.pointerId !== event.pointerId) return;
			if (!current.dragging && Math.hypot(event.clientX - current.clientOrigin.x, event.clientY - current.clientOrigin.y) < DRAG_THRESHOLD) return;
			if (!current.dragging) latest.current.onDragStart();
			const next = { ...current, dragging: true, pointer: latest.current.toPoint({ x: event.clientX, y: event.clientY }) };
			gesture.current = next; setBranch(next);
		};
		const finish = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || current.pointerId !== event.pointerId) return;
			// A click keeps the hover circle mounted until its native click event.
			// CircuitWire then selects the wire once, including Shift toggling.
			if (current.dragging) {
				const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-circuit-pin]');
				const nodeId = element?.dataset.circuitNode;
				const pin = element?.dataset.circuitPin;
				if (nodeId && pin) {
					try {
						latest.current.commit(branchEdge(latest.current.circuit, current.edgeId, { x: current.origin.x - 8, y: current.origin.y - 8 }, nodeId, logicalJunctionPin(latest.current.circuit, nodeId, pin, 'target')));
					} catch (error) { latest.current.error(error instanceof Error ? error.message : 'Could not create a branch.'); }
				}
			}
			cancel();
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('blur', cancel);
		cleanup.current = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			window.removeEventListener('blur', cancel);
		};
	}, [cancel]);
	useEffect(() => { if (!options.editing) cancel(); }, [options.editing, cancel]);
	useEffect(() => () => { cleanup.current?.(); gesture.current = null; }, []);
	return { branch, start, cancel };
}
