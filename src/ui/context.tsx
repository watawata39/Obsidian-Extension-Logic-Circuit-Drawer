import { createContext, useContext, type PointerEvent } from 'react';
import type { CircuitNode } from '../model/types';
import type { Point } from './geometry';

export interface DiagramInteractions {
	editing: boolean;
	scale: number;
	wireRoutes: ReadonlyMap<string, Point[]>;
	connecting: boolean;
	hovered: { edgeId: string; point: Point } | null;
	toPoint: (point: { x: number; y: number }) => Point;
	hoverWire: (edgeId: string, point: Point | null) => void;
	startBranch: (edgeId: string, point: Point, event: PointerEvent) => void;
	insertJunction: (edgeId: string, point: Point) => void;
	selectWire: (edgeId: string, additive: boolean) => void;
	label: (node: CircuitNode, value: string) => void;
}

export const DiagramContext = createContext<DiagramInteractions | null>(null);
export function useDiagram(): DiagramInteractions {
	const value = useContext(DiagramContext);
	if (!value) throw new Error('Circuit interaction context is unavailable.');
	return value;
}
