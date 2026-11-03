import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { searchGazetteer } from '../../lib/geocode/gazetteer'
import { mergePlaces } from '../../lib/geocode/merge'
import { searchNominatim } from '../../lib/geocode/nominatim'
import { searchPhoton } from '../../lib/geocode/photon'
import { GeocodeError, type Place } from '../../lib/geocode/types'
import './SearchBox.css'

interface SearchBoxProps {
  onSelect: (place: Place) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'message'; message: string }

const TYPEAHEAD_DELAY_MS = 350
const TYPEAHEAD_MIN_CHARS = 3

const SOURCE_LABEL: Record<Place['source'], string> = {
  gazetteer: 'Bundled list',
  photon: 'Photon',
  nominatim: 'Nominatim',
}


export function SearchBox({ onSelect }: SearchBoxProps) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const listId = useId()
  const statusId = useId()
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)

  // Suggestions: bundled gazetteer immediately, Photon after a pause in typing.
  useEffect(() => {
    const query = text.trim()
    const id = ++request.current
    controller.current?.abort()
    if (query.length < 2) return

    let photonTimer: number | undefined
    void searchGazetteer(query).then((local) => {
      if (id !== request.current) return
      setOptions(local)
      setActive(-1)
      if (query.length < TYPEAHEAD_MIN_CHARS) return
      photonTimer = window.setTimeout(async () => {
        const abort = new AbortController()
        controller.current = abort
        try {
          const remote = await searchPhoton(query, abort.signal)
          if (id !== request.current) return
          setOptions(mergePlaces(local, remote))
          setStatus({ kind: 'idle' })
        } catch (error) {
          if (abort.signal.aborted || id !== request.current) return
          // Suggestions are optional; explicit search still works.
          setStatus({
            kind: 'message',
            message: local.length
              ? 'Live suggestions are unavailable; showing the bundled list.'
              : 'Live suggestions are unavailable. Press Enter to search.',
          })
          console.warn(error)
        }
      }, TYPEAHEAD_DELAY_MS)
    })
    return () => window.clearTimeout(photonTimer)
  }, [text])

  const choose = (place: Place) => {
    request.current++
    controller.current?.abort()
    setText(place.name)
    setOpen(false)
    setActive(-1)
    setStatus({ kind: 'idle' })
    onSelect(place)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (active >= 0 && options[active]) return choose(options[active])
    const query = text.trim()
    if (query.length < 2) {
      setStatus({ kind: 'message', message: 'Type at least two characters.' })
      return
    }
    const id = ++request.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setStatus({ kind: 'busy', message: 'Searching OpenStreetMap…' })
    try {
      const results = await searchNominatim(query, abort.signal)
      if (id !== request.current) return
      if (results.length === 0) {
        setOptions([])
        setStatus({ kind: 'message', message: `No place in India matches “${query}”. Check the spelling or pan the map.` })
        return
      }
      choose(results[0])
      setOptions(mergePlaces(results, []))
    } catch (error) {
      if (abort.signal.aborted || id !== request.current) return
      setStatus({
        kind: 'message',
        message: error instanceof GeocodeError ? error.message : 'Search failed. Try again, or pan the map.',
      })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % options.length)
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const expanded = open && options.length > 0 && text.trim().length >= 2

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Search for a place in India
      </label>
      <input
        id={`${listId}-input`}
        className="search-input"
        type="search"
        placeholder="Search a city, district or place in India"
        autoComplete="off"
        spellCheck={false}
        value={text}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={statusId}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
          setStatus({ kind: 'idle' })
          if (event.target.value.trim().length < 2) setOptions([])
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} className="search-options" role="listbox" hidden={!expanded}>
        {options.map((place, i) => (
          <li
            key={place.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="search-option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(place)}
          >
            <span className="search-option-name">{place.name}</span>
            <span className="search-option-context">{place.context}</span>
            <span className="search-option-source">{SOURCE_LABEL[place.source]}</span>
          </li>
        ))}
      </ul>
      <p id={statusId} className="search-status" role="status" data-kind={status.kind} hidden={status.kind === 'idle'}>
        {status.kind !== 'idle' ? status.message : ''}
      </p>
    </form>
  )
}
