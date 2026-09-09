import { Popover } from '@astryxdesign/core/Popover';

interface Props {
  /** Short label (1–3 words). The "what it is". */
  title: string;
  /** Two short paragraphs. The "how to read it". */
  body: string;
  /** Optional concrete thresholds (good/caution/risk). */
  thresholds?: { label: string; range: string }[];
}

/**
 * Small ⓘ button next to a metric label. Click to open an Astryx `Popover`
 * explaining (a) what the metric is and (b) how to read it. The Popover
 * handles open/close, outside-click and Escape dismissal, and focus return.
 */
export function InfoTooltip({ title, body, thresholds }: Props) {
  const content = (
    <div className="w-64 text-left">
      <p className="text-xs font-semibold text-ink-900">{title}</p>
      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-700">{body}</p>
      {thresholds && thresholds.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-ink-900/5 pt-2 text-caption">
          {thresholds.map((t) => (
            <li key={t.label} className="flex justify-between gap-2">
              <span className="text-ink-500">{t.label}</span>
              <span className="font-mono tabular-nums text-ink-700">{t.range}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Popover label={title} content={content} placement="end" alignment="start" width="auto">
      <button
        type="button"
        aria-label={`Info: ${title}`}
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-900/5 text-[10px] font-semibold leading-none text-ink-500 transition-[background-color,color,transform] duration-150 ease-out-strong hover:bg-ink-900/10 hover:text-ink-700 active:scale-[0.96] before:absolute before:-inset-3 before:content-['']"
      >
        i
      </button>
    </Popover>
  );
}
