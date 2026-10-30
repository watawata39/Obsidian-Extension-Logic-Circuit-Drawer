import { pinsFor } from '../model/circuit';
import type { CircuitData, CircuitNode } from '../model/types';
import { pinPoint, routedWirePoints, type Point } from './geometry';

export const JUNCTION_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type JunctionSide = typeof JUNCTION_SIDES[number];

function flowHandle(node: CircuitNode, pin: string, other: CircuitNode, otherPin: string): string {
	if (node.type !== 'junction') return pin;
	const point = pinPoint(node, pin);
	const neighbor = pinPoint(other, otherPin);
	const dx = neighbor.x - point.x;
	const dy = neighbor.y - point.y;
	const side = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
	return `junction-${side}`;
}

export function flowHandlesFor(source: CircuitNode, sourcePin: string, target: CircuitNode, targetPin: string) {
	return { sourceHandle: flowHandle(source, sourcePin, target, targetPin), targetHandle: flowHandle(target, targetPin, source, sourcePin) };
}

/** Reverse gestures still route with an outgoing side and an incoming side. */
export function connectionPreviewPoints(fromNode: CircuitNode, fromPin: string, toNode: CircuitNode | null | undefined, toPin: string | null | undefined, from: Point, to: Point): Point[] {
	const reverse = fromNode.type === 'junction'
		? Boolean(toNode && toNode.type !== 'junction' && pinsFor(toNode).outputs.includes(toPin ?? ''))
		: pinsFor(fromNode).inputs.includes(fromPin);
	return reverse ? routedWirePoints(to, from, toNode?.type, fromNode.type).reverse() : routedWirePoints(from, to, fromNode.type, toNode?.type);
}

/** Cardinal handles are an editor detail, never part of the saved circuit. */
export function logicalJunctionPin(circuit: CircuitData, nodeId: string, pin: string, role: 'source' | 'target'): string {
	return circuit.nodes.find(node => node.id === nodeId)?.type === 'junction' && pin.startsWith('junction-')
		? role === 'source' ? 'out' : 'in-1'
		: pin;
}

export function normalizeFlowConnection(circuit: CircuitData, connection: {
	source: string;
	sourceHandle?: string | null;
	target: string;
	targetHandle?: string | null;
}) {
	const source = circuit.nodes.find(node => node.id === connection.source);
	const target = circuit.nodes.find(node => node.id === connection.target);
	let sourcePinId = logicalJunctionPin(circuit, connection.source, connection.sourceHandle ?? '', 'source');
	let targetPinId = logicalJunctionPin(circuit, connection.target, connection.targetHandle ?? '', 'target');
	if (source?.type === 'junction' && target && target.type !== 'junction') {
		sourcePinId = pinsFor(target).outputs.includes(targetPinId) ? 'in-1' : 'out';
	}
	if (target?.type === 'junction' && source && source.type !== 'junction') {
		targetPinId = pinsFor(source).inputs.includes(sourcePinId) ? 'out' : 'in-1';
	}
	return { sourceNodeId: connection.source, sourcePinId, targetNodeId: connection.target, targetPinId };
}
