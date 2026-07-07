// Shared illustrated bits for the "Ontario road-trip" look: the family rig
// (pickup towing a Grand Design-style 23BHE travel trailer), an animated
// campfire, and a twinkling star field. Pure presentation — no behavior.

/**
 * Side-view of the tow rig, drawn left-facing (driving right→left by default).
 * Rendered as a plain <svg>; use `className` to size it (w-24 etc.).
 */
export function RigIcon({ className = '', flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 200 62" className={className} aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <RigArt />
    </svg>
  )
}

/**
 * The same rig as an SVG <g>, so it can be placed inside a bigger scene
 * (e.g. the route-stepper trail) with a transform.
 */
export function RigArt() {
  return (
    <g>
      {/* ---- Travel trailer (23BHE-ish) ---- */}
      {/* body */}
      <path d="M64 8 Q64 3 70 3 L138 3 Q145 3 145 10 L145 40 Q145 45 139 45 L70 45 Q64 45 64 40 Z" fill="#f3f0e8" stroke="#3c4842" strokeWidth="2" />
      {/* front cap swoosh (Grand Design vibes) */}
      <path d="M64 40 Q64 45 70 45 L139 45 Q145 45 145 40 L145 33 Q112 25 64 34 Z" fill="#7a5c48" />
      <path d="M64 30 Q104 21 145 29 L145 25 Q106 18 64 27 Z" fill="#b5482f" />
      {/* window + door */}
      <rect x="74" y="10" width="20" height="13" rx="2.5" fill="#8fd0d6" stroke="#3c4842" strokeWidth="1.8" />
      <rect x="118" y="9" width="15" height="26" rx="2.5" fill="#e0dbcf" stroke="#3c4842" strokeWidth="1.8" />
      <rect x="121" y="13" width="9" height="8" rx="1.5" fill="#8fd0d6" />
      {/* roof AC + vent */}
      <rect x="86" y="-1" width="16" height="5" rx="2" fill="#9aa39e" />
      {/* wheel */}
      <circle cx="94" cy="47" r="8.5" fill="#33393b" />
      <circle cx="94" cy="47" r="3.5" fill="#c9ccc7" />
      {/* hitch + tongue */}
      <path d="M145 38 L163 44" stroke="#3c4842" strokeWidth="3" strokeLinecap="round" />
      {/* ---- Pickup truck ---- */}
      <path d="M160 44 L160 30 Q160 26 165 26 L173 26 L179 16 Q180 14 183 14 L192 14 Q196 14 196 18 L196 26 Q199 27 199 31 L199 44 Q199 47 196 47 L163 47 Q160 47 160 44 Z" fill="#39586e" stroke="#2a3d4c" strokeWidth="2" />
      <rect x="181" y="17" width="11" height="9" rx="1.5" fill="#8fd0d6" stroke="#2a3d4c" strokeWidth="1.5" />
      {/* truck wheels */}
      <circle cx="170" cy="48" r="7.5" fill="#33393b" />
      <circle cx="170" cy="48" r="3" fill="#c9ccc7" />
      <circle cx="190" cy="48" r="7.5" fill="#33393b" />
      <circle cx="190" cy="48" r="3" fill="#c9ccc7" />
    </g>
  )
}

/** Animated little campfire (logs + flickering flame). */
export function Campfire({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      {/* flame */}
      <g className="animate-campfire">
        <path d="M20 6 C26 14 29 18 29 24 A9 9 0 0 1 11 24 C11 18 14 14 20 6 Z" fill="#f59e2c" />
        <path d="M20 15 C23 19 24.5 21 24.5 24.5 A4.5 4.5 0 0 1 15.5 24.5 C15.5 21 17 19 20 15 Z" fill="#ffd166" />
      </g>
      {/* logs */}
      <rect x="6" y="30" width="28" height="4.5" rx="2.25" fill="#7a5c48" transform="rotate(8 20 32)" />
      <rect x="6" y="30" width="28" height="4.5" rx="2.25" fill="#8d6e56" transform="rotate(-8 20 32)" />
    </svg>
  )
}

/** A scattering of twinkling stars for night skies. */
export function Stars({ className = '' }: { className?: string }) {
  const stars = [
    [8, 18, 1.4, 0], [22, 8, 1, 0.6], [38, 22, 1.6, 1.2], [55, 10, 1, 0.3],
    [70, 26, 1.3, 1.6], [84, 8, 1.7, 0.9], [93, 30, 1, 0.2], [48, 32, 1.1, 1.9],
  ] as const
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className} aria-hidden>
      {stars.map(([x, y, r, d], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff" className="animate-twinkle" style={{ animationDelay: `${d}s` }} />
      ))}
    </svg>
  )
}
