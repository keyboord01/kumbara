/** The one loading ring: inherits the text colour and size of its parent. */
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden />;
}
