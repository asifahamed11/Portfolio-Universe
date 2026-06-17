import { useRef } from 'react';
import VariableProximity from './VariableProximity.jsx';

export default function VariableProximityWrapper({ count }) {
  const containerRef = useRef(null);

  const commonProps = {
    className: 'variable-proximity-demo',
    fromFontVariationSettings: "'wght' 400, 'opsz' 9",
    toFontVariationSettings: "'wght' 1000, 'opsz' 40",
    containerRef: containerRef,
    radius: 100,
    falloff: 'linear'
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <VariableProximity label="Explore a curated gallery of" {...commonProps} />
      {' '}
      <span className="neon-green-glow font-black text-[1.2em]">
        <VariableProximity label={String(count)} {...commonProps} />
      </span>
      {' '}
      <VariableProximity label="stunning portfolios. Get inspired, discover tech stacks, and find your next" {...commonProps} />
      {' '}
      <span className="text-white font-medium">
        <VariableProximity label="top-tier hire." {...commonProps} />
      </span>
    </div>
  );
}
