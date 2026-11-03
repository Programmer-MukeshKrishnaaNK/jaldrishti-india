import { expression, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import { quietMissingComparisons } from './basemapStyle'

// The three shield layers as published in OpenFreeMap Liberty (checked Nov 2026), plus an unrelated layer.
const shieldFilter = (network: string[]) => [
  'all',
  ['<=', ['get', 'ref_length'], 6],
  ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  ['match', ['get', 'network'], network, true, false],
]
const style = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenMapTiles' } },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'road_shield_us', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', filter: shieldFilter(['us-highway', 'us-state']) },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'] },
  ],
} as unknown as StyleSpecification

function evaluate(filter: unknown, properties: Record<string, unknown>) {
  const compiled = expression.createExpression(filter, { type: 'boolean', 'property-type': 'data-constant', expression: { interpolated: false, parameters: ['zoom', 'feature'] } } as never)
  if (compiled.result !== 'success') throw new Error('Invalid expression')
  const feature = { type: 2, properties, geometry: [] } as never
  const warnings: string[] = []
  const original = console.warn
  console.warn = (message: string) => warnings.push(message)
  try {
    return { value: compiled.value.evaluate({ zoom: 10 }, feature), warnings }
  } finally {
    console.warn = original
  }
}

describe('quietMissingComparisons', () => {
  const patched = quietMissingComparisons(style)
  const filter = (s: StyleSpecification) => (s.layers[1] as { filter: unknown }).filter

  it('gives the same result for every road, with and without the property', () => {
    for (const properties of [{}, { ref_length: 3, network: 'us-state' }, { ref_length: 9, network: 'us-state' }, { ref_length: 3, network: 'in-national' }]) {
      // MapLibre treats a filter that fails to evaluate (null) as false.
      expect(evaluate(filter(patched), properties).value).toBe(evaluate(filter(style), properties).value ?? false)
    }
  })

  it('no longer warns about a missing property', () => {
    expect(evaluate(filter(style), {}).warnings.length).toBeGreaterThan(0)
    expect(evaluate(filter(patched), {}).warnings).toEqual([])
  })

  it('leaves sources, attribution and other layers untouched', () => {
    expect(patched.sources).toBe(style.sources)
    expect(patched.layers[0]).toBe(style.layers[0])
    expect(patched.layers[2]).toEqual(style.layers[2])
    expect(style.layers[1]).toEqual({ ...style.layers[1], filter: shieldFilter(['us-highway', 'us-state']) })
  })
})
