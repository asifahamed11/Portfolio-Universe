import './ShinyText.css';

// React Bits inspired "Shiny Text": a soft light band continuously sweeps across the text.
export default function ShinyText({ text, speed = 5, disabled = false, className = '' }) {
  return (
    <span
      className={`shiny-text${disabled ? ' shiny-text--disabled' : ''} ${className}`.trim()}
      style={{ animationDuration: `${speed}s` }}
    >
      {text}
    </span>
  );
}
