'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

type Color = { name: string; token: string; hex: string; usage: string };

const COLORS: Color[] = [
  { name: 'Black', token: 'lc-black', hex: '#0a0a0a', usage: 'Background' },
  { name: 'Dark', token: 'lc-dark', hex: '#171717', usage: 'Cards' },
  { name: 'Border', token: 'lc-border', hex: '#262626', usage: 'Dividers' },
  { name: 'Muted', token: 'lc-muted', hex: '#a3a3a3', usage: 'Secondary text' },
  { name: 'White', token: 'lc-white', hex: '#fafafa', usage: 'Primary text' },
  { name: 'Green', token: 'lc-green', hex: '#b4f953', usage: 'Accent / CTA' },
];

const COPY = {
  name: 'Obelisk',
  tagline: 'Chat grupal con identidad Nostr',
  taglineEn: 'Group chat powered by Nostr identity',
  shortPitch:
    'Obelisk es un chat grupal estilo Discord donde la identidad viene de tu llave Nostr. Sin emails, sin contraseñas — solo identidad criptográfica.',
  shortPitchEn:
    'Obelisk is a Discord-style group chat where identity comes from your Nostr keypair. No emails, no passwords — cryptographic identity only.',
  oneLiner: 'Sin emails. Sin contraseñas. Identidad criptográfica.',
  oneLinerEn: 'No emails. No passwords. Cryptographic identity.',
  longPitch:
    'Obelisk es una aplicación de chat grupal completamente sobre relays Nostr. Implementa NIP-29 para grupos, NIP-04/NIP-17 para mensajes directos, voz P2P y SFU vía WebRTC señalizado por Nostr, y pagos Lightning vía NIP-47 (Nostr Wallet Connect). Sin backend, sin base de datos: el cliente habla directamente con los relays.',
  longPitchEn:
    'Obelisk is a fully relay-only group chat application built on Nostr. It implements NIP-29 for groups, NIP-04/NIP-17 for direct messages, P2P and SFU voice via WebRTC signaled over Nostr, and Lightning payments via NIP-47 (Nostr Wallet Connect). No backend, no database: the client talks directly to relays.',
};

const ASSETS = [
  {
    src: '/obelisk.png',
    label: 'Obelisk Logo (PNG)',
    bg: 'bg-lc-black',
    download: 'obelisk.png',
  },
  {
    src: '/obelisk-favicon.png',
    label: 'Favicon (PNG)',
    bg: 'bg-lc-black',
    download: 'obelisk-favicon.png',
  },
  {
    src: '/obelisk.gif',
    label: 'Obelisk Animado (GIF)',
    bg: 'bg-lc-black',
    download: 'obelisk.gif',
  },
  {
    src: '/obelisk-lg.gif',
    label: 'Obelisk Animado — Large',
    bg: 'bg-lc-black',
    download: 'obelisk-lg.gif',
  },
  {
    src: '/obelisk-md.gif',
    label: 'Obelisk Animado — Medium',
    bg: 'bg-lc-black',
    download: 'obelisk-md.gif',
  },
  {
    src: '/obelisk-sm.gif',
    label: 'Obelisk Animado — Small',
    bg: 'bg-lc-black',
    download: 'obelisk-sm.gif',
  },
  {
    src: '/lacrypta-logo.png',
    label: 'La Crypta Logo (PNG)',
    bg: 'bg-lc-black',
    download: 'lacrypta-logo.png',
  },
  {
    src: '/lacrypta-banner.png',
    label: 'La Crypta Banner (PNG)',
    bg: 'bg-lc-black',
    download: 'lacrypta-banner.png',
  },
  {
    src: '/nostr-wot-logo.png',
    label: 'Nostr WoT Logo (PNG)',
    bg: 'bg-lc-black',
    download: 'nostr-wot-logo.png',
  },
  {
    src: '/nostr-wot-logo.svg',
    label: 'Nostr WoT Logo (SVG)',
    bg: 'bg-lc-black',
    download: 'nostr-wot-logo.svg',
  },
  {
    src: '/nostr-wot-logo-clean.png',
    label: 'Nostr WoT Logo (Clean PNG)',
    bg: 'bg-lc-black',
    download: 'nostr-wot-logo-clean.png',
  },
];

const OG_IMAGE_URL = '/opengraph-image';

const EMBED_HTML_BANNER = `<a href="https://obelisk.ar" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;font-family:Inter,system-ui,sans-serif;background:#0a0a0a;border:1px solid #262626;border-radius:12px;padding:14px 20px;color:#fafafa;">
  <span style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:#b4f953;box-shadow:0 0 12px #b4f953;"></span>
    <span style="font-weight:700;letter-spacing:-0.01em;">Obelisk</span>
    <span style="color:#a3a3a3;">— Chat grupal con identidad Nostr</span>
  </span>
</a>`;

const EMBED_BADGE = `<a href="https://obelisk.ar" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#b4f953;color:#0a0a0a;font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:13px;border-radius:9999px;text-decoration:none;">
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2 L8 8 L7 22 H17 L16 8 Z"/></svg>
  Powered by Obelisk
</a>`;

const EMBED_OG = `<!-- Add to <head> for sharing previews -->
<meta property="og:title" content="Obelisk — Chat grupal con identidad Nostr" />
<meta property="og:description" content="Sin emails. Sin contraseñas. Identidad criptográfica." />
<meta property="og:image" content="https://obelisk.ar/opengraph-image" />
<meta property="og:url" content="https://obelisk.ar" />
<meta name="twitter:card" content="summary_large_image" />`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="lc-pill-secondary text-xs px-3 py-1"
    >
      {copied ? 'Copiado ✓' : 'Copiar'}
    </button>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold text-lc-white tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm sm:text-base text-lc-muted max-w-3xl">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="lc-card overflow-x-auto p-4 text-xs sm:text-sm text-lc-white whitespace-pre-wrap break-all">
        <code>{code}</code>
      </pre>
      <div className="absolute top-3 right-3">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

export default function MediaKit() {
  return (
    <main className="min-h-screen bg-lc-black text-lc-white">
      {/* Hero */}
      <header className="border-b border-lc-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-20">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-lc-green">
            <span className="inline-block w-2 h-2 rounded-full bg-lc-green lc-glow" />
            Press & Media
          </div>
          <h1 className="mt-4 text-4xl sm:text-6xl font-extrabold tracking-tight">
            Obelisk Media Kit
          </h1>
          <p className="mt-4 max-w-2xl text-base sm:text-lg text-lc-muted">
            Logos, banners, iconos, paleta y copys listos para usar. Todo lo
            necesario para escribir, embeber o compartir Obelisk.
          </p>

          <nav className="mt-8 flex flex-wrap gap-2 text-sm">
            {[
              ['#about', 'Sobre Obelisk'],
              ['#logos', 'Logos & íconos'],
              ['#banners', 'Banners'],
              ['#colors', 'Colores'],
              ['#typography', 'Tipografía'],
              ['#copy', 'Copys'],
              ['#embeds', 'HTML embebibles'],
              ['#og', 'Open Graph'],
              ['#guidelines', 'Guías de uso'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="lc-pill-secondary px-3 py-1"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 space-y-16">
        {/* About */}
        <Section
          id="about"
          title="Sobre Obelisk"
          description="Pitch corto y largo, en inglés y español. Listo para copiar."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="lc-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-lc-green">
                  ES — Pitch corto
                </span>
                <CopyButton text={COPY.shortPitch} />
              </div>
              <p className="text-sm text-lc-white">{COPY.shortPitch}</p>
            </div>
            <div className="lc-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-lc-green">
                  EN — Short pitch
                </span>
                <CopyButton text={COPY.shortPitchEn} />
              </div>
              <p className="text-sm text-lc-white">{COPY.shortPitchEn}</p>
            </div>
            <div className="lc-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-lc-green">
                  ES — Pitch largo
                </span>
                <CopyButton text={COPY.longPitch} />
              </div>
              <p className="text-sm text-lc-white">{COPY.longPitch}</p>
            </div>
            <div className="lc-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-lc-green">
                  EN — Long pitch
                </span>
                <CopyButton text={COPY.longPitchEn} />
              </div>
              <p className="text-sm text-lc-white">{COPY.longPitchEn}</p>
            </div>
          </div>
        </Section>

        {/* Logos */}
        <Section
          id="logos"
          title="Logos & íconos"
          description="Click derecho → Guardar imagen como… o usá el botón Descargar."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ASSETS.map((a) => (
              <div key={a.src} className="lc-card overflow-hidden">
                <div
                  className={`${a.bg} flex items-center justify-center p-6 h-48`}
                >
                  <Image
                    src={a.src}
                    alt={a.label}
                    width={180}
                    height={180}
                    className="max-h-full max-w-full object-contain"
                    unoptimized
                  />
                </div>
                <div className="border-t border-lc-border p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {a.label}
                    </div>
                    <div className="text-xs text-lc-muted truncate">
                      {a.src}
                    </div>
                  </div>
                  <a
                    href={a.src}
                    download={a.download}
                    className="lc-pill-primary text-xs px-3 py-1 shrink-0"
                  >
                    Descargar
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Banners */}
        <Section
          id="banners"
          title="Banners"
          description="Banners renderizados en HTML/CSS — copialos como código o capturalos como imagen."
        >
          <div className="space-y-6">
            {/* Banner 1 — hero */}
            <div className="lc-card overflow-hidden">
              <div
                className="relative flex flex-col items-center justify-center text-center p-10 sm:p-16"
                style={{
                  background:
                    'radial-gradient(circle at 50% 30%, #1a2a10 0%, #0a0a0a 60%)',
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(180,249,83,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(180,249,83,0.04) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                  }}
                />
                <div
                  className="absolute w-40 h-40 rounded-full"
                  style={{
                    top: '14%',
                    background:
                      'radial-gradient(circle, rgba(180,249,83,0.35) 0%, rgba(180,249,83,0.1) 40%, transparent 70%)',
                  }}
                />
                <div
                  className="absolute w-16 h-16 rounded-full"
                  style={{
                    top: '22%',
                    backgroundColor: '#b4f953',
                    boxShadow: '0 0 60px rgba(180,249,83,0.5)',
                  }}
                />
                <h3 className="relative mt-12 text-5xl sm:text-7xl font-extrabold tracking-tight">
                  Obelisk
                </h3>
                <p className="relative mt-2 text-lc-muted text-sm sm:text-lg">
                  {COPY.tagline}
                </p>
                <p className="relative mt-6 text-lc-green font-semibold text-xs sm:text-sm">
                  {COPY.oneLiner}
                </p>
              </div>
              <div className="border-t border-lc-border p-3 flex items-center justify-between text-xs text-lc-muted">
                <span>Hero banner — 1200×630 estilo OG</span>
                <a
                  href={OG_IMAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lc-pill-secondary px-3 py-1"
                >
                  Ver PNG (Open Graph)
                </a>
              </div>
            </div>

            {/* Banner 2 — wide pill */}
            <div className="lc-card overflow-hidden">
              <div className="flex items-center gap-4 p-6 sm:p-8 bg-lc-black">
                <div className="shrink-0 w-12 h-12 rounded-full bg-lc-green flex items-center justify-center text-lc-black font-extrabold">
                  ◊
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lc-white font-bold text-lg">
                    Obelisk
                  </div>
                  <div className="text-lc-muted text-sm truncate">
                    {COPY.tagline}
                  </div>
                </div>
                <a
                  href="https://obelisk.ar"
                  className="lc-pill-primary px-4 py-2 text-sm hidden sm:inline-block"
                >
                  Abrir app →
                </a>
              </div>
              <div className="border-t border-lc-border p-3 text-xs text-lc-muted">
                Wide banner — perfecto para footer / sponsor row
              </div>
            </div>

            {/* Banner 3 — minimal mono */}
            <div className="lc-card overflow-hidden">
              <div className="p-10 sm:p-14 bg-lc-white text-lc-black text-center">
                <div className="text-3xl sm:text-5xl font-extrabold tracking-tight">
                  OBELISK
                </div>
                <div className="mt-2 text-xs sm:text-sm uppercase tracking-[0.4em] text-neutral-600">
                  Nostr-native group chat
                </div>
              </div>
              <div className="border-t border-lc-border p-3 text-xs text-lc-muted">
                Minimal mono — para impresos / merch
              </div>
            </div>
          </div>
        </Section>

        {/* Colors */}
        <Section
          id="colors"
          title="Paleta — La Crypta"
          description="Tokens del design system. Click en el HEX para copiarlo."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COLORS.map((c) => (
              <div key={c.token} className="lc-card overflow-hidden">
                <div
                  className="h-24 border-b border-lc-border"
                  style={{ backgroundColor: c.hex }}
                />
                <div className="p-4 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-lc-muted">
                      {c.token} · {c.usage}
                    </div>
                  </div>
                  <CopyButton text={c.hex} />
                </div>
                <div className="px-4 pb-4 -mt-2 text-xs text-lc-muted font-mono">
                  {c.hex}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Typography */}
        <Section
          id="typography"
          title="Tipografía"
          description="System UI / Inter para todo. Pesos: 400, 600, 700, 800."
        >
          <div className="lc-card p-6 space-y-4">
            <div className="text-5xl font-extrabold tracking-tight">
              Aa — Obelisk
            </div>
            <div className="text-2xl font-bold">
              Heading · 700 · tracking-tight
            </div>
            <div className="text-base">Body · 400 · text-lc-white</div>
            <div className="text-sm text-lc-muted">
              Muted · 400 · text-lc-muted — usado en descripciones secundarias
            </div>
            <div className="text-xs uppercase tracking-widest text-lc-green">
              Eyebrow · uppercase · tracking-widest · lc-green
            </div>
          </div>
        </Section>

        {/* Copy */}
        <Section id="copy" title="Copys cortos" description="Frases de uso rápido.">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Nombre', COPY.name],
              ['Tagline (ES)', COPY.tagline],
              ['Tagline (EN)', COPY.taglineEn],
              ['One-liner (ES)', COPY.oneLiner],
              ['One-liner (EN)', COPY.oneLinerEn],
              ['URL', 'https://obelisk.ar'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="lc-card p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-lc-green">
                    {label}
                  </div>
                  <div className="text-sm truncate">{value}</div>
                </div>
                <CopyButton text={value} />
              </div>
            ))}
          </div>
        </Section>

        {/* Embeds */}
        <Section
          id="embeds"
          title="HTML embebible"
          description="Pegá estos snippets en cualquier sitio para enlazar Obelisk con estilo."
        >
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-3">Banner pill</h3>
              <div className="lc-card p-6 mb-3 flex justify-center">
                <div dangerouslySetInnerHTML={{ __html: EMBED_HTML_BANNER }} />
              </div>
              <CodeBlock code={EMBED_HTML_BANNER} />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Badge &quot;Powered by Obelisk&quot;
              </h3>
              <div className="lc-card p-6 mb-3 flex justify-center">
                <div dangerouslySetInnerHTML={{ __html: EMBED_BADGE }} />
              </div>
              <CodeBlock code={EMBED_BADGE} />
            </div>
          </div>
        </Section>

        {/* OG */}
        <Section
          id="og"
          title="Open Graph"
          description="Imagen de previsualización generada en runtime y meta tags listos."
        >
          <div className="lc-card overflow-hidden mb-4">
            <div className="aspect-[1200/630] relative bg-lc-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={OG_IMAGE_URL}
                alt="Open Graph preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
            <div className="border-t border-lc-border p-3 flex items-center justify-between text-xs text-lc-muted">
              <span>1200 × 630 · /opengraph-image</span>
              <a
                href={OG_IMAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lc-pill-secondary px-3 py-1"
              >
                Abrir en pestaña
              </a>
            </div>
          </div>
          <CodeBlock code={EMBED_OG} />
        </Section>

        {/* Guidelines */}
        <Section
          id="guidelines"
          title="Guías de uso"
          description="Reglas simples para mantener la marca consistente."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="lc-card p-5">
              <div className="text-lc-green font-semibold mb-2">✓ Sí</div>
              <ul className="space-y-1 text-sm text-lc-white list-disc list-inside">
                <li>Usá el logo sobre fondos oscuros (#0a0a0a) idealmente.</li>
                <li>
                  Respetá el área de espacio: al menos la altura del símbolo
                  alrededor.
                </li>
                <li>Usá el verde lima (#b4f953) solo para acentos / CTAs.</li>
                <li>Mencioná &quot;Obelisk&quot; con O mayúscula.</li>
              </ul>
            </div>
            <div className="lc-card p-5">
              <div className="text-red-400 font-semibold mb-2">✕ No</div>
              <ul className="space-y-1 text-sm text-lc-white list-disc list-inside">
                <li>No deformes ni rotes el logo.</li>
                <li>No reemplaces el verde por otros colores brillantes.</li>
                <li>
                  No uses el logo sobre fondos con poco contraste (gris medio).
                </li>
                <li>No agregues sombras, contornos ni gradientes propios.</li>
              </ul>
            </div>
          </div>
        </Section>

        <footer className="pt-8 border-t border-lc-border text-sm text-lc-muted flex flex-wrap items-center justify-between gap-3">
          <span>
            ¿Necesitás algo más? Abrí un issue o escribinos vía Nostr.
          </span>
          <Link href="/" className="lc-pill-secondary px-4 py-1">
            ← Volver al inicio
          </Link>
        </footer>
      </div>
    </main>
  );
}
