/* oxlint-disable next/no-img-element -- CCP's image CDN serves the requested optimized thumbnail size directly. */

type EveTypeIconProps = {
  typeId: number;
  blueprint?: boolean;
  size?: 32 | 64;
};

function imageUrl(typeId: number, variation: 'icon' | 'bp', size: 32 | 64) {
  return `https://images.evetech.net/types/${typeId}/${variation}?tenant=tranquility&size=${size}`;
}

export default function EveTypeIcon({ typeId, blueprint = false, size = 64 }: EveTypeIconProps) {
  const variation = blueprint ? 'bp' : 'icon';
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden border border-cyan-400/20 bg-slate-950/75 shadow-[inset_0_0_14px_rgba(34,211,238,.06)]">
      <img
        key={`${typeId}:${variation}:${size}`}
        src={imageUrl(typeId, variation, size)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-contain"
        onError={(event) => {
          const image = event.currentTarget;
          if (variation === 'icon' || image.dataset.fallback === 'true') {
            image.hidden = true;
            return;
          }
          image.dataset.fallback = 'true';
          image.src = imageUrl(typeId, 'icon', size);
        }}
      />
    </span>
  );
}
