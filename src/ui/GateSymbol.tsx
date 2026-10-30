import { pinsFor } from '../model/components';
import type { NodeShape, NodeType } from '../model/types';
import { GATE_WIDTH, sizeFor } from './geometry';

export function GateSymbol({ type, node = { type }, className }: { type: NodeType; node?: NodeShape; className?: string }) {
	const inverted = type === 'nand' || type === 'nor' || type === 'xnor' || type === 'not';
	const or = type === 'or' || type === 'nor' || type === 'xor' || type === 'xnor';
	const xor = type === 'xor' || type === 'xnor';
	const { height } = sizeFor(node);
	const middle = height / 2;
	const bottom = height - 4;
	const tip = 68;
	const inputs = pinsFor(node).inputs;
	return <svg className={className} viewBox={`0 0 ${GATE_WIDTH} ${height}`} aria-hidden="true">
		<g className="logic-symbol-lines" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
			{inputs.map((pin, index) => {
				const y = type === 'not' ? middle : 16 + index * 32;
				// Concave OR and XOR curves are quadratic: solve y for t,
				// then intersect the lead with the unchanged-width body curve.
				const t = (y - 4) / (height - 8);
				const inputEnd = or ? 12 + 40 * t * (1 - t) : 12;
				return <path key={pin} data-circuit-connector={pin} d={`M 0,${y} H ${inputEnd}`} />;
			})}
			<path data-circuit-connector="out" d={`M ${tip + (inverted ? 8 : 0)},${middle} H ${GATE_WIDTH}`} />
			{type === 'not' ? <path className="logic-symbol-body" d={`M 12,4 L 68,${middle} L 12,${bottom} Z`} />
				: or ? <path className="logic-symbol-body" d={`M 12,4 Q 42,2 68,${middle} Q 42,${height - 2} 12,${bottom} Q 32,${middle} 12,4 Z`} />
					: <path className="logic-symbol-body" d={`M 12,4 H 40 A 28,${middle - 4} 0 0 1 40,${bottom} H 12 Z`} />}
			{xor && <path d={`M 4,4 Q 24,${middle} 4,${bottom}`} />}
			{inverted && <circle className="logic-symbol-body" cx={tip + 4} cy={middle} r="4" />}
		</g>
	</svg>;
}
