import { useInternalNode, type Edge, type EdgeProps } from '@xyflow/react';
import { useId, type PointerEvent } from 'react';
import { useDiagram } from './context';
import { localPinPoint, nearestOnWire, pathFor, routedWirePoints } from './geometry';
import { eventElement } from './dom';
import type { FlowNode } from './CircuitNode';

export type FlowEdge = Edge<Record<string, never>, 'wire'>;

export function CircuitWire({ id, source, target, sourceHandleId, targetHandleId, sourceX, sourceY, targetX, targetY, selected }: EdgeProps<FlowEdge>) {
	const interaction = useDiagram();
	const branchLabelId = useId();
	const sourceNode = useInternalNode<FlowNode>(source);
	const targetNode = useInternalNode<FlowNode>(target);
	// The SVG connectors have model-defined endpoints. Use Flow's current node
	// positions so wires remain attached during dragging without relying on host
	// CSS or DOM handle measurements for their geometry.
	const start = sourceNode && sourceHandleId ? localPinPoint(sourceNode.data.model, sourceHandleId) : null;
	const end = targetNode && targetHandleId ? localPinPoint(targetNode.data.model, targetHandleId) : null;
	const points = interaction.wireRoutes.get(id) ?? routedWirePoints(
		start && sourceNode ? { x: sourceNode.internals.positionAbsolute.x + start.x, y: sourceNode.internals.positionAbsolute.y + start.y } : { x: sourceX, y: sourceY },
		end && targetNode ? { x: targetNode.internals.positionAbsolute.x + end.x, y: targetNode.internals.positionAbsolute.y + end.y } : { x: targetX, y: targetY },
		sourceNode?.data.model.type, targetNode?.data.model.type,
	);
	const path = pathFor(points);
	const hovered = interaction.hovered?.edgeId === id ? interaction.hovered.point : null;
	const leave = (event: PointerEvent<SVGElement>) => {
		const related = eventElement(event.relatedTarget)?.closest('[data-circuit-edge]');
		if (!interaction.connecting && related?.getAttribute('data-circuit-edge') !== id) interaction.hoverWire(id, null);
	};
	return <g className={`logic-wire${selected && interaction.editing ? ' is-selected' : ''}${interaction.editing && hovered && interaction.connecting ? ' is-branch-target' : ''}`} onClick={event => {
		if (!interaction.editing) return;
		event.preventDefault(); event.stopPropagation();
		interaction.selectWire(id, event.shiftKey);
	}} onDoubleClick={event => {
		if (!interaction.editing) return;
		event.preventDefault(); event.stopPropagation();
		interaction.insertJunction(id, nearestOnWire(points, interaction.toPoint({ x: event.clientX, y: event.clientY })));
	}}>
		{interaction.editing && <title id={branchLabelId}>Branch wire</title>}
		<path d={path} className="react-flow__edge-path" vectorEffect="non-scaling-stroke" />
		<path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(18, 18 / interaction.scale)} className="react-flow__edge-interaction" data-circuit-edge={id} onPointerMove={event => {
			if (interaction.editing) interaction.hoverWire(id, nearestOnWire(points, interaction.toPoint({ x: event.clientX, y: event.clientY })));
		}} onPointerLeave={leave} />
		{interaction.editing && hovered && <circle className={`logic-branch-handle${interaction.connecting ? ' is-target' : ''}`} cx={hovered.x} cy={hovered.y} r={Math.max(5, 7 / interaction.scale)} data-circuit-edge={id} aria-labelledby={branchLabelId} onPointerDown={event => interaction.startBranch(id, hovered, event)} onPointerLeave={leave} />}
	</g>;
}
