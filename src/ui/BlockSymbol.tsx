import type { MouseEventHandler } from 'react';
import type { NodeShape } from '../model/types';
import { blockGeometry } from './block-geometry';

export function BlockSymbol({ node, className, onLabelDoubleClick }: { node: NodeShape; className?: string; onLabelDoubleClick?: MouseEventHandler<SVGGElement> }) {
	const shape = blockGeometry(node);
	return <svg className={className} viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">
		<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
			<rect className="logic-symbol-body" x="16" y="4" width={shape.width - 32} height={shape.height - 8} />
			{shape.inputs.map(pin => <g key={pin.id}>
				<path data-circuit-connector={pin.id} d={`M 0,${pin.y} H ${pin.activeLow ? 8 : 16}`} />
				{pin.activeLow && <circle className="logic-symbol-body" cx="12" cy={pin.y} r="4" />}
				{pin.clock && <path d={`M 16,${pin.y - 6} L 24,${pin.y} L 16,${pin.y + 6}`} />}
			</g>)}
			{shape.outputs.map(pin => <g key={pin.id}>
				<path data-circuit-connector={pin.id} d={`M ${shape.width - (pin.activeLow ? 8 : 16)},${pin.y} H ${shape.width}`} />
				{pin.activeLow && <circle className="logic-symbol-body" cx={shape.width - 12} cy={pin.y} r="4" />}
			</g>)}
		</g>
		<g fill="currentColor" stroke="none" fontFamily="var(--font-text, var(--font-interface, system-ui, sans-serif))" fontSize="12" dominantBaseline="middle">
			{shape.inputs.map(pin => <text key={pin.id} x="32" y={pin.y} textAnchor="start">{pin.lines.map((line, index) => <tspan key={index} x="32" y={pin.y + (index - (pin.lines.length - 1) / 2) * 16}>{line}</tspan>)}</text>)}
			{shape.outputs.map(pin => <text key={pin.id} x={shape.width - 32} y={pin.y} textAnchor="end">{pin.lines.map((line, index) => <tspan key={index} x={shape.width - 32} y={pin.y + (index - (pin.lines.length - 1) / 2) * 16}>{line}</tspan>)}</text>)}
			<g className="logic-block-label" fontSize="14" onDoubleClick={onLabelDoubleClick}>
				<rect x={shape.center.x} y={shape.center.y} width={shape.center.width} height={shape.center.height} fill="transparent" />
				<text x={shape.center.x + shape.center.width / 2} y={shape.height / 2} textAnchor="middle">{shape.labelLines.map((line, index) => <tspan key={index} x={shape.center.x + shape.center.width / 2} y={shape.height / 2 + (index - (shape.labelLines.length - 1) / 2) * 16}>{line || '\u00a0'}</tspan>)}</text>
			</g>
		</g>
	</svg>;
}
