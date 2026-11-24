import { useId } from 'react';

const SPOKES = [0, 60, 120, 180, 240, 300];
const RIVETS = Array.from({ length: 16 }, (_, i) => i * 22.5);

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [32 + r * Math.cos(rad), 32 + r * Math.sin(rad)];
}

/**
 * Book Vault mark: a brushed-steel vault door with riveted rim, hinge,
 * six-spoke handle wheel and a dark keypad hub. Decorative (aria-hidden):
 * the brand name next to it carries the meaning.
 */
export function VaultLogo({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '');
  const steel = `${uid}-steel`;
  const door = `${uid}-door`;
  const hub = `${uid}-hub`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className="vault-logo"
    >
      <defs>
        {/* userSpaceOnUse: a gradient sized to each shape breaks on the vertical
            spokes, whose bounding box has zero width. */}
        <linearGradient id={steel} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#f6f7f9" />
          <stop offset="0.35" stopColor="#b9bec6" />
          <stop offset="0.6" stopColor="#eceef1" />
          <stop offset="1" stopColor="#7d838c" />
        </linearGradient>
        <linearGradient id={door} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9dce1" />
          <stop offset="0.5" stopColor="#8e949c" />
          <stop offset="1" stopColor="#c4c8ce" />
        </linearGradient>
        <radialGradient id={hub} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#2c2f34" />
          <stop offset="1" stopColor="#08090a" />
        </radialGradient>
      </defs>

      {/* Hinges */}
      <rect
        x="1"
        y="17"
        width="6"
        height="9"
        rx="1.5"
        fill={`url(#${steel})`}
        stroke="#3a3d42"
        strokeWidth="0.6"
      />
      <rect
        x="1"
        y="38"
        width="6"
        height="9"
        rx="1.5"
        fill={`url(#${steel})`}
        stroke="#3a3d42"
        strokeWidth="0.6"
      />

      {/* Rim with rivets */}
      <circle cx="32" cy="32" r="29" fill={`url(#${steel})`} stroke="#2b2e33" strokeWidth="1" />
      {RIVETS.map((deg) => {
        const [x, y] = polar(26.2, deg);
        return <circle key={deg} cx={x} cy={y} r="0.95" fill="#5b6068" />;
      })}

      {/* Door face */}
      <circle cx="32" cy="32" r="23" fill={`url(#${door})`} stroke="#4a4e55" strokeWidth="0.8" />
      <circle
        cx="32"
        cy="32"
        r="18.5"
        fill="none"
        stroke="#f2f3f5"
        strokeOpacity="0.55"
        strokeWidth="0.6"
      />

      {/* Handle wheel */}
      {SPOKES.map((deg) => {
        const [x1, y1] = polar(8, deg);
        const [x2, y2] = polar(19.5, deg);
        return (
          <g key={deg}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#3a3d42"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={`url(#${steel})`}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* Keypad hub */}
      <circle cx="32" cy="32" r="9" fill={`url(#${hub})`} stroke="#c9cdd3" strokeWidth="1.2" />
      {[29, 31, 33, 35].map((x) => (
        <rect key={x} x={x - 0.6} y="28.3" width="1.2" height="1.6" rx="0.3" fill="#5dfc8d" />
      ))}
      {[-3, 0, 3].flatMap((dx) =>
        [33, 36].map((cy) => (
          <circle key={`${dx}-${cy}`} cx={32 + dx} cy={cy} r="0.8" fill="#9aa0a8" />
        )),
      )}
    </svg>
  );
}
