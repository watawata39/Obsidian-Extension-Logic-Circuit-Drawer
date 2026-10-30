import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { pinsFor } from '../model/circuit';
import { isBlockType, pinDefinitions } from '../model/components';
import type { CircuitNode } from '../model/types';
import { GateSymbol } from './GateSymbol';
import { blockGeometry, pinAnchorFor, pinHitSize, sizeFor, terminalGeometry, TERMINAL_PIN_OFFSET, TERMINAL_RADIUS } from './geometry';
import { useDiagram } from './context';
import { JUNCTION_SIDES } from './junction-connections';
import { useAccessibleLabel } from './accessibility';
import { BlockSymbol } from './BlockSymbol';
import { LabelEditor } from './LabelEditor';

export type FlowNode = Node<{ model: CircuitNode }, 'circuit'>;

export function CircuitObject({ data, selected }: NodeProps<FlowNode>) {
	const { editing, scale, label } = useDiagram();
	const node = data.model;
	const size = sizeFor(node);
	const pins = pinsFor(node);
	const definitions = pinDefinitions(node);
	const updateInternals = useUpdateNodeInternals();
	useLayoutEffect(() => { updateInternals(node.id); }, [updateInternals, node.id, node.type, node.inputCount, node.pins, node.sequential, node.label]);
	const [labelEditing, setLabelEditing] = useState(false);
	const [draft, setDraft] = useState(node.label ?? '');
	const cancelled = useRef(false);
	useEffect(() => { if (!editing) { cancelled.current = true; setLabelEditing(false); } }, [editing]);
	const terminal = node.type === 'input' || node.type === 'output';
	const name = useAccessibleLabel(terminal || node.type === 'custom' ? `${node.type}: ${node.label ?? ''}` : node.type.toUpperCase());
	const pinLabels = useId();
	const terminalSize = terminalGeometry(node.label);
	const startLabel = (event: MouseEvent) => {
		if (!editing) return;
		event.stopPropagation(); cancelled.current = false; setDraft(node.label ?? ''); setLabelEditing(true);
	};
	const confirmLabel = () => {
		if (editing && !cancelled.current && draft !== node.label) label(node, draft);
		cancelled.current = true;
		setLabelEditing(false);
	};
	const labelEditor = <LabelEditor type={node.type} draft={draft} change={setDraft} confirm={confirmLabel} cancel={() => { cancelled.current = true; setLabelEditing(false); }} />;
	return <div className={`logic-object logic-object-${node.type}${selected && editing ? ' is-selected' : ''}`} role="group" style={{ width: size.width, height: size.height }} aria-labelledby={name.id}>
		{name.label}
		{node.type === 'junction' ? <span className="logic-junction-dot" />
			: terminal ? <><div className="logic-terminal-body" style={{ top: terminalSize.labelTop, height: terminalSize.labelHeight }} onDoubleClick={startLabel}>
				{editing && labelEditing ? labelEditor : <span className="logic-terminal-label">{node.label || '\u00a0'}</span>}
			</div><svg className="logic-terminal-marker" viewBox={`0 0 ${size.width} 16`} style={{ position: 'absolute', top: terminalSize.markerTop, left: 0, width: size.width, height: 16 }} aria-hidden="true">
				<g fill="none" stroke="currentColor" strokeWidth="1.6">
					<path data-circuit-connector={node.type === 'input' ? 'out' : 'in-1'} d={node.type === 'input'
						? `M ${terminalSize.markerX + TERMINAL_RADIUS},8 H ${terminalSize.markerX + TERMINAL_PIN_OFFSET}`
						: `M ${terminalSize.markerX - TERMINAL_PIN_OFFSET},8 H ${terminalSize.markerX - TERMINAL_RADIUS}`} />
					<circle className="logic-symbol-body" cx={terminalSize.markerX} cy="8" r={TERMINAL_RADIUS} />
				</g>
			</svg></> : isBlockType(node.type) ? <>
				<BlockSymbol node={node} className="logic-gate-symbol" onLabelDoubleClick={node.type === 'custom' ? startLabel : undefined} />
				{node.type === 'custom' && editing && labelEditing && <div className="logic-block-label-editor" style={blockGeometry(node).centerLabel}>{labelEditor}</div>}
			</> : <GateSymbol type={node.type} node={node} className="logic-gate-symbol" />}
		{node.type === 'junction' ? <JunctionHandles node={node} editing={editing} scale={scale} /> : (['input', 'output'] as const).flatMap(direction => (direction === 'input' ? pins.inputs : pins.outputs).map((pin, index) => {
			const anchor = pinAnchorFor(node, pin);
			// Flow wires attach to the handle's outside edge. Keep a tiny measured
			// anchor at that exact connector and a separate centered CSS hit area.
			return <Handle key={pin} id={pin} type={direction === 'input' ? 'target' : 'source'} position={direction === 'input' ? Position.Left : Position.Right} className={`logic-pin${editing ? '' : ' is-hidden'}`} isConnectable={editing && !labelEditing} data-circuit-node={node.id} data-circuit-pin={pin} data-circuit-direction={direction} aria-labelledby={`${pinLabels}-${direction}-${index}`} style={{ top: anchor.top, left: anchor.left, right: 'auto', width: anchor.width, height: anchor.height, minWidth: 0, minHeight: 0, transform: 'none', '--logic-pin-hit-size': `${pinHitSize(scale)}px`, '--logic-pin-marker-x': `${anchor.markerX}px`, '--logic-pin-marker-y': `${anchor.markerY}px` } as CSSProperties}><span className="logic-sr-only" id={`${pinLabels}-${direction}-${index}`}>{`${node.type} ${direction} ${[...definitions.inputs, ...definitions.outputs].find(item => item.id === pin)?.label || pin}`}</span></Handle>;
		}))}
	</div>;
}

/** Four editor targets surround the dot while its center remains draggable. */
function JunctionHandles({ node, editing, scale }: { node: CircuitNode; editing: boolean; scale: number }) {
	const labels = useId();
	const hitSize = pinHitSize(scale);
	const distance = Math.max(16, hitSize / 2 + 8);
	const anchors = {
		top: { x: 8, y: 8 - distance, position: Position.Top },
		right: { x: 8 + distance, y: 8, position: Position.Right },
		bottom: { x: 8, y: 8 + distance, position: Position.Bottom },
		left: { x: 8 - distance, y: 8, position: Position.Left },
	};
	return JUNCTION_SIDES.map(side => {
		const anchor = anchors[side];
		const pin = `junction-${side}`;
		return <Handle key={pin} id={pin} type="source" position={anchor.position} className={`logic-pin logic-junction-pin${editing ? '' : ' is-hidden'}`} isConnectable={editing} data-circuit-node={node.id} data-circuit-pin={pin} data-circuit-direction="junction" data-circuit-side={side} aria-labelledby={`${labels}-${side}`} style={{ top: anchor.y - 1, left: anchor.x - 1, right: 'auto', width: 2, height: 2, minWidth: 0, minHeight: 0, transform: 'none', '--logic-pin-hit-size': `${hitSize}px`, '--logic-pin-marker-x': '1px', '--logic-pin-marker-y': '1px' } as CSSProperties}><span className="logic-sr-only" id={`${labels}-${side}`}>{`Junction ${side} connection`}</span></Handle>;
	});
}
