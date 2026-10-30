import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createNode, pinsFor } from '../src/model/components';
import { newCircuit } from '../src/model/circuit';
import type { CircuitNode } from '../src/model/types';
import { blockGeometry, boundsFor, GRID, localPinPoint, pinAnchorFor, sizeFor, snapNodePosition } from '../src/ui/geometry';
import { wrapBlockText } from '../src/ui/block-geometry';
import { BlockSymbol } from '../src/ui/BlockSymbol';
import { GateSymbol } from '../src/ui/GateSymbol';

void test('all block pins have distinct grid-aligned connector and handle positions', () => {
	for (const type of ['sr-latch', 'd-latch', 'd-ff', 'jk-ff', 't-ff', 'custom'] as const) {
		const node = createNode(type, { x: 0, y: 0 });
		if (type.endsWith('-ff')) node.sequential = { clockEdge: 'falling', preset: { label: 'PRE', activeLow: true }, clear: { label: 'RESET', activeLow: false } };
		const size = sizeFor(node);
		const shape = blockGeometry(node);
		assert.equal(shape.width, size.width);
		assert.equal(shape.height, size.height);
		const pins = pinsFor(node);
		for (const [source, ids] of [[false, pins.inputs], [true, pins.outputs]] as const) {
			const positions = new Set<number>();
			for (const pin of ids) {
				const point = localPinPoint(node, pin);
				assert.equal(point.x, source ? size.width : 0);
				assert.equal(point.x % GRID, 0);
				assert.equal(point.y % GRID, 0);
				assert.ok(point.y > 4 && point.y < size.height - 4);
				assert.ok(!positions.has(point.y));
				positions.add(point.y);
				const anchor = pinAnchorFor(node, pin);
				assert.equal(anchor.left + (source ? anchor.width : 0), point.x);
				assert.equal(anchor.top + anchor.height / 2, point.y);
			}
		}
		const position = snapNodePosition(node, { x: 37, y: 51 });
		for (const id of [...pins.inputs, ...pins.outputs]) {
			const local = localPinPoint(node, id);
			assert.equal((position.x + local.x) % GRID, 0);
			assert.equal((position.y + local.y) % GRID, 0);
		}
	}
});

void test('long block text wraps into separate reserved columns without clipping', () => {
	const node: CircuitNode = { ...createNode('custom', { x: 16, y: 32 }), label: '輸入🔌'.repeat(60), pins: {
		inputs: [{ id: 'a', label: '長い入力'.repeat(10) }, { id: 'b', label: '' }],
		outputs: [{ id: 'y', label: 'output'.repeat(6) }],
	} };
	const shape = blockGeometry(node);
	assert.equal(shape.labelLines.join(''), node.label);
	for (const line of shape.labelLines) assert.ok(Array.from(line).length <= 12);
	for (const pin of [...shape.inputs, ...shape.outputs]) {
		assert.equal(pin.lines.join(''), node.pins![shape.inputs.includes(pin) ? 'inputs' : 'outputs'].find(item => item.id === pin.id)!.label);
		assert.ok(pin.y - pin.lines.length * 8 >= 0 && pin.y + pin.lines.length * 8 <= shape.height);
	}
	assert.ok(shape.centerLabel.left >= 32 + 8 * 14 + 12);
	assert.ok(shape.centerLabel.width >= 12 * 14);
	assert.ok(shape.centerLabel.top >= 4 && shape.centerLabel.top + shape.centerLabel.height <= shape.height - 4);
	const bounds = boundsFor({ ...newCircuit(), schemaVersion: 2, nodes: [node] });
	assert.ok(bounds.maxX >= node.position.x + shape.width);
	assert.ok(bounds.maxY >= node.position.y + shape.height);
	assert.deepEqual(wrapBlockText('A\n\n🔌B', 1), ['A', '', '🔌', 'B']);
});

void test('the center label remains geometrically centered with asymmetric pin names', () => {
	for (const [input, output] of [['Long input label', 'Y'], ['A', 'Long output label']]) {
		const node = createNode('custom', { x: 0, y: 0 }, 'Adder');
		node.pins = { inputs: [{ id: 'a', label: input! }], outputs: [{ id: 'y', label: output! }] };
		const shape = blockGeometry(node);
		assert.equal(shape.centerLabel.left + shape.centerLabel.width / 2, shape.width / 2);
		assert.equal(shape.centerLabel.top + shape.centerLabel.height / 2, shape.height / 2);
	}
});

void test('block symbols draw clock triangles, bubbles and every configured connector', () => {
	const node = createNode('d-ff', { x: 0, y: 0 });
	node.sequential = { clockEdge: 'falling', preset: { label: 'SET', activeLow: true }, clear: { label: 'RESET', activeLow: false } };
	const markup = renderToStaticMarkup(createElement(BlockSymbol, { node }));
	const shape = blockGeometry(node);
	for (const pin of [...pinsFor(node).inputs, ...pinsFor(node).outputs]) assert.ok(markup.includes(`data-circuit-connector="${pin}"`));
	const clockY = localPinPoint(node, 'clock').y;
	assert.ok(markup.includes(`M 16,${clockY - 6} L 24,${clockY} L 16,${clockY + 6}`));
	assert.ok(markup.includes(`cx="12" cy="${clockY}" r="4"`));
	assert.ok(markup.includes(`cx="${shape.width - 12}"`), 'inverted output has a bubble');
	assert.ok(markup.includes('PRE'));
	assert.ok(markup.includes('CLR'));
	assert.ok(!markup.includes('SET'), 'legacy custom control labels do not override fixed pin names');
	assert.ok(markup.includes(`viewBox="0 0 ${shape.width} ${shape.height}"`));
});

void test('gate SVG connector paths follow the same geometry for every input count', () => {
	for (const type of ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'] as const) {
		for (const inputCount of type === 'not' ? [1] : [2, 3, 8, 32]) {
			const node = { type, ...(type === 'not' ? {} : { inputCount }) };
			const markup = renderToStaticMarkup(createElement(GateSymbol, { type, node }));
			const size = sizeFor(node);
			assert.ok(markup.includes(`viewBox="0 0 ${size.width} ${size.height}"`));
			for (const pin of pinsFor(node).inputs) {
				const point = localPinPoint(node, pin);
				assert.ok(markup.includes(`data-circuit-connector="${pin}" d="M 0,${point.y} H `));
			}
			assert.ok(markup.includes(`,${size.height / 2} H 80`));
			if (type === 'nand' || type === 'nor' || type === 'xnor' || type === 'not') assert.ok(markup.includes(`cx="72" cy="${size.height / 2}" r="4"`));
		}
	}
});
