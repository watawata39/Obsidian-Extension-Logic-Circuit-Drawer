import type { CircuitData, CircuitNode, NodeShape, NodeType } from '../model/types';
import { isBlockType, pinsFor } from '../model/components';
import { blockGeometry } from './block-geometry';
export { blockGeometry } from './block-geometry';
import { routesForCircuit, routedWirePoints } from './wire-routing';
export { wirePoints, routedWirePoints } from './wire-routing';

export const GRID = 8;
export const PADDING = 16;
export const GATE_WIDTH = 80;
export const GATE_HEIGHT = 64;
export const TERMINAL_RADIUS = 4;
export const TERMINAL_PIN_OFFSET = 16;
export const PIN_ANCHOR_SIZE = 2;
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** The label occupies the top of the terminal; its small marker sits below it. */
export function terminalGeometry(label = '') {
	const rows = label.split('\n');
	const length = Math.max(...rows.map(row => Array.from(row).length));
	// A width of whole pairs of grid cells puts the centered marker on the
	// same lattice as gate connectors, even when labels have different widths.
	const width = Math.min(192, Math.max(64, Math.ceil((length * 9 + 16) / (GRID * 2)) * GRID * 2));
	// Use code points rather than UTF-16 length and reserve space for wide glyphs.
	const capacity = Math.max(1, Math.floor((width - 8) / 14));
	const lines = rows.reduce((total, row) => total + Math.max(1, Math.ceil(Array.from(row).length / capacity)), 0);
	const labelHeight = lines * 19;
	const markerY = Math.ceil((labelHeight + 12) / GRID) * GRID;
	// Keep the label close to the dot without moving the grid-aligned connector.
	const labelTop = markerY - TERMINAL_RADIUS - 5 - labelHeight;
	return { width, height: markerY + 8, labelHeight, labelTop, markerTop: markerY - 8, markerY, markerX: width / 2 };
}

export function sizeFor(node: NodeShape): Size {
	if (node.type === 'junction') return { width: 16, height: 16 };
	if (isBlockType(node.type)) { const { width, height } = blockGeometry(node); return { width, height }; }
	if (node.type !== 'input' && node.type !== 'output') return { width: GATE_WIDTH, height: node.type === 'not' ? GATE_HEIGHT : pinsFor(node).inputs.length * 32 };
	const { width, height } = terminalGeometry(node.label);
	return { width, height };
}

/** One definition for SVG connector ends, Flow handles, routing and fit bounds. */
export function localPinPoint(node: NodeShape, pin: string): Point {
	const size = sizeFor(node);
	if (node.type === 'junction') return { x: 8, y: 8 };
	if (node.type === 'input' || node.type === 'output') {
		const geometry = terminalGeometry(node.label);
		return { x: geometry.markerX + (pin === 'out' ? TERMINAL_PIN_OFFSET : -TERMINAL_PIN_OFFSET), y: geometry.markerY };
	}
	const pins = pinsFor(node);
	const source = pins.outputs.includes(pin);
	if (isBlockType(node.type)) {
		const geometry = blockGeometry(node);
		const row = (source ? geometry.outputs : geometry.inputs).find(item => item.id === pin);
		return { x: source ? size.width : 0, y: row?.y ?? size.height / 2 };
	}
	return { x: source ? size.width : 0, y: source || node.type === 'not' ? size.height / 2 : 16 + Math.max(0, pins.inputs.indexOf(pin)) * 32 };
}

export function pinPoint(node: CircuitNode, pin: string): Point {
	const local = localPinPoint(node, pin);
	return { x: node.position.x + local.x, y: node.position.y + local.y };
}

export function pinHitSize(scale: number): number { return Math.max(16, Math.min(32, 18 / scale)); }

/** Flow attaches at the handle's left/right side, independently of its hit area. */
export function pinAnchorFor(node: NodeShape, pin: string) {
	const point = localPinPoint(node, pin);
	const source = pinsFor(node).outputs.includes(pin);
	return {
		left: point.x - (source ? PIN_ANCHOR_SIZE : 0),
		top: point.y - PIN_ANCHOR_SIZE / 2,
		width: PIN_ANCHOR_SIZE,
		height: PIN_ANCHOR_SIZE,
		markerX: source ? PIN_ANCHOR_SIZE : 0,
		markerY: PIN_ANCHOR_SIZE / 2,
	};
}

export function edgeWirePoints(source: CircuitNode, sourcePin: string, target: CircuitNode, targetPin: string): Point[] {
	return routedWirePoints(pinPoint(source, sourcePin), pinPoint(target, targetPin), source.type, target.type);
}

export function wireRoutesFor(circuit: CircuitData): Map<string, Point[]> {
	return routesForCircuit(circuit, pinPoint);
}

export function pathFor(points: Point[]): string {
	return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x},${point.y}`).join(' ');
}

/** Snap along a segment while keeping the proposed branch exactly on its wire. */
export function nearestOnWire(points: Point[], point: Point): Point {
	let closest = points[0] ?? point;
	let distance = Infinity;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1];
		const b = points[index];
		if (!a || !b) continue;
		const horizontal = a.y === b.y;
		const candidate = horizontal
			? { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snap(point.x))), y: a.y }
			: { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snap(point.y))) };
		const nextDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
		if (nextDistance < distance) { closest = candidate; distance = nextDistance; }
	}
	return closest;
}

export function boundsFor(circuit: CircuitData) {
	const wireRoutes = wireRoutesFor(circuit);
	if (!circuit.nodes.length) return { minX: 0, minY: 0, maxX: 480, maxY: 96, width: 480, height: 96, wireRoutes };
	const points: Point[] = [];
	for (const node of circuit.nodes) {
		const size = sizeFor(node);
		points.push({ x: node.position.x, y: node.position.y }, { x: node.position.x + size.width, y: node.position.y + size.height });
	}
	for (const route of wireRoutes.values()) points.push(...route);
	const minX = Math.min(0, ...points.map(point => point.x));
	const minY = Math.min(...points.map(point => point.y));
	const maxX = Math.max(...points.map(point => point.x));
	const maxY = Math.max(...points.map(point => point.y));
	return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), wireRoutes };
}

export function snap(value: number): number { return Math.round(value / GRID) * GRID; }

/** Snap the electrical reference point, rather than a label's outer bounds. */
export function nodeSnapReference(node: NodeShape): Point {
	if (node.type === 'junction') return { x: 8, y: 8 };
	if (node.type === 'input' || node.type === 'output') {
		const geometry = terminalGeometry(node.label);
		return { x: geometry.markerX, y: geometry.markerY };
	}
	const size = sizeFor(node);
	return { x: size.width / 2, y: size.height / 2 };
}

export function snapNodePosition(node: NodeShape, position: Point): Point {
	const reference = nodeSnapReference(node);
	return { x: snap(position.x + reference.x) - reference.x, y: snap(position.y + reference.y) - reference.y };
}

export function terminalLabel(circuit: CircuitData, type: NodeType): string | undefined {
	if (type !== 'input' && type !== 'output') return undefined;
	const used = new Set(circuit.nodes.filter(node => node.type === type).map(node => node.label));
	const choices = type === 'input' ? 'ABCDEFGHIJKLMNOPQRSTUVWX' : 'YZ';
	for (const letter of choices) if (!used.has(letter)) return letter;
	for (let index = 1; ; index++) {
		const label = `${type === 'input' ? 'A' : 'Y'}${index}`;
		if (!used.has(label)) return label;
	}
}
