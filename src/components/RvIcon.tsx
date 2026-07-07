// RV / camper icon used to flag supermarket items for camping (§8/§15).
// Full-color when active; near-colorless (faded + desaturated) when inactive.
export function RvIcon({ className = '', active = false }: { className?: string; active?: boolean }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        transition: 'opacity 150ms, filter 150ms',
        opacity: active ? 1 : 0.35,
        filter: active ? 'none' : 'grayscale(1) opacity(0.6)',
      }}
    >
      {/* Antenna */}
      <rect x="130" y="60" width="10" height="26" fill="#9099A2" />
      <rect x="108" y="60" width="54" height="10" fill="#9099A2" />
      {/* Main body */}
      <path d="M20 130 Q20 96 60 96 L370 96 Q430 96 430 180 L430 340 Q430 400 370 400 L60 400 Q20 400 20 366 Z" fill="#E6E7E8" />
      {/* Roof detail */}
      <path d="M46 118 Q46 108 58 108 L360 108 Q392 108 392 140 L392 152 Q392 160 384 160 L200 160 Q188 160 188 148 Q188 138 176 138 L64 138 Q46 138 46 128 Z" fill="none" stroke="#C7C9CC" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      {/* Small bump/light on roof */}
      <rect x="38" y="158" width="26" height="14" rx="7" fill="#F4F5F6" />
      {/* Top red stripe */}
      <path d="M20 205 L430 205 L430 220 L20 220 Z" fill="#FF6F5B" />
      {/* Yellow lower band */}
      <path d="M20 300 L430 300 L430 340 Q430 400 370 400 L60 400 Q20 400 20 366 Z" fill="#FFC94A" />
      {/* Small red accent dot top right */}
      <rect x="404" y="168" width="26" height="10" rx="5" fill="#FF6F5B" />
      {/* Left large window */}
      <rect x="34" y="205" width="150" height="100" rx="14" fill="#1F3A5F" />
      <rect x="46" y="217" width="126" height="76" fill="#54C8C0" />
      <rect x="46" y="255" width="126" height="38" fill="#3AA9A0" />
      {/* Second window */}
      <rect x="196" y="205" width="82" height="100" rx="14" fill="#1F3A5F" />
      <rect x="206" y="217" width="62" height="76" fill="#54C8C0" />
      <rect x="206" y="255" width="62" height="38" fill="#3AA9A0" />
      {/* Door panel */}
      <rect x="298" y="178" width="86" height="230" rx="10" fill="#FF6F5B" />
      <rect x="298" y="178" width="86" height="18" rx="9" fill="#1F3A5F" />
      {/* Door window */}
      <rect x="318" y="205" width="46" height="66" rx="8" fill="#1F3A5F" />
      <rect x="326" y="213" width="30" height="50" fill="#54C8C0" />
      {/* Door handle */}
      <rect x="330" y="288" width="24" height="10" rx="5" fill="#F4F5F6" />
      {/* Door vent lines */}
      <rect x="316" y="316" width="52" height="6" rx="3" fill="#E85B47" />
      <rect x="316" y="330" width="52" height="6" rx="3" fill="#E85B47" />
      <rect x="316" y="344" width="52" height="6" rx="3" fill="#E85B47" />
      <rect x="316" y="358" width="52" height="6" rx="3" fill="#E85B47" />
      {/* Side small window (front) */}
      <rect x="398" y="216" width="40" height="40" rx="6" fill="none" stroke="#C7C9CC" strokeWidth="7" />
      {/* Trailer hitch */}
      <rect x="430" y="374" width="70" height="12" fill="#1F3A5F" />
      <rect x="478" y="368" width="12" height="70" fill="#1F3A5F" />
      {/* Wheels */}
      <circle cx="120" cy="410" r="38" fill="#4A4A4A" />
      <circle cx="120" cy="410" r="18" fill="#B0B3B6" />
      <circle cx="310" cy="410" r="38" fill="#4A4A4A" />
      <circle cx="310" cy="410" r="18" fill="#B0B3B6" />
    </svg>
  )
}
