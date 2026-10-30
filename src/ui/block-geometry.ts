import { pinDefinitions } from '../model/components';
import type { NodeShape } from '../model/types';

const PIN_CHARACTER_WIDTH = 14;
const LABEL_CHARACTER_WIDTH = 14;
const LINE_HEIGHT = 16;
const LEAD = 16;
const INNER_PADDING = 16;
const LABEL_GAP = 12;

/** Compact preset labels use Latin text; retain room for wide custom control names. */
function sequentialTextWidth(text: string): number {
	return Array.from(text.replace(/[0-9#*]\uFE0F?\u20E3/g, '🔢')).reduce((width, character) => {
		if (/\p{Mark}/u.test(character)) return width;
		if (/[ilI1.,:;'!| ]/.test(character)) return width + 4;
		if (/[MWmw@#%&]/.test(character)) return width + 12;
		return width + (/^[\x20-\x7e]$/.test(character) ? 8 : 16);
	}, 0);
}

/** Deterministic code-point wrapping keeps saved layout independent of DOM measurement. */
export function wrapBlockText(text: string, capacity: number): string[] {
	return text.split('\n').flatMap(row => {
		const characters = Array.from(row);
		const result: string[] = [];
		for (let offset = 0; offset < characters.length; offset += capacity) result.push(characters.slice(offset, offset + capacity).join(''));
		return result.length ? result : [''];
	});
}

export function blockTitle(node: NodeShape): string {
	if (node.type === 'custom') return node.label ?? 'Block';
	const names: Record<string, string> = { 'sr-latch': 'SR\nlatch', 'd-latch': 'D\nlatch', 'd-ff': 'D\nFF', 'jk-ff': 'JK\nFF', 't-ff': 'T\nFF' };
	return names[node.type] ?? '';
}

/** Shared by the symbol, handles, label editor and diagram fit calculations. */
export function blockGeometry(node: NodeShape) {
	const sequential = node.type !== 'custom';
	const labelGap = sequential ? 4 : LABEL_GAP;
	const pins = pinDefinitions(node);
	const side = (items: typeof pins.inputs) => items.map(pin => {
		const lines = wrapBlockText(pin.label, 8);
		return { ...pin, lines, rowHeight: Math.ceil(Math.max(32, lines.length * LINE_HEIGHT + 8) / 16) * 16 };
	});
	const inputs = side(pins.inputs);
	const outputs = side(pins.outputs);
	const widthOf = (items: typeof inputs) => Math.max(0, ...items.flatMap(pin => pin.lines.map(line => sequential ? sequentialTextWidth(line) : Array.from(line).length * PIN_CHARACTER_WIDTH)));
	const inputWidth = widthOf(inputs);
	const outputWidth = widthOf(outputs);
	// Equal gutters keep the title at the rectangle's geometric center,
	// independently of different input and output label lengths.
	const sideWidth = Math.max(inputWidth, outputWidth);
	const labelLines = wrapBlockText(blockTitle(node), 12);
	const labelWidth = Math.max(sequential ? 24 : 64, ...labelLines.map(line => sequential ? sequentialTextWidth(line) : Array.from(line).length * LABEL_CHARACTER_WIDTH));
	const width = Math.max(sequential ? 144 : 0, Math.ceil((LEAD * 2 + INNER_PADDING * 2 + labelGap * 2 + sideWidth * 2 + labelWidth) / 16) * 16);
	const totalHeight = (items: typeof inputs) => items.reduce((height, pin) => height + pin.rowHeight, 0);
	const height = Math.ceil(Math.max(64, totalHeight(inputs), totalHeight(outputs), labelLines.length * LINE_HEIGHT + 16) / 16) * 16;
	const rows = (items: typeof inputs) => {
		let nextY = (height - totalHeight(items)) / 2;
		return items.map(pin => {
			const y = nextY + pin.rowHeight / 2;
			nextY += pin.rowHeight;
			return { ...pin, y };
		});
	};
	const centerLeft = LEAD + INNER_PADDING + sideWidth + labelGap;
	const centerRight = width - LEAD - INNER_PADDING - sideWidth - labelGap;
	const center = { x: centerLeft, y: (height - labelLines.length * LINE_HEIGHT) / 2, width: centerRight - centerLeft, height: labelLines.length * LINE_HEIGHT };
	return { width, height, inputs: rows(inputs), outputs: rows(outputs), labelLines, center,
		centerLabel: { left: center.x, top: center.y, width: center.width, height: center.height } };
}
