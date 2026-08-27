import React, { useState, useEffect } from 'react';
import { Video, Image as ImageIcon, ImageOff } from 'lucide-react';

interface CreativeThumbProps {
  url?: string | null;
  name: string;
  format?: 'image' | 'video' | 'carousel';
  size?: number;
}

/**
 * Miniatura do criativo, como aparece no Meta Ads.
 *
 * As URLs vêm assinadas do CDN da Meta e expiram; quando isso acontece — ou
 * quando a Meta oculta o criativo — mostramos um marcador em vez de uma imagem
 * qualquer, para não passar por criativo do cliente algo que não é.
 */
export const CreativeThumb: React.FC<CreativeThumbProps> = ({ url, name, format, size = 38 }) => {
  const [failed, setFailed] = useState(false);

  // Um novo período pode trazer outra URL para a mesma linha: rearma o estado.
  useEffect(() => setFailed(false), [url]);

  const box: React.CSSProperties = {
    position: 'relative',
    width: `${size}px`,
    height: `${size}px`,
    flexShrink: 0
  };

  const surface: React.CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: '6px',
    objectFit: 'cover',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg)'
  };

  if (!url || failed) {
    return (
      <div style={box} title={url ? 'Imagem do criativo indisponível' : 'Sem imagem de criativo na Meta'}>
        <div
          style={{
            ...surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)'
          }}
        >
          <ImageOff size={Math.round(size * 0.42)} />
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      <img
        src={url}
        alt={`Criativo do anúncio ${name}`}
        loading="lazy"
        // O CDN da Meta recusa requisições com referrer de outra origem.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={surface}
      />
      <span
        style={{
          position: 'absolute',
          bottom: '-2px',
          right: '-2px',
          backgroundColor: 'var(--surface)',
          borderRadius: '50%',
          padding: '2px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center'
        }}
      >
        {format === 'video' ? (
          <Video size={10} style={{ color: 'var(--accent-blue)' }} />
        ) : (
          <ImageIcon size={10} style={{ color: 'var(--good)' }} />
        )}
      </span>
    </div>
  );
};
