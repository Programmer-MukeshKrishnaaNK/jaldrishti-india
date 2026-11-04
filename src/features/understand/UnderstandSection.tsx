import { useMemo, useState } from 'react'
import { explainArea, type AreaInput, type AreaSection } from '../../lib/explain/area'
import './UnderstandSection.css'

interface UnderstandSectionProps {
  /** Null until terrain is loaded for an area. */
  input: AreaInput | null
}

const OPEN_AT_START: AreaSection['id'][] = ['looking']

/** "Understand this area": the selected area and scenario in everyday words. */
export function UnderstandSection({ input }: UnderstandSectionProps) {
  const explanation = useMemo(() => (input ? explainArea(input) : null), [input])
  const [open, setOpen] = useState<Set<AreaSection['id']>>(() => new Set(OPEN_AT_START))

  // Choosing a hotspot opens its reasons (adjusted while rendering, when the selection changes).
  const selectedRank = input?.selected?.rank ?? null
  const [shownRank, setShownRank] = useState(selectedRank)
  if (selectedRank !== shownRank) {
    setShownRank(selectedRank)
    if (selectedRank !== null && !open.has('why')) setOpen(new Set(open).add('why'))
  }

  const toggle = (id: AreaSection['id'], isOpen: boolean) =>
    setOpen((previous) => {
      const next = new Set(previous)
      if (isOpen) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <section className="panel-section understand" aria-labelledby="understand-heading">
      <h2 id="understand-heading" className="panel-heading">
        Understand this area <span className="badge badge-plain">Plain language</span>
      </h2>
      {!explanation ? (
        <p className="panel-text">Search for a place and load its terrain. This box will then explain the area in everyday words.</p>
      ) : (
        <>
          <p className="understand-summary" aria-live="polite">
            {explanation.summary}
          </p>
          {explanation.sections.map((section) => (
            <details
              key={section.id}
              className="understand-item"
              open={open.has(section.id)}
              onToggle={(event) => toggle(section.id, event.currentTarget.open)}
            >
              <summary>{section.question}</summary>
              <div className="understand-body">
                {section.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {section.points && (
                  <ul>
                    {section.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {section.notes?.map((note) => (
                  <p key={note} className="understand-note">
                    {note}
                  </p>
                ))}
              </div>
            </details>
          ))}
          <p className="panel-note">
            A simplified, hypothetical scenario from open elevation and land-cover data. It is not a real-time flood
            prediction, and hotspots are not observed floods.
          </p>
        </>
      )}
    </section>
  )
}
