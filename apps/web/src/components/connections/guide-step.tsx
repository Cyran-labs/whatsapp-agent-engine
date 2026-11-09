/** Lien externe d'un guide : nouvel onglet, sans référent ni accès à la page d'origine. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-block text-xs font-semibold text-accent-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
    >
      {children}
    </a>
  );
}

/** Étape numérotée d'un guide de raccordement (numéro, titre, aide, puis contenu libre). */
export function GuideStep({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 border-t border-border py-3.5 first:border-t-0">
      <span
        aria-hidden="true"
        className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-pill bg-accent-soft text-xs font-bold text-accent-ink"
      >
        {index}
      </span>
      <div className="min-w-0 flex-1 text-[13.5px] text-fg">
        <div className="font-semibold">{title}</div>
        {hint && <p className="mt-0.5 text-xs text-muted-2">{hint}</p>}
        {children}
      </div>
    </li>
  );
}
