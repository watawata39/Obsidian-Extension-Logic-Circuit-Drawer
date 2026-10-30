import type { NodeShape } from '../model/types';
import { MIN_SCALE, MAX_SCALE } from '../model/circuit';
import { GRID, nodeSnapReference, sizeFor, snapNodePosition, type Point } from './geometry';

/** Keep the reference pin/center on the same lattice, even at the block edges. */
export function constrainNodePosition(node: NodeShape, position: Point,
	limits: { left: number; top: number; width: number }): Point {
	const size = sizeFor(node);
	const reference = nodeSnapReference(node);
	const snapped = snapNodePosition(node, position);
	const minimumX = Math.ceil((limits.left + reference.x) / GRID) * GRID - reference.x;
	const maximumX = Math.floor((limits.left + limits.width - size.width + reference.x) / GRID) * GRID - reference.x;
	const minimumY = Math.ceil((limits.top + reference.y) / GRID) * GRID - reference.y;
	return { x: Math.max(minimumX, Math.min(snapped.x, maximumX)), y: Math.max(minimumY, snapped.y) };
}

/** Fit has an exact scale; the buttons visit only whole ten-point percentages. */
export function scaleStep(scale: number, direction: -1 | 1, maximum: number): number | null {
	const percentage = scale * 100;
	const next = direction === 1 ? (Math.floor(percentage / 10 + 1e-8) + 1) * 10 : (Math.ceil(percentage / 10 - 1e-8) - 1) * 10;
	const value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next / 100));
	if (direction === 1 && (value <= scale + 1e-8 || value > maximum + 1e-8)
		|| direction === -1 && value >= scale - 1e-8) return null;
	return value;
}
